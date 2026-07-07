import { describe, it, expect } from 'vitest';
import { stringify as stringifyYaml } from 'yaml';
import { OpenApiImportService } from '../src/services/OpenApiImportService';
import { SpecEnricher, formatImportBlocks } from '../src/ai/SpecEnricher';
import { AiUnavailableError } from '../src/ai/providers/types';
import type { AiService } from '../src/ai/AiService';
import type { RouteConfig } from '../src/types/core';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const petstore = {
  openapi: '3.0.3',
  info: { title: 'Petstore API', version: '1.0.0' },
  paths: {
    '/pets': {
      get: {
        summary: 'List pets',
        tags: ['pets'],
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/Pet' } },
              },
            },
          },
        },
      },
      post: {
        summary: 'Create pet',
        responses: {
          '201': {
            description: 'Created',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Pet' } },
            },
          },
          '400': {
            description: 'Bad request',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
        },
      },
    },
    '/pets/{petId}': {
      get: {
        summary: 'Get pet',
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Pet' } },
            },
          },
          '404': {
            description: 'Not found',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Pet: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          ownerEmail: { type: 'string', format: 'email' },
          status: { type: 'string', enum: ['available', 'pending', 'sold'] },
          createdAt: { type: 'string', format: 'date-time' },
          age: { type: 'integer', minimum: 1, maximum: 20 },
        },
      },
      Error: {
        type: 'object',
        properties: { code: { type: 'integer' }, message: { type: 'string' } },
      },
    },
  },
};

function findRoute(
  routes: Omit<RouteConfig, 'id'>[],
  method: string,
  path: string,
  statusCode?: number
): Omit<RouteConfig, 'id'> | undefined {
  return routes.find(
    (r) =>
      r.method === method &&
      r.path === path &&
      (statusCode === undefined || r.response.statusCode === statusCode)
  );
}

function fakeAi(handler: (prompt: string) => unknown): AiService {
  return {
    getActiveProviderLabel: async () => 'Fake AI',
    sendJsonRequest: async (prompt: string) => handler(prompt),
  } as unknown as AiService;
}

describe('OpenApiImportService.parseSpec', () => {
  it('parses a JSON OpenAPI 3.0 spec', () => {
    const parsed = new OpenApiImportService().parseSpec(JSON.stringify(petstore));
    expect(parsed.version).toBe('openapi3');
    expect(parsed.warnings).toEqual([]);
  });

  it('parses a YAML OpenAPI spec to the same routes as JSON', () => {
    const service = new OpenApiImportService();
    const fromYaml = service.importSpec(stringifyYaml(petstore));
    const fromJson = service.importSpec(JSON.stringify(petstore));
    expect(fromYaml.name).toBe('Petstore API');
    expect(fromYaml.routes).toEqual(fromJson.routes);
  });

  it('throws a friendly error for unparseable text', () => {
    expect(() => new OpenApiImportService().parseSpec('{ not: [valid')).toThrow(
      /could not be parsed/i
    );
  });

  it('resolves local $refs into inline schemas', () => {
    const parsed = new OpenApiImportService().parseSpec(JSON.stringify(petstore));
    const paths = parsed.document.paths as Record<string, Record<string, unknown>>;
    const get = paths['/pets/{petId}'].get as {
      responses: Record<string, { content: Record<string, { schema: { properties: unknown } }> }>;
    };
    const schema = get.responses['200'].content['application/json'].schema;
    expect(schema.properties).toHaveProperty('name');
  });

  it('truncates cyclic $refs with a placeholder and a warning instead of throwing', () => {
    const cyclic = {
      openapi: '3.0.0',
      info: { title: 'Tree API', version: '1.0.0' },
      paths: {
        '/nodes': {
          get: {
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': { schema: { $ref: '#/components/schemas/Node' } },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Node: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              children: { type: 'array', items: { $ref: '#/components/schemas/Node' } },
            },
          },
        },
      },
    };
    const service = new OpenApiImportService();
    const result = service.importSpec(JSON.stringify(cyclic));
    expect(result.warnings.some((w) => w.includes('Cyclic $ref'))).toBe(true);
    const route = findRoute(result.routes, 'GET', '/nodes');
    expect(route).toBeDefined();
    const body = route!.response.body!.content as { name: string; children: unknown[] };
    expect(typeof body.name).toBe('string');
    expect(body.children).toHaveLength(2);
  });

  it('skips remote $refs with a warning instead of throwing', () => {
    const remote = {
      openapi: '3.0.0',
      info: { title: 'Remote API', version: '1.0.0' },
      paths: {
        '/things': {
          get: {
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': { schema: { $ref: 'https://example.com/schemas.json#/Thing' } },
                },
              },
            },
          },
        },
      },
    };
    const result = new OpenApiImportService().importSpec(JSON.stringify(remote));
    expect(result.warnings.some((w) => w.includes('non-local $ref'))).toBe(true);
    expect(findRoute(result.routes, 'GET', '/things')).toBeDefined();
  });
});

