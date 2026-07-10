import { describe, it, expect, vi, type Mock } from 'vitest';
import {
  createServerToolBelt,
  restoreUndoSnapshot,
  resolveServerRef,
  resolveRouteRef,
  clampLine,
  valuePreview,
  responseDisclosure,
  routeChangeSnapshot,
  computeRouteFieldDiffs,
  clampDisclosures,
  CHANGE_DISCLOSURES_MAX,
  routeItemJsonSchema,
  MUTATION_DENIED_MESSAGE,
  ADD_ROUTES_MAX,
  PROXY_TARGET_PREVIEW_CHARS,
  ROUTE_BODY_MAX_CHARS,
  CHANGE_BODY_PREVIEW_MAX_CHARS,
  LOGS_DEFAULT_LIMIT,
  LOGS_MAX_LIMIT,
  LOG_BODY_PREVIEW_CHARS,
  UPDATABLE_ROUTE_FIELDS,
  type ConfirmAction,
  type ServerToolsHost,
  type ServerToolBelt,
  type UndoSnapshot,
} from '../src/ai/agent/serverTools';
import { ROUTES_JSON_SCHEMA } from '../src/ai/MockGenerator';
import type {
  MockServerConfig,
  RouteConfig,
  RequestLogEntry,
  ServerRuntimeState,
} from '../src/types/core';

// ---------------------------------------------------------------------------
// Fake host
// ---------------------------------------------------------------------------

let idCounter = 0;
const nextId = (prefix: string): string => `${prefix}-${++idCounter}`;

class FakeHost implements ServerToolsHost {
  servers = new Map<string, MockServerConfig>();
  states = new Map<string, ServerRuntimeState>();
  logs: RequestLogEntry[] = [];
  /** Chronological record of every host method invoked. */
  calls: string[] = [];
  /** Method names that throw when invoked. */
  failOn = new Set<string>();
  /** Arguments of the most recent getLogEntries call. */
  lastLogQuery: { serverId?: string; limit?: number } | undefined;

  private touch(method: string): void {
    this.calls.push(method);
    if (this.failOn.has(method)) {
      throw new Error(`${method} exploded`);
    }
  }

  private mustGet(serverId: string): MockServerConfig {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error(`Server ${serverId} not found`);
    }
    return server;
  }

  async getServers(): Promise<MockServerConfig[]> {
    return [...this.servers.values()];
  }

  async getServer(serverId: string): Promise<MockServerConfig | undefined> {
    return this.servers.get(serverId);
  }

  getServerState(serverId: string): ServerRuntimeState | undefined {
    return this.states.get(serverId);
  }

  getLogEntries(serverId?: string, limit?: number): RequestLogEntry[] {
    this.lastLogQuery = {
      ...(serverId !== undefined ? { serverId } : {}),
      ...(limit !== undefined ? { limit } : {}),
    };
    // Mirrors the real RequestLogger semantics: entries are stored newest
    // FIRST (log() unshifts) and getEntries slices from the front. `logs` is
    // appended chronologically here, so reverse before slicing.
    const filtered = this.logs
      .filter((entry) => !serverId || entry.serverId === serverId)
      .reverse();
    return limit === undefined ? filtered : filtered.slice(0, limit);
  }

  async createServer(
    name: string,
    port?: number,
    protocol: 'http' | 'graphql' | 'websocket' = 'http'
  ): Promise<MockServerConfig> {
    this.touch('createServer');
    const server: MockServerConfig = {
      id: nextId('srv'),
      name,
      port: port ?? 3000,
      protocol,
      enabled: true,
      routes: [],
    };
    this.servers.set(server.id, server);
    this.states.set(server.id, {
      id: server.id,
      status: 'stopped',
      port: server.port,
      requestCount: 0,
    });
    return server;
  }

  async deleteServer(serverId: string): Promise<void> {
    this.touch('deleteServer');
    this.mustGet(serverId);
    this.servers.delete(serverId);
    this.states.delete(serverId);
  }

  async addRoute(serverId: string, route: Omit<RouteConfig, 'id'>): Promise<RouteConfig> {
    this.touch('addRoute');
    const created: RouteConfig = { ...route, id: nextId('route') };
    this.mustGet(serverId).routes.push(created);
    return created;
  }

  async addRoutes(serverId: string, routes: Omit<RouteConfig, 'id'>[]): Promise<RouteConfig[]> {
    this.touch('addRoutes');
    const server = this.mustGet(serverId);
    const created = routes.map((route) => ({ ...route, id: nextId('route') }));
    server.routes.push(...created);
    return created;
  }

  async updateRoute(
    serverId: string,
    routeId: string,
    updates: Partial<RouteConfig>
  ): Promise<void> {
    this.touch('updateRoute');
    const server = this.mustGet(serverId);
    const index = server.routes.findIndex((route) => route.id === routeId);
    if (index === -1) {
      throw new Error(`Route ${routeId} not found`);
    }
    server.routes[index] = { ...server.routes[index], ...updates, id: routeId };
  }

  async deleteRoute(serverId: string, routeId: string): Promise<void> {
    this.touch('deleteRoute');
    const server = this.mustGet(serverId);
    server.routes = server.routes.filter((route) => route.id !== routeId);
  }

  async startServer(serverId: string): Promise<void> {
    this.touch('startServer');
    const server = this.mustGet(serverId);
    this.states.set(serverId, {
      id: serverId,
      status: 'running',
      port: server.port,
      requestCount: 0,
    });
  }

  async stopServer(serverId: string): Promise<void> {
    this.touch('stopServer');
    const server = this.mustGet(serverId);
    this.states.set(serverId, {
      id: serverId,
      status: 'stopped',
      port: server.port,
      requestCount: 0,
    });
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRoute(overrides: Partial<RouteConfig> = {}): RouteConfig {
  return {
    id: nextId('route'),
    name: 'List users',
    enabled: true,
    method: 'GET',
    path: '/api/users',
    response: {
      type: 'static',
      statusCode: 200,
      body: { contentType: 'application/json', content: [{ id: 1, name: 'Ada' }] },
    },
    ...overrides,
  };
}

function seedServer(
  host: FakeHost,
  overrides: Partial<MockServerConfig> = {},
  status: ServerRuntimeState['status'] = 'stopped'
): MockServerConfig {
  const server: MockServerConfig = {
    id: nextId('srv'),
    name: 'Payments API',
    port: 4100,
    protocol: 'http',
    enabled: true,
    routes: [makeRoute()],
    ...overrides,
  };
  host.servers.set(server.id, server);
  host.states.set(server.id, { id: server.id, status, port: server.port, requestCount: 0 });
  return server;
}

function makeLog(overrides: {
  serverId?: string;
  path?: string;
  requestBody?: unknown;
  responseBody?: unknown;
  matched?: boolean;
} = {}): RequestLogEntry {
  return {
    id: nextId('log'),
    serverId: overrides.serverId ?? 'srv-unknown',
    timestamp: new Date('2026-07-10T10:00:00.000Z'),
    request: {
      method: 'GET',
      path: overrides.path ?? '/api/users',
      url: 'http://localhost:4100/api/users',
      headers: {},
      query: {},
      ...(overrides.requestBody !== undefined ? { body: overrides.requestBody } : {}),
    },
    response: {
      statusCode: 200,
      headers: {},
      duration: 12,
      ...(overrides.responseBody !== undefined ? { body: overrides.responseBody } : {}),
    },
    matched: overrides.matched ?? true,
  };
}

/** A schema-valid route payload as the model would supply it (no id). */
function routeInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Create user',
    enabled: true,
    method: 'POST',
    path: '/api/users',
    response: {
      type: 'static',
      statusCode: 201,
      body: { contentType: 'application/json', content: { id: 2, name: 'Grace' } },
    },
    ...overrides,
  };
}

