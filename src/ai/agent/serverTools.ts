import type {
  MockServerConfig,
  RouteConfig,
  RequestLogEntry,
  ServerRuntimeState,
} from '../../types/core.js';
import type { AiToolDefinition, AiToolExecutor } from '../providers/types.js';
import { MockGenerator, ROUTES_JSON_SCHEMA } from '../MockGenerator.js';

/**
 * Provider-agnostic tool belt over the mock-server layer for the /agent chat
 * command. The belt depends on the structural {@link ServerToolsHost} — never
 * the concrete MockServerManager — so the whole module (and everything it
 * imports) is vitest-importable with zero vscode imports.
 *
 * Trust and safety rules enforced here, not by the model:
 * - every mutating tool is gated by an injected {@link ConfirmHandler}; a
 *   refusal returns {@link MUTATION_DENIED_MESSAGE} instead of mutating, and
 *   the model is told the decision is final;
 * - the first confirmed mutation touching each pre-existing server snapshots
 *   it (deep clone + running state) so the whole session can be rolled back
 *   with {@link restoreUndoSnapshot}; servers the session creates are
 *   recorded by id and deleted on restore;
 * - ALL tool input is untrusted model output: route payloads go through
 *   MockGenerator.validateRoutes/verifyRoutes, scalar fields are clamped in
 *   code (the JSON schemas deliberately carry no numeric/length constraints),
 *   and every tool result is bounded to {@link TOOL_OUTPUT_MAX_CHARS}.
 */

// ---- Host (structural) ----

/**
 * The slice of MockServerManager the tool belt needs. MockServerManager
 * satisfies this structurally — the concrete class is never imported, so
 * this module stays importable under vitest. Signatures mirror the real
 * methods exactly (a defaulted parameter is optional in the method type).
 */
export interface ServerToolsHost {
  getServers(): Promise<MockServerConfig[]>;
  getServer(serverId: string): Promise<MockServerConfig | undefined>;
  getServerState(serverId: string): ServerRuntimeState | undefined;
  getLogEntries(serverId?: string, limit?: number): RequestLogEntry[];
  createServer(
    name: string,
    port?: number,
    protocol?: 'http' | 'graphql' | 'websocket'
  ): Promise<MockServerConfig>;
  deleteServer(serverId: string): Promise<void>;
  addRoute(serverId: string, route: Omit<RouteConfig, 'id'>): Promise<RouteConfig>;
  addRoutes(serverId: string, routes: Omit<RouteConfig, 'id'>[]): Promise<RouteConfig[]>;
  updateRoute(serverId: string, routeId: string, updates: Partial<RouteConfig>): Promise<void>;
  deleteRoute(serverId: string, routeId: string): Promise<void>;
  startServer(serverId: string): Promise<void>;
  stopServer(serverId: string): Promise<void>;
}

// ---- Constants ----

/** Server names are clamped to one line of at most this many characters. */
export const SERVER_NAME_MAX_CHARS = 60;
/** Lowest port the agent may assign (unprivileged range). */
export const PORT_MIN = 1024;
/** Highest valid TCP port. */
export const PORT_MAX = 65535;
/** Routes accepted per add_route call. */
export const ADD_ROUTES_MAX = 20;
/** Serialized response body content cap per route. */
export const ROUTE_BODY_MAX_CHARS = 32_000;
/** Log entries returned when the model does not pass a limit. */
export const LOGS_DEFAULT_LIMIT = 25;
/** Hard cap on log entries per get_request_logs call. */
export const LOGS_MAX_LIMIT = 100;
/** Request/response body preview length in log output. */
export const LOG_BODY_PREVIEW_CHARS = 300;
/** Every tool result is truncated to this many characters. */
export const TOOL_OUTPUT_MAX_CHARS = 16_000;
/** Tool result when the user refuses a gated mutation. */
export const MUTATION_DENIED_MESSAGE =
  'The user declined this change — it was NOT applied and the decision is final. Do not retry the same change; continue with what is already approved, or ask the user what they would like instead.';
/** Route fields update_route may change; everything else is dropped with a note. */
export const UPDATABLE_ROUTE_FIELDS = [
  'name',
  'enabled',
  'method',
  'path',
  'response',
  'delay',
  'priority',
  'tags',
  'stateful',
] as const;

// ---- Confirmation gate ----

/** Display-oriented, clamped snapshot of one route for confirm cards. NEVER the raw RouteConfig. */
export interface RouteChangeSnapshot {
  /** methodLabel output, clamped to 40 chars (e.g. 'GET' or 'GET|POST'). */
  method: string;
  /** clampLine'd to CHANGE_LINE_MAX_CHARS. */
  path: string;
  statusCode: number;
  /** Route display name; omitted when empty. clampLine'd to SERVER_NAME_MAX_CHARS. */
  name?: string;
  enabled?: boolean;
  /** response.type verbatim ('static' | 'dynamic' | 'proxy' | 'database' | 'sequence'). */
  responseType: string;
  /** Number of explicit response headers. */
  headersCount: number;
  /** JSON.stringify of response.body.content sliced to CHANGE_BODY_PREVIEW_MAX_CHARS ('…' when cut); omitted when no body. */
  bodyPreview?: string;
  /** responseDisclosure lines (proxy target, DB op, …), each clamped, max CHANGE_DISCLOSURES_MAX. */
  disclosures: string[];
}

