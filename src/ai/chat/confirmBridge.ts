import { randomUUID } from 'node:crypto';
import type { ConfirmAction } from '../agent/serverTools.js';
import { ASK_USER_ANSWER_TIMEOUT_MS } from '../agent/askUser.js';
import {
  sanitizeConfirmAction,
  type ChatConfirmReason,
  type ChatConfirmRequest,
} from './chatProtocol.js';

/**
 * Bridges the tool belt's synchronous-looking {@link ChatConfirmBridge.ask}
 * ConfirmHandler to the webview's asynchronous confirm card: each ask mints an
 * id'd {@link ChatConfirmRequest}, shows it through `onAsk`, and waits for a
 * {@link ChatConfirmBridge.resolve} from the webview — racing a timeout, the
 * turn's AbortSignal, and {@link ChatConfirmBridge.denyAll}.
 *
 * Every ask settles EXACTLY ONCE, on exactly one of: webview answer
 * ('user'), timeout ('timeout'), abort/second-ask/end-of-turn sweep
 * ('cancelled'), or view disposal ('disposed'). A denial resolves `false`
 * into the belt, which answers the model with MUTATION_DENIED_MESSAGE —
 * nothing is applied, matching the Phase 1 semantics.
 *
 * Pure logic — zero vscode imports, fully vitest-importable.
 */

// ---- Constants ----

/** Mirrors the ask_user answer timeout so both HITL surfaces behave identically. */
export const CHAT_CONFIRM_TIMEOUT_MS = ASK_USER_ANSWER_TIMEOUT_MS; // 120_000

// ---- Bridge ----

export interface ChatConfirmBridgeOptions {
  /** Show the confirm card (ChatSession.requestConfirm in production). */
  onAsk: (request: ChatConfirmRequest) => void;
  /** Fired EXACTLY ONCE per ask, on every settle path. */
  onSettle: (id: string, approved: boolean, reason: ChatConfirmReason) => void;
  createId?: () => string;
  now?: () => number;
  timeoutMs?: number;
}

/** One in-flight ask: its request plus the exactly-once settle closure. */
interface PendingConfirm {
  request: ChatConfirmRequest;
  settle: (approved: boolean, reason: ChatConfirmReason) => void;
}

export class ChatConfirmBridge {
  private readonly onAsk: ChatConfirmBridgeOptions['onAsk'];
  private readonly onSettle: ChatConfirmBridgeOptions['onSettle'];
  private readonly createId: () => string;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private pendingConfirm: PendingConfirm | undefined;

  constructor(options: ChatConfirmBridgeOptions) {
    this.onAsk = options.onAsk;
    this.onSettle = options.onSettle;
    this.createId = options.createId ?? ((): string => randomUUID());
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? CHAT_CONFIRM_TIMEOUT_MS;
  }

  /**
   * The ConfirmHandler body: sanitize → mint request → onAsk → wait. Resolves
   * (never rejects) with `true` only when the user approved before the
   * timeout/abort fired. A signal that is ALREADY aborted resolves `false`
   * immediately without calling onAsk or onSettle — nothing was asked, so
   * there is nothing to settle. A second ask while one is pending denies the
   * previous one ('cancelled') first.
   *
   * Exactly-once is guarded by a per-ask `settled` flag inside the settle
   * closure — same shape as `waitForAnswer` in askUser.ts: clear the timeout,
   * remove the abort listener, delete the pending record, resolve, then fire
   * onSettle. Resolving FIRST (and swallowing onSettle throws) is what keeps
   * the never-rejects contract binding on the promise itself: a notification
   * sink that throws (e.g. a disposed webview) can never leave the belt's
   * await pending or unwind into resolve()/denyAll() callers.
   */
  async ask(action: ConfirmAction, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) {
      return false;
    }
    // Defensive — the tool loop is sequential, but never stack two cards.
    this.pendingConfirm?.settle(false, 'cancelled');

    const { title, detail, change } = sanitizeConfirmAction(action);
    const request: ChatConfirmRequest = {
      id: this.createId(),
      title,
      detail,
      ...(change !== undefined ? { change } : {}),
      createdAt: this.now(),
      timeoutMs: this.timeoutMs,
    };

    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const onAbort = (): void => settle(false, 'cancelled');
      // `settle` and `timer` reference each other; both are only ever *called*
      // after this scope finishes initializing, so the forward reference is safe.
      const settle = (approved: boolean, reason: ChatConfirmReason): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        if (this.pendingConfirm?.request.id === request.id) {
          this.pendingConfirm = undefined;
        }
        // Resolve BEFORE notifying — the contract that every ask settles
        // exactly once and never rejects binds the promise, not the sink.
        resolve(approved);
        try {
          this.onSettle(request.id, approved, reason);
        } catch {
          // Notification failure (disposed webview mid-post, etc.) — the ask
          // is already settled; never propagate into settle's caller.
        }
      };
      const timer = setTimeout(() => settle(false, 'timeout'), this.timeoutMs);
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pendingConfirm = { request, settle };
      this.onAsk(request);
    });
  }

  /** Webview answer. Returns false for unknown/already-settled ids. */
  resolve(id: string, approved: boolean): boolean {
    const pending = this.pendingConfirm;
    if (!pending || pending.request.id !== id) {
      return false;
    }
    pending.settle(approved, 'user');
    return true;
  }

  /** Deny the pending ask (view disposal / end-of-turn sweep). No-op when idle. */
  denyAll(reason: 'cancelled' | 'disposed'): void {
    this.pendingConfirm?.settle(false, reason);
  }

  /** The currently pending request, for state snapshots. */
  pending(): ChatConfirmRequest | undefined {
    return this.pendingConfirm?.request;
  }
}
