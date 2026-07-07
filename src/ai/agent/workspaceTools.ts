import type * as vscode from 'vscode';
import { SCAN_EXCLUDE_GLOB } from '../scan/heuristics.js';
import type { AiToolDefinition, AiToolExecutor } from '../providers/types.js';

/**
 * Read-only workspace tools for the agentic codebase scanner. The model
 * drives list_files / read_file / search_code in a loop; everything here is
 * strictly read-only (vscode.workspace.fs.stat/readFile plus findFiles) and
 * confined to the workspace root the factory was created with.
 *
 * Pure logic — path confinement, line windowing, search matching, budget
 * accounting, output formatting — is exported for unit tests; only the thin
 * adapter inside createWorkspaceTools touches vscode.
 */

export interface WorkspaceToolStats {
  toolCalls: number;
  bytesRead: number;
  filesRead: number;
}

export interface WorkspaceTools {
  definitions: AiToolDefinition[];
  execute: AiToolExecutor;
  stats(): WorkspaceToolStats;
}

export const LIST_MAX_RESULTS = 200;
export const READ_MAX_LINES = 400;
export const READ_MAX_BYTES = 32 * 1024;
/** read_file loads the whole file to window it, so refuse pathological sizes. */
export const READ_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const READ_TRUNCATION_NOTE = '…truncated (use startLine/endLine)';
export const SEARCH_MAX_MATCHES = 50;
export const SEARCH_MAX_FILES = 300;
export const SEARCH_MAX_FILE_BYTES = 256 * 1024;
export const SEARCH_MAX_PATTERN_LENGTH = 200;
/** Bound regex evaluation per line — a cheap hedge against pathological patterns. */
export const SEARCH_MAX_LINE_CHARS = 1000;
export const SEARCH_MATCH_TEXT_CHARS = 200;
export const DEFAULT_READ_BUDGET_BYTES = 512 * 1024;
export const BUDGET_EXHAUSTED_MESSAGE =
  'Read budget exhausted — produce your answer from what you have.';

const PATH_HINT = 'Use workspace-relative paths like "src/api/client.ts".';

/**
 * Tracks the total bytes of tool output delivered to the model across the
 * loop. Charging output (rather than raw disk reads) is what bounds context
 * growth; per-call disk caps bound I/O independently.
 */
export class ReadBudget {
  private used = 0;

  constructor(private readonly limitBytes = DEFAULT_READ_BUDGET_BYTES) {}

  get bytesUsed(): number {
    return this.used;
  }

  get exhausted(): boolean {
    return this.used >= this.limitBytes;
  }

  charge(bytes: number): void {
    if (bytes > 0) {
      this.used += bytes;
    }
  }
}

/** Decode URL-encoding until stable (bounded) so %2e%2e / %252e tricks surface. */
function fullyDecode(value: string): string {
  let current = value;
  for (let i = 0; i < 3; i++) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      return current; // malformed escapes stay literal — harmless as a filename
    }
    if (decoded === current) {
      return current;
    }
    current = decoded;
  }
  return current;
}

/**
 * Confine a model-supplied path to the workspace: reject absolute paths,
 * `..` traversal (raw, backslash, or URL-encoded), and control characters.
 * On success returns the normalized workspace-relative path (`/` separators,
 * no `.` segments) — safe to hand to Uri.joinPath.
 */
export function validateWorkspacePath(
  raw: unknown
): { ok: true; path: string } | { ok: false; error: string } {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, error: `Invalid path. ${PATH_HINT}` };
  }
  const decoded = fullyDecode(raw.trim());
  if (decoded.includes('\0')) {
    return { ok: false, error: `Invalid path: contains a null byte. ${PATH_HINT}` };
  }
  const normalized = decoded.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)) {
    return { ok: false, error: `Absolute paths are not allowed. ${PATH_HINT}` };
  }
  if (normalized === '~' || normalized.startsWith('~/')) {
    return { ok: false, error: `Home-relative paths are not allowed. ${PATH_HINT}` };
  }
  const segments = normalized.split('/').filter((s) => s !== '' && s !== '.');
  if (segments.length === 0) {
    return { ok: false, error: `Invalid path. ${PATH_HINT}` };
  }
  if (segments.includes('..')) {
    return {
      ok: false,
      error: `Path traversal ("..") is not allowed. ${PATH_HINT}`,
    };
  }
  return { ok: true, path: segments.join('/') };
}

