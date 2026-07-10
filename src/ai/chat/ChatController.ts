import type * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import {
  createServerToolBelt,
  restoreUndoSnapshot,
  type ConfirmHandler,
  type ServerToolsHost,
  type UndoSnapshot,
} from '../agent/serverTools.js';
import {
  runServerAgentTurn,
  type ServerAgentAi,
  type ServerAgentTurnMessage,
} from '../agent/serverAgent.js';
import type { WorkspaceTools } from '../agent/workspaceTools.js';
import type { KnowledgeTool } from '../agent/knowledgeTool.js';
import { AiUnavailableError } from '../providers/types.js';
import {
  CHAT_SESSION_DEFAULT_TITLE,
  parseChatMessageToExtension,
  toChatAction,
  type ChatMessage,
  type ChatPost,
  type ChatSessionMeta,
  type ChatUndoState,
} from './chatProtocol.js';
import { ChatConfirmBridge } from './confirmBridge.js';
import { ChatSession } from './chatSession.js';
import {
  CHAT_SESSIONS_MAX,
  ChatSessionStore,
  deriveSessionTitle,
  emptyPersistedChatState,
  fromPersistedMessages,
  toPersistedMessages,
  type ChatStateStorage,
  type PersistedChatState,
} from './chatSessionStore.js';

/**
 * Thin vscode adapter wiring the chat panel to the Phase 1 agent core: routes
 * validated webview messages into per-session {@link ChatSession} /
 * {@link ChatConfirmBridge} calls and runs one gated `runServerAgentTurn` per
 * chatSend (mirroring `ChatParticipant.handleAgent` — same belt, same turn,
 * same undo semantics, different HITL surface).
 *
 * The controller owns ONE ChatSession per session id (all materialized at
 * construction from workspaceState), metadata for the session list, the
 * single global in-flight turn, and the shared undo-snapshot map. Only the
 * ACTIVE session has the post sink attached; inactive sessions mutate
 * silently — a turn closure captures its own session, so a turn cancelled by
 * a session switch still completes into the correct (now background) session.
 * UndoSnapshot objects never cross the webview boundary.
 *
 * The unavoidable vscode value uses — CancellationTokenSource and
 * env.openExternal — sit behind injectable factories whose defaults
 * lazy-require vscode inside the function body (graphRuntime.ts pattern), so
 * this module stays importable under vitest with `import type * as vscode`.
 */

// ---- Constants ----

/** In-memory undo snapshots kept at once (oldest expires). */
export const CHAT_UNDO_MAX_SNAPSHOTS = 10;
/** Doc/UI copy for the busy guard — the extension resyncs instead of erroring. */
export const CHAT_BUSY_NOTE = 'A chat turn is already running — press Stop first.';

// ---- Types ----

/** Structural stand-in for vscode.CancellationTokenSource (tests fake it). */
export interface ChatCancellation {
  token: vscode.CancellationToken;
  cancel(): void;
  dispose(): void;
}

export interface ChatControllerDeps {
  /** MockServerManager, structurally. */
  host: ServerToolsHost;
  /** AiService, structurally (runToolLoop only) — provider-agnostic by design. */
  ai: ServerAgentAi;
  /**
   * Fresh read-only codebase belt per turn; undefined when no folder is open.
   * Production wiring:
   * `() => { const root = vscode.workspace.workspaceFolders?.[0]?.uri;
   *          return root ? createWorkspaceTools(root) : undefined; }`
   */
  workspaceTools?: () => WorkspaceTools | undefined;
  /**
   * Fresh read-only knowledge tool per turn; undefined when unavailable.
   * Production wiring:
   * `() => createKnowledgeTool(createDefaultKnowledgeHost(manager))`
   */
  knowledgeTool?: () => KnowledgeTool | undefined;
  /** Cancellation factory override (tests). Default lazy-requires vscode. */
  createCancellation?: () => ChatCancellation;
  createId?: () => string;
  now?: () => number;
  /** Forwarded to the confirm bridge (tests shrink it). */
  confirmTimeoutMs?: number;
  /** Structural Memento (context.workspaceState). Omit to disable persistence (tests). */
  storage?: ChatStateStorage;
  /** External-link opener override (tests). Default lazy-requires vscode:
   *  const vs = require('vscode'); vs.env.openExternal(vs.Uri.parse(url)); */
  openExternal?: (url: string) => unknown;
  /** Forwarded to ChatSessionStore (tests shrink them). */
  persistDebounceMs?: number;
  persistMaxBytes?: number;
}

