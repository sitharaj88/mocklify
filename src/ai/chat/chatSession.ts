import { randomUUID } from 'node:crypto';
import type { ServerAgentTurnMessage } from '../agent/serverAgent.js';
import {
  CHAT_INPUT_MAX_CHARS,
  CHAT_PROGRESS_MAX_LINES,
  CHAT_TRANSCRIPT_MAX_MESSAGES,
  type ChatAppliedAction,
  type ChatAssistantMessage,
  type ChatConfirmReason,
  type ChatConfirmRequest,
  type ChatMessage,
  type ChatMessageFromExtension,
  type ChatPost,
  type ChatUndoState,
  type ChatUserMessage,
  type ChatViewState,
} from './chatProtocol.js';

/**
 * The chat transcript state machine AND the sole emitter: every
 * {@link ChatMessageFromExtension} the chat surface sends goes through a
 * session method, so the in-memory state and the posted messages can never
 * diverge. Posting is a no-op while no sink is attached (panel closed) — a
 * detached session keeps mutating state silently and a reopened panel
 * replays everything via {@link ChatSession.sync}.
 *
 * The session knows nothing about vscode, the tool belt, or undo snapshots;
 * the controller owns those and mirrors their events into session calls.
 * Pure logic — zero vscode imports, fully vitest-importable.
 */

// ---- Options / handles ----

export interface ChatSessionOptions {
  createId?: () => string;
  now?: () => number;
  /** Transcript cap override (default {@link CHAT_TRANSCRIPT_MAX_MESSAGES}; tests shrink it). */
  maxMessages?: number;
}

export interface ChatTurnHandles {
  userId: string;
  assistantId: string;
}

export interface ChatTurnCompletion {
  status: 'complete' | 'cancelled';
  text: string;
  actions: ChatAppliedAction[];
  undoId?: string;
}

// ---- Session ----

export class ChatSession {
  private readonly createId: () => string;
  private readonly now: () => number;
  private readonly maxMessages: number;
  private messages: ChatMessage[] = [];
  private pendingConfirm: ChatConfirmRequest | undefined;
  /** Id of the assistant message of the turn in flight (undefined when idle). */
  private activeAssistantId: string | undefined;
  private post: ChatPost | undefined;

  /** Set once by the controller: receives undoIds evicted by the message cap. */
  onEvictUndo?: (undoIds: string[]) => void;

  constructor(options?: ChatSessionOptions) {
    this.createId = options?.createId ?? ((): string => randomUUID());
    this.now = options?.now ?? Date.now;
    this.maxMessages = options?.maxMessages ?? CHAT_TRANSCRIPT_MAX_MESSAGES;
  }

  /**
   * Attach the webview sink. Attaching does NOT auto-post — callers send
   * {@link sync} when the webview asks (chatSync).
   */
  attach(post: ChatPost): void {
    this.post = post;
  }

  /** Detach the webview sink; subsequent state changes are not posted. */
  detach(): void {
    this.post = undefined;
  }

  get running(): boolean {
    return this.activeAssistantId !== undefined;
  }

  /** structuredClone'd snapshot — callers can never mutate session state. */
  state(): ChatViewState {
    return structuredClone({
      messages: this.messages,
      running: this.running,
      ...(this.pendingConfirm !== undefined ? { pendingConfirm: this.pendingConfirm } : {}),
    });
  }

  /** Post the full snapshot as chatState (no-op when detached). */
  sync(): void {
    this.emit({ type: 'chatState', state: this.state() });
  }

  // ---- Turn lifecycle ----

  /**
   * Start one turn: trim + slice the text to {@link CHAT_INPUT_MAX_CHARS},
   * refusing empty input or a turn already in flight with undefined. Appends
   * the user message plus a running assistant message, enforces the message
   * cap (evicted undo ids flow through {@link onEvictUndo}), and posts
   * chatUserMessage then chatAssistantUpdate — or one full chatState when the
   * cap evicted messages, because the webview store only ever appends/upserts
   * and would otherwise keep rendering the evicted messages (with live Undo
   * buttons whose snapshots were just freed).
   */
  beginTurn(text: string): ChatTurnHandles | undefined {
    if (this.running) {
      return undefined;
    }
    const cleaned = text.trim().slice(0, CHAT_INPUT_MAX_CHARS);
    if (cleaned === '') {
      return undefined;
    }
    const user: ChatUserMessage = {
      id: this.createId(),
      role: 'user',
      text: cleaned,
      createdAt: this.now(),
    };
    const assistant: ChatAssistantMessage = {
      id: this.createId(),
      role: 'assistant',
      status: 'running',
      progress: [],
      text: '',
      actions: [],
      createdAt: this.now(),
    };
    this.messages.push(user, assistant);
    this.activeAssistantId = assistant.id;
    if (this.enforceMessageCap()) {
      this.sync(); // eviction — the full snapshot supersedes the increments
    } else {
      this.emit({ type: 'chatUserMessage', message: structuredClone(user) });
      this.emitAssistant(assistant);
    }
    return { userId: user.id, assistantId: assistant.id };
  }

  /**
   * Append one progress line to the RUNNING assistant message (capped at
   * {@link CHAT_PROGRESS_MAX_LINES}, oldest lines dropped) and post the full
   * message. No-op when no turn is running.
   */
  appendProgress(line: string): void {
    const assistant = this.activeAssistant();
    if (!assistant) {
      return;
    }
    assistant.progress.push(line);
    if (assistant.progress.length > CHAT_PROGRESS_MAX_LINES) {
      assistant.progress.splice(0, assistant.progress.length - CHAT_PROGRESS_MAX_LINES);
    }
    this.emitAssistant(assistant);
  }