/** Confine a model-supplied glob: relative, no traversal, bounded length. */
export function sanitizeGlob(
  raw: unknown
): { ok: true; glob: string } | { ok: false; error: string } {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, error: 'Provide a glob pattern like "**/*.ts" or "src/**".' };
  }
  if (raw.length > 500) {
    return { ok: false, error: 'Glob pattern too long (max 500 characters).' };
  }
  const decoded = fullyDecode(raw.trim()).replace(/\\/g, '/');
  if (decoded.includes('\0')) {
    return { ok: false, error: 'Invalid glob: contains a null byte.' };
  }
  if (/(^|\/)\.\.(\/|$)/.test(decoded)) {
    return {
      ok: false,
      error: 'Glob patterns must stay inside the workspace — remove ".." segments.',
    };
  }
  const relative = decoded.replace(/^\/+/, '').replace(/^[a-zA-Z]:\//, '');
  if (relative === '') {
    return { ok: false, error: 'Provide a glob pattern like "**/*.ts" or "src/**".' };
  }
  return { ok: true, glob: relative };
}

// Directory names SCAN_EXCLUDE_GLOB hides from list_files/search_code —
// read_file must refuse them too, or "read_file .git/config" bypasses the glob.
const EXCLUDED_DIR_SEGMENTS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  '.git',
  'target',
  'Pods',
  'vendor',
  '.mocklify',
  'coverage',
  '__pycache__',
]);
const EXCLUDED_FILE_PATTERNS: RegExp[] = [/\.min\.js$/i, /\.d\.ts$/];

// Secrets never belong in a prompt to a third-party model, whatever the glob says.
const SECRET_DIR_SEGMENTS = new Set(['.ssh', '.aws', '.gnupg']);
const SECRET_FILE_PATTERNS: RegExp[] = [
  /^\.env(\..+)?$/i,
  /^\.npmrc$/,
  /^\.netrc$/,
  /^\.htpasswd$/,
  /^id_(rsa|dsa|ecdsa|ed25519)(\..+)?$/,
  /\.(pem|key|p12|pfx|jks|keystore|tfstate)$/i,
];

/**
 * Why a validated workspace-relative path must not be read (excluded
 * directory/file per SCAN_EXCLUDE_GLOB, or a likely secrets file), or
 * undefined when reading it is fine.
 */
export function excludedPathReason(path: string): string | undefined {
  const segments = path.split('/');
  const fileName = segments[segments.length - 1];
  for (const segment of segments.slice(0, -1)) {
    if (SECRET_DIR_SEGMENTS.has(segment)) {
      return `"${path}" may contain credentials, which this tool refuses to read.`;
    }
    if (EXCLUDED_DIR_SEGMENTS.has(segment)) {
      return `"${path}" is inside "${segment}", which is excluded from scanning.`;
    }
  }
  if (SECRET_FILE_PATTERNS.some((pattern) => pattern.test(fileName))) {
    return `"${path}" may contain credentials, which this tool refuses to read.`;
  }
  if (EXCLUDED_FILE_PATTERNS.some((pattern) => pattern.test(fileName))) {
    return `"${path}" is excluded from scanning (generated file).`;
  }
  return undefined;
}

/** Workspace-relative form of a file path under the given root path. */
export function relativeToRoot(rootPath: string, filePath: string): string {
  const prefix = rootPath.endsWith('/') ? rootPath : `${rootPath}/`;
  return filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath;
}

