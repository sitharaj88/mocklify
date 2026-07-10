import { describe, it, expect } from 'vitest';
import {
  createKnowledgeTool,
  clampKnowledgeOutput,
  formatRoutesKnowledge,
  formatRequestLogsKnowledge,
  formatSpecsKnowledge,
  formatScanMemoryKnowledge,
  formatDiagnosticsKnowledge,
  listSpecEndpoints,
  KNOWLEDGE_TOPICS,
  KNOWLEDGE_OUTPUT_MAX_CHARS,
  KNOWLEDGE_MAX_LIMIT,
  KNOWLEDGE_LINE_MAX_CHARS,
  KNOWLEDGE_SPEC_ENDPOINTS_MAX,
  type KnowledgeHost,
  type KnowledgeDiagnostics,
} from '../src/ai/agent/knowledgeTool';
import type { ScanMemory } from '../src/ai/scan/scanMemory';
import type {
  MockServerConfig,
  RouteConfig,
  RequestLogEntry,
  ServerRuntimeState,
} from '../src/types/core';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let idCounter = 0;
const nextId = (prefix: string): string => `${prefix}-${++idCounter}`;

function makeRoute(overrides: Partial<RouteConfig> = {}): RouteConfig {
  return {
    id: nextId('route'),
    name: 'List users',
    enabled: true,
    method: 'GET',
    path: '/users',
    response: {
      type: 'static',
      statusCode: 200,
      body: { contentType: 'application/json', content: [] },
    },
    ...overrides,
  };
}

function makeServers(): MockServerConfig[] {
  return [
    {
      id: 'srv-pets',
      name: 'petstore api',
      port: 4000,
      protocol: 'http',
      enabled: true,
      routes: [
        makeRoute({ id: 'route-users', name: 'List users', path: '/users', tags: ['users'] }),
        makeRoute({
          id: 'route-proxy',
          name: 'Proxy upstream',
          method: 'POST',
          path: '/proxy',
          enabled: false,
          response: {
            type: 'proxy',
            statusCode: 200,
            proxy: { targetUrl: 'http://internal.example:9999' },
          },
        }),
      ],
    },
    {
      id: 'srv-orders',
      name: 'orders',
      port: 4001,
      protocol: 'http',
      enabled: true,
      routes: [makeRoute({ id: 'route-orders', name: 'Create order', method: 'POST', path: '/orders' })],
      contract: { specPath: 'openapi.json', mode: 'warn' },
    },
  ];
}

function makeLogEntry(overrides: {
  method?: string;
  path?: string;
  statusCode?: number;
  matched?: boolean;
  validation?: RequestLogEntry['validation'];
  serverId?: string;
}): RequestLogEntry {
  return {
    id: nextId('log'),
    serverId: overrides.serverId ?? 'srv-pets',
    timestamp: new Date('2026-07-01T12:00:00.000Z'),
    request: {
      method: overrides.method ?? 'GET',
      path: overrides.path ?? '/users',
      url: `http://localhost:4000${overrides.path ?? '/users'}`,
      headers: {},
      query: {},
      body: { secret: 'never shown' },
    },
    response: {
      statusCode: overrides.statusCode ?? 200,
      headers: {},
      body: { secret: 'never shown' },
      duration: 12,
    },
    matched: overrides.matched ?? true,
    ...(overrides.validation !== undefined ? { validation: overrides.validation } : {}),
  };
}

function makeLogs(): RequestLogEntry[] {
  // Newest first, mirroring RequestLogger.getEntries.
  return [
    makeLogEntry({
      method: 'POST',
      path: '/orders',
      statusCode: 422,
      serverId: 'srv-orders',
      validation: {
        mode: 'warn',
        ok: false,
        violations: [{ field: 'body.total', message: 'must be a number' }],
      },
    }),
    makeLogEntry({ method: 'POST', path: '/orders', statusCode: 500, serverId: 'srv-orders' }),
    makeLogEntry({ method: 'GET', path: '/nope', statusCode: 404, matched: false }),
    makeLogEntry({ method: 'GET', path: '/users', statusCode: 200 }),
  ];
}

