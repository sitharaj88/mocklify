import { clampLine } from '../agent/serverTools.js';
import {
  CHAT_INPUT_MAX_CHARS,
  CHAT_PROGRESS_MAX_LINES,
  CHAT_SESSION_DEFAULT_TITLE,
  CHAT_SESSION_TITLE_MAX_CHARS,
  CHAT_TRANSCRIPT_MAX_MESSAGES,
  type ChatMessage,
  type ChatUndoInfo,
} from './chatProtocol.js';

/**
 * Persistence for the chat's multi-session history: the versioned
 * workspaceState blob format, a forgiving parser (corrupt/oversized data
 * reads as empty — FileCheckpointSaver style, never throws into chat), the
 * live↔persisted message mappers, and a debounced write-through store.
 *
 * Volatile fields are structurally unrepresentable in the persisted shapes:
 * no 'running' status, no pendingConfirm, no undoId, no undo error strings.
 *
 * Pure logic — zero vscode imports, fully vitest-importable.
 */

// ---- Constants ----

export const CHAT_PERSIST_VERSION = 1;
export const CHAT_PERSIST_KEY = 'mocklify.chat.v1';
export const CHAT_PERSIST_DEBOUNCE_MS = 750;
export const CHAT_PERSIST_MAX_BYTES = 512_000;
export const CHAT_SESSIONS_MAX = 30;
/** Defensive per-field caps applied on BOTH serialize and parse. */
export const CHAT_PERSIST_ASSISTANT_TEXT_MAX_CHARS = 20_000;
/** errorMessage cap — an uncapped provider/tool error embedding a response
 *  body must never blow the blob past maxBytes and cascade into evicting
 *  every other session's history via applyPersistCaps. */
export const CHAT_PERSIST_ERROR_MESSAGE_MAX_CHARS = 2_000;
export const CHAT_PERSIST_PROGRESS_LINE_MAX_CHARS = 500;
export const CHAT_PERSIST_ACTION_SUMMARY_MAX_CHARS = 300;
export const CHAT_PERSIST_ACTIONS_MAX = 40;

// ---- Persisted shapes ----

export interface PersistedUserMessage {
  id: string;
  role: 'user';
  text: string;
  createdAt: number;
}

export interface PersistedAssistantMessage {
  id: string;
  role: 'assistant';
  status: 'complete' | 'cancelled' | 'error'; // NEVER 'running'
  text: string;
  errorMessage?: string;
  progress: string[]; // ≤ CHAT_PROGRESS_MAX_LINES lines
  actions: { kind: string; summary: string; serverName: string }[];
  undoState?: 'undone' | 'expired'; // no undoId, no live state, no error text
  createdAt: number;
}

export type PersistedChatMessage = PersistedUserMessage | PersistedAssistantMessage;

export interface PersistedChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: PersistedChatMessage[]; // ≤ CHAT_TRANSCRIPT_MAX_MESSAGES
}

export interface PersistedChatState {
  version: 1;
  activeSessionId: string | null;
  sessions: PersistedChatSession[]; // updatedAt desc
}

// ---- Storage seam ----

/**
 * Structural Memento seam. vscode.Memento satisfies this: its generic
 * `get<T>(key): T | undefined` instantiates to `(key: string) => unknown`,
 * and `update`'s Thenable<void> return is assignable to `unknown` (Thenable
 * is not in vitest's lib, so the seam must not name it).
 */
export interface ChatStateStorage {
  get(key: string): unknown;
  update(key: string, value: unknown): unknown;
}

export interface ChatSessionStoreOptions {
  storage: ChatStateStorage;
  key?: string; // default CHAT_PERSIST_KEY
  debounceMs?: number; // default CHAT_PERSIST_DEBOUNCE_MS
  maxBytes?: number; // default CHAT_PERSIST_MAX_BYTES
  onWarning?: (message: string) => void; // default no-op
}

// ---- Pure helpers ----

/** The blob every corrupt/missing read collapses to. */
export function emptyPersistedChatState(): PersistedChatState {
  return { version: 1, activeSessionId: null, sessions: [] };
}