/** Coerce an optional 1-indexed line argument; undefined when absent. */
export function optionalLineNumber(
  value: unknown,
  name: string
): { ok: true; value?: number } | { ok: false; error: string } {
  if (value === undefined || value === null) {
    return { ok: true };
  }
  const num = typeof value === 'string' ? Number(value) : value;
  if (typeof num !== 'number' || !Number.isInteger(num) || num < 1) {
    return { ok: false, error: `"${name}" must be a positive integer line number (1-indexed).` };
  }
  return { ok: true, value: num };
}

export interface FileWindow {
  /** Numbered lines, `<n>: <text>` per line. */
  text: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  /** True when the window stopped before the requested/available end. */
  truncated: boolean;
}

/**
 * Cut a numbered line window out of file content, capped at maxLines and
 * maxBytes. `truncated` means content past the window was withheld (so the
 * caller should append READ_TRUNCATION_NOTE).
 */
export function windowFileContent(
  content: string,
  startLine?: number,
  endLine?: number,
  maxLines = READ_MAX_LINES,
  maxBytes = READ_MAX_BYTES
): FileWindow | { error: string } {
  const lines = content.split(/\r?\n/);
  const totalLines = lines.length;
  const start = startLine ?? 1;
  if (start > totalLines) {
    return { error: `startLine ${start} is past the end of the file (${totalLines} lines).` };
  }
  if (endLine !== undefined && endLine < start) {
    return { error: `endLine (${endLine}) must be >= startLine (${start}).` };
  }
  const requestedEnd = endLine === undefined ? totalLines : Math.min(endLine, totalLines);

  const out: string[] = [];
  let bytes = 0;
  let last = start - 1;
  for (let i = start - 1; i < requestedEnd; i++) {
    if (out.length >= maxLines) {
      break;
    }
    let numbered = `${i + 1}: ${lines[i]}`;
    let lineBytes = Buffer.byteLength(numbered, 'utf-8');
    if (bytes + lineBytes > maxBytes) {
      if (out.length === 0) {
        // A single monster line: deliver a slice rather than nothing.
        numbered = numbered.slice(0, maxBytes);
        lineBytes = Buffer.byteLength(numbered, 'utf-8');
        out.push(numbered);
        last = i + 1;
      }
      break;
    }
    out.push(numbered);
    bytes += lineBytes;
    last = i + 1;
  }

  return {
    text: out.join('\n'),
    startLine: start,
    endLine: last,
    totalLines,
    truncated: last < requestedEnd,
  };
}

/**
 * Conservative ReDoS guard: true when a quantifier applies to a group that
 * itself contains a quantifier (e.g. "(a+)+", "(.*a){20}"), the classic
 * catastrophic-backtracking shape — Node has no regex timeout, so such
 * model-supplied patterns must never be compiled. Over-rejection is fine:
 * the pattern still matches as a plain substring.
 */
export function hasNestedQuantifier(pattern: string): boolean {
  let depth = 0;
  const quantified: boolean[] = [false];
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\') {
      i++; // escaped char — never structural
      continue;
    }
    if (ch === '[') {
      // Character class: quantifier chars inside are literals.
      i++;
      while (i < pattern.length && pattern[i] !== ']') {
        if (pattern[i] === '\\') {
          i++;
        }
        i++;
      }
      continue;
    }
    if (ch === '(') {
      depth++;
      quantified[depth] = false;
      continue;
    }
    if (ch === ')') {
      const inner = quantified[depth] ?? false;
      if (depth > 0) {
        depth--;
      }
      const next = pattern[i + 1];
      if (inner && (next === '*' || next === '+' || next === '?' || next === '{')) {
        return true;
      }
      if (inner) {
        quantified[depth] = true;
      }
      continue;
    }
    if (ch === '*' || ch === '+' || ch === '{' || ch === '?') {
      quantified[depth] = true; // "?" counts: "(a?)+" backtracks exponentially too
    }
  }
  return false;
}

/**
 * Build a per-line matcher for search_code: always a plain-text substring
 * test, plus a regex test when the pattern compiles and passes the ReDoS
 * guard. Patterns over SEARCH_MAX_PATTERN_LENGTH are rejected outright.
 */