interface Setup {
  host: FakeHost;
  belt: ServerToolBelt;
  confirm: Mock<[action: { title: string; detail: string }], Promise<boolean>>;
}

function setup(confirmResult: boolean | ((action: { title: string; detail: string }) => boolean) = true): Setup {
  const host = new FakeHost();
  const confirm = vi.fn(async (action: { title: string; detail: string }) =>
    typeof confirmResult === 'function' ? confirmResult(action) : confirmResult
  );
  const belt = createServerToolBelt({ host, confirm });
  return { host, belt, confirm };
}

const run = (belt: ServerToolBelt, name: string, input: unknown = {}): Promise<string> =>
  belt.execute({ name, input });

// ---------------------------------------------------------------------------
// Read tools
// ---------------------------------------------------------------------------

describe('list_servers', () => {
  it('reports an empty workspace', async () => {
    const { belt } = setup();
    expect(await run(belt, 'list_servers')).toBe('No mock servers configured.');
  });

  it('returns id, name, port, protocol, status, baseUrl, and routes with ids', async () => {
    const { host, belt } = setup();
    const server = seedServer(host, {}, 'running');
    const parsed = JSON.parse(await run(belt, 'list_servers')) as Array<Record<string, unknown>>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      id: server.id,
      name: 'Payments API',
      port: 4100,
      protocol: 'http',
      status: 'running',
      baseUrl: 'http://localhost:4100',
    });
    const routes = parsed[0].routes as Array<Record<string, unknown>>;
    expect(routes[0]).toEqual({
      id: server.routes[0].id,
      method: 'GET',
      path: '/api/users',
      statusCode: 200,
      enabled: true,
    });
  });
});

describe('get_route', () => {
  it('resolves by route id and by "METHOD /path" (case-insensitive method)', async () => {
    const { host, belt } = setup();
    const server = seedServer(host);
    const route = server.routes[0];

    const byId = JSON.parse(await run(belt, 'get_route', { server: server.id, route: route.id }));
    expect(byId.id).toBe(route.id);
    expect(byId.response.statusCode).toBe(200);

    const byRef = JSON.parse(
      await run(belt, 'get_route', { server: 'Payments API', route: 'get /api/users' })
    );
    expect(byRef.id).toBe(route.id);
  });

  it('returns guidance for unknown server and unknown route', async () => {
    const { host, belt } = setup();
    const server = seedServer(host);
    expect(await run(belt, 'get_route', { server: 'nope', route: 'x' })).toBe(
      'Server "nope" not found — call list_servers.'
    );
    expect(await run(belt, 'get_route', { server: server.id, route: 'DELETE /missing' })).toBe(
      `Route "DELETE /missing" not found on "Payments API" — call list_servers to see its routes.`
    );
  });
});

describe('get_request_logs', () => {
  it('applies the default limit', async () => {
    const { host, belt } = setup();
    const server = seedServer(host);
    for (let i = 0; i < LOGS_DEFAULT_LIMIT + 10; i++) {
      host.logs.push(makeLog({ serverId: server.id }));
    }
    const parsed = JSON.parse(await run(belt, 'get_request_logs', {}));
    expect(parsed).toHaveLength(LOGS_DEFAULT_LIMIT);
    expect(parsed[0]).toMatchObject({
      timestamp: '2026-07-10T10:00:00.000Z',
      method: 'GET',
      path: '/api/users',
      statusCode: 200,
      durationMs: 12,
      matched: true,
    });
    expect(parsed[0]).not.toHaveProperty('requestBody');
  });

  it('clamps limit 0 up to 1 and huge limits down to the max', async () => {
    const { host, belt } = setup();
    const server = seedServer(host);
    for (let i = 0; i < LOGS_MAX_LIMIT + 20; i++) {
      host.logs.push(makeLog({ serverId: server.id }));
    }
    expect(JSON.parse(await run(belt, 'get_request_logs', { limit: 0 }))).toHaveLength(1);
    expect(host.lastLogQuery?.limit).toBe(1);
    // 100 pretty-printed entries exceed TOOL_OUTPUT_MAX_CHARS, so assert the
    // clamped limit handed to the host rather than parsing truncated JSON.
    await run(belt, 'get_request_logs', { limit: 10_000 });
    expect(host.lastLogQuery?.limit).toBe(LOGS_MAX_LIMIT);
  });

  it('filters by server and rejects an unknown server ref', async () => {
    const { host, belt } = setup();
    const a = seedServer(host, { name: 'Alpha', port: 4101 });
    seedServer(host, { name: 'Beta', port: 4102 });
    host.logs.push(makeLog({ serverId: a.id }), makeLog({ serverId: 'other' }));
    expect(JSON.parse(await run(belt, 'get_request_logs', { server: 'Alpha' }))).toHaveLength(1);
    expect(await run(belt, 'get_request_logs', { server: 'Ghost' })).toBe(
      'Server "Ghost" not found — call list_servers.'
    );
  });

  it('includeBodies adds previews truncated to the cap', async () => {
    const { host, belt } = setup();
    const server = seedServer(host);
    host.logs.push(
      makeLog({
        serverId: server.id,
        requestBody: 'x'.repeat(LOG_BODY_PREVIEW_CHARS + 100),
        responseBody: { message: 'ok' },
      })
    );
    const parsed = JSON.parse(await run(belt, 'get_request_logs', { includeBodies: true }));
    expect(parsed[0].requestBody).toHaveLength(LOG_BODY_PREVIEW_CHARS + 1); // + ellipsis
    expect(parsed[0].requestBody.endsWith('…')).toBe(true);
    expect(parsed[0].responseBody).toBe('{"message":"ok"}');
  });

  it('reports when no logs are recorded', async () => {
    const { belt } = setup();
    expect(await run(belt, 'get_request_logs')).toBe('No request logs recorded.');
  });

  it('returns entries newest first, matching the real RequestLogger', async () => {
    const { host, belt } = setup();
    const server = seedServer(host);
    // Appended chronologically — the tool must surface the LAST logged
    // request as the FIRST element, exactly like RequestLogger.getEntries.
    host.logs.push(
      makeLog({ serverId: server.id, path: '/api/oldest' }),
      makeLog({ serverId: server.id, path: '/api/newest' })
    );
    const parsed = JSON.parse(await run(belt, 'get_request_logs', {})) as Array<{ path: string }>;
    expect(parsed.map((entry) => entry.path)).toEqual(['/api/newest', '/api/oldest']);
  });

  it('declares the newest-first ordering in the tool description', () => {
    const { belt } = setup();
    const definition = belt.definitions.find((d) => d.name === 'get_request_logs');
    expect(definition?.description).toContain('newest FIRST');
    expect(definition?.description).not.toContain('newest last');
  });
});