function makeScanMemory(): ScanMemory {
  return {
    version: 1,
    updatedAt: '2026-07-01T00:00:00.000Z',
    surfaces: [
      {
        name: 'petstore',
        rootPath: '',
        direction: 'serves',
        apiLayerPaths: ['src/api'],
        modelPaths: ['src/models'],
        conventions: { auth: 'Bearer tokens' },
      },
    ],
    notes: ['API spec files present: openapi.json'],
  };
}

const TINY_OPENAPI = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'Petstore', version: '1.0.0' },
  paths: {
    '/users': {
      get: { summary: 'List users' },
      post: { summary: 'Create user' },
    },
    '/pets/{id}': { get: {} },
  },
});

function makeDiagnostics(): KnowledgeDiagnostics {
  return {
    extensionVersion: '0.4.0',
    scanStrategies: [{ surface: 'backend', strategy: 'agentic', reason: 'large API surface' }],
    lastError: { message: 'request failed with key sk-abcdefghijkl', when: '2026-07-01T00:00:00.000Z' },
  };
}

function makeHost(overrides: Partial<KnowledgeHost> = {}): KnowledgeHost {
  const servers = makeServers();
  const logs = makeLogs();
  const states = new Map<string, ServerRuntimeState>([
    ['srv-pets', { id: 'srv-pets', status: 'running', port: 4000, requestCount: 4 }],
    ['srv-orders', { id: 'srv-orders', status: 'stopped', port: 4001, requestCount: 0 }],
  ]);
  return {
    getServers: async () => servers,
    getServerState: (serverId) => states.get(serverId),
    getLogEntries: (serverId, limit) => {
      const filtered = logs.filter((entry) => !serverId || entry.serverId === serverId);
      return limit === undefined ? filtered : filtered.slice(0, limit);
    },
    loadScanMemory: async () => makeScanMemory(),
    readSpecText: async () => TINY_OPENAPI,
    getDiagnostics: () => makeDiagnostics(),
    ...overrides,
  };
}

const ask = (
  host: KnowledgeHost,
  input: Record<string, unknown>
): Promise<string> => createKnowledgeTool(host).execute({ name: 'query_knowledge', input });

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

describe('createKnowledgeTool definitions', () => {
  it('exposes exactly one strict-schema tool', () => {
    const tool = createKnowledgeTool(makeHost());
    expect(tool.definitions).toHaveLength(1);
    const definition = tool.definitions[0];
    expect(definition.name).toBe('query_knowledge');
    expect(definition.inputSchema.type).toBe('object');
    expect(definition.inputSchema.additionalProperties).toBe(false);
    expect(definition.inputSchema.required).toEqual(['topic']);
    const properties = definition.inputSchema.properties as Record<string, { enum?: string[] }>;
    expect(properties.topic.enum).toEqual([...KNOWLEDGE_TOPICS]);
  });
});

// ---------------------------------------------------------------------------
// Topic happy paths
// ---------------------------------------------------------------------------

