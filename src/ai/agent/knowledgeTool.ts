import type { MockServerConfig, RequestLogEntry, ServerRuntimeState } from '../../types/core.js';
import type { AiToolDefinition, AiToolExecutor } from '../providers/types.js';
import { clampLine, resolveServerRef, routeConfirmLine } from './serverTools.js';
import { describeScanMemory, createScanMemoryStore, type ScanMemory } from '../scan/scanMemory.js';
import { validateWorkspacePath } from './workspaceTools.js';
import { OpenApiImportService } from '../../services/OpenApiImportService.js';
import { redact, detectHome, getRecordedScanReport, getRecordedError } from '../../services/DiagnosticsService.js';

/**
 * query_knowledge — one read-only tool answering questions from what Mocklify
 * already knows: scan memory, request logs, contract-bound API specs, session
 * diagnostics, and routes. Read-only, so no confirmation gate is needed.
 *
 * Pure at import time: ZERO vscode value imports at module scope. The only
 * vscode touches live inside createDefaultKnowledgeHost's optional member
 * bodies behind lazy require('vscode') (createScanMemoryStore /
 * createDefaultScanGraphDeps pattern), so the module is fully
 * vitest-importable.
 *
 * Trust rules (enforced here, not by the model): every input scalar is
 * clamped/coerced in code (the JSON schema deliberately carries no numeric or
 * length constraints), every rendered line is clampLine'd, the whole result is
 * bounded to KNOWLEDGE_OUTPUT_MAX_CHARS, raw spec text never enters the
 * transcript (only parsed endpoint lines do), scan memory is sanitized on
 * load, and diagnostics free text runs through redact().
 */

// ---- Constants ----

export const KNOWLEDGE_TOPICS = ['scan-memory', 'request-logs', 'specs', 'diagnostics', 'routes'] as const;
export type KnowledgeTopic = (typeof KNOWLEDGE_TOPICS)[number];
/** Every query_knowledge result is truncated to this many characters (< TOOL_OUTPUT_MAX_CHARS). */
export const KNOWLEDGE_OUTPUT_MAX_CHARS = 8_000;
export const KNOWLEDGE_DEFAULT_LIMIT = 25;
export const KNOWLEDGE_MAX_LIMIT = 100;
export const KNOWLEDGE_QUERY_MAX_CHARS = 200;
/** Per-item line clamp for rendered knowledge lines. */
export const KNOWLEDGE_LINE_MAX_CHARS = 200;
/** Spec files larger than this are not read (returns the unreadable note). */
export const KNOWLEDGE_SPEC_MAX_BYTES = 1_000_000;
/** Hard cap on endpoints listed per spec (limit further caps it). */
export const KNOWLEDGE_SPEC_ENDPOINTS_MAX = 100;
/** Log entries examined for the diagnostics contract-violation tally. */
export const KNOWLEDGE_DIAGNOSTICS_LOG_SAMPLE = 100;

// ---- Types ----

/** Session diagnostics snapshot (pure data; free text NOT yet redacted — the formatter redacts). */
export interface KnowledgeDiagnostics {
  extensionVersion?: string;
  scanStrategies?: { surface: string; strategy: string; reason: string }[];
  lastError?: { message: string; when?: string };
  /** Absolute workspace root — used ONLY to relativize paths out of redacted text. */
  workspaceRoot?: string;
}

/**
 * The slice of Mocklify the knowledge tool reads. MockServerManager satisfies
 * the three required members structurally (identical signatures to
 * ServerToolsHost's read methods). Optional members degrade gracefully: when
 * absent (or resolving null) the topic renders an availability note instead
 * of throwing.
 */
export interface KnowledgeHost {
  getServers(): Promise<MockServerConfig[]>;
  getServerState(serverId: string): ServerRuntimeState | undefined;
  getLogEntries(serverId?: string, limit?: number): RequestLogEntry[];
  /** Sanitized scan memory or null (absent file / no workspace). */
  loadScanMemory?: () => Promise<ScanMemory | null>;
  /** UTF-8 text of a server's contract spec file, or null when unreadable/too large/outside the workspace. */
  readSpecText?: (specPath: string) => Promise<string | null>;
  /** Session diagnostics snapshot. */
  getDiagnostics?: () => KnowledgeDiagnostics;
}

export interface KnowledgeTool {
  /** Exactly one definition: query_knowledge. */
  definitions: AiToolDefinition[];
  /** Resolves an error STRING (never throws) for anything model-caused. */
  execute: AiToolExecutor;
}

