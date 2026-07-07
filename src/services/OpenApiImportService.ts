import { parse as parseYamlDocument } from 'yaml';
import { faker } from '@faker-js/faker';
import { HttpMethod, NEGATIVE_ROUTE_PRIORITY, ResponseConfig, RouteConfig } from '../types/core.js';

/**
 * Deterministic OpenAPI 3.0/3.1 and Swagger 2.0 importer. No vscode and no AI
 * dependency: the same spec text always produces the same routes (faker is
 * seeded per route from the path string), so the import works fully offline.
 * AI enrichment on top of this result lives in src/ai/SpecEnricher.ts.
 */

export type SpecVersion = 'openapi3' | 'swagger2' | 'unknown';

export interface ParsedSpec {
  /** Spec document with all local $ref pointers resolved inline. */
  document: Record<string, unknown>;
  version: SpecVersion;
  warnings: string[];
}

export interface OpenApiImportResult {
  /** Server name, taken from info.title. */
  name: string;
  routes: Omit<RouteConfig, 'id'>[];
  warnings: string[];
}

type JsonRecord = Record<string, unknown>;

const HTTP_METHOD_KEYS = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'] as const;

/** Guards against pathological (non-cyclic) $ref chains. */
const MAX_REF_DEPTH = 32;
/** Guards example generation against deeply nested schemas. */
const MAX_GENERATION_DEPTH = 8;
const ARRAY_ITEM_COUNT = 2;
/** Fixed reference date so faker date output is stable across runs. */
const FIXED_REF_DATE = '2026-01-01T00:00:00.000Z';

function asRecord(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

/** FNV-1a 32-bit hash — a stable faker seed derived from the route path. */
function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function decodePointerSegment(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

function lookupPointer(root: unknown, ref: string): unknown {
  const segments = ref.slice(2).split('/').map(decodePointerSegment);
  let node: unknown = root;
  for (const segment of segments) {
    const record = asRecord(node);
    if (!record || !(segment in record)) {
      return undefined;
    }
    node = record[segment];
  }
  return node;
}

interface RefResolutionState {
  warnings: Set<string>;
  /** Shared resolutions per $ref so N usage sites of one schema resolve once. */
  cache: Map<string, unknown>;
  /** Count of cycle/depth truncations — those results depend on the ref stack. */
  truncations: number;
}

/**
 * Deep-copy a spec node with every local $ref resolved inline. Cycles and
 * over-deep chains are cut with an empty-object placeholder plus a warning;
 * remote/unresolvable refs are skipped the same way, never thrown. Acyclic
 * refs are memoized (heavily shared component schemas would otherwise be
 * re-copied at every usage site, blowing up time and memory on large specs).
 */
function resolveRefs(node: unknown, root: unknown, state: RefResolutionState, stack: string[]): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => resolveRefs(item, root, state, stack));
  }
  const record = asRecord(node);
  if (!record) {
    return node;
  }

  const ref = record.$ref;
  if (typeof ref === 'string') {
    if (!ref.startsWith('#/')) {
      state.warnings.add(`Skipped unsupported non-local $ref "${ref}" — only #/... pointers are resolved.`);
      return {};
    }
    if (stack.includes(ref)) {
      state.warnings.add(`Cyclic $ref "${ref}" truncated to an empty object.`);
      state.truncations++;
      return {};
    }
    if (stack.length >= MAX_REF_DEPTH) {
      state.warnings.add(`$ref chain deeper than ${MAX_REF_DEPTH} truncated at "${ref}".`);
      state.truncations++;
      return {};
    }
    if (state.cache.has(ref)) {
      return state.cache.get(ref);
    }
    const target = lookupPointer(root, ref);
    if (target === undefined) {
      state.warnings.add(`Skipped unresolvable $ref "${ref}".`);
      return {};
    }
    const truncationsBefore = state.truncations;
    const resolved = resolveRefs(target, root, state, [...stack, ref]);
    // Only truncation-free resolutions are stack-independent and safe to share.
    if (state.truncations === truncationsBefore) {
      state.cache.set(ref, resolved);
    }
    return resolved;
  }

  const out: JsonRecord = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = resolveRefs(value, root, state, stack);
  }
  return out;
}

/** Convert OpenAPI {param} segments to Express :param, sanitizing the name. */
function toExpressPath(path: string): string {
  return path.replace(/\{([^{}/]+)\}/g, (_match, name: string) => {
    let param = name.replace(/[^A-Za-z0-9_]/g, '_');
    if (!/^[A-Za-z_]/.test(param)) {
      param = `_${param}`;
    }
    return `:${param}`;
  });
}