export function compileSearchMatcher(
  raw: unknown
): { ok: true; test: (line: string) => boolean } | { ok: false; error: string } {
  if (typeof raw !== 'string' || raw === '') {
    return { ok: false, error: 'Provide a non-empty search pattern.' };
  }
  if (raw.length > SEARCH_MAX_PATTERN_LENGTH) {
    return {
      ok: false,
      error: `Pattern too long (max ${SEARCH_MAX_PATTERN_LENGTH} characters) — use a shorter, distinctive substring.`,
    };
  }
  let regex: RegExp | undefined;
  if (!hasNestedQuantifier(raw)) {
    try {
      regex = new RegExp(raw); // no flags: test() stays stateless
    } catch {
      regex = undefined; // substring matching still applies
    }
  }
  const test = (line: string): boolean => {
    const bounded = line.length > SEARCH_MAX_LINE_CHARS ? line.slice(0, SEARCH_MAX_LINE_CHARS) : line;
    return bounded.includes(raw) || (regex !== undefined && regex.test(bounded));
  };
  return { ok: true, test };
}

/** One search hit in the `path:line: text` shape the tool returns. */
export function formatSearchMatch(path: string, lineNumber: number, line: string): string {
  return `${path}:${lineNumber}: ${line.trim().slice(0, SEARCH_MATCH_TEXT_CHARS)}`;
}

const TOOL_DEFINITIONS: AiToolDefinition[] = [
  {
    name: 'list_files',
    description:
      'List files in the workspace matching a glob pattern. Call this first to map the project before reading anything. Examples: "**/*.ts", "src/**", "**/*{Api,Service,Client,Repository}*". Returns workspace-relative paths, at most 200 — narrow the glob if the result says it was truncated. Dependency and build directories are excluded automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        glob: {
          type: 'string',
          description: 'Glob pattern relative to the workspace root, e.g. "**/*.kt".',
        },
      },
      required: ['glob'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_file',
    description:
      'Read one workspace file as numbered lines. Call this after list_files or search_code has identified a relevant file — never guess paths. At most 400 lines / 32KB are returned per call; when the result says it was truncated, call again with startLine/endLine to page through only the parts you need.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Workspace-relative file path, e.g. "src/api/client.ts".',
        },
        startLine: {
          type: 'number',
          description: 'First line to read, 1-indexed. Defaults to 1.',
        },
        endLine: {
          type: 'number',
          description: 'Last line to read, 1-indexed inclusive. Defaults to end of file.',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_code',
    description:
      'Search file contents across the workspace for a pattern. Prefer this over reading many files when hunting for a symbol, endpoint path, URL, or keyword. The pattern matches each line as a plain-text substring and, when it compiles, also as a regular expression. Pass glob to narrow which files are searched. Returns up to 50 matches as "path:line: text".',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Substring or regular expression to find, max 200 characters.',
        },
        glob: {
          type: 'string',
          description: 'Optional glob to restrict the search, e.g. "**/*.swift".',
        },
      },
      required: ['pattern'],
      additionalProperties: false,
    },
  },
];

/**
 * Create the read-only tool belt for one scan loop. All file access is
 * confined to workspaceRoot, goes through vscode.workspace.fs.stat/readFile
 * and findFiles only (never write, never execute), and shares a single
 * output budget — once it is exhausted every tool returns
 * BUDGET_EXHAUSTED_MESSAGE so the loop converges on an answer.
 */