  /** Finish the running turn: status/text/actions/undo per completion; posts. */
  completeTurn(completion: ChatTurnCompletion): void {
    const assistant = this.activeAssistant();
    if (!assistant) {
      return;
    }
    assistant.status = completion.status;
    assistant.text = completion.text;
    assistant.actions = [...completion.actions];
    if (completion.undoId !== undefined) {
      assistant.undo = { undoId: completion.undoId, state: 'available' };
    }
    this.activeAssistantId = undefined;
    this.emitAssistant(assistant);
  }

  /**
   * Finish the running turn with status 'error': errorMessage set, text
   * empty, partial actions/undo preserved; posts.
   */
  failTurn(errorMessage: string, actions: ChatAppliedAction[], undoId?: string): void {
    const assistant = this.activeAssistant();
    if (!assistant) {
      return;
    }
    assistant.status = 'error';
    assistant.errorMessage = errorMessage;
    assistant.text = '';
    assistant.actions = [...actions];
    if (undoId !== undefined) {
      assistant.undo = { undoId, state: 'available' };
    }
    this.activeAssistantId = undefined;
    this.emitAssistant(assistant);
  }

  // ---- Confirm mirroring (called by the controller from bridge callbacks) ----

  /** Show the confirm card: set pendingConfirm and post chatConfirmRequest. */
  requestConfirm(request: ChatConfirmRequest): void {
    this.pendingConfirm = request;
    this.emit({ type: 'chatConfirmRequest', request: structuredClone(request) });
  }

  /** Hide the confirm card: clear pendingConfirm (when it matches) and post chatConfirmResolved. */
  resolveConfirm(id: string, approved: boolean, reason: ChatConfirmReason): void {
    if (this.pendingConfirm?.id === id) {
      this.pendingConfirm = undefined;
    }
    this.emit({ type: 'chatConfirmResolved', id, approved, reason });
  }

  // ---- Undo ----

  /**
   * Update the undo block of the assistant message owning undoId and post
   * that message. `error` is only kept when state === 'failed'. No-op when no
   * message owns the id (e.g. it was evicted).
   */
  setUndoState(undoId: string, state: ChatUndoState, error?: string): void {
    const owner = this.messages.find(
      (message): message is ChatAssistantMessage =>
        message.role === 'assistant' && message.undo?.undoId === undoId
    );
    if (!owner) {
      return;
    }
    owner.undo = {
      undoId,
      state,
      ...(state === 'failed' && error !== undefined ? { error } : {}),
    };
    this.emitAssistant(owner);
  }

  // ---- History / housekeeping ----

  /**
   * Prior COMPLETED turns as ServerAgentTurnMessage[], oldest first: user
   * messages keep their text; assistant messages contribute their final text
   * when non-empty (running turns and error turns with empty text are
   * skipped). Clamping to 8 turns / 1500 chars per turn stays in
   * formatAgentHistory, shared with the ChatParticipant.
   */
  history(): ServerAgentTurnMessage[] {
    const turns: ServerAgentTurnMessage[] = [];
    for (const message of this.messages) {
      if (message.role === 'user') {
        turns.push({ role: 'user', content: message.text });
      } else if (message.status !== 'running' && message.text.trim() !== '') {
        turns.push({ role: 'assistant', content: message.text });
      }
    }
    return turns;
  }

  /**
   * Wipe the transcript. Refuses while a turn is running (returns null).
   * Otherwise clears the messages, posts a full chatState, and returns the
   * undoIds of every dropped assistant message so the controller can free
   * their snapshots.
   */
  clear(): string[] | null {
    if (this.running) {
      return null;
    }
    const undoIds = this.collectUndoIds(this.messages);
    this.messages = [];
    this.sync();
    return undoIds;
  }

  // ---- Private ----

  private activeAssistant(): ChatAssistantMessage | undefined {
    if (this.activeAssistantId === undefined) {
      return undefined;
    }
    return this.messages.find(
      (message): message is ChatAssistantMessage =>
        message.role === 'assistant' && message.id === this.activeAssistantId
    );
  }

  /** Drop the oldest messages beyond the cap, reporting their undo ids.
   *  Returns true when anything was evicted (the caller must sync). */
  private enforceMessageCap(): boolean {
    if (this.messages.length <= this.maxMessages) {
      return false;
    }
    const evicted = this.messages.splice(0, this.messages.length - this.maxMessages);
    const undoIds = this.collectUndoIds(evicted);
    if (undoIds.length > 0) {
      this.onEvictUndo?.(undoIds);
    }
    return true;
  }

  private collectUndoIds(messages: ChatMessage[]): string[] {
    return messages
      .filter(
        (message): message is ChatAssistantMessage =>
          message.role === 'assistant' && message.undo !== undefined
      )
      .map((message) => message.undo!.undoId);
  }

  /** Post one message (no-op when detached). */
  private emit(message: ChatMessageFromExtension): void {
    this.post?.(message);
  }

  /** Post the FULL assistant message as an upsert, cloned so the transcript
   *  can keep mutating without aliasing what was already posted. */
  private emitAssistant(message: ChatAssistantMessage): void {
    this.emit({ type: 'chatAssistantUpdate', message: structuredClone(message) });
  }
}