function isJsonMediaType(mediaType: string): boolean {
  const base = mediaType.split(';')[0].trim().toLowerCase();
  return base === 'application/json' || base.endsWith('+json');
}

function pickSuccessKey(statusKeys: string[]): string | undefined {
  for (const preferred of ['200', '201', '202', '204']) {
    if (statusKeys.includes(preferred)) {
      return preferred;
    }
  }
  const twoXx = statusKeys.filter((key) => /^2\d\d$/.test(key)).sort();
  if (twoXx.length > 0) {
    return twoXx[0];
  }
  return statusKeys.includes('default') ? 'default' : undefined;
}

type BodyResult =
  | { kind: 'body'; content: unknown }
  | { kind: 'none' }
  | { kind: 'unsupported'; mediaTypes: string[] };

export class OpenApiImportService {
  /** Parse JSON or YAML spec text and resolve all local $ref pointers. */
  parseSpec(text: string): ParsedSpec {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      try {
        raw = parseYamlDocument(text);
      } catch (error) {
        throw new Error(
          `The file could not be parsed as JSON or YAML: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    const document = asRecord(raw);
    if (!document) {
      throw new Error('The spec must be a JSON or YAML object with an OpenAPI/Swagger structure.');
    }

    const warnings = new Set<string>();
    let version: SpecVersion = 'unknown';
    if (typeof document.openapi === 'string' && document.openapi.startsWith('3.')) {
      version = 'openapi3';
    } else if (typeof document.swagger === 'string' && document.swagger.startsWith('2.')) {
      version = 'swagger2';
    } else {
      warnings.add(
        'Unrecognized spec version — expected OpenAPI 3.x ("openapi") or Swagger 2.0 ("swagger"); attempting import anyway.'
      );
    }

    const state: RefResolutionState = { warnings, cache: new Map(), truncations: 0 };
    const resolved = asRecord(resolveRefs(document, document, state, [])) ?? {};
    return { document: resolved, version, warnings: [...warnings] };
  }

  /** Convert a parsed spec into Mocklify routes. */
  toRoutes(parsed: ParsedSpec): OpenApiImportResult {
    const warnings = [...parsed.warnings];
    const document = parsed.document;
    const info = asRecord(document.info);
    const name =
      typeof info?.title === 'string' && info.title.trim().length > 0
        ? info.title.trim()
        : 'Imported API';

    const routes: Omit<RouteConfig, 'id'>[] = [];
    const paths = asRecord(document.paths);
    if (!paths || Object.keys(paths).length === 0) {
      warnings.push('The spec declares no paths — nothing to import.');
      return { name, routes, warnings };
    }

    for (const [rawPath, rawItem] of Object.entries(paths)) {
      const pathItem = asRecord(rawItem);
      if (!pathItem) {
        warnings.push(`Skipped path "${rawPath}": not an object.`);
        continue;
      }
      const path = toExpressPath(rawPath);
      for (const methodKey of HTTP_METHOD_KEYS) {
        const operation = asRecord(pathItem[methodKey]);
        if (!operation) {
          continue;
        }
        const method = methodKey.toUpperCase() as HttpMethod;
        try {
          this.buildOperationRoutes(method, path, operation, document, parsed.version, routes, warnings);
        } catch (error) {
          warnings.push(
            `Skipped ${method} ${rawPath}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    }

    return { name, routes, warnings };
  }

  /** Parse spec text and convert it to routes in one call. */
  importSpec(text: string): OpenApiImportResult {
    return this.toRoutes(this.parseSpec(text));
  }

  private buildOperationRoutes(
    method: HttpMethod,
    path: string,
    operation: JsonRecord,
    document: JsonRecord,
    version: SpecVersion,
    routes: Omit<RouteConfig, 'id'>[],
    warnings: string[]
  ): void {
    if (version === 'swagger2') {
      const produces = (
        Array.isArray(operation.produces)
          ? operation.produces
          : Array.isArray(document.produces)
            ? document.produces
            : undefined
      )?.filter((entry): entry is string => typeof entry === 'string');
      if (produces && produces.length > 0 && !produces.some(isJsonMediaType)) {
        warnings.push(
          `Skipped ${method} ${path}: only non-JSON content types are documented (${produces.join(', ')}).`
        );
        return;
      }
    }

    const responses = asRecord(operation.responses) ?? {};
    const statusKeys = Object.keys(responses);
    const summary =
      typeof operation.summary === 'string' && operation.summary.trim().length > 0
        ? operation.summary.trim()
        : undefined;
    const operationId =
      typeof operation.operationId === 'string' && operation.operationId.trim().length > 0
        ? operation.operationId.trim()
        : undefined;
    const baseName = summary ?? operationId ?? `${method} ${path}`;
    const tags = Array.isArray(operation.tags)
      ? operation.tags.filter((tag): tag is string => typeof tag === 'string')
      : [];

    const successKey = pickSuccessKey(statusKeys);
    const successStatus =
      successKey && successKey !== 'default' ? parseInt(successKey, 10) : 200;
    const successResponse = successKey ? asRecord(responses[successKey]) : undefined;

    const successBody = this.buildBody(method, path, successKey ?? '200', successResponse);
    if (successBody.kind === 'unsupported') {
      warnings.push(
        `Skipped ${method} ${path}: the success response only documents non-JSON content types (${successBody.mediaTypes.join(', ')}).`
      );
      return;
    }

    const response: ResponseConfig = { type: 'static', statusCode: successStatus };
    if (successBody.kind === 'body') {
      response.headers = { 'Content-Type': 'application/json' };
      response.body = { contentType: 'application/json', content: successBody.content };
    }
    routes.push({
      name: baseName,
      enabled: true,
      method,
      path,
      response,
      ...(tags.length > 0 ? { tags } : {}),
    });

    // Documented error responses become disabled negative routes, following
    // the repo convention: tags ["negative", "<status>"], enabled: false.
    for (const statusKey of statusKeys) {
      if (!/^[45]\d\d$/.test(statusKey)) {
        continue;
      }
      const status = parseInt(statusKey, 10);
      const errorResponse = asRecord(responses[statusKey]);
      const errorBody = this.buildBody(method, path, statusKey, errorResponse);
      if (errorBody.kind === 'unsupported') {
        warnings.push(
          `Skipped documented ${status} response for ${method} ${path}: only non-JSON content types (${errorBody.mediaTypes.join(', ')}).`
        );
        continue;
      }
      const description =
        typeof errorResponse?.description === 'string' && errorResponse.description.trim().length > 0
          ? errorResponse.description.trim()
          : 'error';
      const negativeResponse: ResponseConfig = { type: 'static', statusCode: status };
      if (errorBody.kind === 'body') {
        negativeResponse.headers = { 'Content-Type': 'application/json' };
        negativeResponse.body = { contentType: 'application/json', content: errorBody.content };
      }
      routes.push({
        name: `${method} ${path} — ${status} ${description}`,
        enabled: false,
        method,
        path,
        response: negativeResponse,
        // Once enabled, the negative route must outscore the success route
        // sharing its method+path (the matcher keeps the first route on a tie).
        priority: NEGATIVE_ROUTE_PRIORITY,
        tags: [...tags, 'negative', String(status)],
      });
    }
  }

  /**
   * Extract a JSON response body for one documented response: a declared
   * example wins, otherwise the body is generated from the JSON schema with a
   * faker seeded from the route path so the output is stable across runs.
   */
  private buildBody(
    method: HttpMethod,
    path: string,
    statusKey: string,
    response: JsonRecord | undefined
  ): BodyResult {
    if (!response) {
      return { kind: 'none' };
    }
    faker.seed(hashSeed(`${method} ${path} ${statusKey}`));

    // OpenAPI 3.x shape: responses.<status>.content.<mediaType>
    const content = asRecord(response.content);
    if (content && Object.keys(content).length > 0) {
      const jsonKey = Object.keys(content).find(isJsonMediaType);
      if (!jsonKey) {
        return { kind: 'unsupported', mediaTypes: Object.keys(content) };
      }
      const media = asRecord(content[jsonKey]) ?? {};
      if (media.example !== undefined) {
        return { kind: 'body', content: media.example };
      }
      const examples = asRecord(media.examples);
      if (examples) {
        const first = Object.values(examples)[0];
        const firstRecord = asRecord(first);
        if (firstRecord && firstRecord.value !== undefined) {
          return { kind: 'body', content: firstRecord.value };
        }
      }
      if (media.schema !== undefined) {
        return { kind: 'body', content: this.generateFromSchema(media.schema, 0) };
      }
      return { kind: 'none' };
    }

    // Swagger 2.0 shape: responses.<status>.{schema, examples.<mediaType>}
    const examples = asRecord(response.examples);
    if (examples) {
      const jsonKey = Object.keys(examples).find(isJsonMediaType);
      if (jsonKey) {
        return { kind: 'body', content: examples[jsonKey] };
      }
    }
    if (response.schema !== undefined) {
      return { kind: 'body', content: this.generateFromSchema(response.schema, 0) };
    }
    return { kind: 'none' };
  }

  private generateFromSchema(schema: unknown, depth: number): unknown {
    const record = asRecord(schema);
    if (!record) {
      return {};
    }
    if (record.example !== undefined) {
      return record.example;
    }
    if (record.default !== undefined) {
      return record.default;
    }
    if (Array.isArray(record.enum) && record.enum.length > 0) {
      return record.enum[0];
    }
    if (depth >= MAX_GENERATION_DEPTH) {
      return {};
    }

    if (Array.isArray(record.allOf)) {
      const merged: JsonRecord = {};
      for (const part of record.allOf) {
        const value = this.generateFromSchema(part, depth + 1);
        const valueRecord = asRecord(value);
        if (valueRecord) {
          Object.assign(merged, valueRecord);
        }
      }
      return merged;
    }
    for (const key of ['oneOf', 'anyOf'] as const) {
      const variants = record[key];
      if (Array.isArray(variants) && variants.length > 0) {
        return this.generateFromSchema(variants[0], depth + 1);
      }
    }

    let type = record.type;
    if (Array.isArray(type)) {
      // OpenAPI 3.1 union types, e.g. ["string", "null"]
      type = type.find((t) => t !== 'null') ?? type[0];
    }
    if (type === undefined) {
      if (asRecord(record.properties)) {
        type = 'object';
      } else if (record.items !== undefined) {
        type = 'array';
      }
    }

    switch (type) {
      case 'object': {
        const out: JsonRecord = {};
        const properties = asRecord(record.properties) ?? {};
        for (const [key, propertySchema] of Object.entries(properties)) {
          out[key] = this.generatePropertyValue(key, propertySchema, depth + 1);
        }
        return out;
      }
      case 'array':
        return Array.from({ length: ARRAY_ITEM_COUNT }, () =>
          this.generateFromSchema(record.items, depth + 1)
        );
      case 'string':
        return this.generateString(record);
      case 'integer': {
        const min = typeof record.minimum === 'number' ? record.minimum : 1;
        const max = typeof record.maximum === 'number' && record.maximum >= min ? record.maximum : min + 999;
        return faker.number.int({ min, max });
      }
      case 'number': {
        const min = typeof record.minimum === 'number' ? record.minimum : 0;
        const max = typeof record.maximum === 'number' && record.maximum >= min ? record.maximum : min + 999;
        return faker.number.float({ min, max, fractionDigits: 2 });
      }
      case 'boolean':
        return faker.datatype.boolean();
      case 'null':
        return null;
      default:
        return {};
    }
  }

  /** Property-name-aware string generation for nicer default values. */
  private generatePropertyValue(name: string, schema: unknown, depth: number): unknown {
    const record = asRecord(schema);
    const type = Array.isArray(record?.type)
      ? record?.type.find((t) => t !== 'null')
      : record?.type;
    if (
      record &&
      type === 'string' &&
      record.format === undefined &&
      record.example === undefined &&
      record.default === undefined &&
      !Array.isArray(record.enum)
    ) {
      return this.generateString(record, name);
    }
    return this.generateFromSchema(schema, depth);
  }

  private generateString(schema: JsonRecord, propertyName?: string): string {
    switch (schema.format) {
      case 'uuid':
        return faker.string.uuid();
      case 'email':
        return faker.internet.email();
      case 'date-time':
        return faker.date.past({ years: 1, refDate: FIXED_REF_DATE }).toISOString();
      case 'date':
        return faker.date.past({ years: 1, refDate: FIXED_REF_DATE }).toISOString().slice(0, 10);
      case 'uri':
      case 'url':
        return faker.internet.url();
      case 'hostname':
        return faker.internet.domainName();
      case 'ipv4':
        return faker.internet.ipv4();
      default:
        break;
    }

    const lower = (propertyName ?? '').toLowerCase();
    if (lower === 'id' || lower.endsWith('id') || lower.endsWith('_id')) {
      return faker.string.uuid();
    }
    if (lower.includes('email')) {
      return faker.internet.email();
    }
    if (lower.includes('firstname') || lower === 'first_name') {
      return faker.person.firstName();
    }
    if (lower.includes('lastname') || lower === 'last_name') {
      return faker.person.lastName();
    }
    if (lower === 'name' || lower.endsWith('name')) {
      return faker.person.fullName();
    }
    if (lower.includes('phone')) {
      return faker.phone.number();
    }
    if (lower.includes('url') || lower.includes('avatar') || lower.includes('image')) {
      return faker.internet.url();
    }
    if (lower.includes('description') || lower.includes('summary') || lower.includes('bio')) {
      return faker.lorem.sentence();
    }
    if (lower.includes('city')) {
      return faker.location.city();
    }
    if (lower.includes('country')) {
      return faker.location.country();
    }
    return faker.lorem.words(2);
  }
}
