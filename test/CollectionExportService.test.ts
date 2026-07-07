import { describe, it, expect } from 'vitest';
import { parse as yamlParse } from 'yaml';
import {
  buildPostmanCollection,
  buildHttpFile,
  buildOpenApiYaml,
  PostmanFolder,
  PostmanItem,
} from '../src/services/CollectionExportService';
import { OpenApiExportService } from '../src/services/OpenApiExportService';
import { MockServerConfig, RouteConfig } from '../src/types/core';

function makeRoute(overrides: Partial<RouteConfig>): RouteConfig {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'List users',
    enabled: true,
    method: 'GET',
    path: '/api/users',
    response: {
      type: 'static',
      statusCode: 200,
      body: {
        contentType: 'application/json',
        content: [{ id: 42, name: 'Ada Lovelace' }],
      },
    },
    ...overrides,
  };
}

function makeServer(overrides?: Partial<MockServerConfig>): MockServerConfig {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Users API',
    port: 3100,
    protocol: 'http',
    enabled: true,
    routes: [
      makeRoute({ tags: ['users'] }),
      makeRoute({
        id: '33333333-3333-4333-8333-333333333333',
        name: 'Get user',
        path: '/api/users/:id',
        response: {
          type: 'static',
          statusCode: 200,
          headers: { 'X-Mock': 'true' },
          body: { contentType: 'application/json', content: { id: 42, name: 'Ada Lovelace' } },
        },
        tags: ['users'],
      }),
      makeRoute({
        id: '44444444-4444-4444-8444-444444444444',
        name: 'User not found',
        enabled: false,
        path: '/api/users/:id',
        response: {
          type: 'static',
          statusCode: 404,
          body: { contentType: 'application/json', content: { error: 'not found' } },
        },
        tags: ['users', 'negative', '404'],
        priority: 10,
      }),
      makeRoute({
        id: '55555555-5555-4555-8555-555555555555',
        name: 'Create user',
        method: 'POST',
        path: '/api/users',
        matcher: {
          headers: { Authorization: 'Bearer {{token}}' },
          body: { type: 'exact', value: '{"name":"Ada"}' },
        },
        response: {
          type: 'static',
          statusCode: 201,
          body: { contentType: 'application/json', content: { id: 43 } },
        },
      }),
    ],
    ...overrides,
  };
}

function findFolder(collection: { item: unknown[] }, name: string): PostmanFolder | undefined {
  return collection.item.find(
    (entry) => (entry as PostmanFolder).name === name && Array.isArray((entry as PostmanFolder).item)
  ) as PostmanFolder | undefined;
}