// ---- Tool definition (strict dialect; clamps live in code, not the schema) ----

const KNOWLEDGE_TOOL_DEFINITION: AiToolDefinition = {
  name: 'query_knowledge',
  description:
    'Answer questions from what Mocklify already knows — read-only, needs no approval. Topics: ' +
    '"scan-memory" (what previous codebase scans learned: API layer locations, model paths, conventions), ' +
    '"request-logs" (recent requests, failures, unmatched hits, contract violations), ' +
    '"specs" (API specs bound to servers via contract config and the endpoints they declare), ' +
    '"diagnostics" (server/route counts, runtime errors, contract-violation tally, last scan, last error), ' +
    '"routes" (every route across all mock servers). ' +
    'Optionally narrow with query (substring filter), server (id or name), and limit (default 25, max 100).',
  inputSchema: {
    type: 'object',
    properties: {
      topic: {
        type: 'string',
        enum: ['scan-memory', 'request-logs', 'specs', 'diagnostics', 'routes'],
        description: 'Which knowledge source to read.',
      },
      query: { type: 'string', description: 'Optional case-insensitive substring filter.' },
      server: { type: 'string', description: 'Optional server id or name to scope the answer.' },
      limit: { type: 'number', description: 'Max items to return (default 25, max 100).' },
    },
    required: ['topic'],
    additionalProperties: false,
  },
};

// ---- Factory ----

/** Create the read-only knowledge tool for one agent session. Pure — no vscode. */
export function createKnowledgeTool(host: KnowledgeHost): KnowledgeTool {
  const execute: AiToolExecutor = async (call) => {
    if (call.name !== 'query_knowledge') {
      return `Unknown tool "${call.name}". Available tools: query_knowledge.`;
    }
    try {
      const input = (call.input ?? {}) as Record<string, unknown>;

      const rawTopic = input.topic;
      if (typeof rawTopic !== 'string' || !(KNOWLEDGE_TOPICS as readonly string[]).includes(rawTopic)) {
        return `topic must be one of: ${KNOWLEDGE_TOPICS.join(', ')}.`;
      }
      const topic = rawTopic as KnowledgeTopic;

      const query =
        typeof input.query === 'string' ? clampLine(input.query, KNOWLEDGE_QUERY_MAX_CHARS) : '';
      const limit = clampKnowledgeLimit(input.limit);

      // The server scope only applies to topics that are per-server; it is
      // ignored for scan-memory/diagnostics.
      let serverFilter: MockServerConfig | undefined;
      const serverScoped = topic === 'routes' || topic === 'request-logs' || topic === 'specs';
      if (serverScoped && typeof input.server === 'string' && input.server !== '') {
        serverFilter = resolveServerRef(await host.getServers(), input.server);
        if (!serverFilter) {
          return `Server "${clampLine(String(input.server), 80)}" not found — omit server to search everything.`;
        }
      }

      let text: string;
      switch (topic) {
        case 'routes': {
          const servers = await host.getServers();
          const scoped =
            serverFilter !== undefined
              ? servers.filter((server) => server.id === serverFilter?.id)
              : servers;
          text = formatRoutesKnowledge(
            scoped,
            (id) => host.getServerState(id)?.status ?? 'stopped',
            query,
            limit
          );
          break;
        }
        case 'request-logs': {
          // With a query, fetch WITHOUT a limit (the logger's own retention
          // cap bounds the sample) so matches older than the newest `limit`
          // entries are still found — the formatter applies `limit` AFTER
          // filtering. Without a query the fetch itself can be limited.
          const entries = host.getLogEntries(serverFilter?.id, query === '' ? limit : undefined);
          text = formatRequestLogsKnowledge(entries, query, limit);
          break;
        }
        case 'specs': {
          const servers = await host.getServers();
          // When scoped to a server WITHOUT contract config, don't let the
          // formatter emit its global "no server has contract config" message
          // while other servers do have bound specs — that would be false.
          if (serverFilter !== undefined && serverFilter.contract === undefined) {
            const boundElsewhere = servers.filter(
              (server) => server.id !== serverFilter?.id && server.contract !== undefined
            ).length;
            if (boundElsewhere > 0) {
              text = `Server "${clampLine(serverFilter.name, 80)}" has no contract config (no API spec bound to it). ${boundElsewhere} other server(s) do have bound specs — omit server to see them.`;
              break;
            }
          }
          const scoped =
            serverFilter !== undefined
              ? servers.filter((server) => server.id === serverFilter?.id)
              : servers;
          text = await formatSpecsKnowledge(scoped, host.readSpecText, query, limit);
          break;
        }
        case 'scan-memory': {
          if (host.loadScanMemory === undefined) {
            text = 'Scan memory is unavailable in this session (no workspace folder is open).';
            break;
          }
          let mem: ScanMemory | null;
          try {
            mem = await host.loadScanMemory();
          } catch {
            mem = null;
          }
          text = formatScanMemoryKnowledge(mem, query);
          break;
        }
        case 'diagnostics': {
          const servers = await host.getServers();
          const recentLogs = host.getLogEntries(undefined, KNOWLEDGE_DIAGNOSTICS_LOG_SAMPLE);
          text = formatDiagnosticsKnowledge(
            servers,
            (id) => host.getServerState(id),
            recentLogs,
            host.getDiagnostics?.()
          );
          break;
        }
      }
      return clampKnowledgeOutput(text);
    } catch (error) {
      return `Tool "query_knowledge" failed: ${errorMessage(error)}`;
    }
  };

  return { definitions: [KNOWLEDGE_TOOL_DEFINITION], execute };
}

