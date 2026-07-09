import { describe, it, expect } from 'vitest';
import { MockServerConfigSchema, MockServerConfig } from '../../src/types/core.js';

// A config exercising every new additive field: route-level chaos override,
// graphql-native route, and a server-level contract block. Because all three
// are `.optional()` additions, ConfigurationStore round-trips them for free via
// MockServerConfigSchema.parse on load/save — this asserts parse→serialize→parse
// is a fixed point.
const config: MockServerConfig = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'RoundTrip',
  port: 4100,
  protocol: 'http',
  enabled: true,
  contract: { specPath: 'openapi.yaml', mode: 'warn' },
  chaos: { enabled: true, failureRate: 0.1 },
  routes: [
    {
      id: '22222222-2222-2222-2222-222222222222',
      name: 'exempt route',
      enabled: true,
      method: 'GET',
      path: '/health',
      chaos: { enabled: false },
      response: { type: 'static', statusCode: 200 },
    },
    {
      id: '33333333-3333-3333-3333-333333333333',
      name: 'graphql route',
      enabled: true,
      method: 'POST',
      path: '/graphql',
      graphql: { operationName: 'GetUser', operationType: 'query' },
      response: { type: 'static', statusCode: 200 },
    },
  ],
};

describe('core types round-trip', () => {
  it('survives parse → serialize → parse unchanged', () => {
    const first = MockServerConfigSchema.parse(config);
    const serialized = JSON.stringify(first);
    const second = MockServerConfigSchema.parse(JSON.parse(serialized));
    expect(second).toEqual(first);
    // New fields specifically preserved.
    expect(second.contract).toEqual({ specPath: 'openapi.yaml', mode: 'warn' });
    expect(second.routes[0].chaos).toEqual({ enabled: false });
    expect(second.routes[1].graphql).toEqual({ operationName: 'GetUser', operationType: 'query' });
  });

  it('rejects an invalid contract mode', () => {
    const bad = { ...config, contract: { specPath: 'x', mode: 'strict' } };
    expect(() => MockServerConfigSchema.parse(bad)).toThrow();
  });
});