describe('query_knowledge happy paths', () => {
  it('routes: lists servers with route lines, proxy disclosure, and disabled marker', async () => {
    const result = await ask(makeHost(), { topic: 'routes' });
    expect(result).toContain('"petstore api" (id srv-pets, http, port 4000, running) — 2 route(s)');
    expect(result).toContain('- GET /users → 200');
    expect(result).toContain('PROXIES live requests to http://internal.example:9999');
    expect(result).toContain('(disabled)');
    expect(result).toContain('"orders" (id srv-orders, http, port 4001, stopped) — 1 route(s)');
  });

  it('request-logs: renders newest-first lines with UNMATCHED and CONTRACT markers', async () => {
    const result = await ask(makeHost(), { topic: 'request-logs' });
    expect(result).toContain('4 log entries, newest first.');
    expect(result).toContain('Failures (status ≥ 400): 3.');
    expect(result).toContain('Unmatched: 1.');
    expect(result).toContain('Contract violations: 1.');
    expect(result).toContain('GET /nope → 404 (12ms) UNMATCHED');
    expect(result).toContain('CONTRACT[warn] 1 violation(s): body.total: must be a number');
    expect(result).not.toContain('never shown'); // bodies are never included
  });

  it('specs: lists contract binding plus parsed endpoints, never raw spec text', async () => {
    const result = await ask(makeHost(), { topic: 'specs' });
    expect(result).toContain('Server "orders": contract spec openapi.json (mode warn)');
    expect(result).toContain('openapi3, "Petstore" — 3 endpoint(s):');
    expect(result).toContain('GET /users — List users');
    expect(result).toContain('POST /users — Create user');
    expect(result).toContain('GET /pets/{id}');
    expect(result).not.toContain('"openapi"'); // raw JSON never emitted
  });

  it('scan-memory: returns the describeScanMemory block', async () => {
    const result = await ask(makeHost(), { topic: 'scan-memory' });
    expect(result).toContain('Previous scans learned:');
    expect(result).toContain('API layer at src/api');
    expect(result).toContain('- Note: API spec files present: openapi.json');
  });

  it('diagnostics: counts, contract tally, scan strategies, and redacted last error', async () => {
    const result = await ask(makeHost(), { topic: 'diagnostics' });
    expect(result).toContain('2 server(s), 3 route(s), 1 running.');
    expect(result).toContain('Contract validation (last 4 logged requests):');
    expect(result).toContain('1 request(s) failed contract validation.');
    expect(result).toContain('- POST /orders: body.total: must be a number');
    expect(result).toContain('- backend → agentic — large API surface');
    expect(result).toContain('«redacted»');
    expect(result).not.toContain('sk-abcdefghijkl');
    expect(result).toContain('(at 2026-07-01T00:00:00.000Z)');
    expect(result).toContain('0.4.0');
  });

  it('diagnostics: relativizes workspace and home paths out of all free text', () => {
    const workspaceRoot = '/work/acme';
    const diag: KnowledgeDiagnostics = {
      scanStrategies: [
        { surface: '/work/acme/src/api', strategy: 'agentic', reason: 'models under /work/acme/src/models' },
      ],
      lastError: { message: 'Error: ENOENT /work/acme/clients/internal/api.ts\n at scan' },
      workspaceRoot,
    };
    const servers = makeServers();
    const state: ServerRuntimeState = {
      id: 'srv-pets',
      status: 'error',
      port: 4000,
      error: 'listen failed at /work/acme/server.js',
      requestCount: 0,
    };
    const result = formatDiagnosticsKnowledge(servers, () => state, [], diag);
    expect(result).not.toContain('/work/acme');
    expect(result).toContain('./src/api');
    expect(result).toContain('./src/models');
    expect(result).toContain('ENOENT ./clients/internal/api.ts');
    expect(result).toContain('is in error state: listen failed at ./server.js');
  });

  it('diagnostics: reports error-state servers with their message', async () => {
    const servers = makeServers();
    const state: ServerRuntimeState = {
      id: 'srv-pets',
      status: 'error',
      port: 4000,
      error: 'EADDRINUSE: port taken',
      requestCount: 0,
    };
    const result = formatDiagnosticsKnowledge(servers, () => state, [], undefined);
    expect(result).toContain('- "petstore api" is in error state: EADDRINUSE: port taken');
    expect(result).toContain('no violations.');
    expect(result).toContain('(not recorded this session)');
  });
});

// ---------------------------------------------------------------------------
// Graceful degradation
// ---------------------------------------------------------------------------