// ---- Defaults ----

/** Default cancellation factory — lazy `require('vscode')` so the module
 *  stays importable outside the extension host (graphRuntime.ts pattern). */
function defaultCreateCancellation(): ChatCancellation {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const vs: typeof import('vscode') = require('vscode');
  const cts = new vs.CancellationTokenSource();
  return { token: cts.token, cancel: () => cts.cancel(), dispose: () => cts.dispose() };
}

/** Default external-link opener — lazy `require('vscode')`, same pattern. */
function defaultOpenExternal(url: string): unknown {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const vs: typeof import('vscode') = require('vscode');
  return vs.env.openExternal(vs.Uri.parse(url));
}

/** User-facing message for a failed turn (mirrors WebViewManager.describeAiError). */
function describeChatError(error: unknown): string {
  if (error instanceof AiUnavailableError) {
    return error.message;
  }
  return error instanceof Error ? error.message : 'The chat turn failed.';
}

/** True for objects whose `type` string starts with 'chat' — routing signal only. */
function isChatPrefixed(raw: unknown): boolean {
  if (raw === null || typeof raw !== 'object') {
    return false;
  }
  const type = (raw as Record<string, unknown>).type;
  return typeof type === 'string' && type.startsWith('chat');
}

// ---- Controller ----

export class ChatController {
  private readonly deps: ChatControllerDeps;
  /** One live ChatSession per session id (insertion order irrelevant — the
   *  list order comes from meta.updatedAt). */
  private readonly sessions = new Map<string, ChatSession>();
  private readonly meta = new Map<string, { title: string; createdAt: number; updatedAt: number }>();
  private activeId!: string;
  private post: ChatPost | undefined;
  private readonly store: ChatSessionStore | undefined;
  private readonly bridge: ChatConfirmBridge;
  /** Insertion-ordered — the first key is always the oldest snapshot. */
  private readonly undoSnapshots = new Map<string, UndoSnapshot>();
  private readonly createId: () => string;
  private currentTurn: { cancellation: ChatCancellation; session: ChatSession } | undefined;
  /** True while an undo restore is awaited — undos are host mutations too,
   *  so chatSend/chatUndo/chatClear must treat the controller as busy. */
  private undoInFlight = false;

  constructor(deps: ChatControllerDeps) {
    this.deps = deps;
    this.createId = deps.createId ?? ((): string => randomUUID());
    this.store =
      deps.storage !== undefined
        ? new ChatSessionStore({
            storage: deps.storage,
            ...(deps.persistDebounceMs !== undefined ? { debounceMs: deps.persistDebounceMs } : {}),
            ...(deps.persistMaxBytes !== undefined ? { maxBytes: deps.persistMaxBytes } : {}),
            onWarning: () => {},
          })
        : undefined;
    const persisted = this.store?.load() ?? emptyPersistedChatState();
    for (const session of persisted.sessions) {
      this.addSession(
        session.id,
        session.title,
        session.createdAt,
        session.updatedAt,
        fromPersistedMessages(session.messages)
      );
    }
    if (persisted.activeSessionId !== null && this.sessions.has(persisted.activeSessionId)) {
      this.activeId = persisted.activeSessionId;
    } else {
      this.activeId = this.mostRecentlyUpdatedId() ?? this.createFreshSession();
    }
    this.bridge = new ChatConfirmBridge({
      // Confirms belong to the turn in flight, which may live in a session
      // the user has since switched away from.
      onAsk: (request) => this.currentTurn?.session.requestConfirm(request),
      onSettle: (id, approved, reason) =>
        this.currentTurn?.session.resolveConfirm(id, approved, reason),
      ...(deps.createId ? { createId: deps.createId } : {}),
      ...(deps.now ? { now: deps.now } : {}),
      ...(deps.confirmTimeoutMs !== undefined ? { timeoutMs: deps.confirmTimeoutMs } : {}),
    });
  }

  /** Panel opened: attach the post sink. Does not auto-sync (the webview sends chatSync). */
  attach(post: ChatPost): void {
    this.post = post;
    this.activeSession().attach(post);
  }

