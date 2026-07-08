import { scoreApiContentDirectional } from './heuristics.js';

/**
 * Universal, language-agnostic API signals. Detects API surface area in ANY
 * language — including ones we have no framework markers for (Lua, C,
 * Haskell, COBOL, shell scripts, plain-text API notes) — by looking for
 * things that exist in every language: rooted REST-looking path literals,
 * absolute http(s) URLs, HTTP verb tokens adjacent to those literals,
 * JSON-shaped object literals, and auth vocabulary.
 *
 * Pure module: no vscode dependency, fully unit-testable.
 *
 * PERFORMANCE CONTRACT: every regex in this file is linear-time. No nested
 * quantifiers, no unbounded backtracking — each quantified run is a single
 * character class (bounded where ambiguity with the following token is
 * possible), alternations are fixed words, and lookarounds are fixed-width.
 * Analysis is additionally capped by MAX_ANALYZED_CHARS / MAX_MATCHES /
 * MAX_WINDOW_SCANS so pathological inputs stay cheap.
 */

/** Universal-signal score at or above which a file can seed a scan. */
export const UNIVERSAL_SEED_THRESHOLD = 10;

export interface UniversalSignals {
  /** Unique REST-looking rooted path literals (trailing slash stripped). */
  urlPaths: string[];
  /** Unique absolute http(s) URLs (noise hosts like w3.org filtered out). */
  absoluteUrls: string[];
  /** HTTP verb tokens found within ~80 chars of a path/URL literal. */
  methodHints: number;
  /** JSON-looking object literals with 2+ key/value pairs. */
  jsonShapes: number;
  /** Distinct auth markers present (Authorization, Bearer, api key headers). */
  authHints: number;
  /** Combined score — see the formula on detectUniversalSignals. */
  score: number;
}

export type UniversalDirection = 'serves' | 'consumes';

export interface UniversalFileScore {
  /** Client-direction score from the marker heuristics (known ecosystems). */
  clientScore: number;
  /** Server-direction score from the marker heuristics (known ecosystems). */
  serverScore: number;
  /** Language-agnostic score; can reach UNIVERSAL_SEED_THRESHOLD alone. */
  universalScore: number;
  /**
   * Best-guess direction when only universal signals are available:
   * 'consumes' unless server-ish shapes (verb at line start followed by a
   * rooted path, or a route-registration call shape) push 'serves'. When the
   * directional heuristics disagree with each other, the higher one wins.
   */
  universalDirection: UniversalDirection;
}

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

const MAX_ANALYZED_CHARS = 1_000_000;
const MAX_MATCHES = 20_000;
const MAX_WINDOW_SCANS = 2_000;
const VERB_WINDOW = 80;
const MAX_PATHS_RETURNED = 100;
const MAX_URLS_RETURNED = 50;

// ---------------------------------------------------------------------------
// Detection regexes (all linear-time; see PERFORMANCE CONTRACT above)
// ---------------------------------------------------------------------------

/**
 * Rooted path literal in any quote style: "/api/users/{id}", '/v1/…', `…`.
 * Single character class (quotes excluded from it) with a bounded run, so a
 * missing closing quote costs at most 256 backtrack steps per opening quote.
 */