describe('query_knowledge degradation', () => {
  it('scan-memory without loadScanMemory renders the availability note', async () => {
    const host = makeHost();
    delete host.loadScanMemory;
    const result = await ask(host, { topic: 'scan-memory' });
    expect(result).toBe('Scan memory is unavailable in this session (no workspace folder is open).');
  });

  it('scan-memory resolving null renders the not-recorded note', async () => {
    const result = await ask(makeHost({ loadScanMemory: async () => null }), {
      topic: 'scan-memory',
    });
    expect(result).toContain('No scan memory recorded yet');
  });

  it('scan-memory rejecting renders the not-recorded note instead of throwing', async () => {
    const result = await ask(
      makeHost({
        loadScanMemory: async () => {
          throw new Error('fs exploded');
        },
      }),
      { topic: 'scan-memory' }
    );
    expect(result).toContain('No scan memory recorded yet');
  });

  it('specs without readSpecText renders the availability note per server', async () => {
    const host = makeHost();
    delete host.readSpecText;
    const result = await ask(host, { topic: 'specs' });
    expect(result).toContain('Server "orders": contract spec openapi.json (mode warn)');
    expect(result).toContain('Spec file contents are unavailable in this session.');
  });

  it('specs with readSpecText resolving null renders the unreadable note', async () => {
    const result = await ask(makeHost({ readSpecText: async () => null }), { topic: 'specs' });
    expect(result).toContain('Could not read the spec file (missing, too large, or outside the workspace).');
  });

  it('specs with unparseable text renders the parse-failure note, not a throw', async () => {
    const result = await ask(makeHost({ readSpecText: async () => '[' }), { topic: 'specs' });
    expect(result).toContain('Spec could not be parsed:');
  });

  it('specs with no contract-bound server renders the pointer note', async () => {
    const result = await formatSpecsKnowledge(
      [{ ...makeServers()[0] }],
      async () => TINY_OPENAPI,
      '',
      25
    );
    expect(result).toContain('No API specs are bound to servers');
    expect(result).toContain("scan-memory");
  });

  it('diagnostics without getDiagnostics renders not-recorded sections, no throw', async () => {
    const host = makeHost();
    delete host.getDiagnostics;
    const result = await ask(host, { topic: 'diagnostics' });
    expect(result).toContain('Last codebase scan:\n(not recorded this session)');
    expect(result).toContain('Last error:\n(not recorded this session)');
    expect(result).toContain('Extension:\n(not recorded this session)');
  });

  it('routes with no servers configured', async () => {
    const result = await ask(makeHost({ getServers: async () => [] }), { topic: 'routes' });
    expect(result).toBe('No mock servers configured.');
  });

  it('request-logs with no entries', async () => {
    const result = await ask(makeHost({ getLogEntries: () => [] }), { topic: 'request-logs' });
    expect(result).toBe('No request logs recorded yet — start a server and send it traffic.');
  });
});

// ---------------------------------------------------------------------------
// Input hardening
// ---------------------------------------------------------------------------

