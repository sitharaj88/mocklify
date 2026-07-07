import { describe, it, expect } from 'vitest';
import {
  StatefulStore,
  deriveStatefulOperation,
  executeStateful,
  StatefulRequest,
} from '../src/core/StatefulStore.js';
import { StatefulConfig } from '../src/types/core.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('deriveStatefulOperation', () => {
  it('maps GET without id to list', () => {
    expect(deriveStatefulOperation('GET', false)).toBe('list');
  });

  it('maps GET with id to get', () => {
    expect(deriveStatefulOperation('GET', true)).toBe('get');
  });

  it('maps HEAD like GET', () => {
    expect(deriveStatefulOperation('HEAD', false)).toBe('list');
    expect(deriveStatefulOperation('HEAD', true)).toBe('get');
  });

  it('maps POST without id to insert', () => {
    expect(deriveStatefulOperation('POST', false)).toBe('insert');
  });

  it('returns null for POST with id', () => {
    expect(deriveStatefulOperation('POST', true)).toBeNull();
  });

  it('maps PUT with id to replace and PATCH with id to update', () => {
    expect(deriveStatefulOperation('PUT', true)).toBe('replace');
    expect(deriveStatefulOperation('PATCH', true)).toBe('update');
  });

  it('returns null for PUT/PATCH/DELETE without id', () => {
    expect(deriveStatefulOperation('PUT', false)).toBeNull();
    expect(deriveStatefulOperation('PATCH', false)).toBeNull();
    expect(deriveStatefulOperation('DELETE', false)).toBeNull();
  });

  it('maps DELETE with id to delete', () => {
    expect(deriveStatefulOperation('DELETE', true)).toBe('delete');
  });

  it('is case-insensitive on method', () => {
    expect(deriveStatefulOperation('post', false)).toBe('insert');
    expect(deriveStatefulOperation('delete', true)).toBe('delete');
  });

  it('returns null for non-CRUD methods', () => {
    expect(deriveStatefulOperation('OPTIONS', false)).toBeNull();
    expect(deriveStatefulOperation('TRACE', true)).toBeNull();
  });
});

