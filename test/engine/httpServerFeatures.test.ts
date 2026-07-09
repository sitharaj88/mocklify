import { describe, it, expect, afterEach } from 'vitest';
import net from 'node:net';
import { HttpMockServer } from '../../src/servers/HttpMockServer.js';
import {
  MockServerConfig,
  RouteConfig,
  RequestValidator,
  RequestLogEntry,
} from '../../src/types/core.js';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

const staticRoute = (
  id: string,
  path: string,
  method: RouteConfig['method'] = 'GET',
  overrides: Partial<RouteConfig> = {}
): RouteConfig => ({
  id,
  name: id,
  enabled: true,
  method,
  path,
  response: {
    type: 'static',
    statusCode: 200,
    body: { contentType: 'application/json', content: { ok: true, id } },
  },
  ...overrides,
});

const baseConfig = (port: number, routes: RouteConfig[]): MockServerConfig => ({
  id: '00000000-0000-0000-0000-000000000000',
  name: 'test',
  port,
  protocol: 'http',
  enabled: true,
  routes,
});

let running: HttpMockServer | null = null;

async function boot(config: MockServerConfig, validator?: RequestValidator): Promise<HttpMockServer> {
  const server = new HttpMockServer(config, validator);
  await server.start();
  running = server;
  return server;
}

afterEach(async () => {
  if (running) {
    await running.stop();
    running = null;
  }
});

describe('HttpMockServer — per-route chaos precedence', () => {
  it('applies server chaos to routes without an override (unchanged behavior) and to 404s', async () => {
    const port = await freePort();
    const config: MockServerConfig = {
      ...baseConfig(port, [staticRoute('normal', '/normal')]),
      chaos: { enabled: true, failureRate: 1, failureStatus: 503 },
    };
    await boot(config);

    const matched = await fetch(`http://127.0.0.1:${port}/normal`);
    expect(matched.status).toBe(503); // server chaos still fires on a matched route

    const missing = await fetch(`http://127.0.0.1:${port}/does-not-exist`);
    expect(missing.status).toBe(503); // unmatched requests use server chaos
  });

  it('a route override REPLACES server chaos, and enabled:false EXEMPTS the route', async () => {
    const port = await freePort();
    const config: MockServerConfig = {
      ...baseConfig(port, [
        staticRoute('normal', '/normal'),
        staticRoute('exempt', '/exempt', 'GET', { chaos: { enabled: false } }),
        staticRoute('override', '/override', 'GET', {
          chaos: { enabled: true, failureRate: 1, failureStatus: 418 },
        }),
      ]),
      chaos: { enabled: true, failureRate: 1, failureStatus: 503 },
    };
    await boot(config);

    // No override → server chaos → 503
    expect((await fetch(`http://127.0.0.1:${port}/normal`)).status).toBe(503);
    // enabled:false override → exempt → normal 200
    const exempt = await fetch(`http://127.0.0.1:${port}/exempt`);
    expect(exempt.status).toBe(200);
    expect(await exempt.json()).toEqual({ ok: true, id: 'exempt' });
    // enabled override with its own status → 418 (route chaos wins over server 503)
    expect((await fetch(`http://127.0.0.1:${port}/override`)).status).toBe(418);
  });

  it('with no server chaos, a route override can inject failure for just that route', async () => {
    const port = await freePort();
    const config = baseConfig(port, [
      staticRoute('calm', '/calm'),
      staticRoute('stormy', '/stormy', 'GET', {
        chaos: { enabled: true, failureRate: 1, failureStatus: 500 },
      }),
    ]);
    await boot(config);

    expect((await fetch(`http://127.0.0.1:${port}/calm`)).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${port}/stormy`)).status).toBe(500);
  });

  it('behaves exactly as before when chaos is absent', async () => {
    const port = await freePort();
    await boot(baseConfig(port, [staticRoute('normal', '/normal')]));
    const res = await fetch(`http://127.0.0.1:${port}/normal`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: 'normal' });
  });
});

describe('HttpMockServer — contract validation hook', () => {
  const okValidator: RequestValidator = { validate: () => ({ ok: true }) };
  const failing: RequestValidator = {
    validate: () => ({ ok: false, violations: [{ field: 'name', message: 'required' }] }),
  };

  function collectLogs(server: HttpMockServer): RequestLogEntry[] {
    const entries: RequestLogEntry[] = [];
    server.onEvent((e) => {
      if (e.type === 'request:received') entries.push(e.entry);
    });
    return entries;
  }

  it('is never called when no validator is injected', async () => {
    const port = await freePort();
    // Even with a contract block, absence of injected validator = zero overhead.
    const config: MockServerConfig = {
      ...baseConfig(port, [staticRoute('users', '/users')]),
      contract: { specPath: 'spec.yaml', mode: 'enforce' },
    };
    const server = await boot(config); // no validator passed
    const res = await fetch(`http://127.0.0.1:${port}/users`);
    expect(res.status).toBe(200);
    // no validation field recorded
    expect(server.config.contract?.mode).toBe('enforce');
  });

  it('warn mode serves normally and attaches violations to the log entry', async () => {
    const port = await freePort();
    const config: MockServerConfig = {
      ...baseConfig(port, [staticRoute('users', '/users')]),
      contract: { specPath: 'spec.yaml', mode: 'warn' },
    };
    const server = await boot(config, failing);
    const logs = collectLogs(server);

    const res = await fetch(`http://127.0.0.1:${port}/users`);
    expect(res.status).toBe(200); // passthrough
    expect(await res.json()).toEqual({ ok: true, id: 'users' });

    const entry = logs.find((l) => l.matched);
    expect(entry?.validation).toEqual({
      mode: 'warn',
      ok: false,
      violations: [{ field: 'name', message: 'required' }],
    });
  });

  it('enforce mode short-circuits with a 400 listing violations', async () => {
    const port = await freePort();
    const config: MockServerConfig = {
      ...baseConfig(port, [staticRoute('users', '/users')]),
      contract: { specPath: 'spec.yaml', mode: 'enforce' },
    };
    const server = await boot(config, failing);
    const logs = collectLogs(server);

    const res = await fetch(`http://127.0.0.1:${port}/users`);
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({
      error: 'Contract violation',
      mode: 'enforce',
      violations: [{ field: 'name', message: 'required' }],
    });

    const entry = logs.find((l) => l.matched);
    expect(entry?.validation?.ok).toBe(false);
    expect(entry?.routeId).toBe('users');
  });

  it('a passing validator records ok:true and serves the route', async () => {
    const port = await freePort();
    const config: MockServerConfig = {
      ...baseConfig(port, [staticRoute('users', '/users')]),
      contract: { specPath: 'spec.yaml', mode: 'enforce' },
    };
    const server = await boot(config, okValidator);
    const logs = collectLogs(server);

    const res = await fetch(`http://127.0.0.1:${port}/users`);
    expect(res.status).toBe(200);
    const entry = logs.find((l) => l.matched);
    expect(entry?.validation).toEqual({ mode: 'enforce', ok: true, violations: [] });
  });
});