/** One before → after row for update_route (only fields whose value actually changes). */
export interface RouteFieldDiff {
  /** UPDATABLE_ROUTE_FIELDS member, clamped to 40 chars. */
  field: string;
  /** valuePreview of the current value (≤ 80 chars). */
  before: string;
  /** valuePreview of the validated new value (≤ 80 chars). */
  after: string;
}

/** Optional structured payload describing the mutation being approved. */
export interface ConfirmChange {
  kind: ServerAgentActionKind;
  /** clampLine'd to SERVER_NAME_MAX_CHARS. */
  serverName: string;
  /** create_server / start_server / stop_server. */
  port?: number;
  /** create_server only. */
  protocol?: 'http' | 'graphql' | 'websocket';
  /** add_route: the routes being added (max ADD_ROUTES_MAX). */
  routes?: RouteChangeSnapshot[];
  /** update_route (current) and delete_route (the route being removed). */
  before?: RouteChangeSnapshot;
  /** update_route: the validated post-update route. */
  after?: RouteChangeSnapshot;
  /** update_route: only fields actually changing. */
  fieldDiffs?: RouteFieldDiff[];
}

/** One gated mutation shown to the human. title/detail are ALWAYS set (text fallback);
 *  change is additive — consumers that only read title/detail keep working unchanged. */
export interface ConfirmAction {
  title: string;
  detail: string;
  change?: ConfirmChange;
}

/** Asks the human to approve one mutation. False means politely refused. */
export type ConfirmHandler = (action: ConfirmAction) => Promise<boolean>;

// ---- Executed actions ----

/** The mutation kinds an agent session can perform. */
export type ServerAgentActionKind =
  | 'create_server'
  | 'add_route'
  | 'update_route'
  | 'delete_route'
  | 'start_server'
  | 'stop_server';

/** One confirmed, executed mutation — the agent turn returns these. */
export interface ExecutedAction {
  kind: ServerAgentActionKind;
  serverId: string;
  serverName: string;
  /** Human-readable, e.g. 'Added 2 route(s): GET /api/users, POST /api/users'. */
  summary: string;
  /** Set for route-level actions. */
  routeIds?: string[];
}

// ---- Undo ----

/** A server exactly as it was before this session first mutated it. */
export interface ServerSnapshot {
  /** Deep clone (structuredClone) of the pre-mutation config. */
  config: MockServerConfig;
  /** Whether the server was running at snapshot time. */
  wasRunning: boolean;
}

/**
 * Everything needed to roll the session's mutations back. Plain data —
 * serializable, safe as a command argument.
 */
export interface UndoSnapshot {
  /** First-touch snapshots of servers that existed before the session. */
  servers: ServerSnapshot[];
  /** Servers the session created, newest last — deleted on restore. */
  createdServerIds: string[];
}

export interface UndoRestoreResult {
  restoredServerIds: string[];
  deletedServerIds: string[];
  /** Per-step failures; restore never throws. */
  errors: string[];
}

/**
 * Restore every server in the snapshot to its pre-session state:
 * 1. delete createdServerIds (reverse order; a missing server is not an
 *    error);
 * 2. for each ServerSnapshot: if the server no longer exists, record an
 *    error and skip; else delete all current routes and re-add the
 *    snapshot's routes in one addRoutes call — route ids regenerate
 *    (documented limitation);
 * 3. reconcile running state against getServerState (start what was
 *    running, stop what was not).
 * All failures are collected into errors; the function always resolves.
 */
export async function restoreUndoSnapshot(
  host: ServerToolsHost,
  snapshot: UndoSnapshot
): Promise<UndoRestoreResult> {
  const restoredServerIds: string[] = [];
  const deletedServerIds: string[] = [];
  const errors: string[] = [];

  for (const serverId of [...snapshot.createdServerIds].reverse()) {
    try {
      const existing = await host.getServer(serverId);
      if (!existing) {
        continue; // already gone — not an error
      }
      await host.deleteServer(serverId);
      deletedServerIds.push(serverId);
    } catch (error) {
      errors.push(`Failed to delete created server ${serverId}: ${errorMessage(error)}`);
    }
  }

  for (const serverSnapshot of snapshot.servers) {
    const { id: serverId, name } = serverSnapshot.config;
    let current: MockServerConfig | undefined;
    try {
      current = await host.getServer(serverId);
    } catch (error) {
      errors.push(`Failed to look up server "${name}": ${errorMessage(error)}`);
      continue;
    }
    if (!current) {
      errors.push(`Server "${name}" (${serverId}) no longer exists — cannot restore it.`);
      continue;
    }

    try {
      for (const route of current.routes) {
        await host.deleteRoute(serverId, route.id);
      }
      await host.addRoutes(
        serverId,
        serverSnapshot.config.routes.map(({ id: _id, ...rest }) => rest)
      );
      restoredServerIds.push(serverId);
    } catch (error) {
      errors.push(`Failed to restore routes of "${name}": ${errorMessage(error)}`);
    }

    try {
      const status = host.getServerState(serverId)?.status;
      if (serverSnapshot.wasRunning && status !== 'running') {
        await host.startServer(serverId);
      } else if (!serverSnapshot.wasRunning && status === 'running') {
        await host.stopServer(serverId);
      }
    } catch (error) {
      errors.push(`Failed to restore running state of "${name}": ${errorMessage(error)}`);
    }
  }

  return { restoredServerIds, deletedServerIds, errors };
}

// ---- Belt factory ----

export interface ServerToolBeltOptions {
  host: ServerToolsHost;
  confirm: ConfirmHandler;
}

