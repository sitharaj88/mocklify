import { v5 as uuidv5 } from 'uuid';
import { stringify as yamlStringify } from 'yaml';
import { MockServerConfig, RouteConfig, HttpMethod } from '../types/core.js';
import { getExtensionVersion } from '../version.js';

/** Fixed namespace so _postman_id is stable for the same server across exports. */
const MOCKLIFY_POSTMAN_NAMESPACE = '5f0aa3f7-31bf-4f0b-9c62-8f9d5a2b7e41';

const POSTMAN_SCHEMA_URL = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';

const FAILURE_FOLDER_NAME = 'Failure scenarios';

const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  301: 'Moved Permanently',
  302: 'Found',
  304: 'Not Modified',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

export interface PostmanKeyValue {
  key: string;
  value: string;
  type?: string;
  description?: string;
}

export interface PostmanUrl {
  raw: string;
  host: string[];
  path: string[];
  query?: PostmanKeyValue[];
  variable?: PostmanKeyValue[];
}

export interface PostmanRequestBody {
  mode: 'raw';
  raw: string;
  options?: { raw: { language: string } };
}

export interface PostmanRequest {
  method: string;
  header: PostmanKeyValue[];
  url: PostmanUrl;
  body?: PostmanRequestBody;
  description?: string;
}

export interface PostmanSavedResponse {
  name: string;
  originalRequest: PostmanRequest;
  status: string;
  code: number;
  _postman_previewlanguage?: string;
  header: PostmanKeyValue[];
  body: string;
}

export interface PostmanItem {
  name: string;
  request: PostmanRequest;
  response: PostmanSavedResponse[];
}

export interface PostmanFolder {
  name: string;
  item: (PostmanItem | PostmanFolder)[];
}

export interface PostmanCollection {
  info: {
    name: string;
    _postman_id: string;
    description: string;
    schema: string;
  };
  item: (PostmanItem | PostmanFolder)[];
  variable: PostmanKeyValue[];
}

export interface PostmanExportOptions {
  version?: string;
}

function methodsOf(route: RouteConfig): HttpMethod[] {
  return Array.isArray(route.method) ? route.method : [route.method];
}

/** Disabled non-2xx routes follow the Mocklify negative-flow convention. */
function isFailureRoute(route: RouteConfig): boolean {
  const status = route.response.statusCode;
  return !route.enabled && (status < 200 || status >= 300);
}

/** Grouping tag: first tag that is not the auto-added 'negative'/status marker. */
function primaryTag(route: RouteConfig): string | undefined {
  return (route.tags ?? []).find((tag) => tag !== 'negative' && !/^\d+$/.test(tag));
}

function statusText(code: number): string {
  return STATUS_TEXT[code] ?? 'Unknown';
}

function pathSegments(path: string): string[] {
  return path.split('/').filter(Boolean);
}

function pathParams(path: string): string[] {
  return pathSegments(path)
    .filter((segment) => segment.startsWith(':'))
    .map((segment) => segment.slice(1).replace(/[^A-Za-z0-9_].*$/, ''));
}

/** Example value for a path param, taken from the route's own mock body when present. */
function exampleParamValue(param: string, route: RouteConfig): string {
  let content = route.response.body?.content;
  if (Array.isArray(content)) {
    content = content[0];
  }
  if (content && typeof content === 'object') {
    const value = (content as Record<string, unknown>)[param];
    if (['string', 'number', 'boolean'].includes(typeof value)) {
      return String(value);
    }
  }
  return '1';
}

function normalizedPath(route: RouteConfig): string {
  return route.path.startsWith('/') ? route.path : `/${route.path}`;
}

function queryEntries(route: RouteConfig): PostmanKeyValue[] {
  return Object.entries(route.matcher?.queryParams ?? {}).map(([key, value]) => ({ key, value }));
}

/** Only exact matchers describe a literal request body; others are match rules. */
function exactBodyOf(route: RouteConfig): string | undefined {
  const matcher = route.matcher?.body;
  return matcher?.type === 'exact' ? matcher.value : undefined;
}