describe('StatefulStore', () => {
  describe('seeding', () => {
    it('seeds from an array', () => {
      const store = new StatefulStore();
      store.ensureCollection('users', [{ id: 1, name: 'Ann' }, { id: 2, name: 'Bob' }]);
      expect(store.list('users')).toHaveLength(2);
    });

    it('seeds from a single object as one item', () => {
      const store = new StatefulStore();
      store.ensureCollection('users', { id: 1, name: 'Ann' });
      expect(store.list('users')).toEqual([{ id: 1, name: 'Ann' }]);
    });

    it('starts empty for non-object seeds', () => {
      const store = new StatefulStore();
      store.ensureCollection('users', 'not-an-object');
      expect(store.list('users')).toEqual([]);
    });

    it('ignores non-object entries inside an array seed', () => {
      const store = new StatefulStore();
      store.ensureCollection('users', [{ id: 1 }, 'junk', 42, null]);
      expect(store.list('users')).toEqual([{ id: 1 }]);
    });

    it('only seeds on first access', () => {
      const store = new StatefulStore();
      store.ensureCollection('users', [{ id: 1 }]);
      store.ensureCollection('users', [{ id: 99 }, { id: 100 }]);
      expect(store.list('users')).toEqual([{ id: 1 }]);
    });

    it('copies seed items so mutations do not leak back', () => {
      const seed = [{ id: 1, name: 'Ann' }];
      const store = new StatefulStore();
      store.ensureCollection('users', seed);
      store.update('users', 'id', '1', { name: 'Changed' });
      expect(seed[0].name).toBe('Ann');
    });
  });

  describe('list', () => {
    const seeded = () => {
      const store = new StatefulStore();
      store.ensureCollection('u', [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
      return store;
    };

    it('returns all items', () => {
      expect(seeded().list('u')).toHaveLength(4);
    });

    it('applies offset then limit', () => {
      expect(seeded().list('u', { offset: 1, limit: 2 })).toEqual([{ id: 2 }, { id: 3 }]);
    });

    it('handles limit 0 and out-of-range offset', () => {
      expect(seeded().list('u', { limit: 0 })).toEqual([]);
      expect(seeded().list('u', { offset: 10 })).toEqual([]);
    });

    it('returns empty array for an unknown collection', () => {
      expect(new StatefulStore().list('nope')).toEqual([]);
    });
  });

  describe('get', () => {
    it('finds items with numeric ids via string params', () => {
      const store = new StatefulStore();
      store.ensureCollection('u', [{ id: 7, name: 'Ann' }]);
      expect(store.get('u', 'id', '7')).toEqual({ id: 7, name: 'Ann' });
    });

    it('returns null when missing', () => {
      const store = new StatefulStore();
      store.ensureCollection('u', [{ id: 7 }]);
      expect(store.get('u', 'id', '8')).toBeNull();
    });

    it('supports a custom id key', () => {
      const store = new StatefulStore();
      store.ensureCollection('u', [{ userId: 'a1', name: 'Ann' }]);
      expect(store.get('u', 'userId', 'a1')).toEqual({ userId: 'a1', name: 'Ann' });
    });

    it('falls back to the "id" field when items do not carry the custom id key', () => {
      // Generated seeds key items by "id" even when idParam is e.g. "productId"
      const store = new StatefulStore();
      store.ensureCollection('p', [{ id: 1, title: 'Desk' }, { id: 2, title: 'Lamp' }]);
      expect(store.get('p', 'productId', '2')).toEqual({ id: 2, title: 'Lamp' });
      expect(store.get('p', 'productId', '3')).toBeNull();
    });
  });

  describe('insert', () => {
    it('generates a uuid when the id is absent', () => {
      const store = new StatefulStore();
      const item = store.insert('u', 'id', { name: 'Ann' });
      expect(item.id).toMatch(UUID_RE);
      expect(store.list('u')).toEqual([item]);
    });

    it('keeps a provided id', () => {
      const store = new StatefulStore();
      const item = store.insert('u', 'id', { id: 'custom', name: 'Ann' });
      expect(item.id).toBe('custom');
    });

    it('treats a non-object body as an empty item with generated id', () => {
      const store = new StatefulStore();
      const item = store.insert('u', 'id', 'garbage');
      expect(Object.keys(item)).toEqual(['id']);
      expect(item.id).toMatch(UUID_RE);
    });

    it('does not mutate the request body object', () => {
      const store = new StatefulStore();
      const body = { name: 'Ann' } as Record<string, unknown>;
      store.insert('u', 'id', body);
      expect(body.id).toBeUndefined();
    });

    it('keeps a provided "id" field instead of stamping a custom id key', () => {
      const store = new StatefulStore();
      const item = store.insert('p', 'productId', { id: 7, title: 'Desk' });
      expect(item).toEqual({ id: 7, title: 'Desk' });
      expect(store.get('p', 'productId', '7')).toEqual({ id: 7, title: 'Desk' });
    });
  });

  describe('update (PATCH merge)', () => {
    it('merges fields and preserves the id', () => {
      const store = new StatefulStore();
      store.ensureCollection('u', [{ id: 1, name: 'Ann', age: 30 }]);
      const updated = store.update('u', 'id', '1', { name: 'Anne', id: 999 });
      expect(updated).toEqual({ id: 1, name: 'Anne', age: 30 });
      expect(store.get('u', 'id', '1')).toEqual({ id: 1, name: 'Anne', age: 30 });
    });

    it('returns null for a missing id', () => {
      const store = new StatefulStore();
      store.ensureCollection('u', [{ id: 1 }]);
      expect(store.update('u', 'id', '2', { name: 'x' })).toBeNull();
    });
  });

  describe('replace (PUT)', () => {
    it('replaces non-id fields and preserves the id', () => {
      const store = new StatefulStore();
      store.ensureCollection('u', [{ id: 1, name: 'Ann', age: 30 }]);
      const replaced = store.replace('u', 'id', '1', { name: 'Anne', id: 999 });
      expect(replaced).toEqual({ id: 1, name: 'Anne' });
      expect(store.get('u', 'id', '1')).toEqual({ id: 1, name: 'Anne' });
    });

    it('returns null for a missing id', () => {
      const store = new StatefulStore();
      store.ensureCollection('u', []);
      expect(store.replace('u', 'id', '1', { name: 'x' })).toBeNull();
    });
  });

  describe('delete', () => {
    it('removes the item and returns true', () => {
      const store = new StatefulStore();
      store.ensureCollection('u', [{ id: 1 }, { id: 2 }]);
      expect(store.delete('u', 'id', '1')).toBe(true);
      expect(store.list('u')).toEqual([{ id: 2 }]);
    });

    it('returns false when missing', () => {
      const store = new StatefulStore();
      store.ensureCollection('u', [{ id: 1 }]);
      expect(store.delete('u', 'id', '5')).toBe(false);
      expect(store.list('u')).toHaveLength(1);
    });
  });

  describe('clear', () => {
    it('clears a single collection so it re-seeds on next access', () => {
      const store = new StatefulStore();
      store.ensureCollection('a', [{ id: 1 }]);
      store.ensureCollection('b', [{ id: 2 }]);
      store.clear('a');
      expect(store.hasCollection('a')).toBe(false);
      expect(store.hasCollection('b')).toBe(true);
      store.ensureCollection('a', [{ id: 9 }]);
      expect(store.list('a')).toEqual([{ id: 9 }]);
    });

    it('clears everything without an argument', () => {
      const store = new StatefulStore();
      store.ensureCollection('a', [{ id: 1 }]);
      store.clear();
      expect(store.hasCollection('a')).toBe(false);
    });
  });
});

describe('executeStateful', () => {
  const config: StatefulConfig = { collection: 'users' };

  const req = (
    method: string,
    params: Record<string, string> = {},
    body?: unknown,
    query: StatefulRequest['query'] = {}
  ): StatefulRequest => ({ method, params, query, body });

  it('POST then GET reflects the inserted item', () => {
    const store = new StatefulStore();
    const cfg: StatefulConfig = { collection: 'users', seed: [] };

    const created = executeStateful(store, cfg, req('POST', {}, { name: 'Ann' }));
    expect(created?.statusCode).toBe(201);
    const id = String((created?.body as Record<string, unknown>).id);

    const list = executeStateful(store, cfg, req('GET'));
    expect(list?.statusCode).toBe(200);
    expect(list?.body).toHaveLength(1);

    const one = executeStateful(store, cfg, req('GET', { id }));
    expect(one?.statusCode).toBe(200);
    expect((one?.body as Record<string, unknown>).name).toBe('Ann');
  });

  it('seeds from explicit config.seed', () => {
    const store = new StatefulStore();
    const cfg: StatefulConfig = { collection: 'users', seed: [{ id: 1 }, { id: 2 }] };
    const result = executeStateful(store, cfg, req('GET'));
    expect(result?.body).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('seeds from the fallback static body when no seed configured (array body)', () => {
    const store = new StatefulStore();
    const result = executeStateful(store, config, req('GET'), [{ id: 1 }, { id: 2 }]);
    expect(result?.body).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('seeds a single-item list from an object fallback body', () => {
    const store = new StatefulStore();
    const result = executeStateful(store, config, req('GET'), { id: 1, name: 'Ann' });
    expect(result?.body).toEqual([{ id: 1, name: 'Ann' }]);
  });

  it('prefers config.seed over the fallback body', () => {
    const store = new StatefulStore();
    const cfg: StatefulConfig = { collection: 'users', seed: [{ id: 'seeded' }] };
    const result = executeStateful(store, cfg, req('GET'), [{ id: 'fallback' }]);
    expect(result?.body).toEqual([{ id: 'seeded' }]);
  });

  it('supports ?limit= and ?offset= on list', () => {
    const store = new StatefulStore();
    const cfg: StatefulConfig = {
      collection: 'users',
      seed: [{ id: 1 }, { id: 2 }, { id: 3 }],
    };
    const result = executeStateful(
      store,
      cfg,
      req('GET', {}, undefined, { limit: '1', offset: '1' })
    );
    expect(result?.body).toEqual([{ id: 2 }]);
  });

  it('ignores non-numeric limit/offset', () => {
    const store = new StatefulStore();
    const cfg: StatefulConfig = { collection: 'users', seed: [{ id: 1 }, { id: 2 }] };
    const result = executeStateful(
      store,
      cfg,
      req('GET', {}, undefined, { limit: 'abc', offset: undefined })
    );
    expect(result?.body).toHaveLength(2);
  });

  it('returns 404 for GET/PATCH/PUT/DELETE on missing ids', () => {
    const store = new StatefulStore();
    const cfg: StatefulConfig = { collection: 'users', seed: [] };
    expect(executeStateful(store, cfg, req('GET', { id: 'x' }))?.statusCode).toBe(404);
    expect(executeStateful(store, cfg, req('PATCH', { id: 'x' }, {}))?.statusCode).toBe(404);
    expect(executeStateful(store, cfg, req('PUT', { id: 'x' }, {}))?.statusCode).toBe(404);
    expect(executeStateful(store, cfg, req('DELETE', { id: 'x' }))?.statusCode).toBe(404);
  });

  it('PATCH merges, PUT replaces, DELETE returns 204 with null body', () => {
    const store = new StatefulStore();
    const cfg: StatefulConfig = { collection: 'users', seed: [{ id: 1, name: 'Ann', age: 30 }] };

    const patched = executeStateful(store, cfg, req('PATCH', { id: '1' }, { name: 'Anne' }));
    expect(patched).toEqual({ statusCode: 200, body: { id: 1, name: 'Anne', age: 30 } });

    const put = executeStateful(store, cfg, req('PUT', { id: '1' }, { name: 'Final' }));
    expect(put).toEqual({ statusCode: 200, body: { id: 1, name: 'Final' } });

    const deleted = executeStateful(store, cfg, req('DELETE', { id: '1' }));
    expect(deleted).toEqual({ statusCode: 204, body: null });
    expect(executeStateful(store, cfg, req('GET'))?.body).toEqual([]);
  });

  it('serves the full CRUD lifecycle when idParam names the URL param but items are keyed by "id"', () => {
    // The prompt convention: idParam = the path's :param name ("productId"),
    // seed items carry the "id" field.
    const store = new StatefulStore();
    const cfg: StatefulConfig = {
      collection: 'products',
      idParam: 'productId',
      seed: [{ id: 1, title: 'Desk' }, { id: 2, title: 'Lamp' }],
    };

    expect(executeStateful(store, cfg, req('GET', { productId: '1' }))).toEqual({
      statusCode: 200,
      body: { id: 1, title: 'Desk' },
    });
    expect(
      executeStateful(store, cfg, req('PATCH', { productId: '2' }, { title: 'Floor Lamp' }))
    ).toEqual({ statusCode: 200, body: { id: 2, title: 'Floor Lamp' } });
    expect(
      executeStateful(store, cfg, req('PUT', { productId: '2' }, { title: 'Lamp v2', id: 999 }))
    ).toEqual({ statusCode: 200, body: { id: 2, title: 'Lamp v2' } });
    expect(executeStateful(store, cfg, req('DELETE', { productId: '1' }))?.statusCode).toBe(204);
    expect(executeStateful(store, cfg, req('GET'))?.body).toEqual([{ id: 2, title: 'Lamp v2' }]);
  });

  it('honors a custom idParam', () => {
    const store = new StatefulStore();
    const cfg: StatefulConfig = {
      collection: 'users',
      idParam: 'userId',
      seed: [{ userId: 'u1', name: 'Ann' }],
    };
    const result = executeStateful(store, cfg, req('GET', { userId: 'u1' }));
    expect(result?.statusCode).toBe(200);
    // an unrelated bound param named 'id' must not trigger get-by-id
    const list = executeStateful(store, cfg, req('GET', { id: 'ignored-param' }));
    expect(list?.statusCode).toBe(200);
    expect(Array.isArray(list?.body)).toBe(true);
  });

  it('returns null when no operation can be derived (falls back to normal response)', () => {
    const store = new StatefulStore();
    const cfg: StatefulConfig = { collection: 'users', seed: [] };
    expect(executeStateful(store, cfg, req('PUT'))).toBeNull();
    expect(executeStateful(store, cfg, req('OPTIONS'))).toBeNull();
    expect(executeStateful(store, cfg, req('POST', { id: '1' }, {}))).toBeNull();
  });
});