export interface ServerToolBelt {
  /** All nine tool definitions (strict-dialect schemas). */
  definitions: AiToolDefinition[];
  /** Executes one call; resolves an error/refusal STRING rather than throwing for anything model-caused. */
  execute: AiToolExecutor;
  /** Confirmed mutations executed so far, chronological. */
  actions(): ExecutedAction[];
  /** Undo data accumulated so far; undefined until the first executed mutation. */
  snapshot(): UndoSnapshot | undefined;
}

/** Create the mock-server tool belt for one agent session. Pure — no vscode. */
export function createServerToolBelt(options: ServerToolBeltOptions): ServerToolBelt {
  const { host, confirm } = options;
  const snapshots = new Map<string, ServerSnapshot>();
  const createdServerIds: string[] = [];
  const executed: ExecutedAction[] = [];

  // First-touch snapshot of a PRE-EXISTING server, taken after the
  // confirmation is granted and before the host mutation executes. Servers
  // the session created are covered by createdServerIds instead.
  const snapshotIfNeeded = async (serverId: string): Promise<void> => {
    if (snapshots.has(serverId) || createdServerIds.includes(serverId)) {
      return;
    }
    const config = await host.getServer(serverId);
    if (!config) {
      return;
    }
    snapshots.set(serverId, {
      config: structuredClone(config),
      wasRunning: host.getServerState(serverId)?.status === 'running',
    });
  };

  const serverNotFound = (ref: unknown): string =>
    `Server "${refPreview(ref)}" not found — call list_servers.`;
  const routeNotFound = (ref: unknown, serverName: string): string =>
    `Route "${refPreview(ref)}" not found on "${serverName}" — call list_servers to see its routes.`;

  // -- Read tools --

  const listServers = async (): Promise<string> => {
    const servers = await host.getServers();
    if (servers.length === 0) {
      return 'No mock servers configured.';
    }
    const summary = servers.map((server) => ({
      id: server.id,
      name: server.name,
      port: server.port,
      protocol: server.protocol,
      status: host.getServerState(server.id)?.status ?? 'stopped',
      baseUrl: `http://localhost:${server.port}`,
      routes: server.routes.map((route) => ({
        id: route.id,
        method: route.method,
        path: route.path,
        statusCode: route.response.statusCode,
        enabled: route.enabled,
      })),
    }));
    return JSON.stringify(summary, null, 2);
  };

  const getRoute = async (input: Record<string, unknown>): Promise<string> => {
    const server = resolveServerRef(await host.getServers(), input.server);
    if (!server) {
      return serverNotFound(input.server);
    }
    const route = resolveRouteRef(server, input.route);
    if (!route) {
      return routeNotFound(input.route, server.name);
    }
    return JSON.stringify(route, null, 2);
  };

  const getRequestLogs = async (input: Record<string, unknown>): Promise<string> => {
    let serverId: string | undefined;
    if (input.server !== undefined && input.server !== null && input.server !== '') {
      const server = resolveServerRef(await host.getServers(), input.server);
      if (!server) {
        return serverNotFound(input.server);
      }
      serverId = server.id;
    }
    const limit = clampLogLimit(input.limit);
    const includeBodies = input.includeBodies === true;
    const entries = host.getLogEntries(serverId, limit);
    if (entries.length === 0) {
      return 'No request logs recorded.';
    }
    const summary = entries.map((entry) => ({
      timestamp: new Date(entry.timestamp).toISOString(),
      method: entry.request.method,
      path: entry.request.path,
      statusCode: entry.response.statusCode,
      durationMs: entry.response.duration,
      matched: entry.matched,
      ...(includeBodies
        ? {
            requestBody: bodyPreview(entry.request.body),
            responseBody: bodyPreview(entry.response.body),
          }
        : {}),
    }));
    return JSON.stringify(summary, null, 2);
  };

  // -- Mutating tools (gate → snapshot → host → record) --

  const createServerTool = async (input: Record<string, unknown>): Promise<string> => {
    const name = typeof input.name === 'string' ? clampLine(input.name, SERVER_NAME_MAX_CHARS) : '';
    if (name === '') {
      return 'Provide a non-empty server name (one short line).';
    }
    let port: number | undefined;
    if (input.port !== undefined && input.port !== null) {
      const value = typeof input.port === 'string' ? Number(input.port) : input.port;
      if (
        typeof value !== 'number' ||
        !Number.isInteger(value) ||
        value < PORT_MIN ||
        value > PORT_MAX
      ) {
        return 'port must be an integer between 1024 and 65535.';
      }
      port = value;
    }
    let protocol: 'http' | 'graphql' | 'websocket' | undefined;
    if (input.protocol !== undefined && input.protocol !== null) {
      if (input.protocol !== 'http' && input.protocol !== 'graphql' && input.protocol !== 'websocket') {
        return 'protocol must be one of: http, graphql, websocket.';
      }
      protocol = input.protocol;
    }

    const ok = await confirm({
      title: `Create mock server "${name}"`,
      detail: `Protocol ${protocol ?? 'http'}, port ${port ?? 'default'}; the server starts empty and stopped.`,
      change: {
        kind: 'create_server',
        serverName: name,
        ...(port !== undefined ? { port } : {}),
        protocol: protocol ?? 'http',
      },
    });
    if (!ok) {
      return MUTATION_DENIED_MESSAGE;
    }
    const server = await host.createServer(name, port, protocol);
    createdServerIds.push(server.id);
    executed.push({
      kind: 'create_server',
      serverId: server.id,
      serverName: server.name,
      summary: `Created server "${server.name}" on port ${server.port}`,
    });
    return `Created mock server "${server.name}" (id: ${server.id}) on port ${server.port}. It has no routes and is not started.`;
  };

  const addRouteTool = async (input: Record<string, unknown>): Promise<string> => {
    const server = resolveServerRef(await host.getServers(), input.server);
    if (!server) {
      return serverNotFound(input.server);
    }
    let validated: Omit<RouteConfig, 'id'>[];
    try {
      validated = MockGenerator.validateRoutes(input.routes);
    } catch (error) {
      return errorMessage(error);
    }
    // Cap AFTER validateRoutes: it unwraps object-wrapped arrays
    // ({"routes": [...]}), so checking the raw input would let a wrapped
    // payload bypass the per-call batch limit.
    if (validated.length > ADD_ROUTES_MAX) {
      return `At most ${ADD_ROUTES_MAX} route(s) per add_route call — split the batch into smaller calls.`;
    }
    const { accepted, rejected } = MockGenerator.verifyRoutes(validated);
    if (accepted.length === 0) {
      return `The routes failed validation: ${rejected[0]?.reasons.join('; ') ?? 'empty result'}`;
    }
    for (const route of accepted) {
      const size = JSON.stringify(route.response.body?.content ?? null).length;
      if (size > ROUTE_BODY_MAX_CHARS) {
        return `Route ${methodLabel(route.method)} ${route.path} has ${size} characters of serialized body content (max ${ROUTE_BODY_MAX_CHARS}) — trim the example data.`;
      }
    }
    const rejectedNote =
      rejected.length > 0
        ? `\nNote: ${rejected.length} route(s) were rejected and skipped: ${rejected
            .map((r) => `${methodLabel(r.route.method)} ${r.route.path} (${r.reasons.join('; ')})`)
            .join(' | ')}`
        : '';

    // Every accepted route is listed (the batch is already capped at
    // ADD_ROUTES_MAX) — a route the user cannot see is a route the user
    // cannot approve.
    const detailLines = accepted.map((route) => routeConfirmLine(route));
    const ok = await confirm({
      title: `Add ${accepted.length} route(s) to "${server.name}"`,
      detail: detailLines.join('\n'),
      change: { kind: 'add_route', serverName: server.name, routes: accepted.map(routeChangeSnapshot) },
    });
    if (!ok) {
      return MUTATION_DENIED_MESSAGE;
    }
    await snapshotIfNeeded(server.id);
    const created = await host.addRoutes(server.id, accepted);
    executed.push({
      kind: 'add_route',
      serverId: server.id,
      serverName: server.name,
      summary: clampLine(
        `Added ${created.length} route(s): ${created
          .map((route) => `${methodLabel(route.method)} ${route.path}`)
          .join(', ')}`,
        200
      ),
      routeIds: created.map((route) => route.id),
    });
    return `Added ${created.length} route(s) to "${server.name}":\n${created
      .map((route) => `${methodLabel(route.method)} ${route.path} (id: ${route.id})`)
      .join('\n')}${rejectedNote}`;
  };

  const updateRouteTool = async (input: Record<string, unknown>): Promise<string> => {
    const server = resolveServerRef(await host.getServers(), input.server);
    if (!server) {
      return serverNotFound(input.server);
    }
    const route = resolveRouteRef(server, input.route);
    if (!route) {
      return routeNotFound(input.route, server.name);
    }
    if (input.updates === null || typeof input.updates !== 'object' || Array.isArray(input.updates)) {
      return 'updates must be an object containing only the route fields to change.';
    }
    const filtered: Record<string, unknown> = {};
    const dropped: string[] = [];
    for (const [key, value] of Object.entries(input.updates as Record<string, unknown>)) {
      if ((UPDATABLE_ROUTE_FIELDS as readonly string[]).includes(key)) {
        filtered[key] = value;
      } else {
        dropped.push(key);
      }
    }
    const droppedNote =
      dropped.length > 0 ? ` Ignored non-updatable field(s): ${dropped.join(', ')}.` : '';
    const changedFields = Object.keys(filtered);
    if (changedFields.length === 0) {
      return `updates contained no updatable fields.${droppedNote} Updatable fields: ${UPDATABLE_ROUTE_FIELDS.join(', ')}.`;
    }

    const { id: _routeId, ...existing } = route;
    const merged = { ...existing, ...filtered };
    let validated: Omit<RouteConfig, 'id'>[];
    try {
      validated = MockGenerator.validateRoutes([merged]);
    } catch (error) {
      return `The updated route failed validation: ${errorMessage(error)}`;
    }
    const { accepted, rejected } = MockGenerator.verifyRoutes(validated);
    const updated = accepted[0];
    if (updated === undefined) {
      return `The updated route failed validation: ${rejected[0]?.reasons.join('; ') ?? 'empty result'}`;
    }
    const bodySize = JSON.stringify(updated.response.body?.content ?? null).length;
    if (bodySize > ROUTE_BODY_MAX_CHARS) {
      return `The updated route has ${bodySize} characters of serialized body content (max ${ROUTE_BODY_MAX_CHARS}) — trim the example data.`;
    }

    const label = `${methodLabel(route.method)} ${route.path}`;
    // Field previews are clamped, so any non-static response behavior of the
    // route being approved (proxy target, database operation, …) is disclosed
    // on dedicated unclamped lines — see responseDisclosure.
    const fieldDiffs = computeRouteFieldDiffs(existing, updated, changedFields);
    const diffByField = new Map(fieldDiffs.map((diff) => [diff.field, diff]));
    // Detail lines reuse the diff previews (divergence-anchored when the
    // change sits past the preview clamp) so the text fallback never renders
    // an X → X row for a real change; unchanged fields fall back to the plain
    // previews.
    const updateDetailLines = changedFields.map((key) => {
      const diff = diffByField.get(key);
      return diff !== undefined
        ? `${diff.field}: ${diff.before} → ${diff.after}`
        : `${key}: ${valuePreview((route as unknown as Record<string, unknown>)[key])} → ${valuePreview(filtered[key])}`;
    });
    updateDetailLines.push(...responseDisclosure(updated.response));
    const ok = await confirm({
      title: `Update route ${label} on "${server.name}"`,
      detail: updateDetailLines.join('\n'),
      change: {
        kind: 'update_route',
        serverName: server.name,
        before: routeChangeSnapshot(existing),
        after: routeChangeSnapshot(updated),
        fieldDiffs,
      },
    });
    if (!ok) {
      return MUTATION_DENIED_MESSAGE;
    }
    await snapshotIfNeeded(server.id);
    // The full validated object minus id — the manager's spread then yields
    // exactly the validated result.
    await host.updateRoute(server.id, route.id, updated);
    executed.push({
      kind: 'update_route',
      serverId: server.id,
      serverName: server.name,
      summary: clampLine(`Updated route ${label} (${changedFields.join(', ')})`, 200),
      routeIds: [route.id],
    });
    return `Updated route ${label} on "${server.name}" (fields: ${changedFields.join(', ')}).${droppedNote}`;
  };

  const deleteRouteTool = async (input: Record<string, unknown>): Promise<string> => {
    const server = resolveServerRef(await host.getServers(), input.server);
    if (!server) {
      return serverNotFound(input.server);
    }
    const route = resolveRouteRef(server, input.route);
    if (!route) {
      return routeNotFound(input.route, server.name);
    }
    const label = `${methodLabel(route.method)} ${route.path}`;
    const { id: _ignored, ...routeSansId } = route;
    const ok = await confirm({
      title: `Delete route ${label} from "${server.name}"`,
      detail: `"${route.name}" (status ${route.response.statusCode}) will be removed permanently.`,
      change: { kind: 'delete_route', serverName: server.name, before: routeChangeSnapshot(routeSansId) },
    });
    if (!ok) {
      return MUTATION_DENIED_MESSAGE;
    }
    await snapshotIfNeeded(server.id);
    await host.deleteRoute(server.id, route.id);
    executed.push({
      kind: 'delete_route',
      serverId: server.id,
      serverName: server.name,
      summary: clampLine(`Deleted route ${label}`, 200),
      routeIds: [route.id],
    });
    return `Deleted route ${label} from "${server.name}".`;
  };

  const startServerTool = async (input: Record<string, unknown>): Promise<string> => {
    const server = resolveServerRef(await host.getServers(), input.server);
    if (!server) {
      return serverNotFound(input.server);
    }
    if (host.getServerState(server.id)?.status === 'running') {
      return `"${server.name}" is already running at http://localhost:${server.port}.`;
    }
    const ok = await confirm({
      title: `Start mock server "${server.name}"`,
      detail: `It will listen on http://localhost:${server.port}.`,
      change: { kind: 'start_server', serverName: server.name, port: server.port },
    });
    if (!ok) {
      return MUTATION_DENIED_MESSAGE;
    }
    await snapshotIfNeeded(server.id);
    await host.startServer(server.id);
    executed.push({
      kind: 'start_server',
      serverId: server.id,
      serverName: server.name,
      summary: `Started "${server.name}" at http://localhost:${server.port}`,
    });
    return `"${server.name}" is running at http://localhost:${server.port}.`;
  };

  const stopServerTool = async (input: Record<string, unknown>): Promise<string> => {
    const server = resolveServerRef(await host.getServers(), input.server);
    if (!server) {
      return serverNotFound(input.server);
    }
    if (host.getServerState(server.id)?.status !== 'running') {
      return `"${server.name}" is already stopped.`;
    }
    const ok = await confirm({
      title: `Stop mock server "${server.name}"`,
      detail: `Requests to http://localhost:${server.port} will no longer be served.`,
      change: { kind: 'stop_server', serverName: server.name, port: server.port },
    });
    if (!ok) {
      return MUTATION_DENIED_MESSAGE;
    }
    await snapshotIfNeeded(server.id);
    await host.stopServer(server.id);
    executed.push({
      kind: 'stop_server',
      serverId: server.id,
      serverName: server.name,
      summary: `Stopped "${server.name}"`,
    });
    return `Stopped "${server.name}".`;
  };

  const execute: AiToolExecutor = async (call) => {
    const input = (call.input ?? {}) as Record<string, unknown>;
    let result: string;
    try {
      switch (call.name) {
        case 'list_servers':
          result = await listServers();
          break;
        case 'get_route':
          result = await getRoute(input);
          break;
        case 'get_request_logs':
          result = await getRequestLogs(input);
          break;
        case 'create_server':
          result = await createServerTool(input);
          break;
        case 'add_route':
          result = await addRouteTool(input);
          break;
        case 'update_route':
          result = await updateRouteTool(input);
          break;
        case 'delete_route':
          result = await deleteRouteTool(input);
          break;
        case 'start_server':
          result = await startServerTool(input);
          break;
        case 'stop_server':
          result = await stopServerTool(input);
          break;
        default:
          return `Unknown tool "${call.name}". Available tools: list_servers, get_route, get_request_logs, create_server, add_route, update_route, delete_route, start_server, stop_server.`;
      }
    } catch (error) {
      return `Tool "${call.name}" failed: ${errorMessage(error)}`;
    }
    return clampToolOutput(result);
  };

  return {
    definitions: TOOL_DEFINITIONS,
    execute,
    actions: () => [...executed],
    snapshot: () =>
      snapshots.size === 0 && createdServerIds.length === 0
        ? undefined
        : { servers: [...snapshots.values()], createdServerIds: [...createdServerIds] },
  };
}