describe('query_knowledge input hardening', () => {
  it('rejects an unknown topic with the topic list', async () => {
    const result = await ask(makeHost(), { topic: 'secrets' });
    expect(result).toBe(`topic must be one of: ${KNOWLEDGE_TOPICS.join(', ')}.`);
  });

  it('rejects a missing topic', async () => {
    const result = await ask(makeHost(), {});
    expect(result).toBe(`topic must be one of: ${KNOWLEDGE_TOPICS.join(', ')}.`);
  });

  it('coerces a string limit', async () => {
    const seen: (number | undefined)[] = [];
    const host = makeHost({
      getLogEntries: (_serverId, limit) => {
        seen.push(limit);
        return [];
      },
    });
    await ask(host, { topic: 'request-logs', limit: '3' });
    expect(seen).toEqual([3]);
  });

  it('clamps an oversized limit to KNOWLEDGE_MAX_LIMIT', async () => {
    const seen: (number | undefined)[] = [];
    const host = makeHost({
      getLogEntries: (_serverId, limit) => {
        seen.push(limit);
        return [];
      },
    });
    await ask(host, { topic: 'request-logs', limit: 10_000 });
    expect(seen).toEqual([KNOWLEDGE_MAX_LIMIT]);
  });

  it('returns not-found for an unresolvable server reference', async () => {
    const result = await ask(makeHost(), { topic: 'routes', server: 'no-such-server' });
    expect(result).toBe('Server "no-such-server" not found — omit server to search everything.');
  });

  it('scopes request-logs to the resolved server', async () => {
    const result = await ask(makeHost(), { topic: 'request-logs', server: 'orders' });
    expect(result).toContain('POST /orders');
    expect(result).not.toContain('/users');
  });

  it('query filters route lines down to the match', async () => {
    const result = await ask(makeHost(), { topic: 'routes', query: 'proxy' });
    expect(result).toContain('POST /proxy');
    expect(result).not.toContain('GET /users');
    expect(result).not.toContain('"orders"'); // server with zero matches is omitted
  });

  it('query with zero route matches returns the no-match message', async () => {
    const result = await ask(makeHost(), { topic: 'routes', query: 'zzz-nothing' });
    expect(result).toBe('No routes match "zzz-nothing".');
  });

  it('query with zero log matches returns the no-match message', async () => {
    const result = await ask(makeHost(), { topic: 'request-logs', query: 'zzz-nothing' });
    expect(result).toBe('No log entries match "zzz-nothing".');
  });

  it('request-logs with a query fetches unbounded so matches older than `limit` are found', async () => {
    const seenLimits: (number | undefined)[] = [];
    // Newest first: 25 health probes, then 3 older payments requests — a
    // limit-first fetch would only ever see the health probes.
    const entries = [
      ...Array.from({ length: 25 }, () => makeLogEntry({ path: '/health' })),
      ...Array.from({ length: 3 }, () => makeLogEntry({ method: 'POST', path: '/api/payments' })),
    ];
    const host = makeHost({
      getLogEntries: (_serverId, limit) => {
        seenLimits.push(limit);
        return limit === undefined ? entries : entries.slice(0, limit);
      },
    });
    const result = await ask(host, { topic: 'request-logs', query: 'payments' });
    expect(seenLimits).toEqual([undefined]);
    expect(result).toContain('3 log entries');
    expect(result).toContain('POST /api/payments');
  });

  it('request-logs without a query still fetches with the limit', async () => {
    const seenLimits: (number | undefined)[] = [];
    const host = makeHost({
      getLogEntries: (_serverId, limit) => {
        seenLimits.push(limit);
        return [];
      },
    });
    await ask(host, { topic: 'request-logs' });
    expect(seenLimits).toEqual([25]);
  });

  it('specs scoped to a contract-less server names the servers that DO have specs', async () => {
    const result = await ask(makeHost(), { topic: 'specs', server: 'petstore api' });
    expect(result).toContain('Server "petstore api" has no contract config');
    expect(result).toContain('1 other server(s) do have bound specs');
    expect(result).not.toContain('No API specs are bound to servers');
  });

  it('unknown tool name returns the unknown-tool string', async () => {
    const result = await createKnowledgeTool(makeHost()).execute({
      name: 'query_secrets',
      input: {},
    });
    expect(result).toBe('Unknown tool "query_secrets". Available tools: query_knowledge.');
  });

  it('a throwing required host method resolves an error string, never throws', async () => {
    const host = makeHost({
      getServers: async () => {
        throw new Error('manager exploded');
      },
    });
    const result = await ask(host, { topic: 'routes' });
    expect(result).toBe('Tool "query_knowledge" failed: manager exploded');
  });
});

// ---------------------------------------------------------------------------
// Clamping
// ---------------------------------------------------------------------------

