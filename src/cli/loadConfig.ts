import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { MockServerConfig, MockServerConfigSchema } from '../types/core.js';

export const DEFAULT_CONFIG_PATH = '.mocklify';
export const SERVERS_FILE = 'servers.json';

/**
 * Thrown when the config file cannot be read or is not valid JSON — a
 * whole-file failure distinct from per-server schema violations, which are
 * collected into ConfigValidationError.errors instead.
 */
export class ConfigFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigFileError';
  }
}

export interface ServerIssue {
  /** Zod path joined with dots, e.g. "routes.0.method". Empty at the root. */
  path: string;
  message: string;
}

export interface InvalidServer {
  index: number;
  id?: string;
  name?: string;
  issues: ServerIssue[];
}

export interface LoadConfigResult {
  filePath: string;
  servers: MockServerConfig[];
  invalid: InvalidServer[];
}

/**
 * Resolve the servers.json file from a CLI positional arg. A `*.json` arg is
 * used verbatim; anything else is treated as the config directory and
 * servers.json is appended. Relative paths resolve against `cwd` (the CLI does
 * not read vscode settings — mirrors ConfigurationStore's default of ".mocklify").
 */
export function resolveConfigFile(configPathArg: string | undefined, cwd: string): string {
  const target = configPathArg ?? DEFAULT_CONFIG_PATH;
  const abs = path.isAbsolute(target) ? target : path.resolve(cwd, target);
  if (abs.toLowerCase().endsWith('.json')) {
    return abs;
  }
  return path.join(abs, SERVERS_FILE);
}

function toIssues(error: z.ZodError): ServerIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

/**
 * Read and validate the config file. Reads synchronously (runs in a short-lived
 * CLI process, never at module top level). Throws ConfigFileError for
 * missing-file / bad-JSON; individual invalid servers are returned in `invalid`
 * — same MockServerConfigSchema the extension uses, so configs are interchangeable.
 */
export function loadConfig(filePath: string): LoadConfigResult {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    throw new ConfigFileError(`Config file not found: ${filePath}`);
  }

  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ConfigFileError(`Invalid JSON in ${filePath}: ${detail}`);
  }

  const rawServers = extractServerArray(data);
  if (rawServers === undefined) {
    throw new ConfigFileError(
      `Malformed config in ${filePath}: expected a "servers" array or a top-level array.`
    );
  }

  const servers: MockServerConfig[] = [];
  const invalid: InvalidServer[] = [];

  rawServers.forEach((entry, index) => {
    const parsed = MockServerConfigSchema.safeParse(entry);
    if (parsed.success) {
      servers.push(parsed.data);
    } else {
      const record = (entry ?? {}) as Record<string, unknown>;
      invalid.push({
        index,
        id: typeof record.id === 'string' ? record.id : undefined,
        name: typeof record.name === 'string' ? record.name : undefined,
        issues: toIssues(parsed.error),
      });
    }
  });

  return { filePath, servers, invalid };
}

function extractServerArray(data: unknown): unknown[] | undefined {
  if (Array.isArray(data)) {
    return data;
  }
  if (data && typeof data === 'object' && Array.isArray((data as { servers?: unknown }).servers)) {
    return (data as { servers: unknown[] }).servers;
  }
  return undefined;
}

export interface SelectResult {
  selected: MockServerConfig[];
  error?: string;
}

/**
 * Pick which servers to start. `--server` matches by id or exact name;
 * `--all` takes everything; with neither, a lone server is used, but an
 * ambiguous multi-server config is a hard error so CI never silently starts
 * the wrong one.
 */
export function selectServers(
  servers: MockServerConfig[],
  opts: { server?: string; all?: boolean }
): SelectResult {
  if (servers.length === 0) {
    return { selected: [], error: 'No servers found in the config.' };
  }

  // An explicit --server may start a disabled server (opt-in); the --all and
  // lone-server paths only start enabled servers, mirroring the extension's
  // MockServerManager.startAll (which filters `configs.filter(c => c.enabled)`).
  if (opts.server !== undefined) {
    const match = servers.filter((s) => s.id === opts.server || s.name === opts.server);
    if (match.length === 0) {
      const available = servers.map((s) => `"${s.name}"`).join(', ');
      return { selected: [], error: `No server matches "${opts.server}". Available: ${available}.` };
    }
    return { selected: match };
  }

  const enabled = servers.filter((s) => s.enabled !== false);

  if (opts.all) {
    if (enabled.length === 0) {
      return { selected: [], error: 'All servers are disabled; enable one or pass --server <name|id>.' };
    }
    return { selected: enabled };
  }

  if (servers.length === 1) {
    if (enabled.length === 0) {
      return {
        selected: [],
        error: `Server "${servers[0].name}" is disabled; pass --server ${servers[0].name} to start it anyway.`,
      };
    }
    return { selected: enabled };
  }

  const available = servers.map((s) => `"${s.name}"`).join(', ');
  return {
    selected: [],
    error: `Config has ${servers.length} servers (${available}); pass --server <name|id> or --all.`,
  };
}