// ---- Pure helpers (exported for tests) ----

/**
 * Resolve a model-supplied server reference: id → exact name
 * (case-insensitive) → name substring. With no ref, resolves only when
 * exactly one server exists.
 */
export function resolveServerRef(
  servers: MockServerConfig[],
  ref: unknown
): MockServerConfig | undefined {
  if (ref === undefined || ref === null || ref === '') {
    return servers.length === 1 ? servers[0] : undefined;
  }
  if (typeof ref !== 'string') {
    return undefined;
  }
  const lowered = ref.toLowerCase();
  return (
    servers.find((server) => server.id === ref) ??
    servers.find((server) => server.name.toLowerCase() === lowered) ??
    servers.find((server) => server.name.toLowerCase().includes(lowered))
  );
}

/**
 * Resolve a route inside a server: route id → "METHOD /path"
 * (case-insensitive method) → exact path when unambiguous.
 */
export function resolveRouteRef(server: MockServerConfig, ref: unknown): RouteConfig | undefined {
  if (typeof ref !== 'string' || ref.trim() === '') {
    return undefined;
  }
  const trimmed = ref.trim();

  const byId = server.routes.find((route) => route.id === trimmed);
  if (byId) {
    return byId;
  }

  const methodPath = /^(\S+)\s+(\/\S*)$/.exec(trimmed);
  if (methodPath) {
    const method = methodPath[1].toUpperCase();
    const path = methodPath[2];
    const found = server.routes.find(
      (route) => routeMethods(route).includes(method) && route.path === path
    );
    if (found) {
      return found;
    }
  }

  const byPath = server.routes.filter((route) => route.path === trimmed);
  return byPath.length === 1 ? byPath[0] : undefined;
}