  /**
   * Panel disposed: deny any pending confirm ('disposed'), cancel the running
   * turn, and detach the sink. The turn's finally block still runs and
   * records the outcome in its (now detached) session, so a reopened panel
   * replays it via chatSync.
   */
  detach(): void {
    this.bridge.denyAll('disposed');
    this.currentTurn?.cancellation.cancel();
    this.activeSession().detach();
    this.post = undefined;
  }

  /**
   * Route one raw inbound webview message. Returns true when it WAS a chat
   * message (parse succeeded, or its type starts with 'chat'), so
   * WebViewManager can stop routing. Unparseable chat-prefixed garbage is
   * silently dropped (still true).
   */
  async handleMessage(raw: unknown): Promise<boolean> {
    const message = parseChatMessageToExtension(raw);
    if (message === undefined) {
      return isChatPrefixed(raw);
    }
    switch (message.type) {
      case 'chatSync':
        this.activeSession().sync();
        return true;
      case 'chatSend':
        this.handleSend(message.data.text);
        return true;
      case 'chatStop':
        // Cancellation aborts the AbortController, which auto-denies any
        // pending confirm; runServerAgentTurn resolves with the cancelled
        // text plus the partial actions.
        this.currentTurn?.cancellation.cancel();
        return true;
      case 'chatConfirm':
        // Unknown/already-settled ids are dropped — exactly-once holds.
        this.bridge.resolve(message.data.id, message.data.approved);
        return true;
      case 'chatUndo':
        await this.handleUndo(message.data.undoId);
        return true;
      case 'chatClear':
        this.handleClear();
        return true;
      case 'chatNewSession':
        this.handleNewSession();
        return true;
      case 'chatSwitchSession':
        this.handleSwitch(message.data.id);
        return true;
      case 'chatRenameSession':
        this.handleRename(message.data.id, message.data.title);
        return true;
      case 'chatDeleteSession':
        this.handleDelete(message.data.id);
        return true;
      case 'chatRegenerate':
        this.handleRegenerate();
        return true;
      case 'chatOpenLink':
        this.handleOpenLink(message.data.url);
        return true;
    }
  }

  /** detach() + free all undo snapshots + flush any pending persisted write. */
  dispose(): void {
    this.detach();
    this.undoSnapshots.clear();
    this.store?.dispose();
  }

  // ---- Session bookkeeping ----

  /** Construct + wire one ChatSession and record its metadata. */
  private addSession(
    id: string,
    title: string,
    createdAt: number,
    updatedAt: number,
    initialMessages: ChatMessage[]
  ): ChatSession {
    const session = new ChatSession({
      id,
      initialMessages,
      enrichState: (core) => ({
        sessions: this.sessionMetaList(),
        activeSessionId: this.activeId,
        ...core,
        // A turn cancelled by a session op keeps the controller busy until
        // its promise settles (cancellation is cooperative — a host tool may
        // still be mid-flight). Advertise that window as running so the
        // composer stays disabled and the busy guard can never swallow input
        // the webview already let the user type. runTurn resyncs the active
        // session when a background-settled turn clears currentTurn.
        running: core.running || this.currentTurn !== undefined,
      }),
      ...(this.deps.createId ? { createId: this.deps.createId } : {}),
      ...(this.deps.now ? { now: this.deps.now } : {}),
    });
    session.onEvictUndo = (undoIds): void =>
      undoIds.forEach((undoId) => this.undoSnapshots.delete(undoId));
    session.onDidChange = (): void => {
      this.persistDebounced();
    };
    this.sessions.set(id, session);
    this.meta.set(id, { title, createdAt, updatedAt });
    return session;
  }

  /** Fresh default-titled empty session; returns its id. */
  private createFreshSession(): string {
    const id = this.createId();
    const timestamp = (this.deps.now ?? Date.now)();
    this.addSession(id, CHAT_SESSION_DEFAULT_TITLE, timestamp, timestamp, []);
    return id;
  }

  private activeSession(): ChatSession {
    return this.sessions.get(this.activeId)!;
  }