const QUOTED_PATH_RE = /(["'`])(\/[A-Za-z0-9_.{}:$/-]{1,256})\1/g;

/**
 * Bare `VERB /path` shape (docs, COBOL-ish, route tables). Uppercase-only so
 * prose like "get / put" does not fire. Counts as a path AND a method hint.
 */
const BARE_VERB_PATH_RE =
  /(?<![A-Za-z0-9_])(?:GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)[ \t]{1,8}["'`]?(\/[A-Za-z0-9_.{}:$/-]{1,256})/g;

/**
 * Absolute http(s) URL; host captured in group 1, port group 2, rest group 3.
 * Host class and rest class start on disjoint characters, so no ambiguity.
 */
const ABS_URL_RE =
  /\bhttps?:\/\/([A-Za-z0-9.-]{1,253})(:\d{1,5})?((?:[/?#][^\s"'`<>)\]}]{0,300})?)/g;

/**
 * REST-looking path validator, only ever run on extracted literals (≤ 257
 * chars): 1–20 segments of path-safe characters, optional trailing slash.
 * Segments are separated by a mandatory '/' that the segment class excludes,
 * so backtracking is bounded by the segment count.
 */
const PATH_SHAPE_RE = /^\/[A-Za-z0-9_.{}:$-]{1,64}(?:\/[A-Za-z0-9_.{}:$-]{1,64}){0,19}\/?$/;

const HAS_LETTER_RE = /[A-Za-z]/;

/** Static assets / source files referenced by rooted paths are not API routes. */
const ASSET_EXT_RE =
  /\.(?:png|jpe?g|gif|svg|ico|bmp|webp|avif|css|scss|less|woff2?|ttf|otf|eot|mp[34]|m4[av]|wav|ogg|mov|map|html?|md|markdown|txt|xml|ya?ml|toml|js|mjs|cjs|jsx|ts|tsx|py|rb|go|rs|java|kt|swift|dart|sh|c|h|cpp|hpp)$/i;

/** Filesystem-looking first segments — "/usr/local/bin" is not an API route. */
const FS_PATH_PREFIXES = new Set([
  'usr', 'etc', 'bin', 'sbin', 'tmp', 'var', 'dev', 'opt', 'proc', 'sys',
  'mnt', 'boot', 'lib', 'lib64', 'private', 'applications', 'windows', 'system32',
]);

/**
 * Hosts (any subdomain included) that appear in licenses/schemas/namespaces,
 * READMEs, badges, CI configs, and build infra — never as the app's own API.
 */
const NOISE_HOST_SUFFIXES = [
  'w3.org', 'schema.org', 'xmlns.com', 'apache.org', 'opensource.org',
  'openssl.org', 'gnu.org', 'schemas.microsoft.com', 'schemas.android.com',
  // badges / CI / coverage
  'shields.io', 'badge.fury.io', 'badgen.net', 'travis-ci.org', 'travis-ci.com',
  'circleci.com', 'appveyor.com', 'codecov.io', 'coveralls.io', 'snyk.io',
  'saucelabs.com', 'browserstack.com',
  // code hosting content/pages (api.github.com etc. stay legitimate — see
  // NOISE_HOSTS_EXACT for the root sites)
  'githubusercontent.com', 'github.io', 'gitlab.io', 'sourceforge.net',
  // docs / community / build infra commonly hyperlinked from READMEs
  'gradle.org', 'contributor-covenant.org', 'keepachangelog.com', 'semver.org',
  'opencollective.com', 'gitter.im', 'stackblitz.com', 'codesandbox.io',
  'thinkster.io', 'choosealicense.com', 'creativecommons.org',
];

/**
 * Exact noise hosts (with their www. twins) whose SUBDOMAINS can still be real
 * APIs an app calls (api.github.com, api.twitter.com, registry.npmjs.org, …),
 * so only the root web sites are filtered.
 */
const NOISE_HOSTS_EXACT = new Set([
  'github.com', 'gitlab.com', 'bitbucket.org', 'npmjs.com', 'npmjs.org',
  'yarnpkg.com', 'twitter.com', 'x.com', 'facebook.com', 'youtube.com',
  'linkedin.com', 'medium.com', 'stackoverflow.com', 'reddit.com',
]);

/** HTTP verb as a standalone token, any casing (`GET`, `:get`, `"post"`). */
const VERB_TOKEN_RE =
  /(?<![A-Za-z0-9_])(?:GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)(?![A-Za-z0-9_])/i;

/**
 * JSON-shaped object literal with at least two key/value pairs. The value
 * class excludes ',', '{', '}' and newlines so the following ',' is found
 * deterministically; all whitespace runs are bounded.
 */
const JSON_PAIR_RE =
  /\{\s{0,32}["'][\w$ .-]{1,64}["']\s{0,8}[:=]\s{0,8}[^,{}\n]{0,160},\s{0,32}["'][\w$ .-]{1,64}["']\s{0,8}[:=]/g;

/** Auth vocabulary; lookarounds keep `api-key` from double-counting `x-api-key`. */
const AUTH_MARKER_RES: RegExp[] = [
  /\bauthorization\b/i,
  /\bbearer\b/i,
  /(?<![\w-])api[-_]key(?![\w-])/i,
  /(?<![\w-])x-api-key(?![\w-])/i,
];

/**
 * Server-ish shapes usable in any language: a verb at line start immediately
 * followed by a rooted path literal (Rails/Sinatra-style route tables, HTTP
 * doc blocks), or a route-registration call shape.
 */
const SERVER_SHAPE_RES: RegExp[] = [
  /^[ \t]{0,32}(?:get|post|put|patch|delete|options|head)\b[ \t]{1,8}["'`]?\//im,
  /["'`](?:GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)["'`]\s{0,8},\s{0,8}["'`]\//,
  /\b(?:route|routes|handle|register)[A-Za-z0-9_]{0,32}\s{0,8}\(\s{0,8}["'`]\//i,
];

// ---------------------------------------------------------------------------
// detectUniversalSignals
// ---------------------------------------------------------------------------

function isRestLikePath(raw: string): boolean {
  if (!PATH_SHAPE_RE.test(raw) || !HAS_LETTER_RE.test(raw)) {
    return false;
  }
  const trimmed = raw.endsWith('/') ? raw.slice(0, -1) : raw;
  const firstSegment = trimmed.slice(1).split('/', 1)[0];
  if (FS_PATH_PREFIXES.has(firstSegment.toLowerCase())) {
    return false;
  }
  return !ASSET_EXT_RE.test(trimmed);
}

function isNoiseHost(host: string): boolean {
  const lower = host.toLowerCase();
  const bare = lower.startsWith('www.') ? lower.slice(4) : lower;
  if (NOISE_HOSTS_EXACT.has(bare)) {
    return true;
  }
  return NOISE_HOST_SUFFIXES.some((suffix) => lower === suffix || lower.endsWith(`.${suffix}`));
}

function addPath(paths: Set<string>, raw: string): void {
  const normalized = raw.endsWith('/') ? raw.slice(0, -1) : raw;
  if (normalized.length > 1 && paths.size < MAX_PATHS_RETURNED) {
    paths.add(normalized);
  }
}

/**
 * Detect language-agnostic API signals in file content.
 *
 * SCORE FORMULA (documented + tested):
 *
 *     score = 4 * min(|urlPaths|,     5)   // rooted REST-ish path literals
 *           + 4 * min(|absoluteUrls|, 3)   // absolute http(s) endpoints
 *           + 3 * min(methodHints,    5)   // verbs adjacent to those literals
 *           + 1 * min(jsonShapes,     4)   // payload-looking object literals
 *           + 2 * min(authHints,      4)   // auth vocabulary
 *
 * Calibrated against UNIVERSAL_SEED_THRESHOLD (10): two path literals plus
 * one adjacent verb (11), or one absolute URL whose REST-ish path is adjacent
 * to a verb (4+4+3 = 11), crosses the threshold; a lone URL (4 or 8) or a
 * pure JSON config file (≤ 4) stays below it.
 */
export function detectUniversalSignals(content: string): UniversalSignals {
  const text =
    content.length > MAX_ANALYZED_CHARS ? content.slice(0, MAX_ANALYZED_CHARS) : content;

  const paths = new Set<string>();
  const urls = new Set<string>();
  const literalSpans: Array<[number, number]> = [];
  let methodHints = 0;

  let seen = 0;
  for (const match of text.matchAll(QUOTED_PATH_RE)) {
    if (++seen > MAX_MATCHES) {
      break;
    }
    const raw = match[2];
    if (!isRestLikePath(raw)) {
      continue;
    }
    addPath(paths, raw);
    if (literalSpans.length < MAX_WINDOW_SCANS) {
      literalSpans.push([match.index ?? 0, (match.index ?? 0) + match[0].length]);
    }
  }

  seen = 0;
  for (const match of text.matchAll(ABS_URL_RE)) {
    if (++seen > MAX_MATCHES) {
      break;
    }
    if (isNoiseHost(match[1])) {
      continue;
    }
    if (urls.size < MAX_URLS_RETURNED) {
      urls.add(match[0]);
    }
    const rest = match[3] ?? '';
    if (rest.startsWith('/')) {
      const cut = rest.search(/[?#]/);
      const pathPart = cut === -1 ? rest : rest.slice(0, cut);
      if (isRestLikePath(pathPart)) {
        addPath(paths, pathPart);
      }
    }
    if (literalSpans.length < MAX_WINDOW_SCANS) {
      literalSpans.push([match.index ?? 0, (match.index ?? 0) + match[0].length]);
    }
  }

  seen = 0;
  for (const match of text.matchAll(BARE_VERB_PATH_RE)) {
    if (++seen > MAX_MATCHES) {
      break;
    }
    const raw = match[1];
    if (!isRestLikePath(raw)) {
      continue;
    }
    addPath(paths, raw);
    methodHints++;
  }

  for (const [start, end] of literalSpans) {
    const window = text.slice(Math.max(0, start - VERB_WINDOW), Math.min(text.length, end + VERB_WINDOW));
    if (VERB_TOKEN_RE.test(window)) {
      methodHints++;
    }
  }

  let jsonShapes = 0;
  seen = 0;
  for (const match of text.matchAll(JSON_PAIR_RE)) {
    void match;
    jsonShapes++;
    if (++seen > MAX_MATCHES) {
      break;
    }
  }

  let authHints = 0;
  for (const marker of AUTH_MARKER_RES) {
    if (marker.test(text)) {
      authHints++;
    }
  }

  const urlPaths = [...paths];
  const absoluteUrls = [...urls];
  const score =
    4 * Math.min(urlPaths.length, 5) +
    4 * Math.min(absoluteUrls.length, 3) +
    3 * Math.min(methodHints, 5) +
    1 * Math.min(jsonShapes, 4) +
    2 * Math.min(authHints, 4);

  return { urlPaths, absoluteUrls, methodHints, jsonShapes, authHints, score };
}

// ---------------------------------------------------------------------------
// Binary sniffing
// ---------------------------------------------------------------------------

/**
 * Content sniff so scanning can include ANY extension safely: reject when a
 * NUL byte appears or when more than 10% of the sampled bytes are
 * non-printable control characters. UTF-16/32 BOMs are accepted as text even
 * though such files contain NULs later. Empty files count as text.
 */
export function isProbablyTextFile(firstBytes: Uint8Array): boolean {
  if (firstBytes.length === 0) {
    return true;
  }
  if (firstBytes.length >= 2) {
    const a = firstBytes[0];
    const b = firstBytes[1];
    if ((a === 0xff && b === 0xfe) || (a === 0xfe && b === 0xff)) {
      return true; // UTF-16/32 BOM
    }
  }
  const sample = Math.min(firstBytes.length, 8192);
  let suspicious = 0;
  for (let i = 0; i < sample; i++) {
    const byte = firstBytes[i];
    if (byte === 0) {
      return false;
    }
    // Control chars other than \t \n \v \f \r, plus DEL
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20) || byte === 0x7f) {
      suspicious++;
    }
  }
  return suspicious / sample <= 0.1;
}

// ---------------------------------------------------------------------------
// Path blocklist (replaces the extension whitelist as a gate)
// ---------------------------------------------------------------------------

/** Vendored/generated directory segments; superset of SCAN_EXCLUDE_GLOB's. */
const SKIP_DIR_SEGMENTS = new Set([
  'node_modules', 'bower_components', 'dist', 'build', 'out', '.git', '.hg', '.svn',
  'target', 'pods', 'vendor', '.mocklify', 'coverage', '__pycache__',
  '.next', '.nuxt', '.svelte-kit', '.dart_tool', '.gradle', 'deriveddata',
  '.venv', 'venv', '.terraform', '.idea', '.cache', '.parcel-cache', '.turbo',
  '.pytest_cache', '.mypy_cache', '.tox',
]);

/** Known-binary / media / archive / generated extensions (lowercase). */
const SKIP_EXTENSIONS = new Set([
  // images (svg included: XML noise, never API source)
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'icns', 'webp', 'avif', 'heic', 'heif',
  'tif', 'tiff', 'psd', 'xcf', 'svg', 'svgz',
  // fonts
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  // audio / video
  'mp3', 'mp4', 'm4a', 'm4v', 'aac', 'wav', 'ogg', 'oga', 'ogv', 'flac',
  'mov', 'avi', 'wmv', 'mkv', 'webm', 'mid', 'midi',
  // archives / packages
  'zip', 'tar', 'gz', 'tgz', 'bz2', 'tbz2', 'xz', 'txz', 'zst', 'br', '7z', 'rar',
  'jar', 'war', 'ear', 'aar', 'apk', 'ipa', 'nupkg', 'gem', 'whl', 'egg',
  'deb', 'rpm', 'dmg', 'pkg', 'msi', 'iso',
  // compiled / native binaries
  'wasm', 'class', 'dex', 'pyc', 'pyo', 'o', 'a', 'obj', 'lib', 'dll', 'dylib',
  'so', 'ko', 'exe', 'bin', 'dat', 'pdb', 'nib', 'car', 'elc', 'rlib',
  // office / documents
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp',
  'rtf', 'pages', 'key', 'numbers', 'epub',
  // databases / data / ML weights
  'db', 'sqlite', 'sqlite3', 'realm', 'mdb', 'parquet', 'avro', 'orc',
  'feather', 'arrow', 'pkl', 'pickle', 'npy', 'npz',
  'pb', 'onnx', 'pt', 'pth', 'h5', 'hdf5', 'tflite', 'ckpt', 'safetensors', 'gguf',
  // locks / generated
  'lock', 'lockb', 'lockfile', 'map', 'min', 'snap', 'log',
]);

/** Exact basenames (lowercase) that are always generated. */
const SKIP_BASENAMES = new Set(['go.sum', '.ds_store']);

/**
 * Path-based gate replacing the API_FILE_GLOB extension WHITELIST with a
 * blocklist: any path is scannable unless it is a known binary/media/archive/
 * lock/minified/generated file or sits in a vendored directory (aligned with
 * SCAN_EXCLUDE_GLOB). Extensionless files (Makefile, Dockerfile, .env) pass;
 * pair with isProbablyTextFile for content-level safety.
 */
export function shouldScanPath(path: string): boolean {
  const segments = path.replace(/\\/g, '/').split('/');
  const basename = (segments[segments.length - 1] ?? '').toLowerCase();
  for (let i = 0; i < segments.length - 1; i++) {
    if (SKIP_DIR_SEGMENTS.has(segments[i].toLowerCase())) {
      return false;
    }
  }
  if (SKIP_BASENAMES.has(basename)) {
    return false;
  }
  if (
    basename.endsWith('-lock.json') ||
    basename.endsWith('-lock.yaml') ||
    basename.endsWith('-lock.yml') ||
    basename.endsWith('.d.ts')
  ) {
    return false;
  }
  if (basename.includes('.min.')) {
    return false;
  }
  const dot = basename.lastIndexOf('.');
  if (dot > 0 && SKIP_EXTENSIONS.has(basename.slice(dot + 1))) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Budgeted sampling
// ---------------------------------------------------------------------------

/** Name fragments hinting a file is API-relevant (FILE_NAME_HINTS idea). */
const NAME_HINT_RE =
  /(api|service|client|network|controller|handler|route|server|endpoint|gateway|graphql|http)/i;

function topLevelDir(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '');
  const slash = normalized.indexOf('/');
  return slash === -1 ? '' : normalized.slice(0, slash);
}

/**
 * Pick at most maxFiles paths to scan. Under the cap, returns all paths
 * (deduped, sorted). Over the cap: paths whose names hint API relevance come
 * first, and within each tier files are taken round-robin across top-level
 * directories (breadth-first) so one giant folder cannot starve the others.
 * Fully deterministic: input order never affects the output.
 */
export function pickScanCandidates(paths: string[], maxFiles: number): string[] {
  const cap = Math.floor(maxFiles);
  if (cap <= 0) {
    return [];
  }
  const unique = [...new Set(paths)].sort();
  if (unique.length <= cap) {
    return unique;
  }

  const hinted: string[] = [];
  const rest: string[] = [];
  for (const path of unique) {
    (NAME_HINT_RE.test(path) ? hinted : rest).push(path);
  }

  const result: string[] = [];
  const takeRoundRobin = (tier: string[]): void => {
    if (result.length >= cap || tier.length === 0) {
      return;
    }
    const groups = new Map<string, string[]>();
    for (const path of tier) {
      const key = topLevelDir(path);
      const group = groups.get(key);
      if (group) {
        group.push(path);
      } else {
        groups.set(key, [path]);
      }
    }
    const keys = [...groups.keys()].sort();
    const cursors = new Map<string, number>(keys.map((key) => [key, 0]));
    let advanced = true;
    while (advanced && result.length < cap) {
      advanced = false;
      for (const key of keys) {
        if (result.length >= cap) {
          break;
        }
        const group = groups.get(key) as string[];
        const index = cursors.get(key) as number;
        if (index < group.length) {
          result.push(group[index]);
          cursors.set(key, index + 1);
          advanced = true;
        }
      }
    }
  };

  takeRoundRobin(hinted);
  takeRoundRobin(rest);
  return result;
}

// ---------------------------------------------------------------------------
// Integration contract
// ---------------------------------------------------------------------------

function hasServerShape(content: string): boolean {
  const text =
    content.length > MAX_ANALYZED_CHARS ? content.slice(0, MAX_ANALYZED_CHARS) : content;
  return SERVER_SHAPE_RES.some((shape) => shape.test(text));
}

/**
 * Repo-meta documentation basenames (README, CHANGELOG, CODE_OF_CONDUCT, …):
 * their hyperlinks and prose verbs ("Get started", "Head over") mimic API
 * signals, so their universal score is halved. Genuine API docs (verb + path
 * tables, auth vocabulary) still clear UNIVERSAL_SEED_THRESHOLD after
 * halving; a link farm does not.
 */
const REPO_DOC_BASENAME_RE =
  /^(?:readme|changelog|changes|history|news|code[-_]of[-_]conduct|conduct|contributing|contributors|authors|maintainers|codeowners|license|licence|notice|copying|security|support|governance|funding|backers|sponsors|acknowledgements?|roadmap)\b/i;

function isRepoDocFile(fileName: string): boolean {
  const segments = fileName.replace(/\\/g, '/').split('/');
  return REPO_DOC_BASENAME_RE.test(segments[segments.length - 1] ?? '');
}

/**
 * Combine the marker heuristics (known ecosystems) with universal signals so
 * unknown-language files can still seed a scan: universalScore alone can
 * reach UNIVERSAL_SEED_THRESHOLD (>= 10). Repo-meta docs (README/CHANGELOG/…)
 * get their universal score halved so ordinary project documentation cannot
 * out-seed real API files. Direction defaults to 'consumes' unless the
 * directional heuristics favor the server side or — when they are tied
 * (typically both 0 for unknown languages) — a universal server-ish shape is
 * present.
 */
export function scoreFileUniversal(content: string, fileName: string): UniversalFileScore {
  const { clientScore, serverScore } = scoreApiContentDirectional(content, fileName);
  const signals = detectUniversalSignals(content);
  const universalScore = isRepoDocFile(fileName) ? Math.floor(signals.score / 2) : signals.score;

  let universalDirection: UniversalDirection = 'consumes';
  if (serverScore > clientScore) {
    universalDirection = 'serves';
  } else if (serverScore === clientScore && hasServerShape(content)) {
    universalDirection = 'serves';
  }

  return {
    clientScore,
    serverScore,
    universalScore,
    universalDirection,
  };
}

/**
 * Majority universal direction of a seed set that owes its place to the
 * universal-signal layer alone (every file's marker scores stay below the
 * seed threshold — same criterion as the agentic 'language-unknown' note).
 * Returns undefined when any file carries real marker confidence: the
 * directional marker heuristics are then the better judge.
 */
export function universalLean(
  files: readonly {
    clientScore: number;
    serverScore: number;
    universalDirection?: UniversalDirection;
  }[],
  markerSeedThreshold = UNIVERSAL_SEED_THRESHOLD
): UniversalDirection | undefined {
  const universalOnly =
    files.length > 0 &&
    files.every(
      (file) => file.clientScore < markerSeedThreshold && file.serverScore < markerSeedThreshold
    );
  if (!universalOnly) {
    return undefined;
  }
  const serves = files.filter((file) => file.universalDirection === 'serves').length;
  return serves * 2 > files.length ? 'serves' : 'consumes';
}