/** Bound one result to KNOWLEDGE_OUTPUT_MAX_CHARS, noting the truncation. */
export function clampKnowledgeOutput(text: string): string {
  if (text.length <= KNOWLEDGE_OUTPUT_MAX_CHARS) {
    return text;
  }
  const note = '\n…output truncated.';
  return `${text.slice(0, KNOWLEDGE_OUTPUT_MAX_CHARS - note.length)}${note}`;
}

// ---- Topic renderers (pure, exported for tests) ----

/**
 * Render the routes topic: one header per server plus one clamped line per
 * route. The caller applies any server filter BEFORE invoking (pass the
 * filtered array); query filters route lines, limit caps TOTAL route lines
 * across all servers.
 */
export function formatRoutesKnowledge(
  servers: MockServerConfig[],
  statusOf: (serverId: string) => string,
  query: string,
  limit: number
): string {
  if (servers.length === 0) {
    return 'No mock servers configured.';
  }
  const lowered = query.toLowerCase();
  const lines: string[] = [];
  let printed = 0;
  let omitted = 0;
  let anyMatch = false;

  for (const server of servers) {
    const routeLines: string[] = [];
    for (const route of server.routes) {
      const line = `- ${routeConfirmLine(route)}${route.enabled ? '' : ' (disabled)'}`;
      if (lowered !== '') {
        const haystack = `${line} ${route.name} ${(route.tags ?? []).join(' ')}`.toLowerCase();
        if (!haystack.includes(lowered)) {
          continue;
        }
      }
      routeLines.push(clampLine(line, KNOWLEDGE_LINE_MAX_CHARS));
    }
    if (lowered !== '' && routeLines.length === 0) {
      continue; // with a query, print only servers with matches
    }
    anyMatch = anyMatch || routeLines.length > 0;
    lines.push(
      clampLine(
        `"${server.name}" (id ${server.id}, ${server.protocol}, port ${server.port}, ${statusOf(server.id)}) — ${server.routes.length} route(s)`,
        KNOWLEDGE_LINE_MAX_CHARS
      )
    );
    for (const routeLine of routeLines) {
      if (printed >= limit) {
        omitted++;
        continue;
      }
      lines.push(routeLine);
      printed++;
    }
  }

  if (lowered !== '' && !anyMatch) {
    return `No routes match "${query}".`;
  }
  if (omitted > 0) {
    lines.push(`…${omitted} more route(s) omitted — raise limit or add a query filter.`);
  }
  return lines.join('\n');
}

/**
 * Render the request-logs topic from newest-first entries (RequestLogger
 * already returns newest first). Bodies are NEVER included — that is
 * get_request_logs' job.
 */
