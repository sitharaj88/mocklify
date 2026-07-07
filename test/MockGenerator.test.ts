import { describe, it, expect } from 'vitest';
import { MockGenerator, ROUTES_JSON_SCHEMA } from '../src/ai/MockGenerator';
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

  it('defaults enabled to true when the model omits it', () => {
    const { enabled: _omitted, ...withoutEnabled } = validRoute;
    const routes = MockGenerator.validateRoutes([withoutEnabled]);
    expect(routes[0].enabled).toBe(true);
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
