import { describe, it, expect } from 'vitest';
import { OpenApiExportService } from '../src/services/OpenApiExportService';
import { MockServerConfig } from '../src/types/core';

const service = new OpenApiExportService();

function makeServer(overrides?: Partial<MockServerConfig>): MockServerConfig {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Users API',
    port: 3000,
    protocol: 'http',
    enabled: true,
    routes: [
      {
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
            content: [{ id: 1, name: 'Ada Lovelace', active: true, score: 4.5 }],
          },
        },
        tags: ['users'],
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        name: 'Get user',
        enabled: true,
        method: 'GET',
        path: '/api/users/:id',
        response: {
          type: 'static',
          statusCode: 200,
          body: { contentType: 'application/json', content: { id: 1, name: 'Ada Lovelace' } },
        },
      },
      {
        id: '44444444-4444-4444-8444-444444444444',
        name: 'Disabled route',
        enabled: false,
        method: 'DELETE',
        path: '/api/users/:id',
        response: { type: 'static', statusCode: 204 },
      },
    ],
    ...overrides,
  };
}

describe('OpenApiExportService', () => {
  it('produces a valid OpenAPI 3.0 skeleton', () => {
    const spec = service.exportToOpenApi(makeServer());
    expect(spec.openapi).toBe('3.0.3');
    expect(spec.info.title).toBe('Users API');
    expect(spec.servers[0].url).toBe('http://localhost:3000');
  });

  it('converts :param paths to {param} and adds path parameters', () => {
    const spec = service.exportToOpenApi(makeServer());
    const operation = spec.paths['/api/users/{id}'].get;
    expect(operation).toBeDefined();
    expect(operation.parameters).toEqual([
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
    ]);
  });

  it('excludes disabled routes by default and includes them on request', () => {
    expect(service.exportToOpenApi(makeServer()).paths['/api/users/{id}'].delete).toBeUndefined();
    expect(
      service.exportToOpenApi(makeServer(), { includeDisabled: true }).paths['/api/users/{id}'].delete
    ).toBeDefined();
  });

  it('infers response schemas from example bodies', () => {
    const spec = service.exportToOpenApi(makeServer());
    const content = spec.paths['/api/users'].get.responses['200'].content?.['application/json'];
    expect(content?.schema).toEqual({
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
          active: { type: 'boolean' },
          score: { type: 'number' },
        },
      },
    });
    expect(content?.example).toEqual([{ id: 1, name: 'Ada Lovelace', active: true, score: 4.5 }]);
  });

  it('collects tags from routes', () => {
    const spec = service.exportToOpenApi(makeServer());
    expect(spec.tags).toEqual([{ name: 'users' }]);
    expect(spec.paths['/api/users'].get.tags).toEqual(['users']);
  });

  it('supports multi-method routes', () => {
    const server = makeServer({
      routes: [
        {
          id: '55555555-5555-4555-8555-555555555555',
          name: 'Upsert',
          enabled: true,
          method: ['PUT', 'PATCH'],
          path: '/api/users/:id',
          response: { type: 'static', statusCode: 200 },
        },
      ],
    });
    const spec = service.exportToOpenApi(server);
    expect(spec.paths['/api/users/{id}'].put).toBeDefined();
    expect(spec.paths['/api/users/{id}'].patch).toBeDefined();
  });

  it('exports pretty JSON', () => {
    const json = service.exportToJson(makeServer());
    expect(() => JSON.parse(json)).not.toThrow();
    expect(json).toContain('\n  ');
  });
});
