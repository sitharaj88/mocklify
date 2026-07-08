import type { ApiDirection, ProjectKind } from './projectProfile.js';

/**
 * Declarative ecosystem registry — the single source of truth for every
 * framework/stack Mocklify knows how to scan. heuristics.ts's marker arrays
 * (STRONG_MARKERS, CLIENT_MARKERS_EXTRA, SERVER_MARKERS) and
 * projectProfile.ts's manifest framework tables are DERIVED from this
 * registry, so adding a stack is a data entry here, not code archaeology.
 *
 * ── HOW TO ADD AN ECOSYSTEM (usually < 10 lines) ───────────────────────────
 * Append one object to ECOSYSTEMS below (or call registerEcosystem at
 * runtime):
 *
 *   {
 *     id: 'sinatra',
 *     languages: ['rb'],                 // file extensions it concerns
 *     kind: 'backend',                   // ProjectKind from projectProfile
 *     direction: 'serves',               // 'consumes' | 'serves' | 'both'
 *     manifestRules: [
 *       { file: 'Gemfile', contentPattern: /\bgem\s+['"]sinatra['"]/, framework: 'Sinatra' },
 *     ],
 *     clientMarkers: [],                 // regexes spotting client HTTP calls
 *     serverMarkers: [/\bSinatra::Base\b/], // regexes spotting route declarations
 *   }
 *
 * Rules for marker regexes (enforced by registerEcosystem; follow them in
 * static packs too):
 *   - anchor with \b, a lookbehind (?<! / (?<=, or ^ so partial identifiers
 *     never match mid-token;
 *   - keep them linear-time: never apply a quantifier to a group that itself
 *     ends in a quantifier ('(\w+)*'-style catastrophic backtracking);
 *   - each regex must live in exactly ONE pack — scoring counts distinct
 *     matching regexes, so duplicating one across packs would double-count.
 *
 * Pack order matters ONLY for the derived manifest tables (it fixes the
 * order of framework names in evidence strings); marker order is
 * behaviorally irrelevant.
 * ───────────────────────────────────────────────────────────────────────────
 */

export interface EcosystemManifestRule {
  /** Manifest basename: exact string, or a RegExp tested against the basename. */
  file: string | RegExp;
  /** Pattern applied to the probe text (dep keys for package.json/composer.json, raw text otherwise). */
  contentPattern?: RegExp;
  /** Human-readable framework name surfaced in profiles and evidence. */
  framework: string;
}

export interface EcosystemPack {
  /** Stable identifier, e.g. 'spring', 'react', 'ktor-client'. */
  id: string;
  /** File extensions (without dot) this ecosystem concerns. */
  languages: string[];
  kind: ProjectKind;
  direction: ApiDirection;
  manifestRules: EcosystemManifestRule[];
  clientMarkers: RegExp[];
  serverMarkers: RegExp[];
  /** Optional per-language type-definition hint for data-model following. */
  modelHints?: { defRegex?: RegExp };
}

// ---------------------------------------------------------------------------
// Strong-tier tagging
// ---------------------------------------------------------------------------
// heuristics.ts historically split client markers into STRONG_MARKERS
// (module-private) and CLIENT_MARKERS_EXTRA (exported). Both feed the client
// score identically, but the exported array must keep its exact membership,
// so legacy "strong" markers are tagged here at construction time. Markers of
// packs added via registerEcosystem land in the extra view.
const STRONG_TIER = new WeakSet<RegExp>();

function strong(marker: RegExp): RegExp {
  STRONG_TIER.add(marker);
  return marker;
}

const GRADLE_FILE = /^(?:build|settings)\.gradle(?:\.kts)?$/;

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