describe('OpenApiImportService.toRoutes', () => {
  const service = new OpenApiImportService();
  const result = service.importSpec(JSON.stringify(petstore));

  it('takes the server name from info.title', () => {
    expect(result.name).toBe('Petstore API');
  });

  it('converts {param} paths to Express :param form', () => {
    expect(findRoute(result.routes, 'GET', '/pets/:petId', 200)).toBeDefined();
    expect(result.routes.every((r) => !r.path.includes('{'))).toBe(true);
  });

  it('generates schema-honoring bodies: uuid/email formats, enums, 2-item arrays', () => {
    const list = findRoute(result.routes, 'GET', '/pets', 200)!;
    const items = list.response.body!.content as Array<Record<string, unknown>>;
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item.id).toMatch(UUID_RE);
      expect(item.ownerEmail).toMatch(/@/);
      expect(item.status).toBe('available'); // first enum value, deterministic
      expect(typeof item.createdAt).toBe('string');
      expect(item.age).toBeGreaterThanOrEqual(1);
      expect(item.age).toBeLessThanOrEqual(20);
    }
    expect(list.response.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(list.enabled).toBe(true);
    expect(list.tags).toEqual(['pets']);
  });

  it('is deterministic: the same spec text always yields the same routes', () => {
    const again = new OpenApiImportService().importSpec(JSON.stringify(petstore));
    expect(again.routes).toEqual(result.routes);
  });

  it('prefers a declared example over schema generation', () => {
    const withExample = JSON.parse(JSON.stringify(petstore));
    withExample.paths['/pets'].get.responses['200'].content['application/json'].example = [
      { id: 'fixed', name: 'Rex' },
    ];
    const imported = new OpenApiImportService().importSpec(JSON.stringify(withExample));
    const list = findRoute(imported.routes, 'GET', '/pets', 200)!;
    expect(list.response.body!.content).toEqual([{ id: 'fixed', name: 'Rex' }]);
  });

  it('emits disabled negative routes for documented 4xx responses', () => {
    const notFound = findRoute(result.routes, 'GET', '/pets/:petId', 404)!;
    expect(notFound.enabled).toBe(false);
    expect(notFound.tags).toEqual(['negative', '404']);
    expect(notFound.name).toContain('404');
    const body = notFound.response.body!.content as Record<string, unknown>;
    expect(typeof body.message).toBe('string');

    const badRequest = findRoute(result.routes, 'POST', '/pets', 400)!;
    expect(badRequest.enabled).toBe(false);
    expect(badRequest.tags).toEqual(['negative', '400']);
  });

  it('picks the 2xx response for the enabled route (201 for create)', () => {
    const create = findRoute(result.routes, 'POST', '/pets', 201)!;
    expect(create.enabled).toBe(true);
    const body = create.response.body!.content as Record<string, unknown>;
    expect(body.id).toMatch(UUID_RE);
  });

  it('skips operations whose success response is not application/json', () => {
    const nonJson = {
      openapi: '3.0.0',
      info: { title: 'Files API', version: '1.0.0' },
      paths: {
        '/report': {
          get: {
            responses: {
              '200': {
                description: 'OK',
                content: { 'text/html': { schema: { type: 'string' } } },
              },
            },
          },
        },
      },
    };
    const imported = new OpenApiImportService().importSpec(JSON.stringify(nonJson));
    expect(imported.routes).toHaveLength(0);
    expect(imported.warnings.some((w) => w.includes('non-JSON'))).toBe(true);
  });

  it('supports Swagger 2.0 specs with definitions and response-level schemas', () => {
    const swagger = {
      swagger: '2.0',
      info: { title: 'Legacy Users API', version: '1.0.0' },
      produces: ['application/json'],
      paths: {
        '/users/{id}': {
          get: {
            summary: 'Get user',
            responses: {
              '200': { description: 'OK', schema: { $ref: '#/definitions/User' } },
              '404': { description: 'Not found', schema: { $ref: '#/definitions/Error' } },
            },
          },
        },
      },
      definitions: {
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            email: { type: 'string', format: 'email' },
          },
        },
        Error: { type: 'object', properties: { message: { type: 'string' } } },
      },
    };
    const imported = new OpenApiImportService().importSpec(JSON.stringify(swagger));
    expect(imported.name).toBe('Legacy Users API');
    const user = findRoute(imported.routes, 'GET', '/users/:id', 200)!;
    const body = user.response.body!.content as Record<string, unknown>;
    expect(body.id).toMatch(UUID_RE);
    expect(body.email).toMatch(/@/);
    const notFound = findRoute(imported.routes, 'GET', '/users/:id', 404)!;
    expect(notFound.enabled).toBe(false);
    expect(notFound.tags).toEqual(['negative', '404']);
  });

  it('uses Swagger 2.0 response examples when declared', () => {
    const swagger = {
      swagger: '2.0',
      info: { title: 'Ping API', version: '1.0.0' },
      paths: {
        '/ping': {
          get: {
            responses: {
              '200': {
                description: 'OK',
                examples: { 'application/json': { pong: true } },
              },
            },
          },
        },
      },
    };
    const imported = new OpenApiImportService().importSpec(JSON.stringify(swagger));
    expect(findRoute(imported.routes, 'GET', '/ping', 200)!.response.body!.content).toEqual({
      pong: true,
    });
  });
});

