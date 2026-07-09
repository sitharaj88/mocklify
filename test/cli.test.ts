import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as http from 'node:http';
import * as net from 'node:net';
import { randomUUID } from 'node:crypto';
import { parseCliArgs } from '../src/cli/args.js';
import {
  resolveConfigFile,
  loadConfig,
  selectServers,
  ConfigFileError,
  DEFAULT_CONFIG_PATH,
} from '../src/cli/loadConfig.js';
import { startSelectedServers, PortInUseError, ServeIO } from '../src/cli/serve.js';
import { MockServerConfig, RouteConfig } from '../src/types/core.js';

// ---------------------------------------------------------------------------
// argv parsing
// ---------------------------------------------------------------------------

describe('parseCliArgs', () => {
  const cases: Array<[string, string[], Partial<ReturnType<typeof parseCliArgs>>]> = [
    ['no args -> help', [], { command: 'help', errors: [] }],
    ['--help wins', ['serve', '--help'], { command: 'help' }],
    ['--version', ['--version'], { command: 'version' }],
    ['serve default', ['serve'], { command: 'serve', all: false }],
    ['serve with path', ['serve', 'cfg'], { command: 'serve', configPath: 'cfg' }],
    ['validate', ['validate', '.mocklify'], { command: 'validate', configPath: '.mocklify' }],
    ['list', ['list'], { command: 'list' }],
    ['flags', ['serve', '--all', '--watch', '--quiet'], { all: true, watch: true, quiet: true }],
    ['short flags', ['serve', '-w', '-q'], { watch: true, quiet: true }],
    ['server select', ['serve', '--server', 'api'], { server: 'api' }],
    ['port ok', ['serve', '--port', '4000'], { port: 4000 }],
  ];

  for (const [name, argv, expected] of cases) {
    it(name, () => {
      expect(parseCliArgs(argv)).toMatchObject(expected);
    });
  }

  it('rejects an out-of-range port', () => {
    const parsed = parseCliArgs(['serve', '--port', '99999']);
    expect(parsed.port).toBeUndefined();
    expect(parsed.errors[0]).toMatch(/Invalid --port/);
  });

  it('rejects a non-numeric port', () => {
    expect(parseCliArgs(['serve', '--port', 'abc']).errors[0]).toMatch(/Invalid --port/);
  });

  it('rejects an unknown command', () => {
    expect(parseCliArgs(['frobnicate']).errors[0]).toMatch(/Unknown command/);
  });

  it('rejects an unknown flag', () => {
    expect(parseCliArgs(['serve', '--nope']).errors.length).toBeGreaterThan(0);
  });

  it('flags extra positionals', () => {
    expect(parseCliArgs(['serve', 'a', 'b']).errors[0]).toMatch(/extra/i);
  });
});

// ---------------------------------------------------------------------------
// config path resolution
// ---------------------------------------------------------------------------

describe('resolveConfigFile', () => {
  it('defaults to .mocklify/servers.json under cwd', () => {
    expect(resolveConfigFile(undefined, '/work')).toBe(
      path.join('/work', DEFAULT_CONFIG_PATH, 'servers.json')
    );
  });

  it('treats a directory arg as the config dir', () => {
    expect(resolveConfigFile('conf', '/work')).toBe(path.join('/work', 'conf', 'servers.json'));
  });

  it('uses a *.json arg verbatim', () => {
    expect(resolveConfigFile('custom.json', '/work')).toBe(path.join('/work', 'custom.json'));
  });

  it('honours an absolute path', () => {
    expect(resolveConfigFile('/abs/servers.json', '/work')).toBe('/abs/servers.json');
  });
});

// ---------------------------------------------------------------------------
// config loading / validation
// ---------------------------------------------------------------------------

function makeRoute(): RouteConfig {
  return {
    id: randomUUID(),
    name: 'hello',
    enabled: true,
    method: 'GET',
    path: '/hello',
    response: {
      type: 'static',
      statusCode: 200,
      body: { contentType: 'application/json', content: { message: 'hi' } },
    },
  };
}