export const ECOSYSTEMS: EcosystemPack[] = [
  // ── Client-side ecosystems ────────────────────────────────────────────────
  {
    id: 'web-fetch',
    languages: ['ts', 'tsx', 'js', 'jsx', 'vue', 'svelte'],
    kind: 'web',
    direction: 'consumes',
    manifestRules: [],
    clientMarkers: [
      strong(/\bfetch\s*\(/), // web fetch
      strong(/\baxios\b/), // axios
      strong(/\bXMLHttpRequest\b/),
    ],
    serverMarkers: [],
  },
  {
    id: 'react',
    languages: ['ts', 'tsx', 'js', 'jsx'],
    kind: 'web',
    direction: 'consumes',
    manifestRules: [
      { file: 'package.json', contentPattern: /^(react|react-dom)$/, framework: 'React' },
    ],
    clientMarkers: [
      strong(/\bcreateApi\b|\bfetchBaseQuery\b/), // RTK Query
      strong(/\buseSWR\b|\buseQuery\b|\buseMutation\b/), // SWR / react-query
    ],
    serverMarkers: [],
  },
  {
    id: 'vue',
    languages: ['vue', 'ts', 'js'],
    kind: 'web',
    direction: 'consumes',
    manifestRules: [{ file: 'package.json', contentPattern: /^vue$/, framework: 'Vue' }],
    clientMarkers: [],
    serverMarkers: [],
  },
  {
    id: 'angular',
    languages: ['ts'],
    kind: 'web',
    direction: 'consumes',
    manifestRules: [
      { file: 'package.json', contentPattern: /^@angular\/core$/, framework: 'Angular' },
    ],
    clientMarkers: [
      // Angular HttpClient method calls (typed or via this.http)
      /\bthis\.http\.(?:get|post|put|patch|delete|request)\s*\(/,
      /\bhttp\.(?:get|post|put|patch|delete)\s*</,
    ],
    serverMarkers: [],
  },
  {
    id: 'svelte',
    languages: ['svelte', 'ts', 'js'],
    kind: 'web',
    direction: 'consumes',
    manifestRules: [{ file: 'package.json', contentPattern: /^svelte$/, framework: 'Svelte' }],
    clientMarkers: [],
    serverMarkers: [],
  },
  {
    id: 'jquery',
    languages: ['js', 'ts'],
    kind: 'web',
    direction: 'consumes',
    manifestRules: [],
    clientMarkers: [strong(/\$\.(ajax|get|post)\s*\(/)],
    serverMarkers: [],
  },
  {
    id: 'ky-got',
    languages: ['ts', 'js'],
    kind: 'web',
    direction: 'consumes',
    manifestRules: [],
    clientMarkers: [
      strong(/\bky\.(get|post|put|delete|patch)\b|\bgot\.(get|post|put|delete|patch)\b/),
    ],
    serverMarkers: [],
  },
  {
    id: 'graphql-client', // Apollo / urql / graphql-request
    languages: ['ts', 'tsx', 'js', 'jsx'],
    kind: 'web',
    direction: 'consumes',
    manifestRules: [],
    clientMarkers: [
      strong(/\bApolloClient\b|\bInMemoryCache\b|\buseLazyQuery\b/),
      strong(/\bgql\s*(?:`|\()/), // gql template tag
      strong(/\bGraphQLClient\b|['"`]graphql-request['"`]/),
      strong(/['"`]@?urql(?:\/[\w-]+)?['"`]/),
      strong(/["'`][^"'`\s]*\/graphql\b/), // generic POST-to-/graphql endpoint
    ],
    serverMarkers: [],
  },
  {
    id: 'trpc',
    languages: ['ts', 'tsx'],
    kind: 'web',
    direction: 'consumes',
    manifestRules: [],
    clientMarkers: [
      /\bcreateTRPC(?:ProxyClient|Client|React|Next)\b/,
      /\bhttpBatchLink\b|\bhttpLink\b/,
      /['"`]@trpc\/[\w-]+['"`]/,
      // Lookbehind (not \b): '$' is a non-word char inside [\w$], so \b would
      // restart the match before every word char after a '$' — quadratic on
      // long $-delimited identifier runs (e.g. mangled generated code).
      /(?<![\w$])[\w$]+\.[\w$]+\.(?:useQuery|useMutation|useInfiniteQuery)\s*\(/,
    ],
    serverMarkers: [],
  },
  {
    id: 'openapi-client', // openapi-generator / openapi-typescript-codegen
    languages: ['ts', 'js'],
    kind: 'library',
    direction: 'consumes',
    manifestRules: [],
    clientMarkers: [/\bnew\s+Configuration\s*\(/, /\bBASE_PATH\s*[:=]/, /\bOpenAPI\.BASE\b/],
    serverMarkers: [],
  },
  {
    id: 'grpc-web', // grpc-web / Connect
    languages: ['ts', 'js'],
    kind: 'web',
    direction: 'consumes',
    manifestRules: [],
    clientMarkers: [
      /\bcreatePromiseClient\b|\bcreateConnectTransport\b|\bcreateGrpcWebTransport\b/,
      /\bGrpcWebClientBase\b/,
      /['"`](?:grpc-web|@connectrpc\/[\w-]+|@bufbuild\/connect[\w-]*)['"`]/,
    ],
    serverMarkers: [],
  },
  {
    id: 'capacitor',
    languages: ['ts', 'js'],
    kind: 'ionic-capacitor',
    direction: 'consumes',
    manifestRules: [],
    clientMarkers: [/\bCapacitorHttp\b/, /\bHttp\.(?:request|get|post|put|patch|del)\s*\(/],
    serverMarkers: [],
  },
  {
    id: 'retrofit', // Retrofit / OkHttp / Volley / HttpURLConnection
    languages: ['kt', 'java'],
    kind: 'mobile-android',
    direction: 'consumes',
    manifestRules: [
      { file: GRADLE_FILE, contentPattern: /retrofit/i, framework: 'Retrofit' },
      { file: GRADLE_FILE, contentPattern: /okhttp/i, framework: 'OkHttp' },
      { file: GRADLE_FILE, contentPattern: /volley/i, framework: 'Volley' },
    ],
    clientMarkers: [
      strong(/@(GET|POST|PUT|DELETE|PATCH|HEAD|Multipart|FormUrlEncoded)\b/), // Retrofit
      strong(/\bRetrofit\b/),
      strong(/\bOkHttpClient\b|\bokhttp3\b/),
      strong(/\bHttpURLConnection\b/),
      strong(/\bVolley\b|\bJsonObjectRequest\b/),
    ],
    serverMarkers: [],
    modelHints: { defRegex: /\b(?:data\s+class|class|interface|enum\s+class)\s+[A-Z]\w*/ },
  },
  {
    id: 'ios-http', // URLSession / Alamofire / NSURLSession
    languages: ['swift', 'm', 'mm'],
    kind: 'mobile-ios',
    direction: 'consumes',
    manifestRules: [
      { file: /^(?:Podfile|Package\.swift)$/, contentPattern: /Alamofire/, framework: 'Alamofire' },
      { file: /^(?:Podfile|Package\.swift)$/, contentPattern: /\bMoya\b/, framework: 'Moya' },
    ],
    clientMarkers: [
      strong(/\bURLSession\b/),
      strong(/\bAlamofire\b|\bAF\.request\b/),
      /\bNSURLSession\b/, // Objective-C
      /\bdataTaskWithRequest\b|\bdataTaskWithURL\b/,
    ],
    serverMarkers: [],
    modelHints: { defRegex: /\b(?:struct|class|enum)\s+[A-Z]\w*\s*:\s*[^{]*\bCodable\b/ },
  },
  {
    id: 'ktor-client', // Ktor HttpClient (KMM/KMP shared modules)
    languages: ['kt', 'kts'],
    kind: 'kmp',
    direction: 'consumes',
    manifestRules: [{ file: GRADLE_FILE, contentPattern: /io\.ktor/, framework: 'Ktor' }],
    clientMarkers: [
      /\bHttpClient\s*\(/, // also .NET HttpClient ctor
      /\bio\.ktor\.client\b/,
      /\bclient\.(?:get|post|put|patch|delete)\s*[(<{]/,
    ],
    serverMarkers: [],
  },
  {
    id: 'dio', // Dio / dart http
    languages: ['dart'],
    kind: 'flutter',
    direction: 'consumes',
    manifestRules: [
      { file: 'pubspec.yaml', contentPattern: /(^|\n)\s{2,}dio\s*:/, framework: 'Dio' },
      { file: 'pubspec.yaml', contentPattern: /(^|\n)\s{2,}http\s*:/, framework: 'http' },
    ],
    clientMarkers: [
      strong(/\bDio\b|\bdio\.(get|post|put|delete|patch)\b/), // Flutter
      strong(/\bhttp\.(get|post|put|delete|patch)\s*\(/), // dart http / go / generic
    ],
    serverMarkers: [],
    modelHints: { defRegex: /\bclass\s+[A-Z]\w*/ },
  },
  {
    id: 'python-requests',
    languages: ['py'],
    kind: 'library',
    direction: 'consumes',
    manifestRules: [],
    clientMarkers: [strong(/\brequests\.(get|post|put|delete|patch)\s*\(/)],
    serverMarkers: [],
  },
  {
    id: 'dotnet-httpclient',
    languages: ['cs'],
    kind: 'library',
    direction: 'consumes',
    manifestRules: [],
    clientMarkers: [strong(/\bHttpClient\b/)], // Angular/.NET
    serverMarkers: [],
  },
  {
    id: 'java-http-clients', // RestTemplate / WebClient / Feign
    languages: ['java', 'kt'],
    kind: 'library',
    direction: 'consumes',
    manifestRules: [],
    clientMarkers: [strong(/\bRestTemplate\b|\bWebClient\b|\bFeignClient\b/)],
    serverMarkers: [],
  },
  {
    id: 'guzzle',
    languages: ['php'],
    kind: 'library',
    direction: 'consumes',
    manifestRules: [],
    clientMarkers: [strong(/\bcurl_init\b|\bGuzzle\b/)],
    serverMarkers: [],
  },
  {
    id: 'reqwest',
    languages: ['rs'],
    kind: 'library',
    direction: 'consumes',
    manifestRules: [],
    clientMarkers: [
      /\breqwest::(?:Client|get)\b|\bClient::new\s*\(\)\s*\.\s*(?:get|post|put|patch|delete)\b/,
    ],
    serverMarkers: [],
  },
  {
    id: 'elixir-clients', // HTTPoison / Tesla / Req / Finch
    languages: ['ex', 'exs'],
    kind: 'library',
    direction: 'consumes',
    manifestRules: [],
    clientMarkers: [
      /\bHTTPoison\.(?:get|post|put|patch|delete)\b|\bTesla\.(?:get|post|put|patch|delete)\b|\bReq\.(?:get|post|put|patch|delete)!?\b|\bFinch\.build\b/,
    ],
    serverMarkers: [],
  },
  {
    id: 'sttp', // Scala sttp / Play WS
    languages: ['scala'],
    kind: 'library',
    direction: 'consumes',
    manifestRules: [],
    clientMarkers: [/\bbasicRequest\b|\bws\.url\s*\(/],
    serverMarkers: [],
  },

  // ── Server-side ecosystems ────────────────────────────────────────────────
  {
    id: 'express', // Express / Koa / Fastify / restify
    languages: ['js', 'ts'],
    kind: 'backend',
    direction: 'serves',
    manifestRules: [
      { file: 'package.json', contentPattern: /^express$/, framework: 'Express' },
      { file: 'package.json', contentPattern: /^koa$/, framework: 'Koa' },
      { file: 'package.json', contentPattern: /^fastify$/, framework: 'Fastify' },
    ],
    clientMarkers: [],
    serverMarkers: [
      /\b(?:app|router|fastify|server)\.(?:get|post|put|patch|delete|options|head|all)\s*\(\s*["'`]\//,
      /\.route\s*\(\s*["'`]\/[^"'`\n]*["'`]\s*\)\s*\.(?:get|post|put|patch|delete)/,
    ],
  },
  {
    id: 'nest',
    languages: ['ts'],
    kind: 'backend',
    direction: 'serves',
    manifestRules: [
      { file: 'package.json', contentPattern: /^@nestjs\//, framework: 'NestJS' },
    ],
    clientMarkers: [],
    serverMarkers: [
      // NestJS decorators (Retrofit uses uppercase @GET, so no overlap)
      /@(?:Get|Post|Put|Patch|Delete|Head|Options|All)\s*\(/,
      /@Controller\s*\(/,
    ],
  },
  {
    id: 'hapi',
    languages: ['js', 'ts'],
    kind: 'backend',
    direction: 'serves',
    manifestRules: [
      { file: 'package.json', contentPattern: /^(@hapi\/hapi|hapi)$/, framework: 'hapi' },
    ],
    clientMarkers: [],
    serverMarkers: [],
  },
  {
    id: 'spring',
    languages: ['java', 'kt'],
    kind: 'backend',
    direction: 'serves',
    manifestRules: [
      {
        file: GRADLE_FILE,
        contentPattern: /spring-boot|org\.springframework\.boot/,
        framework: 'Spring Boot',
      },
      { file: 'pom.xml', contentPattern: /spring-boot/, framework: 'Spring Boot' },
    ],
    clientMarkers: [],
    serverMarkers: [
      // Spring MVC / WebFlux
      /@(?:Get|Post|Put|Patch|Delete|Request)Mapping\b/,
      /@RestController\b/,
    ],
  },
  {
    id: 'jaxrs',
    languages: ['java', 'kt'],
    kind: 'backend',
    direction: 'serves',
    manifestRules: [],
    clientMarkers: [],
    serverMarkers: [
      // JAX-RS (leading slash distinguishes from Retrofit's @Path("id") params)
      /\b(?:javax|jakarta)\.ws\.rs\b/,
      /@Path\s*\(\s*["']\//,
    ],
  },
  {
    id: 'ktor-server',
    languages: ['kt'],
    kind: 'backend',
    direction: 'serves',
    manifestRules: [
      { file: GRADLE_FILE, contentPattern: /ktor-server/, framework: 'Ktor server' },
    ],
    clientMarkers: [],
    serverMarkers: [
      // Ktor routing DSL (lookbehind rejects client.get(...) member calls)
      /\brouting\s*\{/,
      /(?<![.\w])(?:get|post|put|patch|delete)\s*\(\s*["']\/[^"'\n]*["']\s*\)\s*\{/,
    ],
  },
  {
    id: 'django',
    languages: ['py'],
    kind: 'backend',
    direction: 'serves',
    manifestRules: [
      {
        file: /^(?:requirements\.txt|pyproject\.toml)$/,
        contentPattern: /\bdjango\b/i,
        framework: 'Django',
      },
    ],
    clientMarkers: [],
    serverMarkers: [
      // Django URLconf
      /\burlpatterns\s*=/,
      /\b(?:path|re_path)\s*\(\s*r?["'][^"'\n]*["']\s*,/,
    ],
  },
  {
    id: 'flask',
    languages: ['py'],
    kind: 'backend',
    direction: 'serves',
    manifestRules: [
      {
        file: /^(?:requirements\.txt|pyproject\.toml)$/,
        contentPattern: /\bflask\b/i,
        framework: 'Flask',
      },
    ],
    clientMarkers: [],
    serverMarkers: [/@\w+\.route\s*\(\s*["']\//], // Flask @app.route / @bp.route
  },
  {
    id: 'fastapi',
    languages: ['py'],
    kind: 'backend',
    direction: 'serves',
    manifestRules: [
      {
        file: /^(?:requirements\.txt|pyproject\.toml)$/,
        contentPattern: /\bfastapi\b/i,
        framework: 'FastAPI',
      },
    ],
    clientMarkers: [],
    serverMarkers: [/@(?:app|router)\.(?:get|post|put|patch|delete)\s*\(/], // FastAPI decorators
  },
  {
    id: 'rails',
    languages: ['rb'],
    kind: 'backend',
    direction: 'serves',
    manifestRules: [
      { file: 'Gemfile', contentPattern: /\bgem\s+['"]rails['"]/, framework: 'Rails' },
    ],
    clientMarkers: [],
    serverMarkers: [/\bresources\s+:\w+/, /\broutes\.draw\b/],
  },
  {
    id: 'phoenix', // Phoenix (shares the Rails-style routing DSL)
    languages: ['ex', 'exs'],
    kind: 'backend',
    direction: 'serves',
    manifestRules: [],
    clientMarkers: [],
    serverMarkers: [
      /(?<![.\w])(?:get|post|put|patch|delete)\s+["']\/[^"'\n]*["']\s*,/,
      /\bscope\s+["']\//,
    ],
  },
  {
    id: 'laravel',
    languages: ['php'],
    kind: 'backend',
    direction: 'serves',
    manifestRules: [
      {
        file: 'composer.json',
        contentPattern: /^laravel\/framework$/,
        framework: 'Laravel',
      },
    ],
    clientMarkers: [],
    serverMarkers: [
      /\bRoute::(?:get|post|put|patch|delete|any|match|resource|apiResource)\s*\(/,
    ],
  },
  {
    id: 'go-http', // gin / echo / chi / gorilla mux / net/http / fiber
    languages: ['go'],
    kind: 'backend',
    direction: 'serves',
    manifestRules: [
      { file: 'go.mod', contentPattern: /gin-gonic\/gin/, framework: 'Gin' },
      { file: 'go.mod', contentPattern: /labstack\/echo/, framework: 'Echo' },
      { file: 'go.mod', contentPattern: /go-chi\/chi/, framework: 'Chi' },
      { file: 'go.mod', contentPattern: /gorilla\/mux/, framework: 'Gorilla Mux' },
      { file: 'go.mod', contentPattern: /gofiber\/fiber/, framework: 'Fiber' },
    ],
    clientMarkers: [],
    serverMarkers: [
      /\b\w+\.(?:GET|POST|PUT|PATCH|DELETE)\s*\(\s*"\//, // gin/echo
      /\b\w+\.(?:Get|Post|Put|Patch|Delete)\s*\(\s*"\//, // chi
      /\bHandleFunc\s*\(\s*"\//,
      /\.Methods\s*\(\s*"(?:GET|POST|PUT|PATCH|DELETE)"/, // gorilla/mux
    ],
  },
  {
    id: 'aspnet',
    languages: ['cs'],
    kind: 'backend',
    direction: 'serves',
    manifestRules: [
      {
        file: /\.csproj$/,
        contentPattern: /Microsoft\.AspNetCore|Sdk="Microsoft\.NET\.Sdk\.Web"/,
        framework: 'ASP.NET Core',
      },
    ],
    clientMarkers: [],
    serverMarkers: [
      /\[Http(?:Get|Post|Put|Patch|Delete|Head|Options)\b/, // attribute routing
      /\[ApiController\]/,
      /\bMap(?:Get|Post|Put|Patch|Delete|Methods)\s*\(\s*"/, // minimal APIs
    ],
  },
  {
    id: 'rust-server', // actix-web / axum / warp / Rocket
    languages: ['rs'],
    kind: 'backend',
    direction: 'serves',
    manifestRules: [],
    clientMarkers: [],
    serverMarkers: [
      /#\[(?:get|post|put|patch|delete)\s*\(\s*"\//, // actix attribute macros
      /\bRouter::new\s*\(\)|\.route\s*\(\s*"\/[^"]*"\s*,\s*(?:get|post|put|patch|delete)\s*\(/, // axum
      /\bwarp::path\b|\brocket::routes!/,
    ],
  },
  {
    id: 'play', // Play routes DSL and Akka/Pekko HTTP directives
    languages: ['scala'],
    kind: 'backend',
    direction: 'serves',
    manifestRules: [],
    clientMarkers: [],
    serverMarkers: [
      /\b(?:GET|POST|PUT|PATCH|DELETE)\s+\/\S*\s+controllers\./,
      /\bpathPrefix\s*\(\s*"|\bcomplete\s*\(\s*StatusCodes\./,
    ],
  },
];

// ---------------------------------------------------------------------------
// Derived marker views
// ---------------------------------------------------------------------------
// These array OBJECTS are shared with heuristics.ts (which re-exports them
// under their legacy names), so registerEcosystem can extend them in place
// and every consumer sees the new markers immediately.

export const STRONG_CLIENT_MARKER_VIEW: RegExp[] = [];
export const EXTRA_CLIENT_MARKER_VIEW: RegExp[] = [];
export const SERVER_MARKER_VIEW: RegExp[] = [];

const seenClientSources = new Set<string>();
const seenServerSources = new Set<string>();

function markerKey(marker: RegExp): string {
  return `${marker.source} ${marker.flags}`;
}

function addPackToViews(pack: EcosystemPack): void {
  for (const marker of pack.clientMarkers) {
    const key = markerKey(marker);
    if (seenClientSources.has(key)) {
      continue;
    }
    seenClientSources.add(key);
    (STRONG_TIER.has(marker) ? STRONG_CLIENT_MARKER_VIEW : EXTRA_CLIENT_MARKER_VIEW).push(marker);
  }
  for (const marker of pack.serverMarkers) {
    const key = markerKey(marker);
    if (seenServerSources.has(key)) {
      continue;
    }
    seenServerSources.add(key);
    SERVER_MARKER_VIEW.push(marker);
  }
}

for (const pack of ECOSYSTEMS) {
  addPackToViews(pack);
}

// ---------------------------------------------------------------------------
// Registry utilities
// ---------------------------------------------------------------------------

function basenameOf(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const index = normalized.lastIndexOf('/');
  return index === -1 ? normalized : normalized.slice(index + 1);
}

/** True when a manifest rule's `file` selector matches the given file name/path. */
export function matchesManifestFile(file: string | RegExp, fileName: string): boolean {
  const base = basenameOf(fileName);
  return typeof file === 'string' ? file === base : file.test(base);
}

/** Packs relevant to a file: by extension (languages) or manifest-rule match. */
export function getPacksForFile(path: string): EcosystemPack[] {
  const base = basenameOf(path);
  const ext = (base.match(/\.([A-Za-z0-9]+)$/)?.[1] ?? '').toLowerCase();
  return ECOSYSTEMS.filter(
    (pack) =>
      (ext !== '' && pack.languages.includes(ext)) ||
      pack.manifestRules.some((rule) => matchesManifestFile(rule.file, base))
  );
}

/** Human-readable one-line summary of a pack; undefined for unknown ids. */
export function describePack(id: string): string | undefined {
  const pack = ECOSYSTEMS.find((p) => p.id === id);
  if (!pack) {
    return undefined;
  }
  const frameworks = [...new Set(pack.manifestRules.map((rule) => rule.framework))];
  const parts = [
    `${pack.id}: ${pack.kind} (${pack.direction})`,
    `languages ${pack.languages.join('/')}`,
    `${pack.clientMarkers.length} client marker(s)`,
    `${pack.serverMarkers.length} server marker(s)`,
  ];
  if (frameworks.length > 0) {
    parts.push(`frameworks ${frameworks.join(', ')}`);
  }
  return parts.join('; ');
}

/**
 * Manifest rules whose `file` selector matches the given manifest basename,
 * in registry order, optionally filtered by the owning pack's direction/kind.
 * projectProfile derives its framework classification tables from this.
 */
export function manifestRulesForFile(
  fileName: string,
  filter?: { direction?: ApiDirection; kind?: ProjectKind }
): (EcosystemManifestRule & { packId: string })[] {
  const rules: (EcosystemManifestRule & { packId: string })[] = [];
  for (const pack of ECOSYSTEMS) {
    if (filter?.direction !== undefined && pack.direction !== filter.direction) {
      continue;
    }
    if (filter?.kind !== undefined && pack.kind !== filter.kind) {
      continue;
    }
    for (const rule of pack.manifestRules) {
      if (matchesManifestFile(rule.file, fileName)) {
        rules.push({ ...rule, packId: pack.id });
      }
    }
  }
  return rules;
}

// ---------------------------------------------------------------------------
// registerEcosystem — runtime extension point
// ---------------------------------------------------------------------------

/**
 * Heuristic catastrophic-backtracking check: reject a quantifier applied
 * directly to a group whose body ends in a quantifier — '(\w+)*', '(a+)+',
 * '(?:x*){2,}' and friends. Escaped parens ('\)+') do not trip it.
 */
const NESTED_QUANTIFIER = /[*+}]\)[*+{]/;

function isLikelyLinear(marker: RegExp): boolean {
  return !NESTED_QUANTIFIER.test(marker.source);
}

/** Markers must anchor at a word boundary, lookbehind, or line start. */
const ANCHORED_START = /^(?:\\b|\(\?<[!=]|\^)/;

function isAnchored(marker: RegExp): boolean {
  return ANCHORED_START.test(marker.source);
}

/**
 * Register an ecosystem pack at runtime. Validates the pack (unique id,
 * non-empty languages, linear-time and anchored marker regexes) and throws
 * an Error describing the first violation. Client markers of runtime packs
 * feed the CLIENT_MARKERS_EXTRA view.
 */
export function registerEcosystem(pack: EcosystemPack): void {
  if (typeof pack.id !== 'string' || pack.id.trim() === '') {
    throw new Error('ecosystem pack id must be a non-empty string');
  }
  if (ECOSYSTEMS.some((existing) => existing.id === pack.id)) {
    throw new Error(`ecosystem pack '${pack.id}' is already registered`);
  }
  if (!Array.isArray(pack.languages) || pack.languages.length === 0) {
    throw new Error(`ecosystem pack '${pack.id}' must declare at least one language extension`);
  }
  for (const marker of [...pack.clientMarkers, ...pack.serverMarkers]) {
    if (!isLikelyLinear(marker)) {
      throw new Error(
        `ecosystem pack '${pack.id}' marker /${marker.source}/ looks quadratic: ` +
          `a quantified group must not end in a quantifier ('(\\w+)*' style)`
      );
    }
    if (!isAnchored(marker)) {
      throw new Error(
        `ecosystem pack '${pack.id}' marker /${marker.source}/ must start with \\b, ` +
          `a lookbehind ((?<! / (?<=), or ^ so it cannot match mid-identifier`
      );
    }
  }
  for (const rule of pack.manifestRules) {
    if (rule.contentPattern && !isLikelyLinear(rule.contentPattern)) {
      throw new Error(
        `ecosystem pack '${pack.id}' manifest rule for ${String(rule.file)} ` +
          `has a quadratic contentPattern`
      );
    }
  }
  ECOSYSTEMS.push(pack);
  addPackToViews(pack);
}
