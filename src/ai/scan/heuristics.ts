import type { RouteConfig } from '../../types/core.js';

/**
 * Pure heuristics for scanning a client codebase (Android, iOS, web, Flutter,
 * backend-for-frontend, …) for HTTP API usage. No vscode dependency so this
 * is fully unit-testable.
 */

/** Source extensions worth scanning for API calls. */
export const API_FILE_GLOB =
  '**/*.{kt,java,swift,m,mm,ts,tsx,js,jsx,dart,vue,svelte,py,cs,go,rb,php}';

/** Directories and files that never contain the app's own API calls. */
export const SCAN_EXCLUDE_GLOB =
  '{**/node_modules/**,**/dist/**,**/build/**,**/out/**,**/.git/**,**/target/**,**/Pods/**,**/vendor/**,**/.mocklify/**,**/coverage/**,**/__pycache__/**,**/*.min.js,**/*.d.ts,**/webview/dist/**}';

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

/**
 * Score file content for API relevance. >= 10 means at least one strong
 * marker (or a hinted filename with several weak markers).
 */
export function scoreApiContent(content: string, fileName: string): number {
  let strong = 0;
  let weak = 0;
  for (const marker of STRONG_MARKERS) {
    if (marker.test(content)) {
      strong++;
    }
  }
  for (const marker of WEAK_MARKERS) {
    if (marker.test(content)) {
      weak++;
    }
  }
  const nameBonus = FILE_NAME_HINTS.test(fileName) ? 5 : 0;
  return strong * 10 + weak * 2 + (strong + weak > 0 ? nameBonus : 0);
}

/**
 * Extract the API-relevant regions of a file: lines matching any marker,
 * with surrounding context, merged when overlapping, capped at maxChars.
 */
export function extractApiSnippets(content: string, maxChars = 4000, context = 12): string {
  const lines = content.split('\n');
  const all = [...STRONG_MARKERS, ...WEAK_MARKERS];

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
