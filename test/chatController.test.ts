import { describe, it, expect, vi } from 'vitest';
import {
  CHAT_UNDO_MAX_SNAPSHOTS,
  ChatController,
  type ChatCancellation,
} from '../src/ai/chat/ChatController';
import {
  CHAT_SESSION_DEFAULT_TITLE,
  CHAT_SESSION_TITLE_MAX_CHARS,
  type ChatAssistantMessage,
  type ChatConfirmRequest,
  type ChatMessageFromExtension,
  type ChatUserMessage,
  type ChatViewState,
} from '../src/ai/chat/chatProtocol';
import {
  CHAT_SESSIONS_MAX,
  type ChatStateStorage,
} from '../src/ai/chat/chatSessionStore';
import { MUTATION_DENIED_MESSAGE, type ServerToolsHost } from '../src/ai/agent/serverTools';
import {
  SERVER_AGENT_CANCELLED_TEXT,
  type ServerAgentAi,
} from '../src/ai/agent/serverAgent';
import { AiUnavailableError, type AiToolCall } from '../src/ai/providers/types';
import type {
  MockServerConfig,
  RequestLogEntry,
  RouteConfig,
  ServerRuntimeState,
} from '../src/types/core';

// ---------------------------------------------------------------------------
// Fake host (structural, like serverTools.test.ts — the REAL belt runs on it)
// ---------------------------------------------------------------------------

let idCounter = 0;
const nextId = (prefix: string): string => `${prefix}-${++idCounter}`;

/** In-memory structural Memento (workspaceState stand-in). */
class MemStorage implements ChatStateStorage {
  data = new Map<string, unknown>();
  get(k: string): unknown {
    return this.data.get(k);
  }
  update(k: string, v: unknown): unknown {
    this.data.set(k, structuredClone(v));
    return undefined;
  }
}

class FakeHost implements ServerToolsHost {
  servers = new Map<string, MockServerConfig>();
  states = new Map<string, ServerRuntimeState>();

  async getServers(): Promise<MockServerConfig[]> {
    return [...this.servers.values()];
  }

  async getServer(serverId: string): Promise<MockServerConfig | undefined> {
    return this.servers.get(serverId);
  }

  getServerState(serverId: string): ServerRuntimeState | undefined {
    return this.states.get(serverId);
  }

  getLogEntries(): RequestLogEntry[] {
    return [];
  }

  async createServer(
    name: string,
    port?: number,
    protocol: 'http' | 'graphql' | 'websocket' = 'http'
  ): Promise<MockServerConfig> {
    const server: MockServerConfig = {
      id: nextId('srv'),
      name,
      port: port ?? 3000,
      protocol,
      enabled: true,
      routes: [],
    };
    this.servers.set(server.id, server);
    this.states.set(server.id, { id: server.id, status: 'stopped', port: server.port, requestCount: 0 });
    return server;
  }

  async deleteServer(serverId: string): Promise<void> {
    this.servers.delete(serverId);
    this.states.delete(serverId);
  }

  async addRoute(serverId: string, route: Omit<RouteConfig, 'id'>): Promise<RouteConfig> {
    const created: RouteConfig = { ...route, id: nextId('route') };
    this.servers.get(serverId)!.routes.push(created);
    return created;
  }

  async addRoutes(serverId: string, routes: Omit<RouteConfig, 'id'>[]): Promise<RouteConfig[]> {
    const created = routes.map((route) => ({ ...route, id: nextId('route') }));
    this.servers.get(serverId)!.routes.push(...created);
    return created;
  }

  async updateRoute(serverId: string, routeId: string, updates: Partial<RouteConfig>): Promise<void> {
    const server = this.servers.get(serverId)!;
    const index = server.routes.findIndex((route) => route.id === routeId);
    server.routes[index] = { ...server.routes[index]!, ...updates, id: routeId };
  }

  async deleteRoute(serverId: string, routeId: string): Promise<void> {
    const server = this.servers.get(serverId)!;
    server.routes = server.routes.filter((route) => route.id !== routeId);
  }

  async startServer(serverId: string): Promise<void> {
    const server = this.servers.get(serverId)!;
    this.states.set(serverId, { id: serverId, status: 'running', port: server.port, requestCount: 0 });
  }

  async stopServer(serverId: string): Promise<void> {
    const server = this.servers.get(serverId)!;
    this.states.set(serverId, { id: serverId, status: 'stopped', port: server.port, requestCount: 0 });
  }
}

function seedServer(host: FakeHost): MockServerConfig {
  const server: MockServerConfig = {
    id: nextId('srv'),
    name: 'Payments API',
    port: 4100,
    protocol: 'http',
    enabled: true,
    routes: [
      {
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
      },
    ],
  };
  host.servers.set(server.id, server);
  host.states.set(server.id, { id: server.id, status: 'stopped', port: server.port, requestCount: 0 });
  return server;
}

// ---------------------------------------------------------------------------
// Scripted AI + fake cancellation
// ---------------------------------------------------------------------------

interface TurnScript {
  calls: AiToolCall[];
  finalText?: string;
  /** Thrown after the calls execute (post-mutation failure). */
  throwAfter?: unknown;
}

/**
 * Scripted AI: each runToolLoop call consumes the next TurnScript, driving
 * the routed executor like the real loop (onToolCall first, token honored
 * before and after each call — a cancelled token throws Canceled, mirroring
 * the provider loops).
 */
function createScriptedAi(scripts: TurnScript[]) {
  let turn = 0;
  const results: string[][] = [];
  const throwCanceled = (): never => {
    const error = new Error('Cancelled');
    error.name = 'Canceled';
    throw error;
  };
  const ai: ServerAgentAi = {
    async runToolLoop(_prompt, _tools, execute, options) {
      const script = scripts[Math.min(turn, scripts.length - 1)]!;
      turn += 1;
      const turnResults: string[] = [];
      results.push(turnResults);
      let index = 0;
      for (const call of script.calls) {
        if (options?.token?.isCancellationRequested) {
          throwCanceled();
        }
        options?.onToolCall?.(call, index);
        turnResults.push(await execute(call));
        index += 1;
        if (options?.token?.isCancellationRequested) {
          throwCanceled();
        }
      }
      if (script.throwAfter !== undefined) {
        throw script.throwAfter;
      }
      return script.finalText ?? 'Done.';
    },
  };
  return { ai, results };
}

