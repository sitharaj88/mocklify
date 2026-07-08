import type { RouteConfig } from '../../types/core.js';

/**
 * Pure heuristics for scanning a client codebase (Android, iOS, web, Flutter,
 * backend-for-frontend, …) for HTTP API usage. No vscode dependency so this
 * is fully unit-testable.
 */

/** Source extensions worth scanning for API calls. */
export const API_FILE_GLOB =
  '**/*.{kt,java,swift,m,mm,ts,tsx,js,jsx,dart,vue,svelte,py,cs,go,rb,php,ex,exs,rs,scala}';

/** Directories and files that never contain the app's own API calls. */
export const SCAN_EXCLUDE_GLOB =
  '{**/node_modules/**,**/dist/**,**/build/**,**/out/**,**/.git/**,**/target/**,**/Pods/**,**/vendor/**,**/.mocklify/**,**/coverage/**,**/__pycache__/**,**/*.min.js,**/*.d.ts,**/webview/dist/**}';

/** Machine-readable API spec files (OpenAPI, Swagger, gRPC, GraphQL, Postman). */
export const SPEC_FILE_GLOB =
  '**/{*openapi*.{json,yaml,yml},*swagger*.{json,yaml,yml},*.proto,*.graphql,*.graphqls,*.gql,*.postman_collection.json}';