// ---------------------------------------------------------------------------
// Gating
// ---------------------------------------------------------------------------

describe('confirmation gating', () => {
  it('create_server gates, executes, and records the action', async () => {
    const { host, belt, confirm } = setup();
    const result = await run(belt, 'create_server', { name: 'Orders API', port: 4200 });
    expect(confirm).toHaveBeenCalledTimes(1);
    const action = confirm.mock.calls[0][0] as { title: string; detail: string };
    expect(action.title).toBe('Create mock server "Orders API"');
    expect(action.detail.length).toBeGreaterThan(0);
    expect(host.calls).toContain('createServer');
    expect(result).toMatch(/Created mock server "Orders API" \(id: srv-\d+\) on port 4200\./);
    const actions = belt.actions();
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe('create_server');
    expect(actions[0].serverName).toBe('Orders API');
    expect(actions[0].summary).toContain('Orders API');
  });

  it('add_route gates, executes via addRoutes, and records route ids', async () => {
    const { host, belt, confirm } = setup();
    const server = seedServer(host);
    const result = await run(belt, 'add_route', {
      server: server.id,
      routes: [routeInput(), routeInput({ name: 'Get user', method: 'GET', path: '/api/users/:id' })],
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect((confirm.mock.calls[0][0] as { title: string }).title).toBe(
      'Add 2 route(s) to "Payments API"'
    );
    expect((confirm.mock.calls[0][0] as { detail: string }).detail).toContain(
      'POST /api/users → 201'
    );
    expect(host.calls).toContain('addRoutes');
    expect(result).toContain('Added 2 route(s) to "Payments API"');
    const actions = belt.actions();
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe('add_route');
    expect(actions[0].serverId).toBe(server.id);
    expect(actions[0].summary).toContain('POST /api/users');
    expect(actions[0].routeIds).toHaveLength(2);
  });

  it('update_route gates with old → new detail and applies the validated merge', async () => {
    const { host, belt, confirm } = setup();
    const server = seedServer(host);
    const result = await run(belt, 'update_route', {
      server: server.id,
      route: 'GET /api/users',
      updates: { path: '/api/members' },
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    const action = confirm.mock.calls[0][0] as { title: string; detail: string };
    expect(action.title).toBe('Update route GET /api/users on "Payments API"');
    expect(action.detail).toContain('path');
    expect(action.detail).toContain('/api/members');
    expect(host.calls).toContain('updateRoute');
    expect(server.routes[0].path).toBe('/api/members');
    expect(result).toContain('Updated route GET /api/users');
    expect(belt.actions()[0]).toMatchObject({
      kind: 'update_route',
      serverId: server.id,
      routeIds: [server.routes[0].id],
    });
  });

  it('delete_route gates with route name and status in the detail', async () => {
    const { host, belt, confirm } = setup();
    const server = seedServer(host);
    const result = await run(belt, 'delete_route', { server: server.id, route: 'GET /api/users' });
    expect(confirm).toHaveBeenCalledTimes(1);
    const action = confirm.mock.calls[0][0] as { title: string; detail: string };
    expect(action.title).toBe('Delete route GET /api/users from "Payments API"');
    expect(action.detail).toContain('List users');
    expect(action.detail).toContain('200');
    expect(host.calls).toContain('deleteRoute');
    expect(server.routes).toHaveLength(0);
    expect(result).toBe('Deleted route GET /api/users from "Payments API".');
    expect(belt.actions()[0].kind).toBe('delete_route');
  });

  it('start_server gates and reports the base URL', async () => {
    const { host, belt, confirm } = setup();
    const server = seedServer(host, {}, 'stopped');
    const result = await run(belt, 'start_server', { server: server.id });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect((confirm.mock.calls[0][0] as { title: string }).title).toBe(
      'Start mock server "Payments API"'
    );
    expect(host.calls).toContain('startServer');
    expect(result).toBe('"Payments API" is running at http://localhost:4100.');
    expect(belt.actions()[0].kind).toBe('start_server');
  });

  it('stop_server gates and records the action', async () => {
    const { host, belt, confirm } = setup();
    const server = seedServer(host, {}, 'running');
    const result = await run(belt, 'stop_server', { server: server.id });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect((confirm.mock.calls[0][0] as { title: string }).title).toBe(
      'Stop mock server "Payments API"'
    );
    expect(host.calls).toContain('stopServer');
    expect(result).toBe('Stopped "Payments API".');
    expect(belt.actions()[0].kind).toBe('stop_server');
  });

  it('start_server on an already-running server short-circuits without gating', async () => {
    const { host, belt, confirm } = setup();
    const server = seedServer(host, {}, 'running');
    expect(await run(belt, 'start_server', { server: server.id })).toBe(
      '"Payments API" is already running at http://localhost:4100.'
    );
    expect(confirm).not.toHaveBeenCalled();
    expect(host.calls).not.toContain('startServer');
  });

  it('stop_server on an already-stopped server short-circuits without gating', async () => {
    const { host, belt, confirm } = setup();
    const server = seedServer(host, {}, 'stopped');
    expect(await run(belt, 'stop_server', { server: server.id })).toBe(
      '"Payments API" is already stopped.'
    );
    expect(confirm).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Confirm change payloads
// ---------------------------------------------------------------------------

describe('confirm change payloads', () => {
  function recordingSetup(): { host: FakeHost; belt: ServerToolBelt; seen: ConfirmAction[] } {
    const host = new FakeHost();
    const seen: ConfirmAction[] = [];
    const confirm = async (a: ConfirmAction): Promise<boolean> => {
      seen.push(a);
      return true;
    };
    const belt = createServerToolBelt({ host, confirm });
    return { host, belt, seen };
  }

  it('create_server carries kind, serverName, and the defaulted protocol', async () => {
    const { belt, seen } = recordingSetup();
    await run(belt, 'create_server', { name: 'Orders API' });
    expect(seen).toHaveLength(1);
    expect(seen[0].change).toEqual({
      kind: 'create_server',
      serverName: 'Orders API',
      protocol: 'http',
    });
    expect(seen[0].change).not.toHaveProperty('port');
  });

  it('create_server includes the port when one is supplied', async () => {
    const { belt, seen } = recordingSetup();
    await run(belt, 'create_server', { name: 'Orders API', port: 4200, protocol: 'graphql' });
    expect(seen[0].change).toEqual({
      kind: 'create_server',
      serverName: 'Orders API',
      port: 4200,
      protocol: 'graphql',
    });
  });

  it('add_route snapshots every accepted route, disclosing proxies and previewing bodies', async () => {
    const { host, belt, seen } = recordingSetup();
    const server = seedServer(host);
    await run(belt, 'add_route', {
      server: server.id,
      routes: [
        routeInput(),
        routeInput({
          name: 'Proxy data',
          method: 'GET',
          path: '/api/data',
          response: {
            type: 'proxy',
            statusCode: 200,
            proxy: { targetUrl: 'http://internal.example/data' },
          },
        }),
      ],
    });
    expect(seen).toHaveLength(1);
    const change = seen[0].change!;
    expect(change.kind).toBe('add_route');
    expect(change.serverName).toBe('Payments API');
    expect(change.routes).toHaveLength(2);
    const [staticSnap, proxySnap] = change.routes!;
    expect(staticSnap.bodyPreview).toBeDefined();
    expect(staticSnap.bodyPreview).toBe(JSON.stringify({ id: 2, name: 'Grace' }));
    expect(staticSnap.responseType).toBe('static');
    expect(proxySnap.responseType).toBe('proxy');
    expect(proxySnap.bodyPreview).toBeUndefined();
    expect(proxySnap.disclosures[0].startsWith('PROXIES live requests to')).toBe(true);
  });

  it('add_route body previews over the cap end with an ellipsis and stay bounded', async () => {
    const { host, belt, seen } = recordingSetup();
    const server = seedServer(host);
    await run(belt, 'add_route', {
      server: server.id,
      routes: [
        routeInput({
          response: {
            type: 'static',
            statusCode: 201,
            body: {
              contentType: 'application/json',
              content: 'x'.repeat(CHANGE_BODY_PREVIEW_MAX_CHARS + 100),
            },
          },
        }),
      ],
    });
    const preview = seen[0].change!.routes![0].bodyPreview!;
    expect(preview.endsWith('…')).toBe(true);
    expect(preview.length).toBeLessThanOrEqual(CHANGE_BODY_PREVIEW_MAX_CHARS + 1);
  });

  it('update_route emits fieldDiffs only for values that actually change', async () => {
    const { host, belt, seen } = recordingSetup();
    const server = seedServer(host);
    await run(belt, 'update_route', {
      server: server.id,
      route: 'GET /api/users',
      updates: { name: 'List users', path: '/renamed' }, // name is unchanged
    });
    expect(seen).toHaveLength(1);
    const action = seen[0];
    // title/detail are byte-identical to the pre-change confirm text.
    expect(action.title).toBe('Update route GET /api/users on "Payments API"');
    expect(action.detail).toBe(
      'name: "List users" → "List users"\npath: "/api/users" → "/renamed"'
    );
    const change = action.change!;
    expect(change.kind).toBe('update_route');
    expect(change.fieldDiffs).toEqual([
      { field: 'path', before: valuePreview('/api/users'), after: valuePreview('/renamed') },
    ]);
    expect(change.before!.path).toBe('/api/users');
    expect(change.after!.path).toBe('/renamed');
    expect(change.before!.path).not.toBe(change.after!.path);
  });

  it('update_route and delete_route summaries stay clamped for oversized paths', async () => {
    const { host, belt } = setup();
    const longPath = `/${'p'.repeat(5000)}`;
    const server = seedServer(host, { routes: [makeRoute({ path: longPath })] });
    await run(belt, 'update_route', {
      server: server.id,
      route: server.routes[0].id,
      updates: { name: 'Renamed' },
    });
    await run(belt, 'delete_route', { server: server.id, route: server.routes[0].id });
    const actions = belt.actions();
    expect(actions).toHaveLength(2);
    expect(actions[0].summary.startsWith('Updated route')).toBe(true);
    expect(actions[0].summary.length).toBeLessThanOrEqual(201); // clamp + ellipsis
    expect(actions[1].summary.startsWith('Deleted route')).toBe(true);
    expect(actions[1].summary.length).toBeLessThanOrEqual(201);
  });

  it('delete_route carries only a before snapshot', async () => {
    const { host, belt, seen } = recordingSetup();
    const server = seedServer(host);
    await run(belt, 'delete_route', { server: server.id, route: 'GET /api/users' });
    const change = seen[0].change!;
    expect(change.kind).toBe('delete_route');
    expect(change.serverName).toBe('Payments API');
    expect(change.before).toMatchObject({ method: 'GET', path: '/api/users', statusCode: 200 });
    expect(change.after).toBeUndefined();
    expect(change.routes).toBeUndefined();
  });

  it('start_server and stop_server carry kind, serverName, and port only', async () => {
    const { host, belt, seen } = recordingSetup();
    const stopped = seedServer(host, {}, 'stopped');
    const running = seedServer(host, { name: 'Running API', port: 4700 }, 'running');
    await run(belt, 'start_server', { server: stopped.id });
    await run(belt, 'stop_server', { server: running.id });
    expect(seen[0].change).toEqual({
      kind: 'start_server',
      serverName: 'Payments API',
      port: 4100,
    });
    expect(seen[1].change).toEqual({
      kind: 'stop_server',
      serverName: 'Running API',
      port: 4700,
    });
  });
});

describe('computeRouteFieldDiffs', () => {
  const base = (): Omit<RouteConfig, 'id'> => {
    const { id: _id, ...rest } = makeRoute();
    return rest;
  };

  it('returns no rows when the candidate fields are identical', () => {
    expect(computeRouteFieldDiffs(base(), base(), ['name', 'path', 'response'])).toEqual([]);
  });

  it('emits one row for a changed object field with bounded previews', () => {
    const before = base();
    const after = {
      ...base(),
      response: {
        type: 'static' as const,
        statusCode: 200,
        body: { contentType: 'application/json', content: { renamed: 'x'.repeat(200) } },
      },
    };
    // The change here sits PAST the 80-char preview clamp (the serialized
    // prefix is shared), so the previews are re-anchored at the divergence —
    // they must never be byte-identical for a real change.
    const diffs = computeRouteFieldDiffs(before, after, ['name', 'response']);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].field).toBe('response');
    expect(diffs[0].before.length).toBeLessThanOrEqual(81);
    expect(diffs[0].after.length).toBeLessThanOrEqual(81);
    expect(diffs[0].before).not.toBe(diffs[0].after);
    expect(diffs[0].before.startsWith('…')).toBe(true);
    expect(diffs[0].before).toContain('"content":[{"id":1');
    expect(diffs[0].after).toContain('"content":{"renamed"');
  });

  it('keeps plain valuePreview rows when the change is inside the preview window', () => {
    const before = base();
    const after = { ...base(), path: '/renamed' };
    const diffs = computeRouteFieldDiffs(before, after, ['path']);
    expect(diffs).toEqual([
      { field: 'path', before: valuePreview(before.path), after: valuePreview('/renamed') },
    ]);
  });
});

describe('clampDisclosures', () => {
  it('returns short lists unchanged', () => {
    expect(clampDisclosures(['renders a dynamic Handlebars template'])).toEqual([
      'renders a dynamic Handlebars template',
    ]);
  });

  it('never hides a proxy line past the cap and announces the elision', () => {
    // 10 lines: sequence header + 8 dynamic steps + a PROXY line at index 9 —
    // a plain slice(0, 8) would silently drop the proxy disclosure.
    const lines = [
      'responds with a 9-step sequence',
      ...Array.from({ length: 8 }, () => 'renders a dynamic Handlebars template'),
      'PROXIES live requests to https://attacker.example',
    ];
    const out = clampDisclosures(lines);
    expect(out).toHaveLength(CHANGE_DISCLOSURES_MAX);
    expect(out[0]).toBe('PROXIES live requests to https://attacker.example');
    expect(out[out.length - 1]).toContain('3 more disclosure line(s) omitted');
  });

  it('flows through routeChangeSnapshot for oversized sequences', () => {
    const { id: _id, ...route } = makeRoute({
      response: {
        type: 'sequence',
        statusCode: 200,
        sequence: {
          responses: [
            ...Array.from({ length: 8 }, () => ({ type: 'dynamic' as const, statusCode: 200 })),
            {
              type: 'proxy' as const,
              statusCode: 200,
              proxy: { targetUrl: 'https://attacker.example' },
            },
          ],
        },
      },
    });
    const snap = routeChangeSnapshot(route);
    expect(snap.disclosures).toHaveLength(CHANGE_DISCLOSURES_MAX);
    expect(snap.disclosures[0]).toContain('PROXIES live requests to https://attacker.example');
    expect(snap.disclosures[snap.disclosures.length - 1]).toContain('omitted');
  });
});

describe('routeChangeSnapshot', () => {
  it('omits empty names, counts headers, and clamps disclosure lines', () => {
    const { id: _id, ...route } = makeRoute({
      name: '',
      response: {
        type: 'proxy',
        statusCode: 200,
        headers: { 'x-a': '1', 'x-b': '2' },
        proxy: { targetUrl: `http://long.example/${'p'.repeat(400)}` },
      },
    });
    const snap = routeChangeSnapshot(route);
    expect(snap).not.toHaveProperty('name');
    expect(snap.headersCount).toBe(2);
    expect(snap.responseType).toBe('proxy');
    expect(snap.bodyPreview).toBeUndefined();
    expect(snap.disclosures).toHaveLength(1);
    expect(snap.disclosures[0].length).toBeLessThanOrEqual(201); // CHANGE_LINE_MAX_CHARS + ellipsis
  });
});

// ---------------------------------------------------------------------------
// Denial path
// ---------------------------------------------------------------------------

describe('denied confirmations', () => {
  it('returns the denial message, leaves the host, actions, and snapshot untouched', async () => {
    const { host, belt, confirm } = setup(false);
    const server = seedServer(host);
    const mutations: Array<[string, Record<string, unknown>]> = [
      ['create_server', { name: 'Denied API' }],
      ['add_route', { server: server.id, routes: [routeInput()] }],
      ['update_route', { server: server.id, route: 'GET /api/users', updates: { name: 'Renamed' } }],
      ['delete_route', { server: server.id, route: 'GET /api/users' }],
      ['start_server', { server: server.id }],
    ];
    for (const [name, input] of mutations) {
      expect(await run(belt, name, input)).toBe(MUTATION_DENIED_MESSAGE);
    }
    expect(confirm).toHaveBeenCalledTimes(mutations.length);
    expect(host.calls).toEqual([]); // no mutation reached the host
    expect(belt.actions()).toEqual([]);
    expect(belt.snapshot()).toBeUndefined(); // no snapshot on denial
    expect(server.routes).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

describe('undo snapshots', () => {
  it('snapshots a server once, holding the ORIGINAL config across two mutations', async () => {
    const { host, belt } = setup();
    const server = seedServer(host);
    const originalRouteId = server.routes[0].id;

    await run(belt, 'add_route', { server: server.id, routes: [routeInput()] });
    await run(belt, 'delete_route', { server: server.id, route: originalRouteId });

    const snapshot = belt.snapshot();
    expect(snapshot).toBeDefined();
    expect(snapshot!.servers).toHaveLength(1);
    expect(snapshot!.createdServerIds).toEqual([]);
    const snap = snapshot!.servers[0];
    expect(snap.config.routes).toHaveLength(1);
    expect(snap.config.routes[0].id).toBe(originalRouteId);
    expect(snap.config.routes[0].path).toBe('/api/users');
    expect(snap.wasRunning).toBe(false);
  });

  it('servers created by the session are recorded by id, not snapshotted', async () => {
    const { host, belt } = setup();
    await run(belt, 'create_server', { name: 'Fresh API', port: 4300 });
    const created = [...host.servers.values()][0];
    // Mutating the created server must not add a pre-existing snapshot.
    await run(belt, 'add_route', { server: created.id, routes: [routeInput()] });
    const snapshot = belt.snapshot();
    expect(snapshot!.createdServerIds).toEqual([created.id]);
    expect(snapshot!.servers).toEqual([]);
  });

  it('restoreUndoSnapshot deletes created servers, restores routes, and re-applies running state', async () => {
    const { host, belt } = setup();
    // Pre-existing server: running, one route. The session stops it, changes
    // its routes; undo must bring both back.
    const touched = seedServer(host, { name: 'Touched API' }, 'running');
    // Pre-existing server: stopped. The session starts it; undo must stop it.
    const started = seedServer(host, { name: 'Started API', port: 4400 }, 'stopped');

    await run(belt, 'stop_server', { server: touched.id });
    await run(belt, 'add_route', { server: touched.id, routes: [routeInput()] });
    await run(belt, 'start_server', { server: started.id });
    await run(belt, 'create_server', { name: 'Session API', port: 4500 });
    const createdId = belt.snapshot()!.createdServerIds[0];

    const result = await restoreUndoSnapshot(host, belt.snapshot()!);
    expect(result.errors).toEqual([]);
    expect(result.deletedServerIds).toEqual([createdId]);
    expect(result.restoredServerIds).toEqual(
      expect.arrayContaining([touched.id, started.id])
    );

    // Created server is gone.
    expect(host.servers.has(createdId)).toBe(false);

    // Route set restored (ids regenerate — compare method/path/response).
    const restored = host.servers.get(touched.id)!;
    expect(restored.routes).toHaveLength(1);
    expect(restored.routes[0]).toMatchObject({
      method: 'GET',
      path: '/api/users',
      response: { statusCode: 200 },
    });

    // Running state re-applied both ways.
    expect(host.getServerState(touched.id)?.status).toBe('running');
    expect(host.getServerState(started.id)?.status).toBe('stopped');
  });

  it('collects restore errors without aborting the remaining work', async () => {
    const host = new FakeHost();
    const survivor = seedServer(host, { name: 'Survivor', port: 4600 }, 'stopped');
    const snapshot: UndoSnapshot = {
      servers: [
        // This server no longer exists — must be an error, not a crash.
        {
          config: { ...structuredClone(survivor), id: 'srv-ghost', name: 'Ghost' },
          wasRunning: false,
        },
        { config: structuredClone(survivor), wasRunning: true },
      ],
      createdServerIds: ['srv-also-ghost', survivor.id],
    };
    host.failOn.add('deleteServer'); // created-server deletion fails too

    const result = await restoreUndoSnapshot(host, snapshot);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
    expect(result.errors.some((e) => e.includes('Ghost'))).toBe(true);
    // The survivor was still fully restored despite earlier failures.
    expect(result.restoredServerIds).toEqual([survivor.id]);
    expect(host.getServerState(survivor.id)?.status).toBe('running');
  });
});

// ---------------------------------------------------------------------------
// Validation of untrusted input
// ---------------------------------------------------------------------------

describe('add_route validation', () => {
  it('rejects non-array/garbage routes without touching the host', async () => {
    const { host, belt, confirm } = setup();
    const server = seedServer(host);
    const result = await run(belt, 'add_route', { server: server.id, routes: 'not routes' });
    expect(result).toContain('did not match the expected format');
    expect(confirm).not.toHaveBeenCalled();
    expect(host.calls).not.toContain('addRoutes');
  });

  it('rejects a route missing path', async () => {
    const { host, belt } = setup();
    const server = seedServer(host);
    const bad = routeInput();
    delete bad.path;
    const result = await run(belt, 'add_route', { server: server.id, routes: [bad] });
    expect(result).toContain('path');
    expect(host.calls).not.toContain('addRoutes');
  });

  it('rejects verifyRoutes failures, quoting the reasons', async () => {
    const { host, belt } = setup();
    const server = seedServer(host);

    const noSlash = await run(belt, 'add_route', {
      server: server.id,
      routes: [routeInput({ path: 'api/users' })],
    });
    expect(noSlash).toContain('path must start with "/"');

    // 999 is rejected by the Zod schema layer (statusCode max 599)…
    const zodStatus = await run(belt, 'add_route', {
      server: server.id,
      routes: [
        routeInput({
          response: { type: 'static', statusCode: 999, body: { contentType: 'application/json', content: {} } },
        }),
      ],
    });
    expect(zodStatus).toContain('statusCode');
    expect(zodStatus).toContain('599');

    // …while a schema-valid but implausible 150 is rejected by verifyRoutes.
    const badStatus = await run(belt, 'add_route', {
      server: server.id,
      routes: [
        routeInput({
          response: { type: 'static', statusCode: 150, body: { contentType: 'application/json', content: {} } },
        }),
      ],
    });
    expect(badStatus).toContain('implausible response status code 150');

    const braceParam = await run(belt, 'add_route', {
      server: server.id,
      routes: [routeInput({ path: '/api/users/{name}' })],
    });
    expect(braceParam).toContain(':name form');

    expect(host.calls).not.toContain('addRoutes');
  });

  it('rejects batches over the max', async () => {
    const { host, belt } = setup();
    const server = seedServer(host);
    const routes = Array.from({ length: ADD_ROUTES_MAX + 1 }, () => routeInput());
    const result = await run(belt, 'add_route', { server: server.id, routes });
    expect(result).toContain(`At most ${ADD_ROUTES_MAX}`);
    expect(host.calls).not.toContain('addRoutes');
  });

  it('rejects over-max batches wrapped in a {"routes": [...]} object too', async () => {
    const { host, belt, confirm } = setup();
    const server = seedServer(host);
    // validateRoutes unwraps object-wrapped arrays, so the cap must apply to
    // the unwrapped result — not just to raw-array input.
    const routes = Array.from({ length: ADD_ROUTES_MAX + 1 }, () => routeInput());
    const result = await run(belt, 'add_route', { server: server.id, routes: { routes } });
    expect(result).toContain(`At most ${ADD_ROUTES_MAX}`);
    expect(confirm).not.toHaveBeenCalled();
    expect(host.calls).not.toContain('addRoutes');
  });

  it('lists EVERY accepted route in the confirmation detail (no truncation)', async () => {
    const { host, belt, confirm } = setup();
    const server = seedServer(host);
    const routes = Array.from({ length: 15 }, (_, i) =>
      routeInput({ name: `Route ${i}`, method: 'GET', path: `/api/batch/${i}` })
    );
    await run(belt, 'add_route', { server: server.id, routes });
    const detail = (confirm.mock.calls[0][0] as { detail: string }).detail;
    for (let i = 0; i < 15; i++) {
      expect(detail).toContain(`GET /api/batch/${i} → 201`);
    }
    expect(detail).not.toContain('…');
  });

  it('discloses proxy targets in the add_route confirmation detail', async () => {
    const { host, belt, confirm } = setup();
    const server = seedServer(host);
    await run(belt, 'add_route', {
      server: server.id,
      routes: [
        routeInput({
          name: 'Data',
          method: 'GET',
          path: '/api/data',
          response: {
            type: 'proxy',
            statusCode: 200,
            proxy: { targetUrl: 'http://169.254.169.254/latest/meta-data/' },
          },
        }),
      ],
    });
    const detail = (confirm.mock.calls[0][0] as { detail: string }).detail;
    expect(detail).toContain('PROXIES');
    expect(detail).toContain('http://169.254.169.254/latest/meta-data/');
  });

  it('rejects oversized serialized response bodies', async () => {
    const { host, belt } = setup();
    const server = seedServer(host);
    const result = await run(belt, 'add_route', {
      server: server.id,
      routes: [
        routeInput({
          response: {
            type: 'static',
            statusCode: 200,
            body: { contentType: 'application/json', content: 'x'.repeat(ROUTE_BODY_MAX_CHARS + 10) },
          },
        }),
      ],
    });
    expect(result).toContain(`max ${ROUTE_BODY_MAX_CHARS}`);
    expect(host.calls).not.toContain('addRoutes');
  });

  it('proceeds with accepted routes and notes the rejected ones', async () => {
    const { host, belt } = setup();
    const server = seedServer(host);
    const result = await run(belt, 'add_route', {
      server: server.id,
      routes: [routeInput(), routeInput({ name: 'Broken', path: 'no-slash' })],
    });
    expect(result).toContain('Added 1 route(s)');
    expect(result).toContain('rejected and skipped');
    expect(result).toContain('path must start with "/"');
  });

  it('returns server guidance when the ref does not resolve', async () => {
    const { belt } = setup();
    expect(await run(belt, 'add_route', { server: 'ghost', routes: [routeInput()] })).toBe(
      'Server "ghost" not found — call list_servers.'
    );
  });
});

describe('create_server validation', () => {
  it('rejects empty and whitespace names', async () => {
    const { host, belt, confirm } = setup();
    expect(await run(belt, 'create_server', { name: '' })).toContain('non-empty server name');
    expect(await run(belt, 'create_server', { name: '   ' })).toContain('non-empty server name');
    expect(await run(belt, 'create_server', {})).toContain('non-empty server name');
    expect(confirm).not.toHaveBeenCalled();
    expect(host.calls).toEqual([]);
  });

  it('rejects non-integer and out-of-range ports', async () => {
    const { host, belt } = setup();
    expect(await run(belt, 'create_server', { name: 'X', port: 'abc' })).toBe(
      'port must be an integer between 1024 and 65535.'
    );
    expect(await run(belt, 'create_server', { name: 'X', port: 80 })).toBe(
      'port must be an integer between 1024 and 65535.'
    );
    expect(await run(belt, 'create_server', { name: 'X', port: 70000 })).toBe(
      'port must be an integer between 1024 and 65535.'
    );
    expect(host.calls).toEqual([]);
  });

  it('clamps overlong names to one line', async () => {
    const { host, belt } = setup();
    await run(belt, 'create_server', { name: `Multi\nline ${'x'.repeat(200)}` });
    const created = [...host.servers.values()][0];
    expect(created.name).not.toContain('\n');
    expect(created.name.length).toBeLessThanOrEqual(61); // clamp + ellipsis
  });
});

describe('update_route validation', () => {
  it('ignores fields outside the allowlist and notes them', async () => {
    const { host, belt } = setup();
    const server = seedServer(host);
    const routeId = server.routes[0].id;
    const result = await run(belt, 'update_route', {
      server: server.id,
      route: routeId,
      updates: { name: 'Renamed', id: 'evil-id', matcher: {}, graphql: { operationName: 'x' } },
    });
    expect(result).toContain('Updated route');
    expect(result).toContain('Ignored non-updatable field(s): id, matcher, graphql');
    expect(server.routes[0].id).toBe(routeId); // id untouched
    expect(server.routes[0].name).toBe('Renamed');
    expect(server.routes[0].matcher).toBeUndefined();
  });

  it('rejects when nothing updatable remains', async () => {
    const { host, belt, confirm } = setup();
    const server = seedServer(host);
    const result = await run(belt, 'update_route', {
      server: server.id,
      route: server.routes[0].id,
      updates: { id: 'evil', chaos: { enabled: true } },
    });
    expect(result).toContain('no updatable fields');
    expect(result).toContain(UPDATABLE_ROUTE_FIELDS.join(', '));
    expect(confirm).not.toHaveBeenCalled();
    expect(host.calls).not.toContain('updateRoute');
  });

  it('discloses proxy targets in the update_route confirmation detail', async () => {
    const { host, belt, confirm } = setup();
    const server = seedServer(host);
    // The changed-field preview is clamped to 80 chars — the target URL must
    // still surface on its own disclosure line.
    const targetUrl = `http://attacker.example/${'x'.repeat(100)}`;
    await run(belt, 'update_route', {
      server: server.id,
      route: 'GET /api/users',
      updates: { response: { type: 'proxy', statusCode: 200, proxy: { targetUrl } } },
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    const detail = (confirm.mock.calls[0][0] as { detail: string }).detail;
    expect(detail).toContain('PROXIES');
    expect(detail).toContain('http://attacker.example/');
  });

  it('rejects a merge that fails verifyRoutes without touching the host', async () => {
    const { host, belt, confirm } = setup();
    const server = seedServer(host);
    const result = await run(belt, 'update_route', {
      server: server.id,
      route: server.routes[0].id,
      updates: { path: 'no-leading-slash' },
    });
    expect(result).toContain('failed validation');
    expect(result).toContain('path must start with "/"');
    expect(confirm).not.toHaveBeenCalled();
    expect(host.calls).not.toContain('updateRoute');
    expect(server.routes[0].path).toBe('/api/users');
  });
});

describe('executor robustness', () => {
  it('names available tools for an unknown tool', async () => {
    const { belt } = setup();
    const result = await run(belt, 'launch_missiles');
    expect(result).toContain('Unknown tool "launch_missiles"');
    expect(result).toContain('list_servers');
    expect(result).toContain('stop_server');
  });

  it('resolves unexpected host errors as strings instead of throwing', async () => {
    const { host, belt } = setup();
    const server = seedServer(host);
    host.failOn.add('addRoutes');
    const result = await run(belt, 'add_route', { server: server.id, routes: [routeInput()] });
    expect(result).toBe('Tool "add_route" failed: addRoutes exploded');
  });
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('resolveServerRef', () => {
  const server = (id: string, name: string): MockServerConfig => ({
    id,
    name,
    port: 3000,
    protocol: 'http',
    enabled: true,
    routes: [],
  });

  it('id beats exact name beats substring', () => {
    const servers = [server('abc', 'Beta'), server('x2', 'abc'), server('x3', 'abcdef')];
    expect(resolveServerRef(servers, 'abc')?.id).toBe('abc'); // id wins
    expect(resolveServerRef([servers[1], servers[2]], 'abc')?.id).toBe('x2'); // exact name next
    expect(resolveServerRef([servers[2]], 'abc')?.id).toBe('x3'); // substring last
    expect(resolveServerRef([server('a', 'pay'), server('b', 'payments')], 'PAY')?.id).toBe('a');
  });

  it('with no ref resolves only a sole server', () => {
    const only = server('one', 'Solo');
    expect(resolveServerRef([only], undefined)).toBe(only);
    expect(resolveServerRef([only, server('two', 'Duo')], undefined)).toBeUndefined();
    expect(resolveServerRef([], undefined)).toBeUndefined();
  });

  it('rejects non-string refs', () => {
    expect(resolveServerRef([server('a', 'A'), server('b', 'B')], 42)).toBeUndefined();
  });
});

describe('resolveRouteRef', () => {
  it('resolves by id, METHOD /path, and unambiguous exact path', () => {
    const routes = [
      makeRoute({ method: 'GET', path: '/api/users' }),
      makeRoute({ method: 'POST', path: '/api/users' }),
      makeRoute({ method: 'DELETE', path: '/api/orders/:id' }),
    ];
    const server: MockServerConfig = {
      id: 'srv',
      name: 'S',
      port: 3000,
      protocol: 'http',
      enabled: true,
      routes,
    };
    expect(resolveRouteRef(server, routes[1].id)).toBe(routes[1]);
    expect(resolveRouteRef(server, 'post /api/users')).toBe(routes[1]);
    expect(resolveRouteRef(server, '/api/orders/:id')).toBe(routes[2]); // unambiguous path
    expect(resolveRouteRef(server, '/api/users')).toBeUndefined(); // ambiguous path
    expect(resolveRouteRef(server, 'PATCH /api/users')).toBeUndefined();
    expect(resolveRouteRef(server, 42)).toBeUndefined();
  });
});

describe('responseDisclosure', () => {
  it('is silent for static responses', () => {
    expect(responseDisclosure(makeRoute().response)).toEqual([]);
  });

  it('names proxy targets (clamped, origin always visible) and database operations', () => {
    const longUrl = `http://internal.example/${'p'.repeat(PROXY_TARGET_PREVIEW_CHARS + 50)}`;
    const [proxyNote] = responseDisclosure({
      type: 'proxy',
      statusCode: 200,
      proxy: { targetUrl: longUrl },
    });
    expect(proxyNote).toContain('PROXIES');
    expect(proxyNote).toContain('http://internal.example/');
    expect(proxyNote.length).toBeLessThanOrEqual('PROXIES live requests to '.length + PROXY_TARGET_PREVIEW_CHARS + 1);

    expect(
      responseDisclosure({
        type: 'database',
        statusCode: 200,
        database: { connectionId: 'prod-db', operation: 'delete' },
      })[0]
    ).toContain('"delete" on connection "prod-db"');
  });

  it('walks sequences recursively so nested proxies are disclosed', () => {
    const notes = responseDisclosure({
      type: 'sequence',
      statusCode: 200,
      sequence: {
        responses: [
          { type: 'static', statusCode: 200 },
          { type: 'proxy', statusCode: 200, proxy: { targetUrl: 'http://hidden.example/' } },
        ],
      },
    });
    expect(notes[0]).toContain('2-step sequence');
    expect(notes.some((note) => note.includes('http://hidden.example/'))).toBe(true);
  });
});

describe('clampLine', () => {
  it('flattens whitespace and clamps with an ellipsis', () => {
    expect(clampLine('  a\n\tb   c  ', 60)).toBe('a b c');
    expect(clampLine('x'.repeat(80), 60)).toBe(`${'x'.repeat(60)}…`);
  });
});

describe('routeItemJsonSchema', () => {
  it('mirrors ROUTES_JSON_SCHEMA.properties.routes.items', () => {
    const item = routeItemJsonSchema();
    const root = ROUTES_JSON_SCHEMA.properties as Record<string, unknown>;
    const expected = (root.routes as Record<string, unknown>).items;
    expect(item).toEqual(expected);
    expect(item).not.toBe(expected); // a copy — callers cannot corrupt the source
  });
});

describe('tool definitions', () => {
  it('exposes all nine strict-dialect tools', () => {
    const { belt } = setup();
    expect(belt.definitions.map((d) => d.name)).toEqual([
      'list_servers',
      'get_route',
      'get_request_logs',
      'create_server',
      'add_route',
      'update_route',
      'delete_route',
      'start_server',
      'stop_server',
    ]);
    for (const definition of belt.definitions) {
      expect(definition.inputSchema.type).toBe('object');
      expect(definition.inputSchema.additionalProperties).toBe(false);
      expect(definition.description.length).toBeGreaterThan(0);
    }
  });
});