export function formatRequestLogsKnowledge(
  entries: RequestLogEntry[],
  query: string,
  limit: number
): string {
  if (entries.length === 0) {
    return 'No request logs recorded yet — start a server and send it traffic.';
  }
  const lowered = query.toLowerCase();
  const survivors = entries.filter(
    (entry) =>
      lowered === '' ||
      `${entry.request.method} ${entry.request.path}`.toLowerCase().includes(lowered)
  );
  if (survivors.length === 0) {
    return `No log entries match "${query}".`;
  }
  const shown = survivors.slice(0, limit);
  const failures = shown.filter((entry) => entry.response.statusCode >= 400).length;
  const unmatched = shown.filter((entry) => !entry.matched).length;
  const violations = shown.filter(
    (entry) => entry.validation !== undefined && !entry.validation.ok
  ).length;

  const lines = shown.map((entry) => {
    let contractSuffix = '';
    if (entry.validation !== undefined && !entry.validation.ok) {
      const first = entry.validation.violations[0];
      contractSuffix = ` CONTRACT[${entry.validation.mode}] ${entry.validation.violations.length} violation(s): ${first?.field ?? '?'}: ${first?.message ?? '?'}`;
    }
    return clampLine(
      `- ${new Date(entry.timestamp).toISOString()} ${entry.request.method} ${entry.request.path} → ${entry.response.statusCode} (${entry.response.duration}ms)${entry.matched ? '' : ' UNMATCHED'}${contractSuffix}`,
      KNOWLEDGE_LINE_MAX_CHARS
    );
  });

  const header = `${lines.length} log entr${lines.length === 1 ? 'y' : 'ies'}, newest first. Failures (status ≥ 400): ${failures}. Unmatched: ${unmatched}. Contract violations: ${violations}.`;
  return [header, ...lines].join('\n');
}

export interface SpecEndpoint {
  method: string;
  path: string;
  summary?: string;
}

const SPEC_METHOD_KEYS = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'] as const;

/** Enumerate METHOD/path/summary from a parsed (ref-resolved) OpenAPI/Swagger document. Pure. */
export function listSpecEndpoints(document: Record<string, unknown>): SpecEndpoint[] {
  const endpoints: SpecEndpoint[] = [];
  const paths = document.paths;
  if (paths === null || typeof paths !== 'object' || Array.isArray(paths)) {
    return endpoints;
  }
  for (const [path, item] of Object.entries(paths as Record<string, unknown>)) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }
    for (const key of SPEC_METHOD_KEYS) {
      const operation = (item as Record<string, unknown>)[key];
      if (operation === null || typeof operation !== 'object' || Array.isArray(operation)) {
        continue;
      }
      const summary = (operation as Record<string, unknown>).summary;
      endpoints.push({
        method: key.toUpperCase(),
        path,
        ...(typeof summary === 'string' && summary.trim() !== '' ? { summary } : {}),
      });
      if (endpoints.length >= KNOWLEDGE_SPEC_ENDPOINTS_MAX) {
        return endpoints;
      }
    }
  }
  return endpoints;
}

/**
 * Render the specs topic: per contract-bound server, the spec binding plus the
 * endpoints the parsed spec declares. RAW SPEC TEXT IS NEVER EMITTED — only
 * the built method/path/summary lines. The caller applies any server filter
 * before invoking.
 */
export async function formatSpecsKnowledge(
  servers: MockServerConfig[],
  readSpecText: ((specPath: string) => Promise<string | null>) | undefined,
  query: string,
  limit: number
): Promise<string> {
  const withContract = servers.filter((server) => server.contract !== undefined);
  if (withContract.length === 0) {
    return "No API specs are bound to servers (no server has contract config). Import one with the OpenAPI import command, or ask topic 'scan-memory' — previous scans note spec files found in the workspace.";
  }
  const lowered = query.toLowerCase();
  const cap = Math.min(limit, KNOWLEDGE_SPEC_ENDPOINTS_MAX);
  const lines: string[] = [];
  let printed = 0;
  let omitted = 0;

  for (const server of withContract) {
    const contract = server.contract;
    if (contract === undefined) {
      continue;
    }
    lines.push(
      `Server "${server.name}": contract spec ${clampLine(contract.specPath, KNOWLEDGE_LINE_MAX_CHARS)} (mode ${contract.mode})`
    );
    if (readSpecText === undefined) {
      lines.push('  Spec file contents are unavailable in this session.');
      continue;
    }
    const text = await readSpecText(contract.specPath);
    if (text === null) {
      lines.push('  Could not read the spec file (missing, too large, or outside the workspace).');
      continue;
    }
    let document: Record<string, unknown>;
    let version: string;
    try {
      const parsed = new OpenApiImportService().parseSpec(text);
      document = parsed.document;
      version = parsed.version;
    } catch (error) {
      lines.push(`  Spec could not be parsed: ${clampLine(errorMessage(error), KNOWLEDGE_LINE_MAX_CHARS)}`);
      continue;
    }
    const endpoints = listSpecEndpoints(document);
    const info = document.info;
    const rawTitle =
      info !== null && typeof info === 'object' && !Array.isArray(info)
        ? (info as Record<string, unknown>).title
        : undefined;
    const title = typeof rawTitle === 'string' ? clampLine(rawTitle, 80) : '(untitled)';
    lines.push(`  ${version}, "${title}" — ${endpoints.length} endpoint(s):`);
    for (const endpoint of endpoints) {
      if (
        lowered !== '' &&
        !`${endpoint.method} ${endpoint.path} ${endpoint.summary ?? ''}`
          .toLowerCase()
          .includes(lowered)
      ) {
        continue;
      }
      if (printed >= cap) {
        omitted++;
        continue;
      }
      lines.push(
        `  ${clampLine(
          `- ${endpoint.method} ${endpoint.path}${endpoint.summary !== undefined ? ` — ${clampLine(endpoint.summary, 120)}` : ''}`,
          KNOWLEDGE_LINE_MAX_CHARS
        )}`
      );
      printed++;
    }
  }
  if (omitted > 0) {
    lines.push(`  …${omitted} more endpoint(s) omitted.`);
  }
  return lines.join('\n');
}