/** Proxy target URLs in confirmation details are clamped to this many
 * characters — generous enough that the scheme://host:port origin (the part
 * that matters for approval) is always visible. */
export const PROXY_TARGET_PREVIEW_CHARS = 200;

/** Body preview length inside a RouteChangeSnapshot. */
export const CHANGE_BODY_PREVIEW_MAX_CHARS = 400;
/** Per-line clamp for snapshot paths and disclosure lines. */
export const CHANGE_LINE_MAX_CHARS = 200;
/** Disclosure lines kept per snapshot (sequences can nest many). */
export const CHANGE_DISCLOSURES_MAX = 8;

/** Build the display snapshot of one route (all clamps applied here). */
export function routeChangeSnapshot(route: Omit<RouteConfig, 'id'>): RouteChangeSnapshot {
  const content = route.response.body?.content;
  let bodyPreview: string | undefined;
  if (content !== undefined) {
    let text: string;
    try {
      text = JSON.stringify(content) ?? '';
    } catch {
      text = String(content);
    }
    bodyPreview =
      text.length > CHANGE_BODY_PREVIEW_MAX_CHARS
        ? `${text.slice(0, CHANGE_BODY_PREVIEW_MAX_CHARS)}…`
        : text;
  }
  const name = clampLine(route.name, SERVER_NAME_MAX_CHARS);
  return {
    method: clampLine(methodLabel(route.method), 40),
    path: clampLine(route.path, CHANGE_LINE_MAX_CHARS),
    statusCode: route.response.statusCode,
    ...(name !== '' ? { name } : {}),
    enabled: route.enabled,
    responseType: route.response.type,
    headersCount: Object.keys(route.response.headers ?? {}).length,
    ...(bodyPreview !== undefined ? { bodyPreview } : {}),
    disclosures: clampDisclosures(responseDisclosure(route.response)),
  };
}

