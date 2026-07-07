import { describe, it, expect } from 'vitest';
import {
  parameterizePath,
  groupLogEntries,
  formatEndpointBlocks,
} from '../src/ai/TrafficMockGenerator';
import type { RequestLogEntry } from '../src/types/core';

let counter = 0;

function entry(overrides: {
  method?: string;
  path?: string;
  statusCode?: number;
  responseBody?: unknown;
  requestBody?: unknown;
  responseHeaders?: Record<string, string>;
  timestamp?: string;
}): RequestLogEntry {
  counter++;
  return {
    id: `entry-${counter}`,
    serverId: 'server-1',
    timestamp: new Date(overrides.timestamp ?? '2026-07-01T10:00:00Z'),
    request: {
      method: overrides.method ?? 'GET',
      path: overrides.path ?? '/api/users',
      url: `http://localhost:3000${overrides.path ?? '/api/users'}`,
      headers: {},
      query: {},
      body: overrides.requestBody,
    },
    response: {
      statusCode: overrides.statusCode ?? 200,
      headers: overrides.responseHeaders ?? { 'Content-Type': 'application/json' },
      body: overrides.responseBody,
      duration: 12,
    },
    matched: true,
  };
}

describe('parameterizePath', () => {
  it('parameterizes numeric segments with a name from the preceding segment', () => {
    expect(parameterizePath('/api/users/42')).toBe('/api/users/:userId');
  });

  it('parameterizes UUID segments', () => {
    expect(parameterizePath('/api/orders/3f2b8c9e-1a4d-4c6f-9b2a-8e7d6c5b4a3f')).toBe(
      '/api/orders/:orderId'
    );
  });

  it('parameterizes 20+ char opaque ids like Mongo ObjectIds', () => {
    expect(parameterizePath('/api/sessions/507f1f77bcf86cd799439011')).toBe(
      '/api/sessions/:sessionId'
    );
  });

  it('leaves long alphabetic words alone', () => {
    expect(parameterizePath('/api/internationalization')).toBe('/api/internationalization');
  });

  it('handles nested resources', () => {
    expect(parameterizePath('/api/users/42/orders/7')).toBe('/api/users/:userId/orders/:orderId');
  });

  it('singularizes plural resource names', () => {
    expect(parameterizePath('/companies/12')).toBe('/companies/:companyId');
    expect(parameterizePath('/statuses/5')).toBe('/statuses/:statusId');
  });

  it('falls back to :id when the id has no named preceding segment', () => {
    expect(parameterizePath('/42')).toBe('/:id');
    expect(parameterizePath('/files/123/456')).toBe('/files/:fileId/:id');
  });

  it('keeps param names unique within a path', () => {
    expect(parameterizePath('/users/1/users/2')).toBe('/users/:userId/users/:userId2');
  });

  it('strips query strings', () => {
    expect(parameterizePath('/api/users/42?verbose=true')).toBe('/api/users/:userId');
  });

  it('camelCases kebab-case resource names', () => {
    expect(parameterizePath('/user-profiles/9')).toBe('/user-profiles/:userProfileId');
  });

  it('leaves non-id paths untouched', () => {
    expect(parameterizePath('/api/users')).toBe('/api/users');
  });
});