/**
 * Render the scan-memory topic. The memory is already sanitized on load and
 * describeScanMemory is capped at 2,000 characters, so no further clamping is
 * needed; a query keeps the header plus only matching "- " lines.
 */
export function formatScanMemoryKnowledge(mem: ScanMemory | null, query: string): string {
  const described = mem === null ? '' : describeScanMemory(mem);
  if (described === '') {
    return 'No scan memory recorded yet — run "Mocklify: Generate Mocks from Codebase" to build it.';
  }
  if (query === '') {
    return described;
  }
  const lowered = query.toLowerCase();
  const [header, ...rest] = described.split('\n');
  const kept = rest.filter(
    (line) => line.startsWith('- ') && line.toLowerCase().includes(lowered)
  );
  if (kept.length === 0) {
    return `Scan memory has no entries matching "${query}".`;
  }
  return [header, ...kept].join('\n');
}

/**
 * Render the diagnostics topic: server/route/running counts (plus error-state
 * servers), a contract-violation tally over the sampled logs, the last scan's
 * strategies, the last error (redacted), and the extension version. The
 * query/limit/server inputs are accepted but ignored for this topic — the
 * snapshot is small and fixed-shape.
 */
export function formatDiagnosticsKnowledge(
  servers: MockServerConfig[],
  statusOf: (serverId: string) => ServerRuntimeState | undefined,
  recentLogs: RequestLogEntry[],
  diag: KnowledgeDiagnostics | undefined
): string {
  const lines: string[] = [];

  // Redact with the SAME path-scrubbing options collectDiagnostics uses —
  // without workspaceRoot/home the path half of redact() is inert and stack
  // traces would carry absolute paths into the model transcript.
  const home = detectHome();
  const scrubOpts = {
    ...(diag?.workspaceRoot !== undefined ? { workspaceRoot: diag.workspaceRoot } : {}),
    ...(home !== undefined ? { home } : {}),
  };
  const scrub = (text: string): string => redact(text, scrubOpts);

  const routeCount = servers.reduce((sum, server) => sum + server.routes.length, 0);
  let running = 0;
  const errorLines: string[] = [];
  for (const server of servers) {
    const state = statusOf(server.id);
    if (state?.status === 'running') {
      running++;
    }
    if (state?.status === 'error') {
      errorLines.push(
        `- "${server.name}" is in error state: ${clampLine(scrub(state.error ?? 'unknown error'), KNOWLEDGE_LINE_MAX_CHARS)}`
      );
    }
  }
  lines.push('Servers:');
  lines.push(`${servers.length} server(s), ${routeCount} route(s), ${running} running.`);
  lines.push(...errorLines);

  lines.push(`Contract validation (last ${recentLogs.length} logged requests):`);
  const failing = recentLogs.filter(
    (entry) => entry.validation !== undefined && !entry.validation.ok
  );
  if (failing.length === 0) {
    lines.push('no violations.');
  } else {
    lines.push(`${failing.length} request(s) failed contract validation.`);
    for (const entry of failing.slice(0, 5)) {
      const first = entry.validation?.ok === false ? entry.validation.violations[0] : undefined;
      lines.push(
        clampLine(
          `- ${entry.request.method} ${entry.request.path}: ${first?.field ?? '?'}: ${first?.message ?? '?'}`,
          KNOWLEDGE_LINE_MAX_CHARS
        )
      );
    }
  }

  lines.push('Last codebase scan:');
  const strategies = diag?.scanStrategies ?? [];
  if (strategies.length === 0) {
    lines.push('(not recorded this session)');
  } else {
    for (const entry of strategies) {
      lines.push(
        `- ${clampLine(scrub(entry.surface), KNOWLEDGE_LINE_MAX_CHARS)} → ${entry.strategy} — ${clampLine(scrub(entry.reason), KNOWLEDGE_LINE_MAX_CHARS)}`
      );
    }
  }

  lines.push('Last error:');
  if (diag?.lastError === undefined) {
    lines.push('(not recorded this session)');
  } else {
    const message = scrub(diag.lastError.message);
    const bounded = message.length > 400 ? `${message.slice(0, 400)}…` : message;
    lines.push(
      `${bounded}${diag.lastError.when !== undefined ? ` (at ${diag.lastError.when})` : ''}`
    );
  }

  lines.push('Extension:');
  lines.push(diag?.extensionVersion !== undefined ? diag.extensionVersion : '(not recorded this session)');

  return lines.join('\n');
}

