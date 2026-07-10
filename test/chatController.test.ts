import { describe, it, expect, vi } from 'vitest';
import {
  CHAT_UNDO_MAX_SNAPSHOTS,
  ChatController,
  type ChatCancellation,
} from '../src/ai/chat/ChatController';
import type {
  ChatAssistantMessage,
  ChatConfirmRequest,
  ChatMessageFromExtension,
  ChatViewState,
} from '../src/ai/chat/chatProtocol';
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

function createHarness(scripts: TurnScript[], options?: { autoApprove?: boolean }) {
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
    now: () => 42,
    confirmTimeoutMs: 60_000,
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