function fakeCancellationFactory() {
  const created: ChatCancellation[] = [];
  const create = (): ChatCancellation => {
    let cancelled = false;
    const listeners: Array<() => void> = [];
    const token = {
      get isCancellationRequested() {
        return cancelled;
      },
      onCancellationRequested(listener: () => void) {
        listeners.push(listener);
        return { dispose: () => undefined };
      },
    } as unknown as ChatCancellation['token'];
    const cancellation: ChatCancellation = {
      token,
      cancel: () => {
        if (!cancelled) {
          cancelled = true;
          for (const listener of [...listeners]) {
            listener();
          }
        }
      },
      dispose: () => undefined,
    };
    created.push(cancellation);
    return cancellation;
  };
  return { create, created };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const ROUTE_INPUT = {
  name: 'Get payment',
  enabled: true,
  method: 'GET',
  path: '/api/pay',
  response: {
    type: 'static',
    statusCode: 200,
    body: { contentType: 'application/json', content: { id: 1, amount: 10 } },
  },
};

const addRouteCall = (server: string): AiToolCall => ({
  name: 'add_route',
  input: { server, routes: [ROUTE_INPUT] },
});

function createHarness(
  scripts: TurnScript[],
  options?: {
    autoApprove?: boolean;
    storage?: MemStorage;
    openExternal?: (url: string) => unknown;
    now?: () => number;
  }
) {
  const host = new FakeHost();
  const server = seedServer(host);
  const { ai, results } = createScriptedAi(scripts);
  const cancellations = fakeCancellationFactory();
  const posts: ChatMessageFromExtension[] = [];
  let counter = 0;
  const controller = new ChatController({
    host,
    ai,
    createCancellation: cancellations.create,
    createId: () => `id-${++counter}`,
    now: options?.now ?? ((): number => 42),
    confirmTimeoutMs: 60_000,
    ...(options?.storage ? { storage: options.storage, persistDebounceMs: 0 } : {}),
    ...(options?.openExternal ? { openExternal: options.openExternal } : {}),
  });
  controller.attach((message) => {
    posts.push(message);
    if (options?.autoApprove && message.type === 'chatConfirmRequest') {
      queueMicrotask(() => {
        void controller.handleMessage({
          type: 'chatConfirm',
          data: { id: message.request.id, approved: true },
        });
      });
    }
  });

  const assistantUpdates = (): ChatAssistantMessage[] =>
    posts
      .filter(
        (post): post is { type: 'chatAssistantUpdate'; message: ChatAssistantMessage } =>
          post.type === 'chatAssistantUpdate'
      )
      .map((post) => post.message);
  const lastAssistant = (): ChatAssistantMessage | undefined => assistantUpdates().at(-1);
  const confirmRequests = (): ChatConfirmRequest[] =>
    posts
      .filter(
        (post): post is { type: 'chatConfirmRequest'; request: ChatConfirmRequest } =>
          post.type === 'chatConfirmRequest'
      )
      .map((post) => post.request);
  const lastState = (): ChatViewState | undefined =>
    posts
      .filter((post): post is { type: 'chatState'; state: ChatViewState } => post.type === 'chatState')
      .at(-1)?.state;
  const sessionsUpdates = (): Extract<ChatMessageFromExtension, { type: 'chatSessionsUpdate' }>[] =>
    posts.filter(
      (post): post is Extract<ChatMessageFromExtension, { type: 'chatSessionsUpdate' }> =>
        post.type === 'chatSessionsUpdate'
    );

  return {
    host,
    server,
    controller,
    posts,
    results,
    cancellations,
    assistantUpdates,
    lastAssistant,
    confirmRequests,
    lastState,
    sessionsUpdates,
  };
}

/** Poll until the predicate holds (the turn runs fire-and-forget). */
async function waitFor(predicate: () => boolean, what = 'condition'): Promise<void> {
  for (let i = 0; i < 1_000; i += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

const finished = (message: ChatAssistantMessage | undefined): boolean =>
  message !== undefined && message.status !== 'running';

// ---------------------------------------------------------------------------
// Turn flows
// ---------------------------------------------------------------------------

describe('ChatController turn flows', () => {
  it('approve path: confirm card → belt executes → complete with action and available undo', async () => {
    const h = createHarness([{ calls: [addRouteCall('Payments API')], finalText: 'Added the route.' }]);

    expect(await h.controller.handleMessage({ type: 'chatSend', data: { text: 'add a pay route' } })).toBe(true);
    await waitFor(() => h.confirmRequests().length === 1, 'confirm card');

    const request = h.confirmRequests()[0]!;
    expect(request.title).toContain('Add 1 route(s) to "Payments API"');
    expect(request.detail).toContain('GET /api/pay → 200');

    await h.controller.handleMessage({ type: 'chatConfirm', data: { id: request.id, approved: true } });
    await waitFor(() => finished(h.lastAssistant()), 'turn completion');

    const final = h.lastAssistant()!;
    expect(final.status).toBe('complete');
    expect(final.text).toBe('Added the route.');
    expect(final.actions).toHaveLength(1);
    expect(final.actions[0]).toMatchObject({ kind: 'add_route', serverName: 'Payments API' });
    expect(final.actions[0]).not.toHaveProperty('serverId');
    expect(final.undo).toMatchObject({ state: 'available' });
    expect(h.server.routes.map((route) => route.path)).toEqual(['/api/users', '/api/pay']);
    expect(
      h.posts.some((post) => post.type === 'chatConfirmResolved' && post.reason === 'user' && post.approved)
    ).toBe(true);
  });

  it('deny path: no mutation, no undo, MUTATION_DENIED_MESSAGE fed to the model', async () => {
    const h = createHarness([{ calls: [addRouteCall('Payments API')], finalText: 'Understood.' }]);

    await h.controller.handleMessage({ type: 'chatSend', data: { text: 'add a pay route' } });
    await waitFor(() => h.confirmRequests().length === 1, 'confirm card');
    await h.controller.handleMessage({
      type: 'chatConfirm',
      data: { id: h.confirmRequests()[0]!.id, approved: false },
    });
    await waitFor(() => finished(h.lastAssistant()), 'turn completion');

    const final = h.lastAssistant()!;
    expect(final.status).toBe('complete');
    expect(final.actions).toEqual([]);
    expect(final.undo).toBeUndefined();
    expect(h.results[0]![0]).toBe(MUTATION_DENIED_MESSAGE);
    expect(h.server.routes).toHaveLength(1); // untouched
  });

  it('chatStop mid-confirm: cancelled turn keeps partial actions + undo', async () => {
    const h = createHarness([
      { calls: [addRouteCall('Payments API'), addRouteCall('Payments API')], finalText: 'never' },
    ]);

    await h.controller.handleMessage({ type: 'chatSend', data: { text: 'add two routes' } });
    await waitFor(() => h.confirmRequests().length === 1, 'first confirm card');
    await h.controller.handleMessage({
      type: 'chatConfirm',
      data: { id: h.confirmRequests()[0]!.id, approved: true },
    });
    await waitFor(() => h.confirmRequests().length === 2, 'second confirm card');

    await h.controller.handleMessage({ type: 'chatStop' });
    await waitFor(() => finished(h.lastAssistant()), 'cancelled completion');

    const final = h.lastAssistant()!;
    expect(final.status).toBe('cancelled');
    expect(final.text).toBe(SERVER_AGENT_CANCELLED_TEXT);
    expect(final.actions).toHaveLength(1); // the approved first mutation
    expect(final.undo).toMatchObject({ state: 'available' });
    expect(
      h.posts.some(
        (post) =>
          post.type === 'chatConfirmResolved' &&
          post.id === h.confirmRequests()[1]!.id &&
          !post.approved &&
          post.reason === 'cancelled'
      )
    ).toBe(true);
    expect(h.server.routes).toHaveLength(2); // seed + one applied
  });

  it('turn throw after an applied action: error status with actions + undo preserved', async () => {
    const h = createHarness(
      [{ calls: [addRouteCall('Payments API')], throwAfter: new Error('model exploded') }],
      { autoApprove: true }
    );

    await h.controller.handleMessage({ type: 'chatSend', data: { text: 'add then die' } });
    await waitFor(() => finished(h.lastAssistant()), 'error completion');

    const final = h.lastAssistant()!;
    expect(final.status).toBe('error');
    expect(final.errorMessage).toBe('model exploded');
    expect(final.text).toBe('');
    expect(final.actions).toHaveLength(1);
    expect(final.undo).toMatchObject({ state: 'available' });
  });

  it('surfaces AiUnavailableError messages verbatim', async () => {
    const h = createHarness([
      { calls: [], throwAfter: new AiUnavailableError('No AI provider configured.') },
    ]);

    await h.controller.handleMessage({ type: 'chatSend', data: { text: 'hello' } });
    await waitFor(() => finished(h.lastAssistant()), 'error completion');

    expect(h.lastAssistant()!.status).toBe('error');
    expect(h.lastAssistant()!.errorMessage).toBe('No AI provider configured.');
  });

  it('streams tool progress lines into the running assistant message', async () => {
    const h = createHarness([{ calls: [{ name: 'list_servers', input: {} }], finalText: 'Two servers.' }]);

    await h.controller.handleMessage({ type: 'chatSend', data: { text: 'list servers' } });
    await waitFor(() => finished(h.lastAssistant()), 'completion');

    const withProgress = h.assistantUpdates().find((m) => m.progress.length > 0)!;
    expect(withProgress.progress[0]).toContain('Server agent: listing mock servers');
    expect(h.lastAssistant()!.progress).toEqual(withProgress.progress);
  });

  it('passes prior completed turns as history to the next turn', async () => {
    const host = new FakeHost();
    seedServer(host);
    const prompts: string[] = [];
    const ai: ServerAgentAi = {
      async runToolLoop(prompt) {
        prompts.push(prompt);
        return 'First answer.';
      },
    };
    const cancellations = fakeCancellationFactory();
    const posts: ChatMessageFromExtension[] = [];
    const controller = new ChatController({ host, ai, createCancellation: cancellations.create });
    controller.attach((message) => posts.push(message));

    await controller.handleMessage({ type: 'chatSend', data: { text: 'first question' } });
    await waitFor(
      () => posts.some((p) => p.type === 'chatAssistantUpdate' && p.message.status === 'complete'),
      'first turn'
    );
    await controller.handleMessage({ type: 'chatSend', data: { text: 'second question' } });
    await waitFor(() => prompts.length === 2, 'second turn');

    expect(prompts[0]).not.toContain('Conversation so far:');
    expect(prompts[1]).toContain('Conversation so far:');
    expect(prompts[1]).toContain('User: first question');
    expect(prompts[1]).toContain('Assistant: First answer.');
  });
});

// ---------------------------------------------------------------------------
// Detach / reattach
// ---------------------------------------------------------------------------

describe('ChatController detach', () => {
  it('mid-turn detach denies the confirm (disposed), cancels, and replays after reattach', async () => {
    const h = createHarness([{ calls: [addRouteCall('Payments API')], finalText: 'never' }]);

    await h.controller.handleMessage({ type: 'chatSend', data: { text: 'add a route' } });
    await waitFor(() => h.confirmRequests().length === 1, 'confirm card');

    h.controller.detach();
    const resolved = h.posts.find((post) => post.type === 'chatConfirmResolved');
    expect(resolved).toMatchObject({ approved: false, reason: 'disposed' });
    expect(h.cancellations.created[0]!.token.isCancellationRequested).toBe(true);

    const postsAfterDetach = h.posts.length;
    // The turn's finally block still runs and records the outcome silently.
    const replayed: ChatMessageFromExtension[] = [];
    h.controller.attach((message) => replayed.push(message));
    await waitFor(() => {
      void h.controller.handleMessage({ type: 'chatSync' });
      const state = replayed
        .filter((p): p is { type: 'chatState'; state: ChatViewState } => p.type === 'chatState')
        .at(-1)?.state;
      return state !== undefined && !state.running;
    }, 'replayed transcript');

    expect(h.posts).toHaveLength(postsAfterDetach); // nothing more hit the old sink
    const state = replayed
      .filter((p): p is { type: 'chatState'; state: ChatViewState } => p.type === 'chatState')
      .at(-1)!.state;
    expect(state.pendingConfirm).toBeUndefined();
    const assistant = state.messages[1] as ChatAssistantMessage;
    expect(assistant.status).toBe('cancelled');
    expect(assistant.text).toBe(SERVER_AGENT_CANCELLED_TEXT);
    expect(h.server.routes).toHaveLength(1); // denied — nothing applied
  });

  it('a sink that throws (disposed webview) cannot hang the confirm or abort detach', async () => {
    const h = createHarness([{ calls: [addRouteCall('Payments API')], finalText: 'never' }]);

    await h.controller.handleMessage({ type: 'chatSend', data: { text: 'add a route' } });
    await waitFor(() => h.confirmRequests().length === 1, 'confirm card');

    // VS Code's WebviewPanel disposes its webview BEFORE onDidDispose fires,
    // so a real sink can throw 'Webview is disposed' on the settle post.
    h.controller.attach(() => {
      throw new Error('Webview is disposed');
    });
    expect(() => h.controller.detach()).not.toThrow();
    expect(h.cancellations.created[0]!.token.isCancellationRequested).toBe(true);

    // The belt's confirm promise resolved (false), so the turn still winds
    // down and a reopened panel sees a settled transcript.
    const replayed: ChatMessageFromExtension[] = [];
    h.controller.attach((message) => replayed.push(message));
    await waitFor(() => {
      void h.controller.handleMessage({ type: 'chatSync' });
      const state = replayed
        .filter((p): p is { type: 'chatState'; state: ChatViewState } => p.type === 'chatState')
        .at(-1)?.state;
      return state !== undefined && !state.running;
    }, 'turn settled despite the throwing sink');

    expect(h.server.routes).toHaveLength(1); // denied — nothing applied
  });
});

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

describe('ChatController undo', () => {
  async function completedTurnWithUndo(h: ReturnType<typeof createHarness>): Promise<string> {
    await h.controller.handleMessage({ type: 'chatSend', data: { text: 'add a pay route' } });
    await waitFor(() => finished(h.lastAssistant()), 'turn completion');
    const undoId = h.lastAssistant()!.undo!.undoId;
    expect(h.lastAssistant()!.undo!.state).toBe('available');
    return undoId;
  }

  it('restores the snapshot through the host and posts undoing → undone', async () => {
    const h = createHarness([{ calls: [addRouteCall('Payments API')], finalText: 'Added.' }], {
      autoApprove: true,
    });
    const undoId = await completedTurnWithUndo(h);
    expect(h.server.routes).toHaveLength(2);
    h.posts.length = 0;

    await h.controller.handleMessage({ type: 'chatUndo', data: { undoId } });

    const undoStates = h
      .assistantUpdates()
      .map((message) => message.undo?.state);
    expect(undoStates).toEqual(['undoing', 'undone']);
    expect(h.server.routes.map((route) => route.path)).toEqual(['/api/users']); // restored
  });

  it('a replayed chatUndo mid-restore is refused — the restore runs exactly once', async () => {
    const h = createHarness([{ calls: [addRouteCall('Payments API')], finalText: 'Added.' }], {
      autoApprove: true,
    });
    const undoId = await completedTurnWithUndo(h);
    expect(h.server.routes).toHaveLength(2);
    h.posts.length = 0;

    // Double-click: the second chatUndo lands before the first restore's
    // awaits complete (the webview only disables the button after the
    // 'undoing' update round-trips).
    const first = h.controller.handleMessage({ type: 'chatUndo', data: { undoId } });
    const second = h.controller.handleMessage({ type: 'chatUndo', data: { undoId } });
    await Promise.all([first, second]);

    // Exactly one restore: the seed route set, not duplicated snapshot routes.
    expect(h.server.routes.map((route) => route.path)).toEqual(['/api/users']);
    const undoStates = h.assistantUpdates().map((message) => message.undo?.state);
    expect(undoStates.filter((state) => state === 'undoing')).toHaveLength(1);
    expect(h.lastAssistant()!.undo!.state).toBe('undone');
    // The replay was answered with a busy resync, not a second restore.
    expect(h.posts.some((post) => post.type === 'chatState')).toBe(true);
  });

  it('a chatSend arriving mid-restore is refused with a resync (no concurrent turn)', async () => {
    const h = createHarness([{ calls: [addRouteCall('Payments API')], finalText: 'Added.' }], {
      autoApprove: true,
    });
    const undoId = await completedTurnWithUndo(h);
    expect(h.results).toHaveLength(1);

    const undoPromise = h.controller.handleMessage({ type: 'chatUndo', data: { undoId } });
    await h.controller.handleMessage({ type: 'chatSend', data: { text: 'and now add more' } });
    await undoPromise;

    expect(h.lastAssistant()!.undo!.state).toBe('undone');
    expect(h.results).toHaveLength(1); // no second agent turn ran mid-restore
    expect(h.server.routes.map((route) => route.path)).toEqual(['/api/users']);
  });

  it('a consumed undoId fails with "no longer available"', async () => {
    const h = createHarness([{ calls: [addRouteCall('Payments API')], finalText: 'Added.' }], {
      autoApprove: true,
    });
    const undoId = await completedTurnWithUndo(h);
    await h.controller.handleMessage({ type: 'chatUndo', data: { undoId } });
    h.posts.length = 0;

    await h.controller.handleMessage({ type: 'chatUndo', data: { undoId } });
    expect(h.lastAssistant()!.undo).toEqual({
      undoId,
      state: 'failed',
      error: 'This undo is no longer available.',
    });
  });

  it('an undoId owned by no message is silently dropped (nothing to update)', async () => {
    const h = createHarness([{ calls: [], finalText: 'ok' }]);
    await h.controller.handleMessage({ type: 'chatUndo', data: { undoId: 'ghost' } });
    expect(h.posts).toHaveLength(0);
  });

  it('evicts the oldest snapshot beyond CHAT_UNDO_MAX_SNAPSHOTS and expires its message', async () => {
    const h = createHarness([{ calls: [addRouteCall('Payments API')], finalText: 'Added.' }], {
      autoApprove: true,
    });

    const undoIds: string[] = [];
    for (let i = 0; i < CHAT_UNDO_MAX_SNAPSHOTS + 1; i += 1) {
      const before = h.assistantUpdates().length;
      await h.controller.handleMessage({ type: 'chatSend', data: { text: `turn ${i}` } });
      await waitFor(() => {
        const updates = h.assistantUpdates();
        return updates.length > before && finished(updates.at(-1));
      }, `turn ${i}`);
      undoIds.push(h.lastAssistant()!.undo!.undoId);
    }

    const expired = h
      .assistantUpdates()
      .filter((message) => message.undo?.undoId === undoIds[0])
      .at(-1)!;
    expect(expired.undo).toEqual({
      undoId: undoIds[0],
      state: 'failed',
      error: 'This undo has expired.',
    });

    // The evicted snapshot is gone; the newest one still works.
    h.posts.length = 0;
    await h.controller.handleMessage({ type: 'chatUndo', data: { undoId: undoIds[0]! } });
    expect(h.lastAssistant()!.undo!.error).toBe('This undo is no longer available.');
    await h.controller.handleMessage({ type: 'chatUndo', data: { undoId: undoIds.at(-1)! } });
    expect(h.lastAssistant()!.undo!.state).toBe('undone');
  });
});

// ---------------------------------------------------------------------------
// Busy guards + clear
// ---------------------------------------------------------------------------

describe('ChatController busy guards and clear', () => {
  it('chatSend / chatUndo / chatClear while running are ignored with a chatState resync', async () => {
    const h = createHarness([{ calls: [addRouteCall('Payments API')], finalText: 'never' }]);
    await h.controller.handleMessage({ type: 'chatSend', data: { text: 'add a route' } });
    await waitFor(() => h.confirmRequests().length === 1, 'confirm card');
    h.posts.length = 0;

    await h.controller.handleMessage({ type: 'chatSend', data: { text: 'another' } });
    await h.controller.handleMessage({ type: 'chatUndo', data: { undoId: 'u-1' } });
    await h.controller.handleMessage({ type: 'chatClear' });

    expect(h.posts.map((post) => post.type)).toEqual(['chatState', 'chatState', 'chatState']);
    expect(h.lastState()!.running).toBe(true);
    expect(h.lastState()!.messages).toHaveLength(2); // untouched transcript

    // release the pending confirm so the turn finishes
    await h.controller.handleMessage({
      type: 'chatConfirm',
      data: { id: h.lastState()!.pendingConfirm!.id, approved: false },
    });
    await waitFor(() => finished(h.lastAssistant()), 'turn completion');
  });

  it('chatClear when idle wipes the transcript and frees consumed undo snapshots', async () => {
    const h = createHarness([{ calls: [addRouteCall('Payments API')], finalText: 'Added.' }], {
      autoApprove: true,
    });
    await h.controller.handleMessage({ type: 'chatSend', data: { text: 'add a route' } });
    await waitFor(() => finished(h.lastAssistant()), 'turn completion');
    const undoId = h.lastAssistant()!.undo!.undoId;

    await h.controller.handleMessage({ type: 'chatClear' });
    expect(h.lastState()!.messages).toHaveLength(0);

    // The snapshot was freed with the transcript: a later undo cannot find it,
    // and with no owning message nothing is posted at all.
    h.posts.length = 0;
    await h.controller.handleMessage({ type: 'chatUndo', data: { undoId } });
    expect(h.posts).toHaveLength(0);
  });

  it('chatSync replays the full state', async () => {
    const h = createHarness([{ calls: [], finalText: 'Hi.' }]);
    await h.controller.handleMessage({ type: 'chatSend', data: { text: 'hello' } });
    await waitFor(() => finished(h.lastAssistant()), 'turn completion');

    await h.controller.handleMessage({ type: 'chatSync' });
    const state = h.lastState()!;
    expect(state.running).toBe(false);
    expect(state.messages).toHaveLength(2);
    expect((state.messages[1] as ChatAssistantMessage).text).toBe('Hi.');
  });

  it('chatStop when idle is a harmless no-op', async () => {
    const h = createHarness([{ calls: [], finalText: 'ok' }]);
    await expect(h.controller.handleMessage({ type: 'chatStop' })).resolves.toBe(true);
    expect(h.posts).toHaveLength(0);
  });

  it('unknown confirm ids are dropped without settling anything', async () => {
    const h = createHarness([{ calls: [addRouteCall('Payments API')], finalText: 'Added.' }]);
    await h.controller.handleMessage({ type: 'chatSend', data: { text: 'add a route' } });
    await waitFor(() => h.confirmRequests().length === 1, 'confirm card');

    await h.controller.handleMessage({ type: 'chatConfirm', data: { id: 'ghost', approved: true } });
    expect(h.posts.some((post) => post.type === 'chatConfirmResolved')).toBe(false);

    await h.controller.handleMessage({
      type: 'chatConfirm',
      data: { id: h.confirmRequests()[0]!.id, approved: true },
    });
    await waitFor(() => finished(h.lastAssistant()), 'turn completion');
    expect(h.lastAssistant()!.status).toBe('complete');
  });
});

// ---------------------------------------------------------------------------
// Routing + garbage input
// ---------------------------------------------------------------------------

describe('ChatController.handleMessage routing', () => {
  it('returns false for non-chat garbage and posts nothing', async () => {
    const h = createHarness([{ calls: [], finalText: 'ok' }]);
    expect(await h.controller.handleMessage(null)).toBe(false);
    expect(await h.controller.handleMessage(42)).toBe(false);
    expect(await h.controller.handleMessage({ type: 'evil', __proto__: { x: 1 } })).toBe(false);
    expect(await h.controller.handleMessage({ type: 'startServer', data: {} })).toBe(false);
    expect(h.posts).toHaveLength(0);
  });

  it('returns true for unparseable chat-prefixed garbage, silently dropped', async () => {
    const h = createHarness([{ calls: [], finalText: 'ok' }]);
    expect(await h.controller.handleMessage({ type: 'chatSend' })).toBe(true);
    expect(await h.controller.handleMessage({ type: 'chatSend', data: { text: '   ' } })).toBe(true);
    expect(await h.controller.handleMessage({ type: 'chatBogus' })).toBe(true);
    expect(h.posts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Dispose
// ---------------------------------------------------------------------------

describe('ChatController.dispose', () => {
  it('detaches and frees every undo snapshot', async () => {
    const h = createHarness([{ calls: [addRouteCall('Payments API')], finalText: 'Added.' }], {
      autoApprove: true,
    });
    await h.controller.handleMessage({ type: 'chatSend', data: { text: 'add a route' } });
    await waitFor(() => finished(h.lastAssistant()), 'turn completion');
    const undoId = h.lastAssistant()!.undo!.undoId;

    h.controller.dispose();

    const replayed: ChatMessageFromExtension[] = [];
    h.controller.attach((message) => replayed.push(message));
    await h.controller.handleMessage({ type: 'chatUndo', data: { undoId } });
    const failure = replayed
      .filter(
        (p): p is { type: 'chatAssistantUpdate'; message: ChatAssistantMessage } =>
          p.type === 'chatAssistantUpdate'
      )
      .at(-1)!;
    expect(failure.message.undo).toEqual({
      undoId,
      state: 'failed',
      error: 'This undo is no longer available.',
    });
  });
});

// ---------------------------------------------------------------------------
// Knowledge tool injection
// ---------------------------------------------------------------------------

describe('ChatController knowledge tool', () => {
  it('calls the factory once per turn and offers query_knowledge to the loop', async () => {
    const host = new FakeHost();
    seedServer(host);
    const fakeKnowledgeTool = {
      definitions: [
        {
          name: 'query_knowledge',
          description: 'x',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        },
      ],
      execute: vi.fn(async () => 'knowledge!'),
    };
    const knowledgeTool = vi.fn(() => fakeKnowledgeTool);
    const recordedTools: string[][] = [];
    const ai: ServerAgentAi = {
      async runToolLoop(_prompt, tools) {
        recordedTools.push(tools.map((d) => d.name));
        return 'Answered.';
      },
    };
    const cancellations = fakeCancellationFactory();
    const posts: ChatMessageFromExtension[] = [];
    const controller = new ChatController({
      host,
      ai,
      knowledgeTool,
      createCancellation: cancellations.create,
    });
    controller.attach((message) => posts.push(message));

    await controller.handleMessage({ type: 'chatSend', data: { text: 'what do you know?' } });
    await waitFor(
      () => posts.some((p) => p.type === 'chatAssistantUpdate' && p.message.status === 'complete'),
      'turn completion'
    );

    expect(knowledgeTool).toHaveBeenCalledTimes(1);
    expect(recordedTools).toHaveLength(1);
    expect(recordedTools[0]).toContain('query_knowledge');
  });
});

// ---------------------------------------------------------------------------
// Sessions: fresh construct, auto-title, new/switch/rename/delete (Phase 5)
// ---------------------------------------------------------------------------

/** Monotonic clock for tests that assert updatedAt ordering. */
function incrementingNow(): () => number {
  let t = 0;
  return () => ++t;
}

async function completeTurn(h: ReturnType<typeof createHarness>, text: string): Promise<void> {
  const before = h.assistantUpdates().length;
  await h.controller.handleMessage({ type: 'chatSend', data: { text } });
  await waitFor(() => {
    const updates = h.assistantUpdates();
    return updates.length > before && finished(updates.at(-1));
  }, `turn "${text}"`);
}

describe('ChatController sessions', () => {
  it('fresh construct on empty storage: one default session in the synced state', async () => {
    const h = createHarness([{ calls: [], finalText: 'ok' }], { storage: new MemStorage() });
    await h.controller.handleMessage({ type: 'chatSync' });

    const state = h.lastState()!;
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]!.title).toBe(CHAT_SESSION_DEFAULT_TITLE);
    expect(state.sessions[0]!.messageCount).toBe(0);
    expect(state.activeSessionId).toBe(state.sessions[0]!.id);
    expect(state.messages).toEqual([]);
    expect(state.running).toBe(false);
  });

  it('auto-titles on the FIRST send (clamped) and never re-titles on the second', async () => {
    const h = createHarness([{ calls: [], finalText: 'ok' }]);
    const longPrompt = 'p'.repeat(CHAT_SESSION_TITLE_MAX_CHARS + 20);
    await completeTurn(h, longPrompt);

    const clamped = `${'p'.repeat(CHAT_SESSION_TITLE_MAX_CHARS)}…`;
    expect(h.sessionsUpdates().length).toBeGreaterThan(0);
    expect(h.sessionsUpdates().at(-1)!.sessions[0]!.title).toBe(clamped);

    await completeTurn(h, 'a totally different prompt');
    expect(h.sessionsUpdates().at(-1)!.sessions[0]!.title).toBe(clamped);
  });

  it('chatNewSession after a turn opens an empty second session; a second chatNewSession only resyncs', async () => {
    const h = createHarness([{ calls: [], finalText: 'ok' }], { now: incrementingNow() });
    await completeTurn(h, 'hello');

    await h.controller.handleMessage({ type: 'chatNewSession' });
    const state = h.lastState()!;
    expect(state.sessions).toHaveLength(2);
    expect(state.messages).toEqual([]);
    expect(state.sessions[0]!.id).toBe(state.activeSessionId); // newest first
    expect(state.sessions[0]!.title).toBe(CHAT_SESSION_DEFAULT_TITLE);
    expect(state.sessions[1]!.title).toBe('hello');

    // Active session is empty — reuse it instead of spamming the list.
    h.posts.length = 0;
    await h.controller.handleMessage({ type: 'chatNewSession' });
    expect(h.posts.map((post) => post.type)).toEqual(['chatState']);
    expect(h.lastState()!.sessions).toHaveLength(2);
  });

  it('switching while idle swaps the transcripts exactly', async () => {
    const h = createHarness([{ calls: [], finalText: 'answer' }], { now: incrementingNow() });
    await completeTurn(h, 'first session prompt');
    await h.controller.handleMessage({ type: 'chatSync' });
    const sessionA = h.lastState()!.activeSessionId;

    await h.controller.handleMessage({ type: 'chatNewSession' });
    await completeTurn(h, 'second session prompt');

    await h.controller.handleMessage({ type: 'chatSwitchSession', data: { id: sessionA } });
    const state = h.lastState()!;
    expect(state.activeSessionId).toBe(sessionA);
    expect(state.messages.map((m) => (m as { text?: string }).text ?? '')).toEqual([
      'first session prompt',
      'answer',
    ]);
    expect(state.running).toBe(false);
  });

  it('unknown switch/delete ids and switching to the active id only resync', async () => {
    const h = createHarness([{ calls: [], finalText: 'ok' }]);
    await h.controller.handleMessage({ type: 'chatSync' });
    const activeId = h.lastState()!.activeSessionId;
    h.posts.length = 0;

    await h.controller.handleMessage({ type: 'chatSwitchSession', data: { id: 'ghost' } });
    await h.controller.handleMessage({ type: 'chatSwitchSession', data: { id: activeId } });
    await h.controller.handleMessage({ type: 'chatDeleteSession', data: { id: 'ghost' } });
    expect(h.posts.map((post) => post.type)).toEqual(['chatState', 'chatState', 'chatState']);
    expect(h.lastState()!.sessions).toHaveLength(1);
  });

  it('switching mid-turn denies the pending confirm and the cancelled turn settles into its own session', async () => {
    const h = createHarness(
      [
        { calls: [], finalText: 'hi' },
        { calls: [addRouteCall('Payments API')], finalText: 'never' },
      ],
      { now: incrementingNow() }
    );
    await completeTurn(h, 'hello');
    await h.controller.handleMessage({ type: 'chatSync' });
    const sessionA = h.lastState()!.activeSessionId;

    await h.controller.handleMessage({ type: 'chatNewSession' });
    const sessionB = h.lastState()!.activeSessionId;
    expect(sessionB).not.toBe(sessionA);

    await h.controller.handleMessage({ type: 'chatSend', data: { text: 'add a route' } });
    await waitFor(() => h.confirmRequests().length === 1, 'confirm card');
    const confirmId = h.confirmRequests()[0]!.id;

    await h.controller.handleMessage({ type: 'chatSwitchSession', data: { id: sessionA } });
    expect(
      h.posts.some(
        (post) =>
          post.type === 'chatConfirmResolved' &&
          post.id === confirmId &&
          !post.approved &&
          post.reason === 'cancelled'
      )
    ).toBe(true);
    // The switch restored A's transcript untouched.
    expect(h.lastState()!.activeSessionId).toBe(sessionA);
    expect(h.lastState()!.messages.map((m) => (m as { text?: string }).text)).toEqual([
      'hello',
      'hi',
    ]);
    expect(h.lastState()!.pendingConfirm).toBeUndefined();

    // The denied mutation answered the model with MUTATION_DENIED_MESSAGE.
    await waitFor(() => (h.results[1]?.length ?? 0) === 1, 'belt denial');
    expect(h.results[1]![0]).toBe(MUTATION_DENIED_MESSAGE);
    expect(h.server.routes).toHaveLength(1); // nothing applied

    // The cancelled turn completed into B (its own, now background, session).
    await h.controller.handleMessage({ type: 'chatSwitchSession', data: { id: sessionB } });
    await waitFor(() => {
      void h.controller.handleMessage({ type: 'chatSync' });
      const assistant = h.lastState()?.messages[1] as ChatAssistantMessage | undefined;
      return assistant !== undefined && assistant.status === 'cancelled';
    }, 'cancelled settle in the original session');
    const assistant = h.lastState()!.messages[1] as ChatAssistantMessage;
    expect(assistant.text).toBe(SERVER_AGENT_CANCELLED_TEXT);
    expect((h.lastState()!.messages[0] as ChatUserMessage).text).toBe('add a route');
  });

  it('a session op mid-turn advertises running:true until the cancelled turn settles, then resyncs idle', async () => {
    // A turn whose provider/tool call outlives cancellation (cooperative
    // cancel — e.g. start_server mid-flight). The settle window must never
    // present an idle composer that silently eats a chatSend.
    const host = new FakeHost();
    seedServer(host);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let loopCalls = 0;
    const ai: ServerAgentAi = {
      async runToolLoop() {
        loopCalls += 1;
        if (loopCalls === 1) {
          return 'hi';
        }
        await gate; // ignores cancellation until released
        return 'late';
      },
    };
    const posts: ChatMessageFromExtension[] = [];
    let counter = 0;
    const controller = new ChatController({
      host,
      ai,
      createCancellation: fakeCancellationFactory().create,
      createId: () => `settle-${++counter}`,
      now: incrementingNow(),
      confirmTimeoutMs: 60_000,
    });
    controller.attach((message) => posts.push(message));
    const states = (): ChatViewState[] =>
      posts
        .filter((post): post is { type: 'chatState'; state: ChatViewState } => post.type === 'chatState')
        .map((post) => post.state);

    // Session A gets one completed turn so chatNewSession creates B.
    await controller.handleMessage({ type: 'chatSend', data: { text: 'hello' } });
    await waitFor(() => {
      const updates = posts.filter(
        (post): post is { type: 'chatAssistantUpdate'; message: ChatAssistantMessage } =>
          post.type === 'chatAssistantUpdate'
      );
      return updates.length > 0 && finished(updates.at(-1)!.message);
    }, 'first turn');
    await controller.handleMessage({ type: 'chatSync' });
    const sessionA = states().at(-1)!.activeSessionId;

    await controller.handleMessage({ type: 'chatNewSession' });
    // Start the gated turn in session B, then switch back to A mid-flight.
    await controller.handleMessage({ type: 'chatSend', data: { text: 'slow prompt' } });
    await controller.handleMessage({ type: 'chatSwitchSession', data: { id: sessionA } });

    // The synced state for A advertises running:true — the composer stays
    // disabled, so no draft can be typed+cleared inside the settle window.
    const afterSwitch = states().at(-1)!;
    expect(afterSwitch.activeSessionId).toBe(sessionA);
    expect(afterSwitch.running).toBe(true);

    // A (hypothetical) chatSend in the window is refused with a resync that
    // STILL says running:true — never an idle state after a swallowed send.
    posts.length = 0;
    await controller.handleMessage({ type: 'chatSend', data: { text: 'eaten?' } });
    expect(states().at(-1)!.running).toBe(true);
    expect(states().at(-1)!.messages.some((m) => (m as { text?: string }).text === 'eaten?')).toBe(
      false
    );

    // Turn settles → the controller resyncs the ACTIVE session idle.
    release();
    await waitFor(() => states().some((state) => !state.running), 'post-settle resync');
    const settled = states().at(-1)!;
    expect(settled.activeSessionId).toBe(sessionA);
    expect(settled.running).toBe(false);
    controller.dispose();
  });

  it('rename updates the title without reordering; unknown ids resync', async () => {
    const h = createHarness([{ calls: [], finalText: 'ok' }], { now: incrementingNow() });
    await completeTurn(h, 'first');
    await h.controller.handleMessage({ type: 'chatNewSession' });
    await completeTurn(h, 'second');
    await h.controller.handleMessage({ type: 'chatSync' });
    const before = h.lastState()!.sessions;
    expect(before.map((s) => s.title)).toEqual(['second', 'first']);
    const renamedId = before[1]!.id;

    h.posts.length = 0;
    await h.controller.handleMessage({
      type: 'chatRenameSession',
      data: { id: 'ghost', title: 'x' },
    });
    expect(h.posts.map((post) => post.type)).toEqual(['chatState']); // resync only

    h.posts.length = 0;
    await h.controller.handleMessage({
      type: 'chatRenameSession',
      data: { id: renamedId, title: 'Renamed' },
    });
    const update = h.sessionsUpdates().at(-1)!;
    expect(update.sessions.map((s) => s.title)).toEqual(['second', 'Renamed']); // order kept
    expect(update.sessions[1]!.updatedAt).toBe(before[1]!.updatedAt); // no bump
  });

  it('deleting an inactive session removes it from the list and frees its undo snapshot', async () => {
    const h = createHarness(
      [{ calls: [addRouteCall('Payments API')], finalText: 'Added.' }],
      { autoApprove: true, now: incrementingNow() }
    );
    await completeTurn(h, 'add a pay route');
    const undoId = h.lastAssistant()!.undo!.undoId;
    expect(h.server.routes).toHaveLength(2);
    await h.controller.handleMessage({ type: 'chatSync' });
    const sessionA = h.lastState()!.activeSessionId;

    await h.controller.handleMessage({ type: 'chatNewSession' });
    await h.controller.handleMessage({ type: 'chatDeleteSession', data: { id: sessionA } });
    const update = h.sessionsUpdates().at(-1)!;
    expect(update.sessions).toHaveLength(1);
    expect(update.sessions.some((s) => s.id === sessionA)).toBe(false);

    // The snapshot went with the session: the undo can never restore now.
    h.posts.length = 0;
    await h.controller.handleMessage({ type: 'chatUndo', data: { undoId } });
    expect(h.server.routes).toHaveLength(2); // NOT restored — snapshot freed
    expect(h.assistantUpdates().some((m) => m.undo?.state === 'undoing')).toBe(false);
  });

  it('deleting the active session falls back to the most-recently-updated; deleting the last creates a fresh one', async () => {
    const h = createHarness([{ calls: [], finalText: 'ok' }], { now: incrementingNow() });
    await completeTurn(h, 'in session A');
    await h.controller.handleMessage({ type: 'chatSync' });
    const sessionA = h.lastState()!.activeSessionId;
    await h.controller.handleMessage({ type: 'chatNewSession' });
    await completeTurn(h, 'in session B');
    await h.controller.handleMessage({ type: 'chatSync' });
    const sessionB = h.lastState()!.activeSessionId;

    await h.controller.handleMessage({ type: 'chatDeleteSession', data: { id: sessionB } });
    let state = h.lastState()!;
    expect(state.activeSessionId).toBe(sessionA);
    expect(state.sessions).toHaveLength(1);
    expect(state.messages.map((m) => (m as { text?: string }).text)).toEqual(['in session A', 'ok']);

    await h.controller.handleMessage({ type: 'chatDeleteSession', data: { id: sessionA } });
    state = h.lastState()!;
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]!.id).not.toBe(sessionA);
    expect(state.sessions[0]!.title).toBe(CHAT_SESSION_DEFAULT_TITLE);
    expect(state.messages).toEqual([]);
  });

  it('enforces CHAT_SESSIONS_MAX by evicting the oldest-updated non-active session', async () => {
    const h = createHarness([{ calls: [], finalText: 'ok' }], { now: incrementingNow() });
    for (let i = 0; i < CHAT_SESSIONS_MAX; i += 1) {
      await completeTurn(h, `turn ${i}`);
      await h.controller.handleMessage({ type: 'chatNewSession' });
    }

    await h.controller.handleMessage({ type: 'chatSync' });
    const state = h.lastState()!;
    expect(state.sessions).toHaveLength(CHAT_SESSIONS_MAX);
    expect(state.sessions.some((s) => s.title === 'turn 0')).toBe(false); // oldest evicted
    expect(state.sessions.some((s) => s.title === 'turn 1')).toBe(true);
    expect(state.sessions[0]!.title).toBe(CHAT_SESSION_DEFAULT_TITLE); // the fresh active one
  });
});

// ---------------------------------------------------------------------------
// Regenerate (Phase 5)
// ---------------------------------------------------------------------------

describe('ChatController regenerate', () => {
  it('appends a NEW turn for the last user text with history truncated before it', async () => {
    const host = new FakeHost();
    seedServer(host);
    const prompts: string[] = [];
    const ai: ServerAgentAi = {
      async runToolLoop(prompt) {
        prompts.push(prompt);
        return 'Answer.';
      },
    };
    const cancellations = fakeCancellationFactory();
    const posts: ChatMessageFromExtension[] = [];
    const controller = new ChatController({ host, ai, createCancellation: cancellations.create });
    controller.attach((message) => posts.push(message));

    await controller.handleMessage({ type: 'chatSend', data: { text: 'first question' } });
    await waitFor(
      () => posts.some((p) => p.type === 'chatAssistantUpdate' && p.message.status === 'complete'),
      'first turn'
    );

    await controller.handleMessage({ type: 'chatRegenerate' });
    await waitFor(
      () =>
        posts.filter((p) => p.type === 'chatAssistantUpdate' && p.message.status === 'complete')
          .length >= 2,
      'regenerated turn'
    );

    expect(prompts).toHaveLength(2);
    // History excluded the last user turn AND its reply — no parroting context.
    expect(prompts[1]).not.toContain('Conversation so far:');
    expect(prompts[1]).not.toContain('Answer.');

    await controller.handleMessage({ type: 'chatSync' });
    const state = posts
      .filter((p): p is { type: 'chatState'; state: ChatViewState } => p.type === 'chatState')
      .at(-1)!.state;
    expect(state.messages).toHaveLength(4); // old pair stays, new pair appended
    expect((state.messages[2] as ChatUserMessage).text).toBe('first question');
    expect(state.messages[2]!.id).not.toBe(state.messages[0]!.id); // a NEW user message
    expect((state.messages[3] as ChatAssistantMessage).text).toBe('Answer.');
  });

  it('resyncs without running when the session is empty or a turn is busy', async () => {
    const h = createHarness([{ calls: [addRouteCall('Payments API')], finalText: 'never' }]);

    // Empty session — nothing to regenerate.
    await h.controller.handleMessage({ type: 'chatRegenerate' });
    expect(h.posts.map((post) => post.type)).toEqual(['chatState']);
    expect(h.results).toHaveLength(0);

    // Busy (mid-confirm) — refused with a resync, no second loop.
    await h.controller.handleMessage({ type: 'chatSend', data: { text: 'add a route' } });
    await waitFor(() => h.confirmRequests().length === 1, 'confirm card');
    const confirmId = h.confirmRequests()[0]!.id;
    h.posts.length = 0;
    await h.controller.handleMessage({ type: 'chatRegenerate' });
    expect(h.posts.map((post) => post.type)).toEqual(['chatState']);
    expect(h.results).toHaveLength(1);

    // Settle the pending confirm so no timer outlives the test.
    await h.controller.handleMessage({
      type: 'chatConfirm',
      data: { id: confirmId, approved: false },
    });
    await waitFor(() => finished(h.lastAssistant()), 'turn completion');
  });
});

// ---------------------------------------------------------------------------
// Persistence (Phase 5)
// ---------------------------------------------------------------------------

describe('ChatController persistence', () => {
  it('round-trips the transcript across controllers; live undo becomes expired', async () => {
    const storage = new MemStorage();
    const h = createHarness([{ calls: [addRouteCall('Payments API')], finalText: 'Added.' }], {
      autoApprove: true,
      storage,
    });
    await completeTurn(h, 'add a pay route');
    expect(h.lastAssistant()!.undo!.state).toBe('available');
    const assistantId = h.lastAssistant()!.id;
    h.controller.dispose();

    const { ai } = createScriptedAi([{ calls: [], finalText: 'ok' }]);
    const cancellations = fakeCancellationFactory();
    const posts2: ChatMessageFromExtension[] = [];
    let counter = 0;
    const controller2 = new ChatController({
      host: h.host,
      ai,
      createCancellation: cancellations.create,
      createId: () => `c2-${++counter}`,
      now: () => 42,
      storage,
      persistDebounceMs: 0,
    });
    controller2.attach((message) => posts2.push(message));
    await controller2.handleMessage({ type: 'chatSync' });

    const state = posts2
      .filter((p): p is { type: 'chatState'; state: ChatViewState } => p.type === 'chatState')
      .at(-1)!.state;
    expect(state.running).toBe(false);
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]!.title).toBe('add a pay route');
    expect(state.messages).toHaveLength(2);
    const assistant = state.messages[1] as ChatAssistantMessage;
    expect(assistant.status).toBe('complete');
    expect(assistant.text).toBe('Added.');
    expect(assistant.undo).toEqual({ undoId: `expired-${assistantId}`, state: 'expired' });

    // The synthetic id can never hit a snapshot — the standard failure path.
    await controller2.handleMessage({
      type: 'chatUndo',
      data: { undoId: `expired-${assistantId}` },
    });
    const failed = posts2
      .filter(
        (p): p is { type: 'chatAssistantUpdate'; message: ChatAssistantMessage } =>
          p.type === 'chatAssistantUpdate'
      )
      .at(-1)!.message;
    expect(failed.undo).toEqual({
      undoId: `expired-${assistantId}`,
      state: 'failed',
      error: 'This undo is no longer available.',
    });
    controller2.dispose();
  });
});

// ---------------------------------------------------------------------------
// External links (Phase 5)
// ---------------------------------------------------------------------------

describe('ChatController.handleOpenLink', () => {
  it('opens validated https URLs through the injected opener exactly once', async () => {
    const opened: string[] = [];
    const h = createHarness([{ calls: [], finalText: 'ok' }], {
      openExternal: (url) => {
        opened.push(url);
      },
    });

    expect(
      await h.controller.handleMessage({
        type: 'chatOpenLink',
        data: { url: 'https://example.com/docs?x=1' },
      })
    ).toBe(true);
    expect(opened).toEqual(['https://example.com/docs?x=1']);
    expect(h.posts).toHaveLength(0); // no chat traffic for a link open
  });

  it('never lets javascript:/data: URLs reach the opener (validator drops them)', async () => {
    const opened: string[] = [];
    const h = createHarness([{ calls: [], finalText: 'ok' }], {
      openExternal: (url) => {
        opened.push(url);
      },
    });

    expect(
      await h.controller.handleMessage({
        type: 'chatOpenLink',
        data: { url: 'javascript:alert(1)' },
      })
    ).toBe(true); // chat-prefixed → still swallowed as chat traffic
    expect(
      await h.controller.handleMessage({ type: 'chatOpenLink', data: { url: 'data:text/html,x' } })
    ).toBe(true);
    expect(opened).toHaveLength(0);
  });

  it('a throwing opener never unwinds into chat', async () => {
    const h = createHarness([{ calls: [], finalText: 'ok' }], {
      openExternal: () => {
        throw new Error('no browser');
      },
    });
    await expect(
      h.controller.handleMessage({ type: 'chatOpenLink', data: { url: 'http://a.b' } })
    ).resolves.toBe(true);
  });
});