describe('query_knowledge clamping', () => {
  it('caps total output at KNOWLEDGE_OUTPUT_MAX_CHARS with the truncation note', async () => {
    const bigServer: MockServerConfig = {
      id: 'srv-big',
      name: 'big',
      port: 5000,
      protocol: 'http',
      enabled: true,
      routes: Array.from({ length: 300 }, (_, i) =>
        makeRoute({
          id: `route-big-${i}`,
          name: `route ${i}`,
          path: `/very/long/path/segment/number/${i}/${'x'.repeat(150)}`,
        })
      ),
    };
    const result = await ask(makeHost({ getServers: async () => [bigServer] }), {
      topic: 'routes',
      limit: 10_000,
    });
    expect(result.length).toBeLessThanOrEqual(KNOWLEDGE_OUTPUT_MAX_CHARS);
    expect(result.endsWith('…output truncated.')).toBe(true);
  });

  it('notes omitted routes when the limit applies first', async () => {
    const result = await ask(makeHost(), { topic: 'routes', limit: 1 });
    expect(result).toContain('- GET /users → 200');
    expect(result).toContain('more route(s) omitted — raise limit or add a query filter.');
  });

  it('clamps each route line to KNOWLEDGE_LINE_MAX_CHARS', () => {
    const server: MockServerConfig = {
      id: 'srv-long',
      name: 'long',
      port: 5001,
      protocol: 'http',
      enabled: true,
      routes: [makeRoute({ id: 'route-long', path: `/${'a'.repeat(1000)}` })],
    };
    const result = formatRoutesKnowledge([server], () => 'stopped', '', 25);
    for (const line of result.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(KNOWLEDGE_LINE_MAX_CHARS + 1); // +1 for the ellipsis
    }
  });

  it('clampKnowledgeOutput leaves short text untouched', () => {
    expect(clampKnowledgeOutput('short')).toBe('short');
  });
});

// ---------------------------------------------------------------------------
// Pure renderers
// ---------------------------------------------------------------------------

describe('listSpecEndpoints', () => {
  it('enumerates method/path/summary and skips non-object items', () => {
    const endpoints = listSpecEndpoints({
      paths: {
        '/users': { get: { summary: 'List users' }, post: {}, 'x-extension': {} },
        '/bad': 'not an object',
        '/also-bad': { get: ['not', 'an', 'operation'] },
        '/pets': { delete: { summary: '   ' } },
      },
    });
    expect(endpoints).toEqual([
      { method: 'GET', path: '/users', summary: 'List users' },
      { method: 'POST', path: '/users' },
      { method: 'DELETE', path: '/pets' },
    ]);
  });

  it('returns no endpoints without a paths object', () => {
    expect(listSpecEndpoints({})).toEqual([]);
    expect(listSpecEndpoints({ paths: 'nope' })).toEqual([]);
  });

  it('caps at KNOWLEDGE_SPEC_ENDPOINTS_MAX endpoints', () => {
    const paths: Record<string, unknown> = {};
    for (let i = 0; i < 150; i++) {
      paths[`/p${i}`] = { get: {} };
    }
    expect(listSpecEndpoints({ paths })).toHaveLength(KNOWLEDGE_SPEC_ENDPOINTS_MAX);
  });
});

describe('formatScanMemoryKnowledge query filter', () => {
  it('keeps the header plus only matching lines', () => {
    const result = formatScanMemoryKnowledge(makeScanMemory(), 'spec files');
    expect(result.startsWith('Previous scans learned:')).toBe(true);
    expect(result).toContain('- Note: API spec files present: openapi.json');
    expect(result).not.toContain('petstore');
  });

  it('returns the no-match message for a query with zero survivors', () => {
    expect(formatScanMemoryKnowledge(makeScanMemory(), 'zzz-nothing')).toBe(
      'Scan memory has no entries matching "zzz-nothing".'
    );
  });
});

describe('formatRequestLogsKnowledge', () => {
  it('uses singular grammar for one entry', () => {
    const result = formatRequestLogsKnowledge([makeLogEntry({})], '', 25);
    expect(result).toContain('1 log entry, newest first.');
  });
});