describe('buildPostmanCollection', () => {
  it('emits the required v2.1 structural shape', () => {
    const collection = buildPostmanCollection(makeServer(), { version: '1.2.3' });

    expect(collection.info.name).toBe('Users API Mock API');
    expect(collection.info.schema).toBe(
      'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
    );
    expect(collection.info.description).toContain('Mocklify');
    expect(collection.info.description).toContain('1.2.3');
    expect(collection.info._postman_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );

    expect(collection.variable).toEqual([
      { key: 'baseUrl', value: 'http://localhost:3100', type: 'string' },
    ]);

    const users = findFolder(collection, 'users');
    expect(users).toBeDefined();
    const list = users!.item[0] as PostmanItem;
    expect(list.name).toBe('List users');
    expect(list.request.method).toBe('GET');
    expect(list.request.url).toMatchObject({
      raw: '{{baseUrl}}/api/users',
      host: ['{{baseUrl}}'],
      path: ['api', 'users'],
    });
    expect(Array.isArray(list.request.header)).toBe(true);
    expect(list.response).toHaveLength(1);
    expect(list.response[0]).toMatchObject({ code: 200, status: 'OK', name: '200 OK' });
    expect(JSON.parse(list.response[0].body)).toEqual([{ id: 42, name: 'Ada Lovelace' }]);
    expect(list.response[0].originalRequest.method).toBe('GET');
  });

  it('produces a deterministic _postman_id across calls', () => {
    const a = buildPostmanCollection(makeServer());
    const b = buildPostmanCollection(makeServer());
    expect(a.info._postman_id).toBe(b.info._postman_id);

    const other = buildPostmanCollection(
      makeServer({ id: '99999999-9999-4999-8999-999999999999' })
    );
    expect(other.info._postman_id).not.toBe(a.info._postman_id);
  });

  it('extracts :param segments as Postman path variables with example values', () => {
    const collection = buildPostmanCollection(makeServer());
    const users = findFolder(collection, 'users')!;
    const getUser = users.item.find((i) => (i as PostmanItem).name === 'Get user') as PostmanItem;

    expect(getUser.request.url.raw).toBe('{{baseUrl}}/api/users/:id');
    expect(getUser.request.url.path).toEqual(['api', 'users', ':id']);
    expect(getUser.request.url.variable).toEqual([{ key: 'id', value: '42' }]);
  });

  it('expands multi-method routes into one item per method', () => {
    const server = makeServer({
      routes: [
        makeRoute({ name: 'Upsert user', method: ['PUT', 'PATCH'], path: '/api/users/:id' }),
      ],
    });
    const collection = buildPostmanCollection(server);
    const names = collection.item.map((i) => (i as PostmanItem).name);
    expect(names).toEqual(['Upsert user (PUT)', 'Upsert user (PATCH)']);
    expect((collection.item[0] as PostmanItem).request.method).toBe('PUT');
    expect((collection.item[1] as PostmanItem).request.method).toBe('PATCH');
  });

  it('places disabled negative routes in a Failure scenarios folder inside their tag', () => {
    const collection = buildPostmanCollection(makeServer());
    const users = findFolder(collection, 'users')!;
    const failures = users.item.find(
      (i) => (i as PostmanFolder).name === 'Failure scenarios'
    ) as PostmanFolder;

    expect(failures).toBeDefined();
    expect(failures.item).toHaveLength(1);
    const notFound = failures.item[0] as PostmanItem;
    expect(notFound.name).toBe('User not found');
    expect(notFound.response[0].code).toBe(404);
    expect(notFound.response[0].status).toBe('Not Found');
  });

  it('places untagged negative routes in a root-level Failure scenarios folder', () => {
    const server = makeServer({
      routes: [
        makeRoute({
          name: 'Server error',
          enabled: false,
          response: { type: 'static', statusCode: 500 },
        }),
      ],
    });
    const collection = buildPostmanCollection(server);
    const failures = findFolder(collection, 'Failure scenarios')!;
    expect(failures.item).toHaveLength(1);
    expect((failures.item[0] as PostmanItem).name).toBe('Server error');
  });

  it('skips disabled routes that are not negative flows', () => {
    const server = makeServer({
      routes: [makeRoute({ name: 'Off', enabled: false, response: { type: 'static', statusCode: 200 } })],
    });
    expect(buildPostmanCollection(server).item).toEqual([]);
  });

  it('adds a raw body and Content-Type when the matcher implies one', () => {
    const collection = buildPostmanCollection(makeServer());
    const create = collection.item.find((i) => (i as PostmanItem).name === 'Create user') as PostmanItem;

    expect(create.request.body).toEqual({
      mode: 'raw',
      raw: '{"name":"Ada"}',
      options: { raw: { language: 'json' } },
    });
    expect(create.request.header).toContainEqual({ key: 'Authorization', value: 'Bearer {{token}}' });
    expect(create.request.header).toContainEqual({ key: 'Content-Type', value: 'application/json' });
  });

  it('describes non-exact body matchers instead of emitting them as raw bodies', () => {
    const server = makeServer({
      routes: [
        makeRoute({
          name: 'Create user',
          method: 'POST',
          matcher: { body: { type: 'jsonPath', jsonPath: '$.name', value: 'John' } },
        }),
      ],
    });
    const create = buildPostmanCollection(server).item[0] as PostmanItem;

    expect(create.request.body).toBeUndefined();
    expect(create.request.header).toEqual([]);
    expect(create.request.description).toBe('Body must match jsonPath $.name: John');
  });

  it('never emits nulls for schema-required fields', () => {
    const json = JSON.stringify(buildPostmanCollection(makeServer()));
    expect(json).not.toContain(':null');
    const collection = buildPostmanCollection(makeServer());
    const walk = (entries: unknown[]): void => {
      for (const entry of entries) {
        const folder = entry as PostmanFolder & PostmanItem;
        if (Array.isArray(folder.item)) {
          walk(folder.item);
        } else {
          expect(typeof folder.request.url).toBe('object');
          expect(Array.isArray(folder.request.header)).toBe(true);
          for (const saved of folder.response) {
            expect(typeof saved.body).toBe('string');
            expect(Array.isArray(saved.header)).toBe(true);
          }
        }
      }
    };
    walk(collection.item);
  });
});