export function createWorkspaceTools(
  workspaceRoot: vscode.Uri,
  budgetBytes: number = DEFAULT_READ_BUDGET_BYTES
): WorkspaceTools {
    // Lazy so the pure exports above stay importable outside the extension host.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const vs: typeof import('vscode') = require('vscode');
  const budget = new ReadBudget(budgetBytes);
  const filesRead = new Set<string>();
  let toolCalls = 0;

  const statReadableFile = async (
    uri: vscode.Uri,
    displayPath: string
  ): Promise<{ ok: true; stat: vscode.FileStat } | { ok: false; error: string }> => {
    let stat: vscode.FileStat;
    try {
      stat = await vs.workspace.fs.stat(uri);
    } catch {
      return {
        ok: false,
        error: `File not found: "${displayPath}". ${PATH_HINT} Call list_files to discover paths.`,
      };
    }
    if ((stat.type & vs.FileType.SymbolicLink) !== 0) {
      return {
        ok: false,
        error: `"${displayPath}" is a symbolic link, which this tool does not follow. ${PATH_HINT}`,
      };
    }
    if ((stat.type & vs.FileType.Directory) !== 0) {
      return {
        ok: false,
        error: `"${displayPath}" is a directory — pass a file path (call list_files to see its contents).`,
      };
    }
    return { ok: true, stat };
  };

  const readContent = async (uri: vscode.Uri): Promise<string> =>
    Buffer.from(await vs.workspace.fs.readFile(uri)).toString('utf-8');

  // statReadableFile only sees the symlink bit on the FINAL component; a
  // committed directory symlink (e.g. "evil" -> "/") would otherwise be
  // followed transparently, escaping the workspace root.
  const findSymlinkAncestor = async (relPath: string): Promise<string | undefined> => {
    const segments = relPath.split('/');
    let current = workspaceRoot;
    for (let i = 0; i < segments.length - 1; i++) {
      current = vs.Uri.joinPath(current, segments[i]);
      try {
        const stat = await vs.workspace.fs.stat(current);
        if ((stat.type & vs.FileType.SymbolicLink) !== 0) {
          return segments.slice(0, i + 1).join('/');
        }
      } catch {
        return undefined; // missing segment — the final stat reports not-found
      }
    }
    return undefined;
  };

  const listFiles = async (input: Record<string, unknown>): Promise<string> => {
    const glob = sanitizeGlob(input.glob);
    if (!glob.ok) {
      return glob.error;
    }
    const uris = await vs.workspace.findFiles(
      new vs.RelativePattern(workspaceRoot, glob.glob),
      SCAN_EXCLUDE_GLOB,
      LIST_MAX_RESULTS + 1
    );
    if (uris.length === 0) {
      return `No files match "${glob.glob}". Try a broader glob like "**/*.ts" or "**/*".`;
    }
    const truncated = uris.length > LIST_MAX_RESULTS;
    const paths = uris
      .slice(0, LIST_MAX_RESULTS)
      .map((uri) => relativeToRoot(workspaceRoot.path, uri.path))
      .sort();
    const note = truncated
      ? `\n…truncated at ${LIST_MAX_RESULTS} results — narrow the glob.`
      : '';
    return `${paths.length} file(s) matching "${glob.glob}":\n${paths.join('\n')}${note}`;
  };

  const readFile = async (input: Record<string, unknown>): Promise<string> => {
    const validated = validateWorkspacePath(input.path);
    if (!validated.ok) {
      return validated.error;
    }
    const start = optionalLineNumber(input.startLine, 'startLine');
    if (!start.ok) {
      return start.error;
    }
    const end = optionalLineNumber(input.endLine, 'endLine');
    if (!end.ok) {
      return end.error;
    }
    const exclusion = excludedPathReason(validated.path);
    if (exclusion) {
      return `${exclusion} ${PATH_HINT}`;
    }

    const uri = vs.Uri.joinPath(workspaceRoot, ...validated.path.split('/'));
    const symlinked = await findSymlinkAncestor(validated.path);
    if (symlinked) {
      return `"${validated.path}" is under a symbolic link ("${symlinked}"), which this tool does not follow. ${PATH_HINT}`;
    }
    const checked = await statReadableFile(uri, validated.path);
    if (!checked.ok) {
      return checked.error;
    }
    if (checked.stat.size > READ_MAX_FILE_BYTES) {
      return `"${validated.path}" is too large (${checked.stat.size} bytes) to read — use search_code to locate the relevant lines instead.`;
    }
    if (checked.stat.size === 0) {
      return `"${validated.path}" is empty.`;
    }

    let content: string;
    try {
      content = await readContent(uri);
    } catch {
      return `Could not read "${validated.path}". ${PATH_HINT}`;
    }
    filesRead.add(validated.path);

    const window = windowFileContent(content, start.value, end.value);
    if ('error' in window) {
      return window.error;
    }
    const header = `${validated.path} (lines ${window.startLine}-${window.endLine} of ${window.totalLines}):`;
    const note = window.truncated ? `\n${READ_TRUNCATION_NOTE}` : '';
    return `${header}\n${window.text}${note}`;
  };

  const searchCode = async (input: Record<string, unknown>): Promise<string> => {
    const matcher = compileSearchMatcher(input.pattern);
    if (!matcher.ok) {
      return matcher.error;
    }
    let includeGlob = '**/*';
    if (input.glob !== undefined && input.glob !== null) {
      const glob = sanitizeGlob(input.glob);
      if (!glob.ok) {
        return glob.error;
      }
      includeGlob = glob.glob;
    }

    const uris = await vs.workspace.findFiles(
      new vs.RelativePattern(workspaceRoot, includeGlob),
      SCAN_EXCLUDE_GLOB,
      SEARCH_MAX_FILES
    );

    const matches: string[] = [];
    let scanned = 0;
    for (const uri of uris) {
      if (matches.length >= SEARCH_MAX_MATCHES) {
        break;
      }
      const relPath = relativeToRoot(workspaceRoot.path, uri.path);
      try {
        const checked = await statReadableFile(uri, relPath);
        if (!checked.ok || checked.stat.size > SEARCH_MAX_FILE_BYTES) {
          continue;
        }
        const content = await readContent(uri);
        if (content.includes('\0')) {
          continue; // binary
        }
        scanned++;
        filesRead.add(relPath);
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length && matches.length < SEARCH_MAX_MATCHES; i++) {
          if (matcher.test(lines[i])) {
            matches.push(formatSearchMatch(relPath, i + 1, lines[i]));
          }
        }
      } catch {
        // Unreadable file — skip
      }
    }

    const pattern = String(input.pattern);
    if (matches.length === 0) {
      return `No matches for "${pattern}" (searched ${scanned} files). Try a shorter substring or a broader glob.`;
    }
    const notes: string[] = [];
    if (matches.length >= SEARCH_MAX_MATCHES) {
      notes.push(`…stopped at ${SEARCH_MAX_MATCHES} matches — refine the pattern.`);
    }
    if (uris.length >= SEARCH_MAX_FILES) {
      notes.push(`Searched the first ${SEARCH_MAX_FILES} files only — narrow the glob for full coverage.`);
    }
    const suffix = notes.length > 0 ? `\n${notes.join('\n')}` : '';
    return `${matches.length} match(es) for "${pattern}":\n${matches.join('\n')}${suffix}`;
  };

  const execute: AiToolExecutor = async (call) => {
    toolCalls++;
    if (budget.exhausted) {
      return BUDGET_EXHAUSTED_MESSAGE;
    }
    const input = (call.input ?? {}) as Record<string, unknown>;
    let result: string;
    try {
      switch (call.name) {
        case 'list_files':
          result = await listFiles(input);
          break;
        case 'read_file':
          result = await readFile(input);
          break;
        case 'search_code':
          result = await searchCode(input);
          break;
        default:
          return `Unknown tool "${call.name}". Available tools: list_files, read_file, search_code.`;
      }
    } catch (error) {
      return `Tool "${call.name}" failed: ${error instanceof Error ? error.message : String(error)}`;
    }
    budget.charge(Buffer.byteLength(result, 'utf-8'));
    return result;
  };

  return {
    definitions: TOOL_DEFINITIONS,
    execute,
    stats: () => ({
      toolCalls,
      bytesRead: budget.bytesUsed,
      filesRead: filesRead.size,
    }),
  };
}
