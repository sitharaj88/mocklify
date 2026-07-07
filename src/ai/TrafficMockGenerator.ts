import type * as vscode from 'vscode';
import { HttpMethod, RequestLogEntry, RouteConfig } from '../types/core.js';
import type { AiService, AiRequestOptions } from './AiService.js';
import { MockGenerator, ROUTE_FORMAT_INSTRUCTIONS } from './MockGenerator.js';
import { dedupeRoutes } from './scan/heuristics.js';

/**
 * Record & replay: turns real traffic captured in Mocklify's request log
 * (proxy routes or hits against a running mock) into a clean mock server.
 * Pre-processing (grouping, path parameterization, representative selection)
 * is pure and exported for unit tests; only the class touches vscode/AI.
 */

/** Methods worth mocking. OPTIONS is excluded as CORS-preflight noise. */
const MOCKABLE_METHODS = new Set<string>(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD']);

const NUMERIC_RE = /^\d+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// 20+ char opaque tokens (Mongo ObjectIds, API keys, JWT fragments). Requiring
// a digit avoids swallowing long English words like "internationalization".
const OPAQUE_ID_RE = /^(?=.*\d)[A-Za-z0-9_-]{20,}$/;

const MAX_BODY_CHARS = 2000;
const MAX_CHARS_PER_CHUNK = 24000;

export interface CapturedExchange {
  statusCode: number;
  requestBody?: unknown;
  responseBody?: unknown;
  contentType?: string;
}

export interface TrafficEndpoint {
  method: HttpMethod;
  /** Parameterized path, e.g. /api/users/:userId */
  path: string;
  hits: number;
  /** Up to three distinct concrete paths that were captured. */
  samplePaths: string[];
  /** Latest 2xx exchange, preferring one with a response body. */
  success?: CapturedExchange;
  /** Latest exchange per distinct non-2xx status. */
  errors: CapturedExchange[];
}

export interface TrafficScanSummary {
  entryCount: number;
  endpointCount: number;
  routes: Omit<RouteConfig, 'id'>[];
  positiveCount: number;
  negativeCount: number;
}

export interface TrafficScanProgress {
  message: string;
  /** 0..1 across the whole pipeline */
  fraction: number;
}

function isIdSegment(segment: string): boolean {
  return NUMERIC_RE.test(segment) || UUID_RE.test(segment) || OPAQUE_ID_RE.test(segment);
}

function singularize(word: string): string {
  const lower = word.toLowerCase();
  if (lower.endsWith('ies') && word.length > 3) {
    return `${word.slice(0, -3)}y`;
  }
  if (/(ses|xes|zes|ches|shes)$/.test(lower)) {
    return word.slice(0, -2);
  }
  if (lower.endsWith('s') && !lower.endsWith('ss')) {
    return word.slice(0, -1);
  }
  return word;
}

/** Derive a :param name from the segment preceding an id, e.g. users → userId. */
function paramNameFor(previousSegment: string | undefined, used: Set<string>): string {
  let base = 'id';
  if (previousSegment && !previousSegment.startsWith(':') && /[a-z]/i.test(previousSegment)) {
    const words = previousSegment.split(/[^a-zA-Z0-9]+/).filter(Boolean);
    if (words.length > 0) {
      words[words.length - 1] = singularize(words[words.length - 1]);
      base =
        words
          .map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
          .join('') + 'Id';
    }
  }
  let name = base;
  let n = 2;
  while (used.has(name)) {
    name = `${base}${n++}`;
  }
  used.add(name);
  return name;
}

/**
 * Deterministically parameterize a concrete request path: numeric segments,
 * UUIDs, and 20+ char opaque ids become :param names inferred from the
 * preceding segment (/users/42 → /users/:userId). Param names are unique
 * within a path so the result is a valid Express route.
 */
export function parameterizePath(path: string): string {
  const clean = path.split('?')[0].split('#')[0];
  const segments = clean.split('/');
  const used = new Set<string>();
  const out: string[] = [];
  for (const segment of segments) {
    if (segment && isIdSegment(segment)) {
      const previous = [...out].reverse().find((s) => s !== '');
      out.push(`:${paramNameFor(previous, used)}`);
    } else {
      out.push(segment);
    }
  }
  return out.join('/') || '/';
}

function timestampOf(entry: RequestLogEntry): number {
  const t = entry.timestamp instanceof Date ? entry.timestamp : new Date(entry.timestamp);
  const ms = t.getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function hasBody(body: unknown): boolean {
  if (body === undefined || body === null) {
    return false;
  }
  if (typeof body === 'string') {
    return body.trim().length > 0;
  }
  if (Buffer.isBuffer(body)) {
    return body.length > 0;
  }
  return true;
}

function latest(entries: RequestLogEntry[]): RequestLogEntry | undefined {
  let best: RequestLogEntry | undefined;
  for (const entry of entries) {
    if (!best || timestampOf(entry) >= timestampOf(best)) {
      best = entry;
    }
  }
  return best;
}

function toExchange(entry: RequestLogEntry): CapturedExchange {
  const contentTypeKey = Object.keys(entry.response.headers ?? {}).find(
    (k) => k.toLowerCase() === 'content-type'
  );
  return {
    statusCode: entry.response.statusCode,
    requestBody: hasBody(entry.request.body) ? entry.request.body : undefined,
    responseBody: hasBody(entry.response.body) ? entry.response.body : undefined,
    contentType: contentTypeKey ? entry.response.headers[contentTypeKey] : undefined,
  };
}

function isUsable(entry: RequestLogEntry): boolean {
  const method = entry.request?.method?.toUpperCase();
  return (
    !!method &&
    MOCKABLE_METHODS.has(method) &&
    typeof entry.request.path === 'string' &&
    entry.request.path.length > 0 &&
    typeof entry.response?.statusCode === 'number'
  );
}

/**
 * Group usable log entries by (method, parameterized path) and pick
 * representative exchanges: the latest 2xx with a body (falling back to the
 * latest 2xx, e.g. a 204) plus the latest capture per distinct non-2xx status.
 */
export function groupLogEntries(entries: RequestLogEntry[]): TrafficEndpoint[] {
  const groups = new Map<string, { method: HttpMethod; path: string; entries: RequestLogEntry[] }>();

  for (const entry of entries) {
    if (!isUsable(entry)) {
      continue;
    }
    const method = entry.request.method.toUpperCase() as HttpMethod;
    const rawPath = entry.request.path.startsWith('/')
      ? entry.request.path
      : `/${entry.request.path}`;
    const path = parameterizePath(rawPath);
    const key = `${method} ${path.toLowerCase()}`;
    let group = groups.get(key);
    if (!group) {
      group = { method, path, entries: [] };
      groups.set(key, group);
    }
    group.entries.push(entry);
  }

  const endpoints: TrafficEndpoint[] = [];
  for (const group of groups.values()) {
    const successEntries = group.entries.filter(
      (e) => e.response.statusCode >= 200 && e.response.statusCode < 300
    );
    const successWithBody = successEntries.filter((e) => hasBody(e.response.body));
    const successEntry = latest(successWithBody) ?? latest(successEntries);

    const errorByStatus = new Map<number, RequestLogEntry>();
    for (const e of group.entries) {
      const status = e.response.statusCode;
      if (status >= 200 && status < 300) {
        continue;
      }
      const current = errorByStatus.get(status);
      if (!current || timestampOf(e) >= timestampOf(current)) {
        errorByStatus.set(status, e);
      }
    }

    const samplePaths: string[] = [];
    for (const e of group.entries) {
      const concrete = e.request.path.split('?')[0];
      if (!samplePaths.includes(concrete)) {
        samplePaths.push(concrete);
        if (samplePaths.length >= 3) {
          break;
        }
      }
    }

    endpoints.push({
      method: group.method,
      path: group.path,
      hits: group.entries.length,
      samplePaths,
      success: successEntry ? toExchange(successEntry) : undefined,
      errors: [...errorByStatus.values()]
        .sort((a, b) => a.response.statusCode - b.response.statusCode)
        .map(toExchange),
    });
  }

  return endpoints.sort(
    (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method)
  );
}

function stringifyBody(body: unknown, maxChars = MAX_BODY_CHARS): string {
  if (body === undefined || body === null) {
    return '(empty)';
  }
  if (Buffer.isBuffer(body)) {
    return '(binary body omitted)';
  }
  let text: string | undefined;
  if (typeof body === 'string') {
    text = body;
  } else {
    try {
      text = JSON.stringify(body, null, 2);
    } catch {
      text = undefined;
    }
  }
  if (text === undefined) {
    text = String(body);
  }
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n… (truncated)` : text;
}

/** Render endpoints as prompt blocks, packed into provider-friendly chunks. */
export function formatEndpointBlocks(
  endpoints: TrafficEndpoint[],
  maxCharsPerChunk = MAX_CHARS_PER_CHUNK
): string[] {
  const chunks: string[] = [];
  let current = '';

  for (const endpoint of endpoints) {
    let block = `### ${endpoint.method} ${endpoint.path}\n`;
    block += `Observed ${endpoint.hits} time(s). Concrete examples: ${endpoint.samplePaths.join(', ')}\n`;
    if (endpoint.success) {
      const type = endpoint.success.contentType ? `, ${endpoint.success.contentType}` : '';
      block += `Success response (status ${endpoint.success.statusCode}${type}):\n${stringifyBody(endpoint.success.responseBody)}\n`;
      if (endpoint.success.requestBody !== undefined) {
        block += `Request body example:\n${stringifyBody(endpoint.success.requestBody)}\n`;
      }
    }
    for (const error of endpoint.errors) {
      block += `Captured error response (status ${error.statusCode}):\n${stringifyBody(error.responseBody)}\n`;
    }
    block += '\n';

    if (current && current.length + block.length > maxCharsPerChunk) {
      chunks.push(current);
      current = '';
    }
    current += block;
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}

/** Path key that ignores param names so :id and :userId compare equal. */
function endpointKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path.toLowerCase().replace(/:[^/]+/g, ':p')}`;
}

/**
 * Generates a mock server from real traffic captured in Mocklify's request
 * log. Deterministic pre-processing groups the log into endpoints with real
 * payloads; the AI's only job is to generalize/clean those payloads into
 * routes — success routes enabled, captured error variants as disabled
 * negative routes — never to invent endpoints.
 */
export class TrafficMockGenerator {
  constructor(private ai: AiService) {}

  async generate(
    entries: RequestLogEntry[],
    options?: {
      token?: vscode.CancellationToken;
      onProgress?: (progress: TrafficScanProgress) => void;
    }
  ): Promise<TrafficScanSummary> {
    const report = (message: string, fraction: number) =>
      options?.onProgress?.({ message, fraction });

    report('Grouping recorded traffic…', 0.02);
    const endpoints = groupLogEntries(entries);
    if (endpoints.length === 0) {
      throw new Error(
        'No usable request traffic has been recorded. Run your app through a Mocklify proxy route (or against a running mock server) so requests appear in the Request Log, then try again.'
      );
    }

    const usableEntryCount = entries.filter(isUsable).length;
    const chunks = formatEndpointBlocks(endpoints);
    const allRoutes: Omit<RouteConfig, 'id'>[] = [];

    for (let i = 0; i < chunks.length; i++) {
      await this.throwIfCancelled(options?.token);
      const provider = (await this.ai.getActiveProviderLabel()) ?? 'AI';
      report(
        `Generating mock routes from traffic with ${provider} (part ${i + 1}/${chunks.length})…`,
        0.1 + 0.8 * (i / chunks.length)
      );

      try {
        const routes = await this.generateChunk(chunks[i], { token: options?.token });
        allRoutes.push(...routes);
      } catch (error) {
        // One failed chunk shouldn't lose the whole run — unless it's the only one
        if (chunks.length === 1) {
          throw error;
        }
        console.error(`Mocklify: traffic generation chunk ${i + 1} failed:`, error);
      }
    }

    report('Assembling mock server…', 0.95);

    // Hard guarantee the model never invents endpoints: keep only routes that
    // match an observed (method, path) pair, ignoring param name differences.
    const observed = new Set(endpoints.map((e) => endpointKey(e.method, e.path)));
    const routes = dedupeRoutes(allRoutes).filter((route) => {
      const methods = Array.isArray(route.method) ? route.method : [route.method];
      return methods.some((m) => observed.has(endpointKey(m, route.path)));
    });

    if (routes.length === 0) {
      throw new Error(
        'The AI did not produce any mock routes matching the recorded traffic. Try again, or use "AI: Generate Mock Server from Description" instead.'
      );
    }

    // Enforce negative-route convention regardless of what the model returned.
    for (const route of routes) {
      const status = route.response.statusCode;
      if (status < 200 || status >= 300) {
        route.enabled = false;
        const tags = new Set(route.tags ?? []);
        tags.add('negative');
        tags.add(String(status));
        route.tags = [...tags];
      }
    }

    const negativeCount = routes.filter((r) => r.tags?.includes('negative')).length;
    return {
      entryCount: usableEntryCount,
      endpointCount: endpoints.length,
      routes,
      positiveCount: routes.length - negativeCount,
      negativeCount,
    };
  }

  private async generateChunk(
    chunk: string,
    options?: AiRequestOptions
  ): Promise<Omit<RouteConfig, 'id'>[]> {
    const prompt = `You are an expert at turning real recorded API traffic into a clean mock server. Below are endpoints observed through Mocklify's request log, grouped by method and parameterized path, with the real captured payloads.

For EVERY endpoint listed, create:
1. A success route (\`"enabled": true\`) reproducing the captured success response: same status code, same field names, same structure. Clean the captured payload — replace volatile values (session tokens, API keys, signatures, one-time codes, tracing/request ids) with realistic stable examples, and keep domain values realistic and consistent with the capture.
2. For each captured error status of that endpoint, a disabled route (\`"enabled": false\`) with that exact status code reproducing the captured error body shape. Tag every negative route with "negative" plus its status, e.g. "tags": ["negative", "404"], and name it like "GET /api/users/:userId — 404 not found".

Rules:
- ONLY create routes for the endpoints listed below — never invent endpoints, methods, or error statuses that were not captured.
- Use the parameterized paths exactly as given (:param form).
- Keep response structure identical to the capture (same keys, same nesting, arrays stay arrays); only values may be cleaned or generalized.
- Tag positive routes with a short domain tag (e.g. "users", "orders").

Return a JSON array of route objects.

${ROUTE_FORMAT_INSTRUCTIONS}

## Recorded endpoints

${chunk}`;

    const raw = await this.ai.sendJsonRequest(prompt, {
      ...options,
      justification: 'Mocklify is turning recorded API traffic into a mock server.',
    });
    return MockGenerator.validateRoutes(raw);
  }

  private async throwIfCancelled(token?: vscode.CancellationToken): Promise<void> {
    if (!token?.isCancellationRequested) {
      return;
    }
    // Dynamic import keeps this module loadable outside VS Code (unit tests).
    let CancellationErrorCtor: (new () => Error) | undefined;
    try {
      CancellationErrorCtor = (await import('vscode')).CancellationError;
    } catch {
      // Not running inside VS Code
    }
    if (CancellationErrorCtor) {
      throw new CancellationErrorCtor();
    }
    const error = new Error('Canceled');
    error.name = 'Canceled';
    throw error;
  }
}