describe('buildHttpFile', () => {
  it('builds a REST Client file with baseUrl, names, headers and bodies', () => {
    const text = buildHttpFile(makeServer());

    expect(text.startsWith('@baseUrl = http://localhost:3100\n')).toBe(true);
    expect(text).toContain('### List users\nGET {{baseUrl}}/api/users\n');
    expect(text).toContain(
      '### Create user\nPOST {{baseUrl}}/api/users\nAuthorization: Bearer {{token}}\nContent-Type: application/json\n\n{"name":"Ada"}'
    );
    expect(text.endsWith('\n')).toBe(true);
  });

  it('fills path params from the mock response body with fallback 1', () => {
    const text = buildHttpFile(makeServer());
    expect(text).toContain('### Get user\nGET {{baseUrl}}/api/users/42');

    const noExample = makeServer({
      routes: [
        makeRoute({
          name: 'Get order',
          path: '/api/orders/:orderId',
          response: { type: 'static', statusCode: 200 },
        }),
      ],
    });
    expect(buildHttpFile(noExample)).toContain('GET {{baseUrl}}/api/orders/1');
  });

  it('expands multi-method routes and marks failure scenarios', () => {
    const text = buildHttpFile(makeServer());
    expect(text).toContain('### User not found (failure scenario)');

    const multi = makeServer({
      routes: [makeRoute({ name: 'Upsert', method: ['PUT', 'PATCH'], path: '/api/users/:id' })],
    });
    const multiText = buildHttpFile(multi);
    expect(multiText).toContain('### Upsert (PUT)\nPUT {{baseUrl}}/api/users/42');
    expect(multiText).toContain('### Upsert (PATCH)\nPATCH {{baseUrl}}/api/users/42');
  });

  it('appends matcher query params to the request line', () => {
    const server = makeServer({
      routes: [
        makeRoute({
          name: 'Search',
          matcher: { queryParams: { q: 'ada', page: '2' } },
        }),
      ],
    });
    expect(buildHttpFile(server)).toContain('GET {{baseUrl}}/api/users?q=ada&page=2');
  });

  it('URL-encodes query param keys and values in the request line', () => {
    const server = makeServer({
      routes: [
        makeRoute({
          name: 'Search',
          matcher: { queryParams: { q: 'hello world', filter: 'a&b' } },
        }),
      ],
    });
    expect(buildHttpFile(server)).toContain(
      'GET {{baseUrl}}/api/users?q=hello%20world&filter=a%26b'
    );
  });

  it('emits non-exact body matchers as a comment instead of a raw body', () => {
    const server = makeServer({
      routes: [
        makeRoute({
          name: 'Create user',
          method: 'POST',
          matcher: { body: { type: 'regex', value: '^\\{.*\\}$' } },
        }),
      ],
    });
    const text = buildHttpFile(server);
    expect(text).toContain(
      '### Create user\n# Body must match regex: ^\\{.*\\}$\nPOST {{baseUrl}}/api/users'
    );
    expect(text).not.toContain('Content-Type: application/json\n\n^');
  });
});

describe('buildOpenApiYaml', () => {
  it('serializes the OpenAPI JSON to YAML with full fidelity', () => {
    const server = makeServer();
    const spec = new OpenApiExportService().exportToOpenApi(server);
    const yaml = buildOpenApiYaml(server, spec);

    expect(yaml).toContain('Users API');
    expect(yaml).not.toContain('*a'); // no anchors/aliases
    expect(yamlParse(yaml)).toEqual(JSON.parse(JSON.stringify(spec)));
  });

  it('preserves top-level key order', () => {
    const server = makeServer();
    const spec = new OpenApiExportService().exportToOpenApi(server);
    const yaml = buildOpenApiYaml(server, spec);
    const topKeys = yaml
      .split('\n')
      .filter((line) => /^[a-zA-Z]/.test(line))
      .map((line) => line.split(':')[0]);
    expect(topKeys).toEqual(Object.keys(spec));
  });
});