/** Non-array object narrowing (mirrors chatProtocol's private asRecord). */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parsePersistedAction(
  raw: unknown
): { kind: string; summary: string; serverName: string } | undefined {
  const record = asRecord(raw);
  if (
    !record ||
    typeof record.kind !== 'string' ||
    typeof record.summary !== 'string' ||
    typeof record.serverName !== 'string'
  ) {
    return undefined;
  }
  return {
    kind: record.kind,
    summary: record.summary.slice(0, CHAT_PERSIST_ACTION_SUMMARY_MAX_CHARS),
    serverName: record.serverName,
  };
}

/** One persisted message, or undefined when it matches neither shape. */
function parsePersistedMessage(raw: unknown): PersistedChatMessage | undefined {
  const record = asRecord(raw);
  if (!record) {
    return undefined;
  }
  const id = nonEmptyString(record.id);
  const createdAt = finiteNumber(record.createdAt);
  if (id === undefined || createdAt === undefined || typeof record.text !== 'string') {
    return undefined;
  }
  if (record.role === 'user') {
    return { id, role: 'user', text: record.text.slice(0, CHAT_INPUT_MAX_CHARS), createdAt };
  }
  if (record.role !== 'assistant') {
    return undefined;
  }
  const status = record.status;
  if (status !== 'complete' && status !== 'cancelled' && status !== 'error') {
    return undefined; // includes 'running' — never rehydrated
  }
  const progress = (Array.isArray(record.progress) ? record.progress : [])
    .filter((line): line is string => typeof line === 'string')
    .slice(0, CHAT_PROGRESS_MAX_LINES)
    .map((line) => line.slice(0, CHAT_PERSIST_PROGRESS_LINE_MAX_CHARS));
  const actions = (Array.isArray(record.actions) ? record.actions : [])
    .map(parsePersistedAction)
    .filter((action): action is { kind: string; summary: string; serverName: string } =>
      action !== undefined
    )
    .slice(0, CHAT_PERSIST_ACTIONS_MAX);
  const undoState =
    record.undoState === 'undone' || record.undoState === 'expired' ? record.undoState : undefined;
  return {
    id,
    role: 'assistant',
    status,
    text: record.text.slice(0, CHAT_PERSIST_ASSISTANT_TEXT_MAX_CHARS),
    ...(typeof record.errorMessage === 'string'
      ? { errorMessage: record.errorMessage.slice(0, CHAT_PERSIST_ERROR_MESSAGE_MAX_CHARS) }
      : {}),
    progress,
    actions,
    ...(undoState !== undefined ? { undoState } : {}),
    createdAt,
  };
}

function parsePersistedSession(raw: unknown): PersistedChatSession | undefined {
  const record = asRecord(raw);
  if (!record) {
    return undefined;
  }
  const id = nonEmptyString(record.id);
  const rawTitle = nonEmptyString(record.title);
  const createdAt = finiteNumber(record.createdAt);
  const updatedAt = finiteNumber(record.updatedAt);
  if (id === undefined || rawTitle === undefined || createdAt === undefined || updatedAt === undefined) {
    return undefined;
  }
  const title = clampLine(rawTitle, CHAT_SESSION_TITLE_MAX_CHARS);
  if (title === '') {
    return undefined;
  }
  const messages = (Array.isArray(record.messages) ? record.messages : [])
    .map(parsePersistedMessage)
    .filter((message): message is PersistedChatMessage => message !== undefined)
    .slice(-CHAT_TRANSCRIPT_MAX_MESSAGES); // newest kept
  return { id, title, createdAt, updatedAt, messages };
}

/**
 * Forgiving parse of a raw stored blob. Non-object / wrong version /
 * non-array sessions → empty state. Malformed sessions/messages are skipped;
 * titles are clamped; each session keeps its newest
 * {@link CHAT_TRANSCRIPT_MAX_MESSAGES} messages; the newest-updated
 * {@link CHAT_SESSIONS_MAX} sessions are kept (updatedAt desc); an
 * activeSessionId not among the kept sessions collapses to null.
 */