function makeServer(overrides: Partial<MockServerConfig> = {}): MockServerConfig {
  return {
    id: randomUUID(),
    name: 'api',
    port: 3000,
    protocol: 'http',
    enabled: true,
    routes: [makeRoute()],
    ...overrides,
  };
}

const tmpDirs: string[] = [];
function writeConfig(data: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mocklify-cli-'));
  tmpDirs.push(dir);
  const file = path.join(dir, 'servers.json');
  fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data));
  return file;
}

afterEach(() => {
  while (tmpDirs.length) {
    fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
  }
});

describe('loadConfig', () => {
  it('loads a valid { servers: [...] } file', () => {
    const file = writeConfig({ version: '1.0', servers: [makeServer()] });
    const result = loadConfig(file);
    expect(result.servers).toHaveLength(1);
    expect(result.invalid).toHaveLength(0);
  });

  it('loads a bare top-level array', () => {
    const file = writeConfig([makeServer(), makeServer({ name: 'b', port: 3001 })]);
    expect(loadConfig(file).servers).toHaveLength(2);
  });

  it('collects per-server schema violations with paths', () => {
    const bad = { ...makeServer(), port: 70000 };
    const file = writeConfig({ servers: [makeServer(), bad] });
    const result = loadConfig(file);
    expect(result.servers).toHaveLength(1);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0].issues.some((i) => i.path === 'port')).toBe(true);
  });

  it('throws ConfigFileError when the file is missing', () => {
    expect(() => loadConfig('/nope/servers.json')).toThrow(ConfigFileError);
  });

  it('throws ConfigFileError on invalid JSON', () => {
    const file = writeConfig('{ not json');
    expect(() => loadConfig(file)).toThrow(ConfigFileError);
  });

  it('throws ConfigFileError on a shape with no servers array', () => {
    const file = writeConfig({ foo: 'bar' });
    expect(() => loadConfig(file)).toThrow(ConfigFileError);
  });

  it('accepts new additive fields (chaos) round-tripping through the schema', () => {
    const withChaos = makeServer({ chaos: { enabled: true, failureRate: 0.5 } });
    const file = writeConfig({ servers: [withChaos] });
    const result = loadConfig(file);
    expect(result.invalid).toHaveLength(0);
    expect(result.servers[0].chaos?.enabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// server selection
// ---------------------------------------------------------------------------

describe('selectServers', () => {
  it('errors when there are no servers', () => {
    expect(selectServers([], {}).error).toMatch(/No servers/);
  });

  it('uses the lone server with no flags', () => {
    const s = makeServer();
    expect(selectServers([s], {}).selected).toEqual([s]);
  });

  it('requires a flag when multiple servers exist', () => {
    const res = selectServers([makeServer(), makeServer({ name: 'b' })], {});
    expect(res.selected).toHaveLength(0);
    expect(res.error).toMatch(/--server|--all/);
  });

  it('--all takes everything', () => {
    const list = [makeServer(), makeServer({ name: 'b' })];
    expect(selectServers(list, { all: true }).selected).toHaveLength(2);
  });

  it('selects by name', () => {
    const a = makeServer({ name: 'a' });
    const b = makeServer({ name: 'b' });
    expect(selectServers([a, b], { server: 'b' }).selected).toEqual([b]);
  });

  it('selects by id', () => {
    const a = makeServer({ name: 'a' });
    const b = makeServer({ name: 'b' });
    expect(selectServers([a, b], { server: b.id }).selected).toEqual([b]);
  });

  it('errors when the named server is missing', () => {
    expect(selectServers([makeServer()], { server: 'ghost' }).error).toMatch(/No server matches/);
  });

  it('--all skips disabled servers, mirroring the extension', () => {
    const on = makeServer({ name: 'on' });
    const off = makeServer({ name: 'off', enabled: false });
    const res = selectServers([on, off], { all: true });
    expect(res.selected).toEqual([on]);
  });

  it('does not auto-start a lone disabled server', () => {
    const res = selectServers([makeServer({ enabled: false })], {});
    expect(res.selected).toEqual([]);
    expect(res.error).toMatch(/disabled/);
  });

  it('an explicit --server can still start a disabled server', () => {
    const off = makeServer({ name: 'off', enabled: false });
    expect(selectServers([off], { server: 'off' }).selected).toEqual([off]);
  });
});

// ---------------------------------------------------------------------------
// integration: boot a real server, hit it, shut down
// ---------------------------------------------------------------------------

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

function get(port: number, urlPath: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: urlPath, method: 'GET' },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function request(
  port: number,
  method: string,
  urlPath: string,
  body?: unknown
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: urlPath,
        method,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : {},
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const silentIo: ServeIO = { log: () => {}, error: () => {} };

describe('startSelectedServers (integration)', () => {
  it('serves a mocked route over real HTTP', async () => {
    const port = await freePort();
    const config = makeServer({ port });
    const started = await startSelectedServers([config], { quiet: true }, silentIo);
    try {
      const res = await get(port, '/hello');
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ message: 'hi' });
    } finally {
      await started.stop();
    }
  });

  it('honours a --port override for a single server', async () => {
    const port = await freePort();
    const config = makeServer({ port: 1 }); // would be invalid to bind; override wins
    const started = await startSelectedServers([config], { port, quiet: true }, silentIo);
    try {
      expect((await get(port, '/hello')).status).toBe(200);
    } finally {
      await started.stop();
    }
  });

  it('runs stateful CRUD identically to the extension', async () => {
    const port = await freePort();
    const collection = 'items';
    const listId = randomUUID();
    const detailId = randomUUID();
    const createId = randomUUID();
    const routes: RouteConfig[] = [
      {
        id: listId,
        name: 'list',
        enabled: true,
        method: 'GET',
        path: '/items',
        stateful: { collection, seed: [{ id: '1', label: 'seed' }] },
        response: {
          type: 'static',
          statusCode: 200,
          body: { contentType: 'application/json', content: [] },
        },
      },
      {
        id: createId,
        name: 'create',
        enabled: true,
        method: 'POST',
        path: '/items',
        stateful: { collection },
        response: {
          type: 'static',
          statusCode: 201,
          body: { contentType: 'application/json', content: {} },
        },
      },
      {
        id: detailId,
        name: 'detail',
        enabled: true,
        method: 'GET',
        path: '/items/:id',
        stateful: { collection },
        response: {
          type: 'static',
          statusCode: 200,
          body: { contentType: 'application/json', content: {} },
        },
      },
    ];
    const config = makeServer({ port, routes });
    const started = await startSelectedServers([config], { quiet: true }, silentIo);
    try {
      const list = await request(port, 'GET', '/items');
      expect(JSON.parse(list.body)).toEqual([{ id: '1', label: 'seed' }]);

      const created = await request(port, 'POST', '/items', { id: '2', label: 'new' });
      expect(created.status).toBe(201);

      const after = await request(port, 'GET', '/items');
      expect(JSON.parse(after.body)).toHaveLength(2);
    } finally {
      await started.stop();
    }
  });

  it('always fails a chaos route with failureRate 1', async () => {
    const port = await freePort();
    const config = makeServer({ port, chaos: { enabled: true, failureRate: 1 } });
    const started = await startSelectedServers([config], { quiet: true }, silentIo);
    try {
      const res = await get(port, '/hello');
      expect(res.status).toBe(503);
      expect(JSON.parse(res.body).chaos).toBe(true);
    } finally {
      await started.stop();
    }
  });

  it('throws PortInUseError when the port is taken', async () => {
    const port = await freePort();
    const blocker = net.createServer();
    await new Promise<void>((resolve) => blocker.listen(port, '0.0.0.0', resolve));
    try {
      await expect(
        startSelectedServers([makeServer({ port })], { quiet: true }, silentIo)
      ).rejects.toBeInstanceOf(PortInUseError);
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });

  it('streams a request log line when not quiet', async () => {
    const port = await freePort();
    const lines: string[] = [];
    const io: ServeIO = { log: (l) => lines.push(l), error: () => {} };
    const started = await startSelectedServers([makeServer({ port })], { quiet: false }, io);
    try {
      await get(port, '/hello');
      // allow the event to flush
      await new Promise((r) => setTimeout(r, 20));
      expect(lines.some((l) => l.includes('GET') && l.includes('/hello') && l.includes('200'))).toBe(
        true
      );
    } finally {
      await started.stop();
    }
  });
});
