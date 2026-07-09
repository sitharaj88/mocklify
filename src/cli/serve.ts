import { IMockServer, MockServerConfig, RequestLogEntry } from '../types/core.js';
import { HttpMockServer } from '../servers/HttpMockServer.js';
import { GraphQLMockServer } from '../servers/GraphQLMockServer.js';
import { createRequestValidator } from '../services/ContractValidator.js';

export interface ServeIO {
  log: (line: string) => void;
  error: (line: string) => void;
}

export interface RunningServer {
  config: MockServerConfig;
  instance: IMockServer;
}

export interface StartedServers {
  running: RunningServer[];
  stop: () => Promise<void>;
}

/**
 * Raised when a server's port is already taken. The CLI maps this to exit
 * code 2 and names the port + the flag to change it.
 */
export class PortInUseError extends Error {
  constructor(public readonly port: number) {
    super(`Port ${port} is already in use. Free it or pass --port <number>.`);
    this.name = 'PortInUseError';
  }
}

/**
 * WebSocket mocking is only available in the VS Code extension — the CLI
 * boundary (contract §5) does not import WebSocketMockServer. HTTP contract
 * validation IS wired here (spec paths resolve against `workspaceRoot`, the
 * config file's directory) so `contract: { mode: 'enforce' }` behaves the same
 * as in the extension; createRequestValidator degrades to undefined (mode off)
 * if the spec is missing/unparseable.
 */
function createInstance(
  config: MockServerConfig,
  io: ServeIO,
  workspaceRoot?: string
): IMockServer | undefined {
  switch (config.protocol) {
    case 'graphql':
      return new GraphQLMockServer(config);
    case 'websocket':
      io.error(`Skipping "${config.name}": WebSocket servers are only supported in the extension.`);
      return undefined;
    case 'http':
    default: {
      const validator = config.contract
        ? createRequestValidator(config.contract, { workspaceRoot })
        : undefined;
      return new HttpMockServer(config, validator);
    }
  }
}

function logRequestLine(io: ServeIO, label: string | undefined, entry: RequestLogEntry): void {
  const prefix = label ? `[${label}] ` : '';
  const method = entry.request.method.padEnd(6);
  const status = entry.response.statusCode;
  const ms = entry.response.duration;
  io.log(`${prefix}${method} ${entry.request.path} ${status} ${ms}ms`);
}

/**
 * Instantiate and start each selected server. `port` overrides the port and is
 * only honoured when a single server is selected (the CLI validates that
 * upstream). Per-request lines stream through `io.log` unless `quiet`. On
 * EADDRINUSE, already-started servers are stopped and PortInUseError is thrown.
 */
export async function startSelectedServers(
  configs: MockServerConfig[],
  opts: { port?: number; quiet?: boolean; workspaceRoot?: string },
  io: ServeIO
): Promise<StartedServers> {
  const multi = configs.length > 1;
  const running: RunningServer[] = [];

  const stop = async (): Promise<void> => {
    await Promise.all(
      running.map(async (r) => {
        try {
          await r.instance.stop();
        } catch {
          /* best-effort shutdown */
        }
      })
    );
  };

  for (const original of configs) {
    const config =
      opts.port !== undefined && configs.length === 1
        ? { ...original, port: opts.port }
        : original;

    const instance = createInstance(config, io, opts.workspaceRoot);
    if (!instance) {
      continue;
    }

    if (!opts.quiet) {
      const label = multi ? config.name : undefined;
      instance.onEvent((event) => {
        if (event.type === 'request:received') {
          logRequestLine(io, label, event.entry);
        }
      });
    }

    try {
      await instance.start();
    } catch (error) {
      await stop();
      if (isAddressInUse(error)) {
        throw new PortInUseError(config.port);
      }
      throw error;
    }

    running.push({ config, instance });
  }

  return { running, stop };
}

function isAddressInUse(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'EADDRINUSE'
  );
}

/** Render the "what's listening" table printed once after startup. */
export function formatServerTable(running: RunningServer[]): string {
  const rows = running.map((r) => ({
    name: r.config.name,
    protocol: r.config.protocol,
    port: String(r.config.port),
    routes: String(r.config.routes.length),
    // Servers bind 0.0.0.0 (see HttpMockServer.start); localhost is how you
    // reach them locally, but they are NOT loopback-only — see the network
    // warning printed alongside this table.
    url: `http://localhost:${r.config.port}`,
  }));

  const headers = { name: 'NAME', protocol: 'PROTOCOL', port: 'PORT', routes: 'ROUTES', url: 'URL' };
  const cols: (keyof typeof headers)[] = ['name', 'protocol', 'port', 'routes', 'url'];
  const width = (c: keyof typeof headers) =>
    Math.max(headers[c].length, ...rows.map((row) => row[c].length));
  const widths = Object.fromEntries(cols.map((c) => [c, width(c)])) as Record<
    keyof typeof headers,
    number
  >;

  const line = (cells: Record<keyof typeof headers, string>) =>
    cols.map((c) => cells[c].padEnd(widths[c])).join('  ').trimEnd();

  return [line(headers), ...rows.map((row) => line(row))].join('\n');
}
