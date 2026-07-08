import { describe, it, expect } from 'vitest';
import {
  MockGenerator,
  ROUTES_JSON_SCHEMA,
  ROUTE_FORMAT_INSTRUCTIONS,
} from '../src/ai/MockGenerator';
import { HttpMethodSchema } from '../src/types/core';

const validRoute = {
  name: 'List products',
  enabled: true,
  method: 'GET',
  path: '/api/products',
  response: {
    type: 'static',
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: { contentType: 'application/json', content: [{ id: 1, title: 'Desk' }] },
  },
  tags: ['products'],
};

describe('MockGenerator.validateRoutes', () => {
  it('accepts an array of valid routes', () => {
    const routes = MockGenerator.validateRoutes([validRoute]);
    expect(routes).toHaveLength(1);
    expect(routes[0].path).toBe('/api/products');
  });

  it('accepts a single bare route object', () => {
    const routes = MockGenerator.validateRoutes(validRoute);
    expect(routes).toHaveLength(1);
  });

  it('unwraps a {"routes": [...]} object (structured outputs / json_object mode)', () => {
    const routes = MockGenerator.validateRoutes({ routes: [validRoute] });
    expect(routes).toHaveLength(1);
    expect(routes[0].path).toBe('/api/products');
  });

  it('unwraps a single-key object wrapping an array under another name', () => {
    const routes = MockGenerator.validateRoutes({ endpoints: [validRoute] });
    expect(routes).toHaveLength(1);
  });

  it('drops invalid entries but keeps valid ones', () => {
    const routes = MockGenerator.validateRoutes([
      validRoute,
      { name: 'broken', method: 'INVALID', path: '' },
    ]);
    expect(routes).toHaveLength(1);
  });

  it('throws when nothing valid was generated', () => {
    expect(() => MockGenerator.validateRoutes([{ nonsense: true }])).toThrow(
      /did not match the expected format/
    );
  });

  it('distinguishes a genuinely empty answer from invalid routes in the error message', () => {
    // The census-chunk flow relies on this contract: only a true empty array
    // reads as "no API usage found"; invalid routes stay real, retryable errors.
    expect(() => MockGenerator.validateRoutes([])).toThrow(/empty result/);
    expect(() => MockGenerator.validateRoutes({ routes: [] })).toThrow(/empty result/);
    let message = '';
    try {
      MockGenerator.validateRoutes([
        { ...validRoute, response: { ...validRoute.response, statusCode: '200' } },
      ]);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('did not match the expected format');
    expect(message).not.toContain('empty result');
  });

  it('defaults enabled to true when the model omits it', () => {
    const { enabled: _omitted, ...withoutEnabled } = validRoute;
    const routes = MockGenerator.validateRoutes([withoutEnabled]);
    expect(routes[0].enabled).toBe(true);
  });

  it('preserves the optional stateful field', () => {
    const routes = MockGenerator.validateRoutes([
      {
        ...validRoute,
        stateful: {
          collection: 'products',
          idParam: 'productId',
          seed: [{ id: 1, title: 'Desk' }, { id: 2, title: 'Lamp' }],
        },
      },
    ]);
    expect(routes[0].stateful).toEqual({
      collection: 'products',
      idParam: 'productId',
      seed: [{ id: 1, title: 'Desk' }, { id: 2, title: 'Lamp' }],
    });
  });

  it('accepts stateful with only a collection (idParam and seed optional)', () => {
    const routes = MockGenerator.validateRoutes([
      { ...validRoute, stateful: { collection: 'products' } },
    ]);
    expect(routes[0].stateful?.collection).toBe('products');
  });

  it('rejects stateful with an empty collection', () => {
    expect(() =>
      MockGenerator.validateRoutes([{ ...validRoute, stateful: { collection: '' } }])
    ).toThrow(/did not match the expected format/);
  });

  it('rejects stateful with a non-string idParam or non-array seed', () => {
    const routes = MockGenerator.validateRoutes([
      validRoute,
      { ...validRoute, stateful: { collection: 'products', idParam: 7 } },
      { ...validRoute, stateful: { collection: 'products', seed: { id: 1 } } },
    ]);
    expect(routes).toHaveLength(1);
    expect(routes[0].stateful).toBeUndefined();
  });
});

describe('MockGenerator.verifyRoutes', () => {
  const route = (overrides: Record<string, unknown> = {}) =>
    ({ ...validRoute, ...overrides }) as Parameters<typeof MockGenerator.verifyRoutes>[0][number];

  it('accepts a well-formed route', () => {
    const { accepted, rejected } = MockGenerator.verifyRoutes([route()]);
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  it('rejects paths that do not start with /', () => {
    const { rejected } = MockGenerator.verifyRoutes([route({ path: 'api/users' })]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reasons[0]).toMatch(/must start with "\/"/);
  });

  it('rejects {param} and <param> style path variables', () => {
    const { rejected } = MockGenerator.verifyRoutes([
      route({ path: '/api/users/{id}' }),
      route({ path: '/api/users/<id>' }),
    ]);
    expect(rejected).toHaveLength(2);
    expect(rejected[0].reasons[0]).toMatch(/:name form/);
  });

  it('accepts :param path variables but rejects malformed ones', () => {
    const ok = MockGenerator.verifyRoutes([route({ path: '/api/users/:userId/orders/:id' })]);
    expect(ok.accepted).toHaveLength(1);
    const bad = MockGenerator.verifyRoutes([route({ path: '/api/users/:123' })]);
    expect(bad.rejected[0].reasons[0]).toMatch(/invalid path parameter/);
  });

  it('rejects paths containing whitespace', () => {
    const { rejected } = MockGenerator.verifyRoutes([route({ path: '/api/user list' })]);
    expect(rejected[0].reasons.join(' ')).toMatch(/whitespace/);
  });

  it('rejects implausible status codes', () => {
    const { rejected } = MockGenerator.verifyRoutes([
      route({ response: { ...validRoute.response, statusCode: 199 } }),
    ]);
    expect(rejected[0].reasons[0]).toMatch(/implausible response status code/);
  });

  it('rejects a response body with missing content', () => {
    const { rejected } = MockGenerator.verifyRoutes([
      route({
        response: {
          ...validRoute.response,
          body: { contentType: 'application/json', content: undefined },
        },
      }),
    ]);
    expect(rejected[0].reasons[0]).toMatch(/no content/);
  });

  it('rejects non-JSON-serializable response bodies', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const { rejected } = MockGenerator.verifyRoutes([
      route({
        response: {
          ...validRoute.response,
          body: { contentType: 'application/json', content: circular },
        },
      }),
    ]);
    expect(rejected[0].reasons[0]).toMatch(/not JSON-serializable/);
  });

  it('rejects enabled negative routes', () => {
    const { rejected } = MockGenerator.verifyRoutes([
      route({ enabled: true, tags: ['negative', '404'] }),
    ]);
    expect(rejected[0].reasons[0]).toMatch(/"enabled": false/);
  });

  it('accepts disabled negative routes', () => {
    const { accepted } = MockGenerator.verifyRoutes([
      route({ enabled: false, tags: ['negative', '404'] }),
    ]);
    expect(accepted).toHaveLength(1);
  });

  it('accepts a coherent stateful CRUD family', () => {
    const { accepted, rejected } = MockGenerator.verifyRoutes([
      route({
        path: '/api/products',
        stateful: {
          collection: 'products',
          seed: [{ id: 1, title: 'Desk' }, { id: 2, title: 'Lamp' }, { id: 3, title: 'Chair' }],
        },
      }),
      route({ path: '/api/products/:id', stateful: { collection: 'products' } }),
      route({ method: 'DELETE', path: '/api/products/:id', stateful: { collection: 'products' } }),
    ]);
    expect(accepted).toHaveLength(3);
    expect(rejected).toHaveLength(0);
  });

  it('rejects a stateful route whose path parameter does not match idParam', () => {
    const { rejected } = MockGenerator.verifyRoutes([
      route({ path: '/api/products/:productId', stateful: { collection: 'products' } }),
    ]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reasons[0]).toMatch(/idParam "id" does not match the path parameter ":productId"/);
  });

  it('checks idParam against the last path parameter of nested paths', () => {
    const { accepted } = MockGenerator.verifyRoutes([
      route({
        path: '/api/users/:userId/orders/:orderId',
        stateful: { collection: 'orders', idParam: 'orderId' },
      }),
    ]);
    expect(accepted).toHaveLength(1);
  });

  it('accepts nested list/create routes whose parent param differs from idParam', () => {
    // The family convention gives EVERY route the same idParam; the list and
    // create routes end in a literal segment, so :userId must not be checked.
    const { accepted, rejected } = MockGenerator.verifyRoutes([
      route({
        path: '/api/users/:userId/orders',
        stateful: {
          collection: 'orders',
          idParam: 'orderId',
          seed: [{ id: 'o-1', total: 10 }, { id: 'o-2', total: 20 }],
        },
      }),
      route({
        method: 'POST',
        path: '/api/users/:userId/orders',
        stateful: { collection: 'orders', idParam: 'orderId' },
      }),
      route({
        path: '/api/users/:userId/orders/:orderId',
        stateful: { collection: 'orders', idParam: 'orderId' },
      }),
    ]);
    expect(rejected).toEqual([]);
    expect(accepted).toHaveLength(3);
  });

  it('accepts seeds keyed by "id" under a custom idParam, rejects seeds with no identifier', () => {
    const ok = MockGenerator.verifyRoutes([
      route({
        path: '/api/products',
        stateful: { collection: 'products', idParam: 'productId', seed: [{ id: 1, title: 'Desk' }] },
      }),
    ]);
    expect(ok.accepted).toHaveLength(1);

    const bad = MockGenerator.verifyRoutes([
      route({
        path: '/api/products',
        stateful: { collection: 'products', idParam: 'productId', seed: [{ title: 'No id here' }] },
      }),
    ]);
    expect(bad.rejected).toHaveLength(1);
    expect(bad.rejected[0].reasons[0]).toMatch(/seed items must carry their identifier/);
  });

  it('rejects stateful routes of one collection that disagree on idParam', () => {
    const { accepted, rejected } = MockGenerator.verifyRoutes([
      route({ path: '/api/products', stateful: { collection: 'products' } }),
      route({
        path: '/api/products/:productId',
        stateful: { collection: 'products', idParam: 'productId' },
      }),
    ]);
    expect(accepted).toHaveLength(0);
    expect(rejected).toHaveLength(2);
    expect(rejected[0].reasons.join(' ')).toMatch(/disagree on idParam/);
    expect(rejected[1].reasons.join(' ')).toMatch(/disagree on idParam/);
  });

  it('does not conflate idParams across different collections', () => {
    const { accepted } = MockGenerator.verifyRoutes([
      route({ path: '/api/products/:productId', stateful: { collection: 'products', idParam: 'productId' } }),
      route({ path: '/api/users/:userId', stateful: { collection: 'users', idParam: 'userId' } }),
    ]);
    expect(accepted).toHaveLength(2);
  });

  it('rejects stateful seed entries that are not objects', () => {
    const { rejected } = MockGenerator.verifyRoutes([
      route({ path: '/api/products', stateful: { collection: 'products', seed: [{ id: 1 }, 'Desk'] } }),
      route({ path: '/api/tags', stateful: { collection: 'tags', seed: [[1, 2]] } }),
      route({ path: '/api/labels', stateful: { collection: 'labels', seed: [null] } }),
    ]);
    expect(rejected).toHaveLength(3);
    for (const r of rejected) {
      expect(r.reasons[0]).toMatch(/seed items must be JSON objects/);
    }
  });

  it('collects every reason for a multiply-broken route', () => {
    const { rejected } = MockGenerator.verifyRoutes([
      route({
        path: 'users/{id}',
        enabled: true,
        tags: ['negative', '500'],
        response: { ...validRoute.response, statusCode: 999 },
      }),
    ]);
    expect(rejected[0].reasons.length).toBeGreaterThanOrEqual(3);
  });
});

describe('ROUTES_JSON_SCHEMA', () => {
  const routesProperty = (ROUTES_JSON_SCHEMA.properties as Record<string, Record<string, unknown>>)
    .routes;
  const items = routesProperty.items as Record<string, unknown>;

  it('stays consistent with what validateRoutes accepts', () => {
    expect(ROUTES_JSON_SCHEMA.type).toBe('object');
    expect(ROUTES_JSON_SCHEMA.required).toEqual(['routes']);
    expect(routesProperty.type).toBe('array');
    expect(items.required).toEqual(['name', 'method', 'path', 'response']);

    // A route satisfying only the schema-required fields must pass Zod
    const minimal = {
      name: 'Minimal',
      method: 'GET',
      path: '/api/ping',
      response: { type: 'static', statusCode: 200 },
    };
    expect(MockGenerator.validateRoutes({ routes: [minimal] })).toHaveLength(1);

    const method = (items.properties as Record<string, Record<string, unknown>>).method
      .anyOf as Array<Record<string, unknown>>;
    expect(method[0].enum).toEqual(HttpMethodSchema.options);
  });

  it('declares the optional stateful field consistently with validateRoutes', () => {
    const stateful = (items.properties as Record<string, Record<string, unknown>>).stateful;
    expect(stateful.type).toBe('object');
    expect(stateful.required).toEqual(['collection']);
    expect(stateful.additionalProperties).toBe(false);
    const props = stateful.properties as Record<string, Record<string, unknown>>;
    expect(props.collection.type).toBe('string');
    expect(props.idParam.type).toBe('string');
    expect(props.seed.type).toBe('array');

    // A schema-minimal stateful route must pass Zod validation
    const minimalStateful = {
      name: 'List pings',
      method: 'GET',
      path: '/api/pings',
      response: { type: 'static', statusCode: 200 },
      stateful: { collection: 'pings' },
    };
    const routes = MockGenerator.validateRoutes({ routes: [minimalStateful] });
    expect(routes[0].stateful?.collection).toBe('pings');
  });

  it('conforms to the strict structured-output dialect (Anthropic + OpenAI)', () => {
    const violations: string[] = [];
    const walk = (node: unknown, at: string): void => {
      if (Array.isArray(node)) {
        node.forEach((entry, i) => walk(entry, `${at}[${i}]`));
        return;
      }
      if (node === null || typeof node !== 'object') {
        return;
      }
      const record = node as Record<string, unknown>;
      for (const key of ['minLength', 'maxLength', 'minimum', 'maximum']) {
        if (key in record) {
          violations.push(`${at} uses unsupported constraint "${key}"`);
        }
      }
      if (record.type === 'object' && Object.keys(record.properties ?? {}).length > 0) {
        if (record.additionalProperties !== false) {
          violations.push(`${at} object is missing additionalProperties: false`);
        }
      }
      if ('additionalProperties' in record && record.additionalProperties !== false) {
        violations.push(`${at} sets additionalProperties to something other than false`);
      }
      for (const [key, child] of Object.entries(record)) {
        walk(child, `${at}.${key}`);
      }
    };
    walk(ROUTES_JSON_SCHEMA, '$');
    expect(violations).toEqual([]);
  });
});

describe('ROUTE_FORMAT_INSTRUCTIONS', () => {
  it('teaches the model the stateful CRUD-family convention', () => {
    expect(ROUTE_FORMAT_INSTRUCTIONS).toContain('"stateful"');
    expect(ROUTE_FORMAT_INSTRUCTIONS).toMatch(/same top-level stateful field to EVERY route/);
    expect(ROUTE_FORMAT_INSTRUCTIONS).toMatch(/ONLY on the GET list route/);
    expect(ROUTE_FORMAT_INSTRUCTIONS).toMatch(/NEVER have a stateful field/);
  });
});

describe('MockGenerator.withIds', () => {
  it('assigns unique uuids to generated routes', () => {
    const withIds = MockGenerator.withIds([
      MockGenerator.validateRoutes(validRoute)[0],
      MockGenerator.validateRoutes(validRoute)[0],
    ]);
    expect(withIds[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(withIds[0].id).not.toBe(withIds[1].id);
  });
});