function bodyRuleNote(route: RouteConfig): string | undefined {
  const matcher = route.matcher?.body;
  if (!matcher || matcher.type === 'exact') {
    return undefined;
  }
  const rule = matcher.type === 'jsonPath' ? `jsonPath ${matcher.jsonPath ?? ''}` : matcher.type;
  return `Body must match ${rule}: ${matcher.value}`;
}

function responseBodyString(route: RouteConfig): string {
  const content = route.response.body?.content;
  if (content === undefined || content === null) {
    return '';
  }
  return typeof content === 'string' ? content : JSON.stringify(content, null, 2);
}

function buildPostmanUrl(route: RouteConfig): PostmanUrl {
  const query = queryEntries(route);
  const queryString = query.length
    ? '?' + query.map(({ key, value }) => `${key}=${value}`).join('&')
    : '';
  const url: PostmanUrl = {
    raw: `{{baseUrl}}${normalizedPath(route)}${queryString}`,
    host: ['{{baseUrl}}'],
    path: pathSegments(normalizedPath(route)),
  };
  if (query.length > 0) {
    url.query = query;
  }
  const params = pathParams(route.path);
  if (params.length > 0) {
    url.variable = params.map((param) => ({
      key: param,
      value: exampleParamValue(param, route),
    }));
  }
  return url;
}

function buildPostmanRequest(route: RouteConfig, method: HttpMethod): PostmanRequest {
  const header: PostmanKeyValue[] = Object.entries(route.matcher?.headers ?? {}).map(
    ([key, value]) => ({ key, value })
  );

  const request: PostmanRequest = {
    method,
    header,
    url: buildPostmanUrl(route),
  };

  const exactBody = exactBodyOf(route);
  if (exactBody !== undefined) {
    if (!header.some((h) => h.key.toLowerCase() === 'content-type')) {
      header.push({ key: 'Content-Type', value: 'application/json' });
    }
    request.body = {
      mode: 'raw',
      raw: exactBody,
      options: { raw: { language: 'json' } },
    };
  } else {
    const note = bodyRuleNote(route);
    if (note) {
      request.description = note;
    }
  }

  return request;
}

function buildSavedResponse(route: RouteConfig, request: PostmanRequest): PostmanSavedResponse {
  const code = route.response.statusCode;
  const contentType = route.response.body?.contentType ?? 'application/json';
  const header: PostmanKeyValue[] = Object.entries(route.response.headers ?? {}).map(
    ([key, value]) => ({ key, value })
  );
  if (route.response.body && !header.some((h) => h.key.toLowerCase() === 'content-type')) {
    header.push({ key: 'Content-Type', value: contentType });
  }

  const body = responseBodyString(route);
  const saved: PostmanSavedResponse = {
    name: `${code} ${statusText(code)}`,
    originalRequest: JSON.parse(JSON.stringify(request)) as PostmanRequest,
    status: statusText(code),
    code,
    header,
    body,
  };
  if (body) {
    saved._postman_previewlanguage = contentType.includes('json') ? 'json' : 'text';
  }
  return saved;
}

function buildPostmanItem(route: RouteConfig, method: HttpMethod, multiMethod: boolean): PostmanItem {
  const request = buildPostmanRequest(route, method);
  return {
    name: multiMethod ? `${route.name} (${method})` : route.name,
    request,
    response: [buildSavedResponse(route, request)],
  };
}

/**
 * Build a Postman Collection Format v2.1.0 document from a server config.
 * Routes are grouped into one folder per tag; disabled negative-flow routes
 * land in a 'Failure scenarios' folder within their tag (or at the root).
 */