export function parsePersistedChatState(raw: unknown): PersistedChatState {
  const record = asRecord(raw);
  if (!record || record.version !== CHAT_PERSIST_VERSION || !Array.isArray(record.sessions)) {
    return emptyPersistedChatState();
  }
  const sessions = record.sessions
    .map(parsePersistedSession)
    .filter((session): session is PersistedChatSession => session !== undefined)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, CHAT_SESSIONS_MAX);
  const activeSessionId =
    typeof record.activeSessionId === 'string' &&
    sessions.some((session) => session.id === record.activeSessionId)
      ? record.activeSessionId
      : null;
  return { version: 1, activeSessionId, sessions };
}

/**
 * Serialize live messages for storage. The input already excludes in-flight
 * turns (callers use ChatSession.persistableMessages()); status 'running' is
 * skipped defensively anyway. Live undo maps to undoState: 'undone' →
 * 'undone', everything else (available/undoing/failed/expired) → 'expired';
 * absent undo omits undoState entirely.
 */
export function toPersistedMessages(messages: ChatMessage[]): PersistedChatMessage[] {
  const persisted: PersistedChatMessage[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      persisted.push({
        id: message.id,
        role: 'user',
        text: message.text.slice(0, CHAT_INPUT_MAX_CHARS),
        createdAt: message.createdAt,
      });
      continue;
    }
    if (message.status === 'running') {
      continue; // defensive — persistableMessages() already excluded it
    }
    const undoState =
      message.undo === undefined
        ? undefined
        : message.undo.state === 'undone'
          ? ('undone' as const)
          : ('expired' as const);
    persisted.push({
      id: message.id,
      role: 'assistant',
      status: message.status,
      text: message.text.slice(0, CHAT_PERSIST_ASSISTANT_TEXT_MAX_CHARS),
      ...(message.errorMessage !== undefined
        ? { errorMessage: message.errorMessage.slice(0, CHAT_PERSIST_ERROR_MESSAGE_MAX_CHARS) }
        : {}),
      progress: message.progress
        .slice(0, CHAT_PROGRESS_MAX_LINES)
        .map((line) => line.slice(0, CHAT_PERSIST_PROGRESS_LINE_MAX_CHARS)),
      actions: message.actions.slice(0, CHAT_PERSIST_ACTIONS_MAX).map((action) => ({
        kind: action.kind,
        summary: action.summary.slice(0, CHAT_PERSIST_ACTION_SUMMARY_MAX_CHARS),
        serverName: action.serverName,
      })),
      ...(undoState !== undefined ? { undoState } : {}),
      createdAt: message.createdAt,
    });
  }
  return persisted;
}

/**
 * Rehydrate persisted messages into live transcript messages. A persisted
 * undoState becomes a synthetic undo whose id (`expired-…`) can never match
 * the controller's (empty-after-reload) snapshot map — defense in depth.
 */
export function fromPersistedMessages(persisted: PersistedChatMessage[]): ChatMessage[] {
  return persisted.map((message): ChatMessage => {
    if (message.role === 'user') {
      return { id: message.id, role: 'user', text: message.text, createdAt: message.createdAt };
    }
    const undo: ChatUndoInfo | undefined =
      message.undoState !== undefined
        ? { undoId: `expired-${message.id}`, state: message.undoState }
        : undefined;
    return {
      id: message.id,
      role: 'assistant',
      status: message.status,
      progress: [...message.progress],
      text: message.text,
      ...(message.errorMessage !== undefined ? { errorMessage: message.errorMessage } : {}),
      actions: message.actions.map((action) => ({
        kind: action.kind,
        summary: action.summary,
        serverName: action.serverName,
      })),
      ...(undo !== undefined ? { undo } : {}),
      createdAt: message.createdAt,
    };
  });
}

/**
 * Auto-title from the first prompt: clampLine to
 * {@link CHAT_SESSION_TITLE_MAX_CHARS}; whitespace-only input falls back to
 * {@link CHAT_SESSION_DEFAULT_TITLE}.
 */