/**
 * Bound a snapshot's disclosure list to {@link CHANGE_DISCLOSURES_MAX} lines
 * without silently hiding a high-risk line: proxy/database disclosures are
 * ordered ahead of benign ones before the cap is applied, and any elision is
 * announced with a trailing marker line COUNTED INSIDE the cap (so downstream
 * defensive re-slices in the chat protocol keep the marker too). Without
 * this, a PROXIES line past the cap would vanish from the confirm card — the
 * exact hidden-targetUrl threat {@link responseDisclosure} exists to prevent.
 */
export function clampDisclosures(lines: string[]): string[] {
  const clamped = lines.map((line) => clampLine(line, CHANGE_LINE_MAX_CHARS));
  if (clamped.length <= CHANGE_DISCLOSURES_MAX) {
    return clamped;
  }
  const isCritical = (line: string): boolean =>
    line.startsWith('PROXIES ') || line.startsWith('runs database operation');
  const ordered = [
    ...clamped.filter(isCritical),
    ...clamped.filter((line) => !isCritical(line)),
  ];
  const kept = ordered.slice(0, CHANGE_DISCLOSURES_MAX - 1);
  const omitted = clamped.length - kept.length;
  return [...kept, `…${omitted} more disclosure line(s) omitted — proxy/database lines are listed first.`];
}