/** Strong signals that a line performs or declares an HTTP call. */
const STRONG_MARKERS: RegExp[] = [
  /\bfetch\s*\(/, // web fetch
  /\baxios\b/, // axios
  /\bXMLHttpRequest\b/,
  /@(GET|POST|PUT|DELETE|PATCH|HEAD|Multipart|FormUrlEncoded)\b/, // Retrofit
  /\bRetrofit\b/,
  /\bOkHttpClient\b|\bokhttp3\b/,
  /\bHttpURLConnection\b/,
  /\bVolley\b|\bJsonObjectRequest\b/,
  /\bURLSession\b/, // iOS
  /\bAlamofire\b|\bAF\.request\b/,
  /\bDio\b|\bdio\.(get|post|put|delete|patch)\b/, // Flutter
  /\bhttp\.(get|post|put|delete|patch)\s*\(/, // dart http / go / generic
  /\bHttpClient\b/, // Angular/.NET
  /\bRestTemplate\b|\bWebClient\b|\bFeignClient\b/, // Java clients
  /\brequests\.(get|post|put|delete|patch)\s*\(/, // python
  /\$\.(ajax|get|post)\s*\(/, // jquery
  /\bcreateApi\b|\bfetchBaseQuery\b/, // RTK Query
  /\buseSWR\b|\buseQuery\b|\buseMutation\b/, // SWR / react-query
  /\bky\.(get|post|put|delete|patch)\b|\bgot\.(get|post|put|delete|patch)\b/,
  /\bcurl_init\b|\bGuzzle\b/, // php
  /\bApolloClient\b|\bInMemoryCache\b|\buseLazyQuery\b/, // Apollo GraphQL
  /\bgql\s*(?:`|\()/, // gql template tag
  /\bGraphQLClient\b|['"`]graphql-request['"`]/, // graphql-request
  /['"`]@?urql(?:\/[\w-]+)?['"`]/, // urql
  /["'`][^"'`\s]*\/graphql\b/, // generic POST-to-/graphql endpoint
];

/**
 * Server-side route DECLARATIONS (as opposed to client HTTP calls). Every
 * pattern is word-boundary anchored and linear-time: single-level quantifiers
 * over disjoint character classes, no nested or overlapping quantifiers.
 */
export const SERVER_MARKERS: RegExp[] = [
  // Express / Koa / Fastify / restify route registration
  /\b(?:app|router|fastify|server)\.(?:get|post|put|patch|delete|options|head|all)\s*\(\s*["'`]\//,
  /\.route\s*\(\s*["'`]\/[^"'`\n]*["'`]\s*\)\s*\.(?:get|post|put|patch|delete)/,
  // NestJS decorators (Retrofit uses uppercase @GET, so no overlap)
  /@(?:Get|Post|Put|Patch|Delete|Head|Options|All)\s*\(/,
  /@Controller\s*\(/,
  // Spring MVC / WebFlux
  /@(?:Get|Post|Put|Patch|Delete|Request)Mapping\b/,
  /@RestController\b/,
  // JAX-RS (leading slash distinguishes from Retrofit's @Path("id") params)
  /\b(?:javax|jakarta)\.ws\.rs\b/,
  /@Path\s*\(\s*["']\//,
  // Ktor routing DSL (lookbehind rejects client.get(...) member calls)
  /\brouting\s*\{/,
  /(?<![.\w])(?:get|post|put|patch|delete)\s*\(\s*["']\/[^"'\n]*["']\s*\)\s*\{/,
  // FastAPI decorators
  /@(?:app|router)\.(?:get|post|put|patch|delete)\s*\(/,
  // Flask @app.route / @bp.route
  /@\w+\.route\s*\(\s*["']\//,
  // Django URLconf
  /\burlpatterns\s*=/,
  /\b(?:path|re_path)\s*\(\s*r?["'][^"'\n]*["']\s*,/,
  // Rails / Phoenix routing DSL
  /\bresources\s+:\w+/,
  /(?<![.\w])(?:get|post|put|patch|delete)\s+["']\/[^"'\n]*["']\s*,/,
  /\broutes\.draw\b/,
  /\bscope\s+["']\//,
  // Laravel
  /\bRoute::(?:get|post|put|patch|delete|any|match|resource|apiResource)\s*\(/,
  // Go: gin/echo (r.GET), chi (r.Get), gorilla/mux, net/http mux
  /\b\w+\.(?:GET|POST|PUT|PATCH|DELETE)\s*\(\s*"\//,
  /\b\w+\.(?:Get|Post|Put|Patch|Delete)\s*\(\s*"\//,
  /\bHandleFunc\s*\(\s*"\//,
  /\.Methods\s*\(\s*"(?:GET|POST|PUT|PATCH|DELETE)"/,
  // ASP.NET attribute routing and minimal APIs
  /\[Http(?:Get|Post|Put|Patch|Delete|Head|Options)\b/,
  /\[ApiController\]/,
  /\bMap(?:Get|Post|Put|Patch|Delete|Methods)\s*\(\s*"/,
  // Rust: actix-web attribute macros, axum/warp/Rocket routing
  /#\[(?:get|post|put|patch|delete)\s*\(\s*"\//,
  /\bRouter::new\s*\(\)|\.route\s*\(\s*"\/[^"]*"\s*,\s*(?:get|post|put|patch|delete)\s*\(/,
  /\bwarp::path\b|\brocket::routes!/,
  // Scala: Play routes DSL and Akka/Pekko HTTP directives
  /\b(?:GET|POST|PUT|PATCH|DELETE)\s+\/\S*\s+controllers\./,
  /\bpathPrefix\s*\(\s*"|\bcomplete\s*\(\s*StatusCodes\./,
];

/** Client-call signals missing from STRONG_MARKERS (newer ecosystems). */
export const CLIENT_MARKERS_EXTRA: RegExp[] = [
  // Rust HTTP clients
  /\breqwest::(?:Client|get)\b|\bClient::new\s*\(\)\s*\.\s*(?:get|post|put|patch|delete)\b/,
  // Elixir HTTP clients
  /\bHTTPoison\.(?:get|post|put|patch|delete)\b|\bTesla\.(?:get|post|put|patch|delete)\b|\bReq\.(?:get|post|put|patch|delete)!?\b|\bFinch\.build\b/,
  // Scala sttp / Play WS
  /\bbasicRequest\b|\bws\.url\s*\(/,
  // Ktor HttpClient (KMM/KMP shared modules); also .NET HttpClient ctor
  /\bHttpClient\s*\(/,
  /\bio\.ktor\.client\b/,
  /\bclient\.(?:get|post|put|patch|delete)\s*[(<{]/,
  // Capacitor
  /\bCapacitorHttp\b/,
  /\bHttp\.(?:request|get|post|put|patch|del)\s*\(/,
  // Angular HttpClient method calls (typed or via this.http)
  /\bthis\.http\.(?:get|post|put|patch|delete|request)\s*\(/,
  /\bhttp\.(?:get|post|put|patch|delete)\s*</,
  // tRPC
  /\bcreateTRPC(?:ProxyClient|Client|React|Next)\b/,
  /\bhttpBatchLink\b|\bhttpLink\b/,
  /['"`]@trpc\/[\w-]+['"`]/,
  // Lookbehind (not \b): '$' is a non-word char inside [\w$], so \b would
  // restart the match before every word char after a '$' — quadratic on long
  // $-delimited identifier runs (e.g. mangled generated code).
  /(?<![\w$])[\w$]+\.[\w$]+\.(?:useQuery|useMutation|useInfiniteQuery)\s*\(/,
  // openapi-generator / openapi-typescript-codegen clients
  /\bnew\s+Configuration\s*\(/,
  /\bBASE_PATH\s*[:=]/,
  /\bOpenAPI\.BASE\b/,
  // Objective-C NSURLSession
  /\bNSURLSession\b/,
  /\bdataTaskWithRequest\b|\bdataTaskWithURL\b/,
  // grpc-web / Connect
  /\bcreatePromiseClient\b|\bcreateConnectTransport\b|\bcreateGrpcWebTransport\b/,
  /\bGrpcWebClientBase\b/,
  /['"`](?:grpc-web|@connectrpc\/[\w-]+|@bufbuild\/connect[\w-]*)['"`]/,
];

/** Weak signals — only meaningful alongside strong ones or in bulk. */
const WEAK_MARKERS: RegExp[] = [
  /\b(BASE_URL|baseUrl|API_URL|apiUrl|API_BASE|api_base)\b/,
  /\bendpoint/i,
  /https?:\/\/[^\s"'`]+/,
  /["'`]\/api\//,
  /\bAuthorization\b|\bBearer\b/,
];

/** Filename hints that a file is an API layer. */
const FILE_NAME_HINTS =
  /(api|service|client|network|repository|repo|http|request|endpoint|datasource|gateway)/i;

export interface ScoredFile {
  path: string;
  score: number;
  snippet: string;
}

function countHits(markers: RegExp[], content: string): number {
  let hits = 0;
  for (const marker of markers) {
    if (marker.test(content)) {
      hits++;
    }
  }
  return hits;
}

/**
 * Score file content separately for client HTTP calls and server route
 * declarations. Same formula as the original scoreApiContent per direction:
 * strong*10 + weak*2 + filename bonus when any marker matched.
 */
export function scoreApiContentDirectional(
  content: string,
  fileName: string
): { clientScore: number; serverScore: number } {
  const clientStrong = countHits(STRONG_MARKERS, content) + countHits(CLIENT_MARKERS_EXTRA, content);
  const serverStrong = countHits(SERVER_MARKERS, content);
  const weak = countHits(WEAK_MARKERS, content);
  const nameBonus = FILE_NAME_HINTS.test(fileName) ? 5 : 0;
  return {
    clientScore: clientStrong * 10 + weak * 2 + (clientStrong + weak > 0 ? nameBonus : 0),
    serverScore: serverStrong * 10 + weak * 2 + (serverStrong + weak > 0 ? nameBonus : 0),
  };
}

/**
 * Score file content for API relevance. >= 10 means at least one strong
 * marker (or a hinted filename with several weak markers). Superset of the
 * original client-only behavior: server-route-only files now score too.
 */
export function scoreApiContent(content: string, fileName: string): number {
  const { clientScore, serverScore } = scoreApiContentDirectional(content, fileName);
  return Math.max(clientScore, serverScore);
}

/**
 * Extract the API-relevant regions of a file: lines matching any marker,
 * with surrounding context, merged when overlapping, capped at maxChars.
 */
export function extractApiSnippets(content: string, maxChars = 4000, context = 12): string {
  const lines = content.split('\n');
  const all = [...STRONG_MARKERS, ...CLIENT_MARKERS_EXTRA, ...SERVER_MARKERS, ...WEAK_MARKERS];

  const matchedLines: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (all.some((m) => m.test(lines[i]))) {
      matchedLines.push(i);
    }
  }
  if (matchedLines.length === 0) {
    return '';
  }

  // Merge overlapping [start, end] ranges around matches
  const ranges: [number, number][] = [];
  for (const line of matchedLines) {
    const start = Math.max(0, line - context);
    const end = Math.min(lines.length - 1, line + context);
    const last = ranges[ranges.length - 1];
    if (last && start <= last[1] + 1) {
      last[1] = Math.max(last[1], end);
    } else {
      ranges.push([start, end]);
    }
  }

  let result = '';
  for (const [start, end] of ranges) {
    const block = lines.slice(start, end + 1).join('\n');
    const separator = result ? '\n  …\n' : '';
    if (result.length + separator.length + block.length > maxChars) {
      const remaining = maxChars - result.length - separator.length;
      if (remaining > 200) {
        result += separator + block.slice(0, remaining);
      }
      break;
    }
    result += separator + block;
  }
  return result;
}

/**
 * Pack scored files (highest first) into prompt-sized chunks. Each chunk is
 * a single string with `// File:` headers, at most maxCharsPerChunk long.
 */
export function chunkScoredFiles(
  files: ScoredFile[],
  maxCharsPerChunk = 24000,
  maxTotalChars = 96000
): string[] {
  const sorted = [...files].sort((a, b) => b.score - a.score);
  const chunks: string[] = [];
  let current = '';
  let total = 0;

  for (const file of sorted) {
    if (!file.snippet) {
      continue;
    }
    const block = `// File: ${file.path}\n${file.snippet}\n\n`;
    if (total + block.length > maxTotalChars) {
      break;
    }
    if (current.length + block.length > maxCharsPerChunk && current) {
      chunks.push(current);
      current = '';
    }
    current += block;
    total += block.length;
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}

/**
 * Deduplicate routes across AI analysis chunks. Two routes are duplicates
 * when method, path, and response status match (so a 200 and a 404 for the
 * same endpoint both survive). First occurrence wins.
 */
/** Built-in / SDK types that are never app data models. */
const NON_MODEL_TYPES = new Set([
  'String',
  'Int',
  'Integer',
  'Long',
  'Short',
  'Byte',
  'Char',
  'Boolean',
  'Bool',
  'Double',
  'Float',
  'Number',
  'Void',
  'Unit',
  'Any',
  'AnyObject',
  'Nothing',
  'Object',
  'Date',
  'Data',
  'Url',
  'Uri',
  'List',
  'MutableList',
  'ArrayList',
  'Array',
  'Set',
  'HashSet',
  'Map',
  'HashMap',
  'MutableMap',
  'Dictionary',
  'Optional',
  'Result',
  'Error',
  'Exception',
  'Throwable',
  'Call',
  'Response',
  'Request',
  'Flow',
  'StateFlow',
  'SharedFlow',
  'LiveData',
  'MutableLiveData',
  'Single',
  'Observable',
  'Maybe',
  'Completable',
  'Deferred',
  'Promise',
  'Task',
  'Codable',
  'Decodable',
  'Encodable',
  'JsonDecoder',
  'JsonEncoder',
  'Json',
]);

function isModelTypeName(name: string): boolean {
  return (
    /^[A-Z][A-Za-z0-9]*$/.test(name) &&
    /[a-z]/.test(name) &&
    !NON_MODEL_TYPES.has(name) &&
    !NON_MODEL_TYPES.has(name.replace(/^JSON/, 'Json'))
  );
}

/** Resolve a relative import specifier against the importing file's directory. */
function resolveRelative(fromFile: string, spec: string): string {
  const stack = fromFile.split('/').slice(0, -1);
  for (const part of spec.split('/')) {
    if (part === '' || part === '.') {
      continue;
    }
    if (part === '..') {
      stack.pop();
    } else {
      stack.push(part);
    }
  }
  return stack.join('/');
}

/** Candidate on-disk paths for a resolved import (compilers hide extensions). */
function importPathCandidates(resolved: string): string[] {
  if (/\.(dart|ts|tsx)$/i.test(resolved)) {
    return [resolved];
  }
  const jsExt = resolved.match(/\.(js|jsx|mjs|cjs)$/i);
  if (jsExt) {
    // ESM-style .js suffix usually points at a TS source
    const base = resolved.slice(0, -jsExt[0].length);
    return [`${base}.ts`, `${base}.tsx`, resolved];
  }
  return [
    `${resolved}.ts`,
    `${resolved}.tsx`,
    `${resolved}.js`,
    `${resolved}.dart`,
    `${resolved}/index.ts`,
    `${resolved}/index.tsx`,
    `${resolved}/index.js`,
  ];
}

/** Imported identifiers from a TS/JS import clause (named, default, aliased). */
function parseImportClause(clause: string): string[] {
  const names: string[] = [];
  const braces = clause.match(/\{([\s\S]*?)\}/);
  if (braces) {
    for (const part of braces[1].split(',')) {
      const name = part.replace(/\btype\b/g, '').trim().split(/\s+as\s+/)[0].trim();
      if (/^[\w$]+$/.test(name)) {
        names.push(name);
      }
    }
  }
  const outside = clause.replace(/\{[\s\S]*?\}/, '').replace(/\*\s+as\s+[\w$]+/, '');
  for (const part of outside.split(',')) {
    const name = part.trim();
    if (/^[\w$]+$/.test(name)) {
      names.push(name);
    }
  }
  return names;
}

/**
 * Find references to data-model types in an API file so the scanner can pull
 * their definitions into the AI context. For TS/JS/Dart the model usually
 * lives behind a relative import; for Kotlin/Java/Swift (package/module
 * imports, no useful paths) only type names used in API-call positions are
 * harvested (Call<User>, fun …: User, decode(User.self), -> User).
 */
export function extractModelReferences(
  content: string,
  filePath: string
): { importPaths: string[]; typeNames: string[] } {
  const ext = (filePath.match(/\.([A-Za-z]+)$/)?.[1] ?? '').toLowerCase();
  const importPaths: string[] = [];
  const typeNames: string[] = [];
  const addType = (name: string): void => {
    if (isModelTypeName(name) && !typeNames.includes(name)) {
      typeNames.push(name);
    }
  };
  const addPaths = (candidates: string[]): void => {
    for (const candidate of candidates) {
      if (!importPaths.includes(candidate)) {
        importPaths.push(candidate);
      }
    }
  };

  if (['ts', 'tsx', 'js', 'jsx', 'mts', 'mjs', 'cts', 'cjs'].includes(ext)) {
    const importRe = /import\s+(type\s+)?([\s\S]*?)\s*from\s*['"]([^'"]+)['"]/g;
    for (const match of content.matchAll(importRe)) {
      const spec = match[3];
      if (!spec.startsWith('./') && !spec.startsWith('../')) {
        continue;
      }
      const names = parseImportClause(match[2]);
      const modelNames = names.filter(isModelTypeName);
      modelNames.forEach(addType);
      if (modelNames.length > 0 || match[1]) {
        addPaths(importPathCandidates(resolveRelative(filePath, spec)));
      }
    }
  } else if (ext === 'dart') {
    for (const match of content.matchAll(/import\s+['"]([^'"]+)['"]([^;]*);/g)) {
      const spec = match[1];
      if (spec.startsWith('package:') || spec.startsWith('dart:')) {
        continue;
      }
      addPaths(importPathCandidates(resolveRelative(filePath, spec)));
      const show = match[2].match(/\bshow\s+([\w,\s]+)/);
      if (show) {
        show[1]
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .forEach(addType);
      }
    }
  } else if (['kt', 'kts', 'java', 'swift'].includes(ext)) {
    const genericRe =
      /\b(?:Call|Response|List|MutableList|ArrayList|Set|Flow|StateFlow|SharedFlow|LiveData|MutableLiveData|Single|Observable|Maybe|Deferred|Result|Page|PagingData|ApiResponse|NetworkResponse|Task)<([^<>]*(?:<[^<>]*>)?[^<>]*)>/g;
    for (const match of content.matchAll(genericRe)) {
      for (const id of match[1].match(/[A-Z][A-Za-z0-9]*/g) ?? []) {
        addType(id);
      }
    }
    for (const match of content.matchAll(/\bfun\s+[\w`]+\s*\([^)]*\)\s*:\s*([A-Z][A-Za-z0-9]*)/g)) {
      addType(match[1]);
    }
    for (const match of content.matchAll(/\bdecode\(\s*\[?\s*([A-Z][A-Za-z0-9]*)\s*\]?\s*\.self/g)) {
      addType(match[1]);
    }
    if (ext === 'swift') {
      for (const match of content.matchAll(/->\s*\[?\s*([A-Z][A-Za-z0-9]*)/g)) {
        addType(match[1]);
      }
    }
  }

  return { importPaths, typeNames };
}

/** Slice a brace/paren-balanced region starting at an opening delimiter. */
function balanceDelimiters(content: string, openIndex: number): number {
  const open = content[openIndex];
  const close = open === '{' ? '}' : ')';
  let depth = 0;
  let inString: string | null = null;
  for (let i = openIndex; i < content.length; i++) {
    const ch = content[i];
    if (inString) {
      if (ch === '\\') {
        i++;
      } else if (ch === inString) {
        inString = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
    } else if (ch === '/' && content[i + 1] === '/') {
      while (i < content.length && content[i] !== '\n') {
        i++;
      }
    } else if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) {
        return i + 1;
      }
    }
  }
  return content.length;
}

/** Capture one definition block starting at the keyword match. */
function captureDefinition(content: string, startIndex: number): string {
  let i = startIndex;
  while (i < content.length) {
    const ch = content[i];
    if (ch === '{' || ch === '(') {
      break;
    }
    if (ch === ';') {
      return content.slice(startIndex, i + 1);
    }
    if (ch === '\n') {
      // allow an opening brace on the next line, otherwise the definition
      // (e.g. a one-line type alias) ends here
      const rest = content.slice(i);
      const brace = rest.match(/^\s*\{/);
      if (!brace) {
        return content.slice(startIndex, i);
      }
      i += brace[0].length - 1;
      break;
    }
    i++;
  }
  if (i >= content.length) {
    return content.slice(startIndex);
  }

  let end = balanceDelimiters(content, i);
  if (content[i] === '(') {
    // Kotlin data class: optional supertype list and/or class body after the
    // constructor parentheses
    const body = content.slice(end).match(/^\s*(?::\s*[\w.<>,\s()]*)?\{/);
    if (body) {
      end = balanceDelimiters(content, end + body[0].length - 1);
    }
  } else if (content[end] === ';') {
    end++;
  }
  return content.slice(startIndex, end);
}

/**
 * Extract the definition blocks (brace-balanced) for the requested type names
 * from a candidate model file. Returns '' when none of the names are defined.
 */
export function extractTypeDefinitions(
  content: string,
  typeNames: string[],
  maxChars = 4000
): string {
  const blocks: string[] = [];
  const seen = new Set<string>();
  for (const name of typeNames) {
    if (seen.has(name) || !/^[A-Za-z_$][\w$]*$/.test(name)) {
      continue;
    }
    seen.add(name);
    const defRe = new RegExp(
      '^[ \\t]*(?:export\\s+)?(?:public\\s+|internal\\s+|open\\s+|final\\s+|abstract\\s+|sealed\\s+|declare\\s+)*' +
        `(?:data\\s+class|enum\\s+class|sealed\\s+class|interface|class|struct|enum|type)\\s+${name}\\b`,
      'm'
    );
    const match = defRe.exec(content);
    if (match) {
      blocks.push(captureDefinition(content, match.index).trim());
    }
  }
  const result = blocks.join('\n\n');
  return result.length > maxChars ? result.slice(0, maxChars) : result;
}

export function dedupeRoutes<T extends Omit<RouteConfig, 'id'>>(routes: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const route of routes) {
    const methods = Array.isArray(route.method) ? [...route.method].sort().join(',') : route.method;
    const key = `${methods}|${route.path.toLowerCase()}|${route.response.statusCode}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(route);
    }
  }
  return result;
}