export function deriveSessionTitle(text: string): string {
  const title = clampLine(text, CHAT_SESSION_TITLE_MAX_CHARS);
  return title === '' ? CHAT_SESSION_DEFAULT_TITLE : title;
}

/**
 * Pure oversize eviction (operates on a structuredClone; returns the clone):
 * while the serialized blob exceeds maxBytes — with multiple sessions, drop
 * the least-recently-updated session whose id ≠ activeSessionId; with one
 * session left, drop the oldest half (ceil(n/2)) of its messages; still
 * oversized with zero messages → `{ version, activeSessionId, sessions: [] }`.
 * Affects only the persisted blob, never live in-memory sessions.
 */
export function applyPersistCaps(state: PersistedChatState, maxBytes: number): PersistedChatState {
  const clone = structuredClone(state);
  while (JSON.stringify(clone).length > maxBytes) {
    if (clone.sessions.length > 1) {
      let victim: PersistedChatSession | undefined;
      for (const session of clone.sessions) {
        if (session.id === clone.activeSessionId) {
          continue;
        }
        if (victim === undefined || session.updatedAt < victim.updatedAt) {
          victim = session;
        }
      }
      // With > 1 sessions at most one is active, so a victim always exists;
      // the fallback guards a (theoretically impossible) all-active list.
      const evicted = victim ?? clone.sessions[clone.sessions.length - 1]!;
      clone.sessions = clone.sessions.filter((session) => session !== evicted);
      continue;
    }
    const only = clone.sessions[0];
    if (only === undefined || only.messages.length === 0) {
      return { version: 1, activeSessionId: clone.activeSessionId, sessions: [] };
    }
    only.messages = only.messages.slice(Math.ceil(only.messages.length / 2));
  }
  return clone;
}

// ---- Store ----

export class ChatSessionStore {
  private readonly storage: ChatStateStorage;
  private readonly key: string;
  private readonly debounceMs: number;
  private readonly maxBytes: number;
  private readonly onWarning: (message: string) => void;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: PersistedChatState | undefined;

  constructor(options: ChatSessionStoreOptions) {
    this.storage = options.storage;
    this.key = options.key ?? CHAT_PERSIST_KEY;
    this.debounceMs = options.debounceMs ?? CHAT_PERSIST_DEBOUNCE_MS;
    this.maxBytes = options.maxBytes ?? CHAT_PERSIST_MAX_BYTES;
    this.onWarning = options.onWarning ?? ((): void => undefined);
  }

  /** Synchronous forgiving read. storage.get throws → empty state + onWarning. */
  load(): PersistedChatState {
    let raw: unknown;
    try {
      raw = this.storage.get(this.key);
    } catch {
      this.onWarning('Mocklify chat history could not be loaded.');
      return emptyPersistedChatState();
    }
    return parsePersistedChatState(raw);
  }

  /**
   * Debounced write-through: the first call starts one trailing timer
   * (setTimeout, debounceMs); later calls within the window only replace the
   * pending state; the timer fires exactly one write of the LATEST state.
   */
  save(state: PersistedChatState): void {
    this.pending = state;
    if (this.timer === undefined) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.flushPending();
      }, this.debounceMs);
    }
  }

  /** Cancel any pending timer and write `state` now. */
  saveImmediate(state: PersistedChatState): void {
    this.clearTimer();
    this.pending = undefined;
    this.write(state);
  }

  /** Flush a pending debounced write now, then clear the timer. Idempotent. */
  dispose(): void {
    this.clearTimer();
    this.flushPending();
  }

  // ---- Private ----

  private flushPending(): void {
    const pending = this.pending;
    this.pending = undefined;
    if (pending !== undefined) {
      this.write(pending);
    }
  }

  private clearTimer(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  /** Cap, then fire-and-forget the Memento update. Never throws, never awaits. */
  private write(state: PersistedChatState): void {
    const capped = applyPersistCaps(state, this.maxBytes);
    try {
      this.storage.update(this.key, capped);
    } catch {
      this.onWarning('Mocklify chat history could not be saved.');
    }
  }
}