/**
 * Diff rows for update_route: for each candidate field (the UPDATABLE_ROUTE_FIELDS
 * keys the model supplied), emit a row only when the validated new value actually
 * differs from the current one (full JSON.stringify comparison — a field
 * "updated" to an identical value produces no row). Previews are clamped to
 * 80 chars; when the change lies PAST the preview clamp (both plain previews
 * would be byte-identical) the previews are re-anchored at the first
 * divergent character so the confirm card always shows a real difference.
 * The compare is NOT clamped.
 */
export function computeRouteFieldDiffs(
  before: Omit<RouteConfig, 'id'>,
  after: Omit<RouteConfig, 'id'>,
  fields: readonly string[]
): RouteFieldDiff[] {
  const stringify = (v: unknown): string => {
    try {
      return JSON.stringify(v) ?? 'undefined';
    } catch {
      return String(v);
    }
  };
  const diffs: RouteFieldDiff[] = [];
  for (const field of fields) {
    const b = (before as unknown as Record<string, unknown>)[field];
    const a = (after as unknown as Record<string, unknown>)[field];
    const bText = stringify(b);
    const aText = stringify(a);
    if (bText !== aText) {
      let beforePreview = valuePreview(b);
      let afterPreview = valuePreview(a);
      if (beforePreview === afterPreview) {
        // The difference is past the 80-char prefix — window both previews
        // around the first divergent offset instead of showing X → X.
        let at = 0;
        while (at < bText.length && at < aText.length && bText[at] === aText[at]) {
          at++;
        }
        beforePreview = divergentPreview(bText, at);
        afterPreview = divergentPreview(aText, at);
      }
      diffs.push({ field: clampLine(field, 40), before: beforePreview, after: afterPreview });
    }
  }
  return diffs;
}

/**
 * Bounded one-line preview windowed to start shortly before `divergeAt`, with
 * a leading '…' when the shared prefix is elided. Total length ≤ 80 chars —
 * the same budget as {@link valuePreview} (and the protocol's field cap).
 */
export function divergentPreview(text: string, divergeAt: number): string {
  const context = 24; // shared-context chars kept ahead of the divergence
  const start = divergeAt <= context ? 0 : divergeAt - context;
  const window = clampLine(text.slice(start), 78);
  return start > 0 ? `…${window}` : window;
}

/**
 * Non-static behavior the approving user MUST see before a route is applied,
 * one line per fact. Proxy targets are spelled out (a hidden targetUrl would
 * turn an approved "benign" route into an SSRF/exfiltration primitive),
 * database operations name their connection, and sequences are walked
 * recursively because their steps can nest any of the above.
 */
export function responseDisclosure(response: RouteConfig['response']): string[] {
  switch (response.type) {
    case 'proxy':
      return [
        `PROXIES live requests to ${
          response.proxy?.targetUrl !== undefined
            ? clampLine(response.proxy.targetUrl, PROXY_TARGET_PREVIEW_CHARS)
            : '(no targetUrl configured)'
        }`,
      ];
    case 'database':
      return [
        `runs database operation "${response.database?.operation ?? '?'}" on connection "${
          response.database?.connectionId ?? '?'
        }"`,
      ];
    case 'dynamic':
      return ['renders a dynamic Handlebars template'];
    case 'sequence': {
      const steps = response.sequence?.responses ?? [];
      return [`responds with a ${steps.length}-step sequence`, ...steps.flatMap(responseDisclosure)];
    }
    default:
      return [];
  }
}

/** One confirmation-detail line for a route: method, path, status, plus any
 * non-static response behavior from {@link responseDisclosure}. */
export function routeConfirmLine(route: Omit<RouteConfig, 'id'>): string {
  const base = `${methodLabel(route.method)} ${route.path} → ${route.response.statusCode}`;
  const notes = responseDisclosure(route.response);
  return notes.length > 0 ? `${base} — ${notes.join('; ')}` : base;
}

/** Bounded one-line preview of a route field value for confirmation details. */
export function valuePreview(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? 'undefined';
  } catch {
    text = String(value);
  }
  return clampLine(text, 80);
}

/** Single-line clamp used for names/summaries (same shape as askUser's singleLine). */
export function clampLine(raw: string, maxChars: number): string {
  const flattened = raw.replace(/\s+/g, ' ').trim();
  return flattened.length > maxChars ? `${flattened.slice(0, maxChars)}…` : flattened;
}

/**
 * The per-route item schema, extracted from
 * ROUTES_JSON_SCHEMA.properties.routes.items so both stay in lockstep.
 */
export function routeItemJsonSchema(): Record<string, unknown> {
  const properties = ROUTES_JSON_SCHEMA.properties as Record<string, unknown>;
  const routes = properties.routes as Record<string, unknown>;
  return structuredClone(routes.items) as Record<string, unknown>;
}

// -- Private helpers --

function routeMethods(route: RouteConfig): string[] {
  return Array.isArray(route.method) ? route.method : [route.method];
}