// ---- Private helpers ----

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Coerce the query_knowledge limit to an integer in 1–KNOWLEDGE_MAX_LIMIT. */
function clampKnowledgeLimit(raw: unknown): number {
  if (raw === undefined || raw === null) {
    return KNOWLEDGE_DEFAULT_LIMIT;
  }
  const value = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return KNOWLEDGE_DEFAULT_LIMIT;
  }
  return Math.min(KNOWLEDGE_MAX_LIMIT, Math.max(1, Math.trunc(value)));
}

// ---- Production wiring ----

/** The MockServerManager slice the default host needs (structural). */
export interface KnowledgeManagerSlice {
  getServers(): Promise<MockServerConfig[]>;
  getServerState(serverId: string): ServerRuntimeState | undefined;
  getLogEntries(serverId?: string, limit?: number): RequestLogEntry[];
}

/**
 * Production KnowledgeHost. vscode is lazy-required INSIDE each optional
 * member (createDefaultScanGraphDeps pattern) so this module stays importable
 * under vitest; every failure path resolves null/undefined, never throws.
 */
export function createDefaultKnowledgeHost(
  manager: KnowledgeManagerSlice,
  options?: { extensionVersion?: string }
): KnowledgeHost {
  return {
    getServers: () => manager.getServers(),
    getServerState: (id) => manager.getServerState(id),
    getLogEntries: (serverId, limit) => manager.getLogEntries(serverId, limit),
    loadScanMemory: async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const vs: typeof import('vscode') = require('vscode');
        const root = vs.workspace.workspaceFolders?.[0]?.uri;
        if (!root) {
          return null;
        }
        return await createScanMemoryStore(root).load();
      } catch {
        return null;
      }
    },
    readSpecText: async (specPath) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const vs: typeof import('vscode') = require('vscode');
        const root = vs.workspace.workspaceFolders?.[0]?.uri;
        if (!root) {
          return null;
        }
        // Confine to the workspace: an absolute path inside the root is
        // relativized; everything else must pass validateWorkspacePath.
        let candidate = specPath.replace(/\\/g, '/');
        const rootPrefix = root.path.endsWith('/') ? root.path : `${root.path}/`;
        if (candidate.startsWith(rootPrefix)) {
          candidate = candidate.slice(rootPrefix.length);
        }
        const validated = validateWorkspacePath(candidate);
        if (!validated.ok) {
          return null;
        }
        const uri = vs.Uri.joinPath(root, ...validated.path.split('/'));
        const stat = await vs.workspace.fs.stat(uri);
        if ((stat.type & vs.FileType.Directory) !== 0 || stat.size > KNOWLEDGE_SPEC_MAX_BYTES) {
          return null;
        }
        return Buffer.from(await vs.workspace.fs.readFile(uri)).toString('utf-8');
      } catch {
        return null;
      }
    },
    getDiagnostics: () => {
      const scan = getRecordedScanReport();
      const err = getRecordedError();
      let workspaceRoot: string | undefined;
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const vs: typeof import('vscode') = require('vscode');
        workspaceRoot = vs.workspace.workspaceFolders?.[0]?.uri.fsPath;
      } catch {
        workspaceRoot = undefined;
      }
      return {
        ...(options?.extensionVersion !== undefined
          ? { extensionVersion: options.extensionVersion }
          : {}),
        ...(scan !== undefined ? { scanStrategies: scan } : {}),
        ...(err !== undefined ? { lastError: err } : {}),
        ...(workspaceRoot !== undefined ? { workspaceRoot } : {}),
      };
    },
  };
}