describe('SpecEnricher', () => {
  const importResult = new OpenApiImportService().importSpec(JSON.stringify(petstore));

  it('groups an endpoint into a single prompt block with documented statuses', () => {
    const chunks = formatImportBlocks(importResult);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    const joined = chunks.join('\n');
    expect(joined).toContain('### GET /pets/:petId');
    expect(joined).toContain('Documented error statuses (keep, do not duplicate): 404');
  });

  it('applies AI enrichment, filters invented endpoints, and enforces the negative convention', async () => {
    const enrichedList = {
      name: 'List pets',
      enabled: true,
      method: 'GET',
      path: '/pets',
      response: {
        type: 'static',
        statusCode: 200,
        body: { contentType: 'application/json', content: [{ id: 'p-1', name: 'Rex' }] },
      },
      tags: ['pets'],
    };
    const inventedRoute = {
      name: 'Invented endpoint',
      enabled: true,
      method: 'GET',
      path: '/hacked',
      response: {
        type: 'static',
        statusCode: 200,
        body: { contentType: 'application/json', content: { ok: true } },
      },
    };
    const addedNegative = {
      name: 'GET /pets — 429 rate limited',
      enabled: true, // wrong on purpose; the post-filter must force it off
      method: 'GET',
      path: '/pets',
      response: {
        type: 'static',
        statusCode: 429,
        body: {
          contentType: 'application/json',
          content: { error: { code: 'RATE_LIMITED', message: 'Slow down' } },
        },
      },
    };
    const ai = fakeAi(() => ({ routes: [enrichedList, inventedRoute, addedNegative] }));

    const result = await new SpecEnricher().enrich(importResult, ai);
    expect(result.enriched).toBe(true);

    // Invented endpoint filtered out
    expect(result.routes.some((r) => r.path === '/hacked')).toBe(false);

    // Enriched route replaces the deterministic one
    const list = findRoute(result.routes, 'GET', '/pets', 200)!;
    expect(list.response.body!.content).toEqual([{ id: 'p-1', name: 'Rex' }]);

    // Added negative kept, forced disabled, and tagged per convention
    const rateLimited = findRoute(result.routes, 'GET', '/pets', 429)!;
    expect(rateLimited.enabled).toBe(false);
    expect(rateLimited.tags).toEqual(expect.arrayContaining(['negative', '429']));

    // Every imported (method, path, status) the AI dropped is restored
    expect(findRoute(result.routes, 'POST', '/pets', 201)).toBeDefined();
    expect(findRoute(result.routes, 'POST', '/pets', 400)).toBeDefined();
    expect(findRoute(result.routes, 'GET', '/pets/:petId', 200)).toBeDefined();
    expect(findRoute(result.routes, 'GET', '/pets/:petId', 404)).toBeDefined();
  });

  it('ignores param-name differences when matching AI routes to the import', async () => {
    const renamedParam = {
      name: 'Get pet',
      enabled: true,
      method: 'GET',
      path: '/pets/:id',
      response: {
        type: 'static',
        statusCode: 200,
        body: { contentType: 'application/json', content: { id: 'p-1', name: 'Rex' } },
      },
    };
    const ai = fakeAi(() => ({ routes: [renamedParam] }));
    const result = await new SpecEnricher().enrich(importResult, ai);
    expect(result.enriched).toBe(true);
    expect(findRoute(result.routes, 'GET', '/pets/:id', 200)).toBeDefined();
    // No duplicate deterministic route for the same endpoint+status
    expect(findRoute(result.routes, 'GET', '/pets/:petId', 200)).toBeUndefined();
  });

  it('returns the deterministic import untouched when the AI is unavailable', async () => {
    const ai = fakeAi(() => {
      throw new AiUnavailableError('No AI provider is available.');
    });
    const result = await new SpecEnricher().enrich(importResult, ai);
    expect(result.enriched).toBe(false);
    expect(result.routes).toEqual(importResult.routes);
    expect(result.name).toBe(importResult.name);
  });

  it('returns the deterministic import when the AI response is unusable', async () => {
    const ai = fakeAi(() => ({ routes: 'not-an-array' }));
    const result = await new SpecEnricher().enrich(importResult, ai);
    expect(result.enriched).toBe(false);
    expect(result.routes).toEqual(importResult.routes);
  });
});