function methodLabel(method: RouteConfig['method']): string {
  return Array.isArray(method) ? method.join('|') : method;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Bounded single-line echo of a model-supplied reference for error messages. */
function refPreview(ref: unknown): string {
  const text = typeof ref === 'string' ? ref : JSON.stringify(ref ?? '') ?? '';
  return clampLine(text, 80);
}

/** Coerce the get_request_logs limit to an integer in 1–LOGS_MAX_LIMIT. */
function clampLogLimit(raw: unknown): number {
  if (raw === undefined || raw === null) {
    return LOGS_DEFAULT_LIMIT;
  }
  const value = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return LOGS_DEFAULT_LIMIT;
  }
  return Math.min(LOGS_MAX_LIMIT, Math.max(1, Math.trunc(value)));
}

/** Bounded preview of a logged request/response body. */
function bodyPreview(body: unknown): string {
  let text: string;
  if (typeof body === 'string') {
    text = body;
  } else {
    try {
      text = JSON.stringify(body ?? null) ?? 'null';
    } catch {
      text = String(body);
    }
  }
  return text.length > LOG_BODY_PREVIEW_CHARS ? `${text.slice(0, LOG_BODY_PREVIEW_CHARS)}…` : text;
}

/** Bound one tool result to TOOL_OUTPUT_MAX_CHARS, noting the truncation. */
function clampToolOutput(text: string): string {
  if (text.length <= TOOL_OUTPUT_MAX_CHARS) {
    return text;
  }
  const note = '\n…output truncated.';
  return `${text.slice(0, TOOL_OUTPUT_MAX_CHARS - note.length)}${note}`;
}

// ---- Tools ----

const APPROVAL_NOTE =
  'The user is asked to approve this change; a refusal is final — do not retry it.';

const TOOL_DEFINITIONS: AiToolDefinition[] = [
  {
    name: 'list_servers',
    description:
      'List all mock servers with their id, name, port, protocol, running status, base URL, and routes (id, method, path, status code, enabled). Call this FIRST to discover what exists — never assume server or route ids.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_route',
    description:
      "Read one route's full configuration. Pass the server (id or name) and the route (route id, or 'METHOD /path'). Call this before update_route or delete_route.",
    inputSchema: {
      type: 'object',
      properties: {
        server: { type: 'string', description: 'Server id or name.' },
        route: { type: 'string', description: 'Route id, or "METHOD /path" like "GET /api/users".' },
      },
      required: ['server', 'route'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_request_logs',
    description:
      'Read recent request log entries (newest FIRST — the first element is the most recent request): timestamp, method, path, status, duration, matched. Unmatched entries (matched=false) hit the server but no route handled them. Set includeBodies true only when you need payloads.',
    inputSchema: {
      type: 'object',
      properties: {
        server: { type: 'string', description: 'Optional server id or name to filter by.' },
        limit: { type: 'number', description: 'Max entries to return (default 25, max 100).' },
        includeBodies: {
          type: 'boolean',
          description: 'Include truncated request/response body previews.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'create_server',
    description: `Create a new mock server. Provide a short name; optionally a port (1024-65535) and a protocol (http, graphql, websocket). The server starts empty and stopped — add routes with add_route, then start_server. ${APPROVAL_NOTE}`,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Short human-readable server name.' },
        port: { type: 'number', description: 'Optional port between 1024 and 65535.' },
        protocol: {
          type: 'string',
          enum: ['http', 'graphql', 'websocket'],
          description: 'Optional protocol; defaults to http.',
        },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_route',
    description: `Add up to 20 routes to an existing mock server in one call. Each route needs name, method, path (Express-style, :param for path parameters), and a response with statusCode plus a JSON body or a handlebars template. ${APPROVAL_NOTE}`,
    inputSchema: {
      type: 'object',
      properties: {
        server: { type: 'string', description: 'Server id or name.' },
        routes: {
          type: 'array',
          items: routeItemJsonSchema(),
          description: 'Routes to add (max 20 per call).',
        },
      },
      required: ['server', 'routes'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_route',
    description: `Update fields of one existing route. Pass the server (id or name), the route (route id, or 'METHOD /path'), and an updates object with ONLY the fields to change (${UPDATABLE_ROUTE_FIELDS.join(', ')}). Call get_route first to see the current configuration. ${APPROVAL_NOTE}`,
    inputSchema: {
      type: 'object',
      properties: {
        server: { type: 'string', description: 'Server id or name.' },
        route: { type: 'string', description: 'Route id, or "METHOD /path" like "GET /api/users".' },
        updates: { ...routeItemJsonSchema(), required: [] },
      },
      required: ['server', 'route', 'updates'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_route',
    description: `Delete one route from a mock server. Pass the server (id or name) and the route (route id, or 'METHOD /path'). ${APPROVAL_NOTE}`,
    inputSchema: {
      type: 'object',
      properties: {
        server: { type: 'string', description: 'Server id or name.' },
        route: { type: 'string', description: 'Route id, or "METHOD /path" like "GET /api/users".' },
      },
      required: ['server', 'route'],
      additionalProperties: false,
    },
  },
  {
    name: 'start_server',
    description: `Start a mock server so it serves its routes at http://localhost:<port>. ${APPROVAL_NOTE}`,
    inputSchema: {
      type: 'object',
      properties: {
        server: { type: 'string', description: 'Server id or name.' },
      },
      required: ['server'],
      additionalProperties: false,
    },
  },
  {
    name: 'stop_server',
    description: `Stop a running mock server. ${APPROVAL_NOTE}`,
    inputSchema: {
      type: 'object',
      properties: {
        server: { type: 'string', description: 'Server id or name.' },
      },
      required: ['server'],
      additionalProperties: false,
    },
  },
];
