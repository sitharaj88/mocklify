import type * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import {
  createServerToolBelt,
  restoreUndoSnapshot,
  type ConfirmHandler,
  type ServerToolsHost,
  type UndoSnapshot,
} from '../agent/serverTools.js';
import { runServerAgentTurn, type ServerAgentAi } from '../agent/serverAgent.js';
import type { WorkspaceTools } from '../agent/workspaceTools.js';
import type { KnowledgeTool } from '../agent/knowledgeTool.js';
import { AiUnavailableError } from '../providers/types.js';
import { parseChatMessageToExtension, toChatAction, type ChatPost } from './chatProtocol.js';
import { ChatConfirmBridge } from './confirmBridge.js';
import { ChatSession } from './chatSession.js';

/**
 * Thin vscode adapter wiring the chat panel to the Phase 1 agent core: routes
 * validated webview messages into {@link ChatSession} /
 * {@link ChatConfirmBridge} calls and runs one gated `runServerAgentTurn` per
 * chatSend (mirroring `ChatParticipant.handleAgent` — same belt, same turn,
 * same undo semantics, different HITL surface).
 *
 * The session, bridge, and undo-snapshot map live for the CONTROLLER's
 * lifetime (owned by WebViewManager), not the panel's — attach/detach only
 * swap the post sink, which is what makes the transcript survive panel
 * close/reopen. UndoSnapshot objects never cross the webview boundary.
 *
 * The one unavoidable vscode value use — creating a CancellationTokenSource —
 * sits behind an injectable factory whose default lazy-requires vscode inside
 * the function body (same pattern as graphRuntime.ts), so this module stays
 * importable under vitest with `import type * as vscode` only.
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
  private readonly session: ChatSession;
  private readonly bridge: ChatConfirmBridge;
  /** Insertion-ordered — the first key is always the oldest snapshot. */
  private readonly undoSnapshots = new Map<string, UndoSnapshot>();
  private readonly createId: () => string;
  private currentTurn: { cancellation: ChatCancellation } | undefined;
  /** True while an undo restore is awaited — undos are host mutations too,
   *  so chatSend/chatUndo/chatClear must treat the controller as busy. */
  private undoInFlight = false;

  constructor(deps: ChatControllerDeps) {
    this.deps = deps;
    this.createId = deps.createId ?? ((): string => randomUUID());
    this.session = new ChatSession({
      ...(deps.createId ? { createId: deps.createId } : {}),
      ...(deps.now ? { now: deps.now } : {}),
    });
    this.session.onEvictUndo = (undoIds) =>
      undoIds.forEach((undoId) => this.undoSnapshots.delete(undoId));
    this.bridge = new ChatConfirmBridge({
      onAsk: (request) => this.session.requestConfirm(request),
      onSettle: (id, approved, reason) => this.session.resolveConfirm(id, approved, reason),
      ...(deps.createId ? { createId: deps.createId } : {}),
      ...(deps.now ? { now: deps.now } : {}),
      ...(deps.confirmTimeoutMs !== undefined ? { timeoutMs: deps.confirmTimeoutMs } : {}),
    });
  }

  /** Panel opened: attach the post sink. Does not auto-sync (the webview sends chatSync). */
  attach(post: ChatPost): void {
    this.session.attach(post);
  }

  /**
   * Panel disposed: deny any pending confirm ('disposed'), cancel the running
   * turn, and detach the sink. The turn's finally block still runs and
   * records the outcome in the (now detached) session, so a reopened panel
   * replays it via chatSync.
   */
  detach(): void {
    this.bridge.denyAll('disposed');
    this.currentTurn?.cancellation.cancel();
    this.session.detach();
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
        this.session.sync();
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
    }
  }

  /** detach() + free all undo snapshots. */
  dispose(): void {
    this.detach();
    this.undoSnapshots.clear();
  }

  // ---- Message handlers ----

  /** True when a turn OR an undo restore is mutating the host right now. */
  private busy(): boolean {
    return this.session.running || this.currentTurn !== undefined || this.undoInFlight;
  }

  /** Busy guard ({@link CHAT_BUSY_NOTE}): resync instead of double-running. */
  private handleSend(text: string): void {
    if (this.busy()) {
      this.session.sync();
      return;
    }
    // Fire-and-forget; runTurn handles its own errors, this catch is defensive.
    void this.runTurn(text).catch((error) => {
      this.session.failTurn(describeChatError(error), []);
    });
  }

  private async handleUndo(undoId: string): Promise<void> {
    if (this.busy()) {
      this.session.sync();
      return;
    }
    const snapshot = this.undoSnapshots.get(undoId);
    if (snapshot === undefined) {
      this.session.setUndoState(undoId, 'failed', 'This undo is no longer available.');
      return;
    }
    // Consume the snapshot and raise the latch BEFORE the await: a replayed
    // chatUndo (double-click beats the 'undoing' round trip) or a chatSend
    // arriving mid-restore must never run host mutations concurrently with
    // the restore — they hit the busy guard and the map lookup misses.
    this.undoSnapshots.delete(undoId); // consumed either way
    this.undoInFlight = true;
    this.session.setUndoState(undoId, 'undoing');
    try {
      const result = await restoreUndoSnapshot(this.deps.host, snapshot);
      if (result.errors.length === 0) {
        this.session.setUndoState(undoId, 'undone');
      } else {
        this.session.setUndoState(undoId, 'failed', `Undo finished with issues: ${result.errors[0]}`);
      }
    } catch (error) {
      // restoreUndoSnapshot never throws — defensive only.
      this.session.setUndoState(
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
      this.session.sync(); // refused while an undo restore is in flight
      return;
    }
    const evicted = this.session.clear();
    if (evicted === null) {
      this.session.sync(); // refused while running — resync the UI
      return;
    }
    for (const undoId of evicted) {
      this.undoSnapshots.delete(undoId);
    }
  }

  // ---- Turn (mirrors ChatParticipant.handleAgent) ----

  private async runTurn(text: string): Promise<void> {
    const history = this.session.history(); // BEFORE beginTurn
    if (!this.session.beginTurn(text)) {
      this.session.sync();
      return;
    }
    const cancellation = (this.deps.createCancellation ?? defaultCreateCancellation)();
    const abort = new AbortController();
    const sub = cancellation.token.onCancellationRequested(() => abort.abort());
    const confirm: ConfirmHandler = (action) => this.bridge.ask(action, abort.signal);
    const belt = createServerToolBelt({ host: this.deps.host, confirm });
    const ws = this.deps.workspaceTools?.();
    const knowledge = this.deps.knowledgeTool?.();
    this.currentTurn = { cancellation };
    try {
      const result = await runServerAgentTurn(
        {
          ai: this.deps.ai,
          tools: belt,
          ...(ws !== undefined ? { workspaceTools: ws } : {}),
          ...(knowledge !== undefined ? { knowledgeTool: knowledge } : {}),
          onProgress: (line) => this.session.appendProgress(line),
          token: cancellation.token,
        },
        { prompt: text, history }
      );
      const undoId = this.registerSnapshot(belt.snapshot());
      this.session.completeTurn({
        status: cancellation.token.isCancellationRequested ? 'cancelled' : 'complete',
        text: result.text,
        actions: result.actions.map(toChatAction),
        ...(undoId !== undefined ? { undoId } : {}),
      });
    } catch (error) {
      // Approved mutations stay undoable even when the turn dies (same
      // rationale as handleAgent): surface the partial actions + undo
      // alongside the error instead of discarding the belt.
      const undoId = this.registerSnapshot(belt.snapshot());
      this.session.failTurn(describeChatError(error), belt.actions().map(toChatAction), undoId);
    } finally {
      this.bridge.denyAll('cancelled'); // never leave a dangling confirm card
      sub.dispose();
      cancellation.dispose();
      this.currentTurn = undefined;
    }
  }

  /**
   * Store one turn's snapshot under a fresh undoId, expiring the oldest entry
   * beyond {@link CHAT_UNDO_MAX_SNAPSHOTS} (its message flips to failed /
   * 'This undo has expired.'). undefined in → undefined out.
   */
  private registerSnapshot(snapshot: UndoSnapshot | undefined): string | undefined {
    if (snapshot === undefined) {
      return undefined;
    }
    const undoId = this.createId();
    this.undoSnapshots.set(undoId, snapshot);
    if (this.undoSnapshots.size > CHAT_UNDO_MAX_SNAPSHOTS) {
      const oldest = this.undoSnapshots.keys().next().value as string;
      this.undoSnapshots.delete(oldest);
      this.session.setUndoState(oldest, 'failed', 'This undo has expired.');
    }
    return undoId;
  }
}
