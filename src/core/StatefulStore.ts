import { v4 as uuidv4 } from 'uuid';
import { StatefulConfig } from '../types/core.js';

export type StatefulItem = Record<string, unknown>;

export type StatefulOperation = 'list' | 'get' | 'insert' | 'update' | 'replace' | 'delete';

export const DEFAULT_ID_PARAM = 'id';

/**
 * Derive the CRUD operation from HTTP method + whether the matched path bound the id param.
 * Returns null when no stateful semantics apply (route falls back to its configured response).
 */
export function deriveStatefulOperation(method: string, hasId: boolean): StatefulOperation | null {
  switch (method.toUpperCase()) {
    case 'GET':
    case 'HEAD':
      return hasId ? 'get' : 'list';
    case 'POST':
      return hasId ? null : 'insert';
    case 'PUT':
      return hasId ? 'replace' : null;
    case 'PATCH':
      return hasId ? 'update' : null;
    case 'DELETE':
      return hasId ? 'delete' : null;
    default:
      return null;
  }
}

function isPlainObject(value: unknown): value is StatefulItem {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEmptyId(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

/**
 * idKey names the URL parameter (e.g. "productId"), but items conventionally
 * carry their identifier in an "id" field regardless of the :param name
 * (AI-generated seeds and captured payloads do). Resolve the field per item,
 * preferring the configured key, so both conventions are addressable.
 */
function idFieldOf(item: StatefulItem, idKey: string): string {
  return isEmptyId(item[idKey]) ? DEFAULT_ID_PARAM : idKey;
}

// Path params are strings while seeded ids may be numbers, so compare loosely by string form.
function idMatches(item: StatefulItem, idKey: string, id: string): boolean {
  const value = item[idFieldOf(item, idKey)];
  return value !== undefined && value !== null && String(value) === id;
}

function normalizeSeed(seed: unknown): StatefulItem[] {
  if (Array.isArray(seed)) {
    return seed.filter(isPlainObject).map((item) => ({ ...item }));
  }
  if (isPlainObject(seed)) {
    return [{ ...seed }];
  }
  return [];
}

/**
 * Per-server-instance in-memory CRUD store keyed by collection name.
 * Pure (vscode-free); the owning server clears it on restart.
 */
export class StatefulStore {
  private collections: Map<string, StatefulItem[]> = new Map();

  /** Seed a collection on first access; no-op if already initialized. */
  ensureCollection(collection: string, seed?: unknown): StatefulItem[] {
    let items = this.collections.get(collection);
    if (!items) {
      items = normalizeSeed(seed);
      this.collections.set(collection, items);
    }
    return items;
  }

  hasCollection(collection: string): boolean {
    return this.collections.has(collection);
  }

  list(collection: string, options?: { offset?: number; limit?: number }): StatefulItem[] {
    const items = this.ensureCollection(collection);
    const offset = options?.offset !== undefined && options.offset > 0 ? options.offset : 0;
    const sliced = offset > 0 ? items.slice(offset) : items.slice();
    if (options?.limit !== undefined && options.limit >= 0) {
      return sliced.slice(0, options.limit);
    }
    return sliced;
  }

  get(collection: string, idKey: string, id: string): StatefulItem | null {
    const items = this.ensureCollection(collection);
    return items.find((item) => idMatches(item, idKey, id)) ?? null;
  }

  insert(collection: string, idKey: string, body: unknown): StatefulItem {
    const items = this.ensureCollection(collection);
    const item: StatefulItem = isPlainObject(body) ? { ...body } : {};
    if (isEmptyId(item[idKey]) && isEmptyId(item[DEFAULT_ID_PARAM])) {
      item[DEFAULT_ID_PARAM] = uuidv4();
    }
    items.push(item);
    return item;
  }

  /** PATCH semantics: shallow-merge into the existing item; id field is preserved. */
  update(collection: string, idKey: string, id: string, patch: unknown): StatefulItem | null {
    const items = this.ensureCollection(collection);
    const index = items.findIndex((item) => idMatches(item, idKey, id));
    if (index === -1) {
      return null;
    }
    const existing = items[index];
    const idField = idFieldOf(existing, idKey);
    const merged: StatefulItem = {
      ...existing,
      ...(isPlainObject(patch) ? patch : {}),
      [idField]: existing[idField],
    };
    items[index] = merged;
    return merged;
  }

  /** PUT semantics: replace all non-id fields; id field is preserved. */
  replace(collection: string, idKey: string, id: string, body: unknown): StatefulItem | null {
    const items = this.ensureCollection(collection);
    const index = items.findIndex((item) => idMatches(item, idKey, id));
    if (index === -1) {
      return null;
    }
    const idField = idFieldOf(items[index], idKey);
    const replaced: StatefulItem = {
      ...(isPlainObject(body) ? body : {}),
      [idField]: items[index][idField],
    };
    items[index] = replaced;
    return replaced;
  }

  delete(collection: string, idKey: string, id: string): boolean {
    const items = this.ensureCollection(collection);
    const index = items.findIndex((item) => idMatches(item, idKey, id));
    if (index === -1) {
      return false;
    }
    items.splice(index, 1);
    return true;
  }

  clear(collection?: string): void {
    if (collection !== undefined) {
      this.collections.delete(collection);
    } else {
      this.collections.clear();
    }
  }
}

export interface StatefulRequest {
  method: string;
  params: Record<string, string>;
  query: Record<string, string | string[] | undefined>;
  body?: unknown;
}

export interface StatefulResult {
  statusCode: number;
  body: unknown; // null means empty body (204)
}

function queryInt(
  query: Record<string, string | string[] | undefined>,
  key: string
): number | undefined {
  const raw = query[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Execute a stateful CRUD request against the store.
 * `fallbackSeed` is the route's static example body, used to seed the collection
 * on first access when no explicit seed is configured (array → list, object → single item).
 * Returns null when no operation can be derived — the caller falls back to normal
 * response generation, so misconfigured routes never break.
 */
export function executeStateful(
  store: StatefulStore,
  config: StatefulConfig,
  request: StatefulRequest,
  fallbackSeed?: unknown
): StatefulResult | null {
  const idKey = config.idParam ?? DEFAULT_ID_PARAM;
  const id = request.params[idKey];
  const operation = deriveStatefulOperation(request.method, id !== undefined);
  if (!operation) {
    return null;
  }

  store.ensureCollection(config.collection, config.seed ?? fallbackSeed);

  switch (operation) {
    case 'list':
      return {
        statusCode: 200,
        body: store.list(config.collection, {
          offset: queryInt(request.query, 'offset'),
          limit: queryInt(request.query, 'limit'),
        }),
      };

    case 'get': {
      const item = store.get(config.collection, idKey, id);
      return item
        ? { statusCode: 200, body: item }
        : { statusCode: 404, body: notFoundBody(config.collection, id) };
    }

    case 'insert':
      return { statusCode: 201, body: store.insert(config.collection, idKey, request.body) };

    case 'update': {
      const item = store.update(config.collection, idKey, id, request.body);
      return item
        ? { statusCode: 200, body: item }
        : { statusCode: 404, body: notFoundBody(config.collection, id) };
    }

    case 'replace': {
      const item = store.replace(config.collection, idKey, id, request.body);
      return item
        ? { statusCode: 200, body: item }
        : { statusCode: 404, body: notFoundBody(config.collection, id) };
    }

    case 'delete':
      return store.delete(config.collection, idKey, id)
        ? { statusCode: 204, body: null }
        : { statusCode: 404, body: notFoundBody(config.collection, id) };
  }
}

function notFoundBody(collection: string, id: string): unknown {
  return { error: 'Not Found', message: `No item '${id}' in collection '${collection}'` };
}