describe('groupLogEntries', () => {
  it('groups entries by method and parameterized path', () => {
    const endpoints = groupLogEntries([
      entry({ path: '/api/users/1', responseBody: { id: 1 } }),
      entry({ path: '/api/users/2', responseBody: { id: 2 } }),
      entry({ method: 'DELETE', path: '/api/users/2', statusCode: 204 }),
    ]);

    expect(endpoints).toHaveLength(2);
    const get = endpoints.find((e) => e.method === 'GET')!;
    expect(get.path).toBe('/api/users/:userId');
    expect(get.hits).toBe(2);
    expect(get.samplePaths).toEqual(['/api/users/1', '/api/users/2']);
    const del = endpoints.find((e) => e.method === 'DELETE')!;
    expect(del.path).toBe('/api/users/:userId');
    expect(del.hits).toBe(1);
  });

  it('picks the latest 2xx response with a body regardless of input order', () => {
    const endpoints = groupLogEntries([
      entry({
        path: '/api/users/1',
        responseBody: { name: 'new' },
        timestamp: '2026-07-02T10:00:00Z',
      }),
      entry({
        path: '/api/users/1',
        responseBody: { name: 'old' },
        timestamp: '2026-07-01T10:00:00Z',
      }),
    ]);

    expect(endpoints[0].success?.responseBody).toEqual({ name: 'new' });
    expect(endpoints[0].success?.statusCode).toBe(200);
  });

  it('prefers a 2xx with a body over a newer bodiless 2xx', () => {
    const endpoints = groupLogEntries([
      entry({
        path: '/api/users/1',
        responseBody: { name: 'kept' },
        timestamp: '2026-07-01T10:00:00Z',
      }),
      entry({ path: '/api/users/1', statusCode: 200, timestamp: '2026-07-03T10:00:00Z' }),
    ]);

    expect(endpoints[0].success?.responseBody).toEqual({ name: 'kept' });
  });

  it('still reports a success for bodiless 2xx like 204', () => {
    const endpoints = groupLogEntries([
      entry({ method: 'DELETE', path: '/api/users/1', statusCode: 204 }),
    ]);

    expect(endpoints[0].success?.statusCode).toBe(204);
    expect(endpoints[0].success?.responseBody).toBeUndefined();
  });

  it('keeps the latest representative per distinct error status', () => {
    const endpoints = groupLogEntries([
      entry({ path: '/api/users/1', responseBody: { id: 1 } }),
      entry({
        path: '/api/users/9',
        statusCode: 404,
        responseBody: { error: 'old not found' },
        timestamp: '2026-07-01T10:00:00Z',
      }),
      entry({
        path: '/api/users/8',
        statusCode: 404,
        responseBody: { error: 'new not found' },
        timestamp: '2026-07-02T10:00:00Z',
      }),
      entry({
        path: '/api/users/1',
        statusCode: 500,
        responseBody: { error: 'boom' },
      }),
    ]);

    expect(endpoints).toHaveLength(1);
    expect(endpoints[0].errors.map((e) => e.statusCode)).toEqual([404, 500]);
    expect(endpoints[0].errors[0].responseBody).toEqual({ error: 'new not found' });
  });

  it('reports no success when only errors were captured', () => {
    const endpoints = groupLogEntries([
      entry({ path: '/api/login', method: 'POST', statusCode: 401, responseBody: { error: 'nope' } }),
    ]);

    expect(endpoints[0].success).toBeUndefined();
    expect(endpoints[0].errors).toHaveLength(1);
  });

  it('captures the request body on the representative success', () => {
    const endpoints = groupLogEntries([
      entry({
        method: 'POST',
        path: '/api/users',
        statusCode: 201,
        requestBody: { name: 'Ada' },
        responseBody: { id: 5, name: 'Ada' },
      }),
    ]);

    expect(endpoints[0].success?.requestBody).toEqual({ name: 'Ada' });
  });

  it('filters out OPTIONS preflight and unknown methods', () => {
    const endpoints = groupLogEntries([
      entry({ method: 'OPTIONS', path: '/api/users', statusCode: 204 }),
      entry({ method: 'PROPFIND', path: '/api/users', statusCode: 207 }),
    ]);

    expect(endpoints).toEqual([]);
  });

  it('returns an empty array for no entries', () => {
    expect(groupLogEntries([])).toEqual([]);
  });
});

describe('formatEndpointBlocks', () => {
  it('renders endpoint headers with captured bodies', () => {
    const [chunk] = formatEndpointBlocks(
      groupLogEntries([
        entry({ path: '/api/users/1', responseBody: { id: 1, name: 'Ada' } }),
        entry({ path: '/api/users/9', statusCode: 404, responseBody: { error: 'not found' } }),
      ])
    );

    expect(chunk).toContain('### GET /api/users/:userId');
    expect(chunk).toContain('"name": "Ada"');
    expect(chunk).toContain('Captured error response (status 404)');
  });

  it('splits endpoints across chunks when the size cap is exceeded', () => {
    const endpoints = groupLogEntries([
      entry({ path: '/api/aardvarks/1', responseBody: { data: 'x'.repeat(300) } }),
      entry({ path: '/api/zebras/1', responseBody: { data: 'y'.repeat(300) } }),
    ]);

    const chunks = formatEndpointBlocks(endpoints, 400);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toContain('/api/aardvarks/:aardvarkId');
    expect(chunks[1]).toContain('/api/zebras/:zebraId');
  });
});