export function buildPostmanCollection(
  server: MockServerConfig,
  options?: PostmanExportOptions
): PostmanCollection {
  const version = options?.version ?? getExtensionVersion();

  interface TagBucket {
    items: PostmanItem[];
    failures: PostmanItem[];
  }
  const rootBucket: TagBucket = { items: [], failures: [] };
  const tagBuckets = new Map<string, TagBucket>();

  for (const route of server.routes) {
    const failure = isFailureRoute(route);
    if (!route.enabled && !failure) {
      continue;
    }
    const tag = primaryTag(route);
    let bucket = rootBucket;
    if (tag) {
      bucket = tagBuckets.get(tag) ?? { items: [], failures: [] };
      tagBuckets.set(tag, bucket);
    }
    const methods = methodsOf(route);
    for (const method of methods) {
      const item = buildPostmanItem(route, method, methods.length > 1);
      (failure ? bucket.failures : bucket.items).push(item);
    }
  }

  const item: (PostmanItem | PostmanFolder)[] = [...rootBucket.items];
  for (const [tag, bucket] of tagBuckets) {
    const folderItems: (PostmanItem | PostmanFolder)[] = [...bucket.items];
    if (bucket.failures.length > 0) {
      folderItems.push({ name: FAILURE_FOLDER_NAME, item: bucket.failures });
    }
    item.push({ name: tag, item: folderItems });
  }
  if (rootBucket.failures.length > 0) {
    item.push({ name: FAILURE_FOLDER_NAME, item: rootBucket.failures });
  }

  return {
    info: {
      name: `${server.name} Mock API`,
      _postman_id: uuidv5(server.id || server.name, MOCKLIFY_POSTMAN_NAMESPACE),
      description: `Postman collection generated by Mocklify v${version} from mock server "${server.name}".`,
      schema: POSTMAN_SCHEMA_URL,
    },
    item,
    variable: [{ key: 'baseUrl', value: `http://localhost:${server.port}`, type: 'string' }],
  };
}

function fillPathParams(route: RouteConfig): string {
  return normalizedPath(route).replace(/:([A-Za-z0-9_]+)/g, (_match, param: string) =>
    exampleParamValue(param, route)
  );
}

/**
 * Build a REST Client (.http) file: one named request block per route/method,
 * with path params filled from the route's own mock body where possible.
 */
export function buildHttpFile(server: MockServerConfig): string {
  const blocks: string[] = [];

  for (const route of server.routes) {
    const failure = isFailureRoute(route);
    if (!route.enabled && !failure) {
      continue;
    }

    const query = queryEntries(route);
    const queryString = query.length
      ? '?' +
        query
          .map(({ key, value }) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
          .join('&')
      : '';
    const target = `{{baseUrl}}${fillPathParams(route)}${queryString}`;

    const methods = methodsOf(route);
    for (const method of methods) {
      const name = methods.length > 1 ? `${route.name} (${method})` : route.name;
      const lines: string[] = [`### ${name}${failure ? ' (failure scenario)' : ''}`];
      const note = bodyRuleNote(route);
      if (note) {
        lines.push(`# ${note}`);
      }
      lines.push(`${method} ${target}`);
      for (const [key, value] of Object.entries(route.matcher?.headers ?? {})) {
        lines.push(`${key}: ${value}`);
      }
      const exactBody = exactBodyOf(route);
      if (exactBody !== undefined) {
        if (!Object.keys(route.matcher?.headers ?? {}).some((k) => k.toLowerCase() === 'content-type')) {
          lines.push('Content-Type: application/json');
        }
        lines.push('', exactBody);
      }
      blocks.push(lines.join('\n'));
    }
  }

  return [`@baseUrl = http://localhost:${server.port}`, ...blocks].join('\n\n') + '\n';
}

/**
 * Serialize an OpenAPI JSON document (as produced by OpenApiExportService)
 * to YAML, preserving key order. The JSON round-trip strips undefined values
 * and shared references so the output never contains YAML anchors/aliases.
 */
export function buildOpenApiYaml(server: MockServerConfig, openApiJson: object): string {
  const plain = JSON.parse(JSON.stringify(openApiJson)) as object;
  const header = `# OpenAPI specification for "${server.name}" - generated by Mocklify\n`;
  return header + yamlStringify(plain, { aliasDuplicateObjects: false, lineWidth: 0 });
}