  private mostRecentlyUpdatedId(): string | undefined {
    let bestId: string | undefined;
    let bestUpdated = -Infinity;
    for (const [id, meta] of this.meta) {
      if (meta.updatedAt > bestUpdated) {
        bestUpdated = meta.updatedAt;
        bestId = id;
      }
    }
    return bestId;
  }

  private sessionMetaList(): ChatSessionMeta[] {
    return [...this.meta.entries()]
      .map(([id, m]) => ({
        id,
        title: m.title,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
        messageCount: this.sessions.get(id)?.messageCount ?? 0,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private buildPersistedState(): PersistedChatState {
    return {
      version: 1,
      activeSessionId: this.activeId,
      sessions: this.sessionMetaList().map((m) => ({
        id: m.id,
        title: m.title,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
        messages: toPersistedMessages(this.sessions.get(m.id)!.persistableMessages()),
      })),
    };
  }

  private persistDebounced(): void {
    this.store?.save(this.buildPersistedState());
  }

  private persistNow(): void {
    this.store?.saveImmediate(this.buildPersistedState());
  }

  /** Metadata-only refresh (titles/order/counts) — never touches the transcript. */
  private postSessionsUpdate(): void {
    this.post?.({
      type: 'chatSessionsUpdate',
      sessions: this.sessionMetaList(),
      activeSessionId: this.activeId,
    });
  }

  private touchActive(): void {
    const meta = this.meta.get(this.activeId);
    if (meta) {
      meta.updatedAt = (this.deps.now ?? Date.now)();
    }
  }

  // ---- Session ops ----

  /** Cancel a running turn so a session op can proceed (undo restores cannot be cancelled). */
  private interruptTurnForSessionOp(): void {
    if (this.currentTurn !== undefined) {
      this.bridge.denyAll('cancelled');
      this.currentTurn.cancellation.cancel();
    }
  }

  private handleNewSession(): void {
    if (this.undoInFlight) {
      this.activeSession().sync();
      return;
    }
    if (this.activeSession().messageCount === 0) {
      // Reuse the empty session — prevents list spam.
      this.activeSession().sync();
      return;
    }
    this.interruptTurnForSessionOp();
    const newId = this.createFreshSession();
    while (this.sessions.size > CHAT_SESSIONS_MAX) {
      let victimId: string | undefined;
      let victimUpdated = Infinity;
      for (const [id, meta] of this.meta) {
        if (id === newId) {
          continue;
        }
        if (meta.updatedAt < victimUpdated) {
          victimUpdated = meta.updatedAt;
          victimId = id;
        }
      }
      if (victimId === undefined) {
        break; // defensive — cannot happen with size > 1
      }
      this.removeSessionInternal(victimId);
    }
    this.switchTo(newId);
  }

  private handleSwitch(id: string): void {
    if (this.undoInFlight) {
      this.activeSession().sync();
      return;
    }
    if (!this.sessions.has(id) || id === this.activeId) {
      this.activeSession().sync();
      return;
    }
    this.interruptTurnForSessionOp();
    this.switchTo(id);
  }

  private switchTo(id: string): void {
    // Optional chain: handleNewSession's cap eviction may (in principle) have
    // removed the previously active session already.
    this.sessions.get(this.activeId)?.detach();
    this.activateSession(id);
  }

  /** Tail of every activation path: swap activeId, attach, full resync, persist. */
  private activateSession(id: string): void {
    this.activeId = id;
    const next = this.sessions.get(id)!;
    if (this.post) {
      next.attach(this.post);
    }
    next.sync(); // the enriched full chatState IS the transcript restore
    this.persistNow();
  }

  /** Metadata only — allowed anytime; does NOT bump updatedAt (no reorder). */
  private handleRename(id: string, title: string): void {
    const meta = this.meta.get(id);
    if (meta === undefined) {
      this.activeSession().sync();
      return;
    }
    meta.title = title;
    this.postSessionsUpdate();
    this.persistNow();
  }

  private handleDelete(id: string): void {
    if (this.undoInFlight) {
      this.activeSession().sync();
      return;
    }
    if (!this.sessions.has(id)) {
      this.activeSession().sync();
      return;
    }
    if (id !== this.activeId) {
      this.removeSessionInternal(id);
      this.postSessionsUpdate();
      this.persistNow();
      return;
    }
    this.interruptTurnForSessionOp();
    this.removeSessionInternal(id);
    this.activateSession(this.mostRecentlyUpdatedId() ?? this.createFreshSession());
  }

  /** Drop one session: free its undo snapshots, unwire, delete from both maps. */
  private removeSessionInternal(id: string): void {
    const session = this.sessions.get(id);
    if (session === undefined) {
      return;
    }
    for (const message of session.state().messages) {
      if (message.role === 'assistant' && message.undo !== undefined) {
        this.undoSnapshots.delete(message.undo.undoId);
      }
    }
    session.detach();
    session.onDidChange = undefined;
    session.onEvictUndo = undefined;
    this.sessions.delete(id);
    this.meta.delete(id);
  }

  private handleOpenLink(url: string): void {
    // Validator already enforced ^https?:// and the length cap — re-verify structurally.
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return;
    }
    const open = this.deps.openExternal ?? defaultOpenExternal;
    try {
      open(parsed.toString());
    } catch {
      // Opener failure never unwinds into chat.
    }
  }

  // ---- Message handlers ----

  /** True when a turn OR an undo restore is mutating the host right now. */
  private busy(): boolean {
    return this.activeSession().running || this.currentTurn !== undefined || this.undoInFlight;
  }

  /** Busy guard ({@link CHAT_BUSY_NOTE}): resync instead of double-running. */
  private handleSend(text: string): void {
    if (this.busy()) {
      this.activeSession().sync();
      return;
    }
    const session = this.activeSession();
    // Fire-and-forget; runTurn handles its own errors, this catch is defensive.
    void this.runTurn(session, text).catch((error) => {
      session.failTurn(describeChatError(error), []);
    });
  }

  /** Re-run the LAST user prompt as a NEW appended turn with history
   *  truncated before that prompt (the model must not parrot itself). */
  private handleRegenerate(): void {
    if (this.busy()) {
      this.activeSession().sync();
      return;
    }
    const session = this.activeSession();
    const text = session.lastUserText();
    if (text === undefined) {
      session.sync();
      return;
    }
    void this.runTurn(session, text, session.historyBeforeLastUser()).catch((error) => {
      session.failTurn(describeChatError(error), []);
    });
  }

  /** Update one undoId's rendered state in whichever session owns it
   *  (ChatSession.setUndoState is a no-op for non-owners). */
  private setUndoStateEverywhere(undoId: string, state: ChatUndoState, error?: string): void {
    for (const session of this.sessions.values()) {
      session.setUndoState(undoId, state, error);
    }
  }

  private async handleUndo(undoId: string): Promise<void> {
    if (this.busy()) {
      this.activeSession().sync();
      return;
    }
    const snapshot = this.undoSnapshots.get(undoId);
    if (snapshot === undefined) {
      this.setUndoStateEverywhere(undoId, 'failed', 'This undo is no longer available.');
      return;
    }
    // Consume the snapshot and raise the latch BEFORE the await: a replayed
    // chatUndo (double-click beats the 'undoing' round trip) or a chatSend
    // arriving mid-restore must never run host mutations concurrently with
    // the restore — they hit the busy guard and the map lookup misses.
    this.undoSnapshots.delete(undoId); // consumed either way
    this.undoInFlight = true;
    this.setUndoStateEverywhere(undoId, 'undoing');
    try {
      const result = await restoreUndoSnapshot(this.deps.host, snapshot);
      if (result.errors.length === 0) {
        this.setUndoStateEverywhere(undoId, 'undone');
      } else {
        this.setUndoStateEverywhere(
          undoId,
          'failed',
          `Undo finished with issues: ${result.errors[0]}`
        );
      }
    } catch (error) {
      // restoreUndoSnapshot never throws — defensive only.
      this.setUndoStateEverywhere(
        undoId,
        'failed',
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      this.undoInFlight = false;
    }
  }

  private handleClear(): void {
    if (this.undoInFlight) {
      this.activeSession().sync(); // refused while an undo restore is in flight
      return;
    }
    const evicted = this.activeSession().clear();
    if (evicted === null) {
      this.activeSession().sync(); // refused while running — resync the UI
      return;
    }
    for (const undoId of evicted) {
      this.undoSnapshots.delete(undoId);
    }
    this.touchActive();
    this.persistNow();
    this.postSessionsUpdate();
  }

  // ---- Turn (mirrors ChatParticipant.handleAgent) ----

  private async runTurn(
    session: ChatSession,
    text: string,
    historyOverride?: ServerAgentTurnMessage[]
  ): Promise<void> {
    const history = historyOverride ?? session.history(); // BEFORE beginTurn
    if (!session.beginTurn(text)) {
      session.sync();
      return;
    }
    // Auto-title: messageCount === 2 ⇔ this turn added the session's first
    // user message. Rename never bumps updatedAt; a turn always does.
    const meta = this.meta.get(session.id);
    if (meta && meta.title === CHAT_SESSION_DEFAULT_TITLE && session.messageCount === 2) {
      meta.title = deriveSessionTitle(text);
    }
    if (meta) {
      meta.updatedAt = (this.deps.now ?? Date.now)();
    }
    this.postSessionsUpdate();
    const cancellation = (this.deps.createCancellation ?? defaultCreateCancellation)();
    const abort = new AbortController();
    const sub = cancellation.token.onCancellationRequested(() => abort.abort());
    const confirm: ConfirmHandler = (action) => this.bridge.ask(action, abort.signal);
    const belt = createServerToolBelt({ host: this.deps.host, confirm });
    const ws = this.deps.workspaceTools?.();
    const knowledge = this.deps.knowledgeTool?.();
    this.currentTurn = { cancellation, session };
    try {
      const result = await runServerAgentTurn(
        {
          ai: this.deps.ai,
          tools: belt,
          ...(ws !== undefined ? { workspaceTools: ws } : {}),
          ...(knowledge !== undefined ? { knowledgeTool: knowledge } : {}),
          onProgress: (line) => session.appendProgress(line),
          token: cancellation.token,
        },
        { prompt: text, history }
      );
      const undoId = this.registerSnapshot(session, belt.snapshot());
      session.completeTurn({
        status: cancellation.token.isCancellationRequested ? 'cancelled' : 'complete',
        text: result.text,
        actions: result.actions.map(toChatAction),
        ...(undoId !== undefined ? { undoId } : {}),
      });
    } catch (error) {
      // Approved mutations stay undoable even when the turn dies (same
      // rationale as handleAgent): surface the partial actions + undo
      // alongside the error instead of discarding the belt.
      const undoId = this.registerSnapshot(session, belt.snapshot());
      session.failTurn(describeChatError(error), belt.actions().map(toChatAction), undoId);
    } finally {
      this.bridge.denyAll('cancelled'); // never leave a dangling confirm card
      sub.dispose();
      cancellation.dispose();
      this.currentTurn = undefined;
    }
    // The transcript changed (session.onDidChange already scheduled the
    // debounced persist) — refresh updatedAt/messageCount in the list.
    const settledMeta = this.meta.get(session.id);
    if (settledMeta) {
      settledMeta.updatedAt = (this.deps.now ?? Date.now)();
    }
    this.postSessionsUpdate();
    // A turn that settled into a background session (it was cancelled by a
    // session switch/new/delete) kept the ACTIVE view advertised as running
    // (see enrichState) — resync now that currentTurn is cleared so the
    // composer re-enables.
    if (session.id !== this.activeId) {
      this.activeSession().sync();
    }
  }

  /**
   * Store one turn's snapshot under a fresh undoId, expiring the oldest entry
   * beyond {@link CHAT_UNDO_MAX_SNAPSHOTS} (its message flips to failed /
   * 'This undo has expired.'). undefined in → undefined out; a turn whose
   * session was deleted mid-flight drops its snapshot instead of orphaning it.
   */
  private registerSnapshot(
    session: ChatSession,
    snapshot: UndoSnapshot | undefined
  ): string | undefined {
    if (snapshot === undefined || !this.sessions.has(session.id)) {
      return undefined;
    }
    const undoId = this.createId();
    this.undoSnapshots.set(undoId, snapshot);
    if (this.undoSnapshots.size > CHAT_UNDO_MAX_SNAPSHOTS) {
      const oldest = this.undoSnapshots.keys().next().value as string;
      this.undoSnapshots.delete(oldest);
      this.setUndoStateEverywhere(oldest, 'failed', 'This undo has expired.');
    }
    return undoId;
  }
}
