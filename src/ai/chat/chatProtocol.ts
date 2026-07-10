import type { ExecutedAction } from '../agent/serverTools.js';
import type {
  ConfirmAction,
  ConfirmChange,
  RouteChangeSnapshot,
  RouteFieldDiff,
} from '../agent/serverTools.js';
import { clampLine } from '../agent/serverTools.js';
import { SERVER_AGENT_PROMPT_MAX_CHARS } from '../agent/serverAgent.js';

/**
 * Canonical chat protocol shared between the extension host and the dashboard
 * webview's chat tab: the transcript model, the two postMessage unions, and
 * the validators that guard the extension against untrusted webview input.
 *
 * `webview/src/types/chat.ts` is a hand-maintained mirror of the type block
 * in this file (the repo's established sharing pattern —
 * `webview/src/types/index.ts` already mirrors `src/types/core.ts`; the two
 * tsconfig projects share nothing at build time). Any change to the types or
 * constants here MUST be reflected there byte-for-byte.
 *
 * Pure data + validation — zero vscode imports, fully vitest-importable.
 */

// ---- Constants ----

/** Chat input cap — kept equal to the agent's own prompt cap. */
export const CHAT_INPUT_MAX_CHARS = SERVER_AGENT_PROMPT_MAX_CHARS; // 4_000
/** Prefill cap — equals the input cap it lands in. */
export const CHAT_PREFILL_MAX_CHARS = CHAT_INPUT_MAX_CHARS; // 4_000
/** Live tool-progress lines kept per assistant message (oldest dropped). */
export const CHAT_PROGRESS_MAX_LINES = 100;
/** Transcript length cap (oldest messages dropped). */
export const CHAT_TRANSCRIPT_MAX_MESSAGES = 200;
/** Confirm-card title cap (single line). */
export const CHAT_CONFIRM_TITLE_MAX_CHARS = 120;
/** Confirm-card detail cap (newlines preserved). */
export const CHAT_CONFIRM_DETAIL_MAX_CHARS = 4_000;
/** Cap on inbound id fields (chatConfirm / chatUndo). */
export const CHAT_ID_MAX_CHARS = 200;
/** Confirm-change server/route name cap. */
export const CHAT_CONFIRM_NAME_MAX_CHARS = 60;
/** Route snapshots kept in a confirm change (mirrors ADD_ROUTES_MAX). */
export const CHAT_CONFIRM_ROUTES_MAX = 20;
/** update_route diff rows kept. */
export const CHAT_CONFIRM_DIFF_ROWS_MAX = 12;
/** Diff-row before/after preview cap. */
export const CHAT_CONFIRM_FIELD_MAX_CHARS = 80;
/** Path/disclosure line cap. */
export const CHAT_CONFIRM_LINE_MAX_CHARS = 200;
/** Body preview cap. */
export const CHAT_CONFIRM_BODY_PREVIEW_MAX_CHARS = 400;
/** Disclosure lines kept per snapshot. */
export const CHAT_CONFIRM_DISCLOSURES_MAX = 8;
export const CHAT_CONFIRM_KINDS = [
  'create_server',
  'add_route',
  'update_route',
  'delete_route',
  'start_server',
  'stop_server',
] as const;
export type ChatConfirmChangeKind = (typeof CHAT_CONFIRM_KINDS)[number];

// ---- Transcript model ----

export type ChatAssistantStatus = 'running' | 'complete' | 'cancelled' | 'error';
export type ChatConfirmReason = 'user' | 'timeout' | 'cancelled' | 'disposed';
export type ChatUndoState = 'available' | 'undoing' | 'undone' | 'failed';

export interface ChatUserMessage {
  id: string;
  role: 'user';
  /** Trimmed, sliced to {@link CHAT_INPUT_MAX_CHARS}. */
  text: string;
  /** Epoch ms. */
  createdAt: number;
}

/** Mirror of ExecutedAction minus ids the webview must not need. */
export interface ChatAppliedAction {
  /** ServerAgentActionKind value. */
  kind: string;
  /** Human-readable, e.g. 'Added 2 route(s): GET /api/users, …'. */
  summary: string;
  serverName: string;
}

export interface ChatUndoInfo {
  undoId: string;
  state: ChatUndoState;
  /** Set when state === 'failed'. */
  error?: string;
}

export interface ChatAssistantMessage {
  id: string;
  role: 'assistant';
  status: ChatAssistantStatus;
  /** Live tool-progress lines (formatAgentToolProgress output), capped. */
  progress: string[];
  /** Final assistant Markdown-as-text (arrives once at turn end today). */
  text: string;
  /** Set when status === 'error'. */
  errorMessage?: string;
  /** [] when none. */
  actions: ChatAppliedAction[];
  /** Present iff the turn produced an undo snapshot. */
  undo?: ChatUndoInfo;
  createdAt: number;
}

export type ChatMessage = ChatUserMessage | ChatAssistantMessage;

/** Webview-safe route snapshot (all strings clamped extension-side; render as plain text only). */
export interface ChatRouteSnapshot {
  method: string;
  path: string;
  statusCode: number;
  name?: string;
  enabled?: boolean;
  responseType: string;
  headersCount: number;
  bodyPreview?: string;
  disclosures: string[];
}

export interface ChatRouteFieldDiff {
  field: string;
  before: string;
  after: string;
}

export interface ChatConfirmChange {
  kind: ChatConfirmChangeKind;
  serverName: string;
  port?: number;
  protocol?: string;
  routes?: ChatRouteSnapshot[];
  before?: ChatRouteSnapshot;
  after?: ChatRouteSnapshot;
  fieldDiffs?: ChatRouteFieldDiff[];
}

export interface ChatConfirmRequest {
  id: string;
  /** clampLine'd, ≤ {@link CHAT_CONFIRM_TITLE_MAX_CHARS}. */
  title: string;
  /** Newlines preserved, sliced to {@link CHAT_CONFIRM_DETAIL_MAX_CHARS}. */
  detail: string;
  /** Structured diff payload; when absent the card renders detail as text. */
  change?: ChatConfirmChange;
  createdAt: number;
  /** So the card can render a countdown. */
  timeoutMs: number;
}

export interface ChatViewState {
  messages: ChatMessage[];
  running: boolean;
  pendingConfirm?: ChatConfirmRequest;
}

// ---- Protocol messages ----

/** Webview → extension. UNTRUSTED — parse with {@link parseChatMessageToExtension}. */
export type ChatMessageToExtension =
  | { type: 'chatSync' }
  | { type: 'chatSend'; data: { text: string } }
  | { type: 'chatStop' }
  | { type: 'chatConfirm'; data: { id: string; approved: boolean } }
  | { type: 'chatUndo'; data: { undoId: string } }
  | { type: 'chatClear' };

/** Extension → webview. chatAssistantUpdate is an upsert-by-id of the FULL message. */
export type ChatMessageFromExtension =
  | { type: 'chatState'; state: ChatViewState }
  | { type: 'chatUserMessage'; message: ChatUserMessage }
  | { type: 'chatAssistantUpdate'; message: ChatAssistantMessage }
  | { type: 'chatConfirmRequest'; request: ChatConfirmRequest }
  | { type: 'chatConfirmResolved'; id: string; approved: boolean; reason: ChatConfirmReason }
  | { type: 'chatFocus' }
  | { type: 'chatPrefill'; text: string }; // NEW — pre-fill the input, never sends

/** The webview sink the session posts through. */
export type ChatPost = (message: ChatMessageFromExtension) => void;

/**
 * Bounded chatPrefill builder (pure, vitest-tested): trims, slices to
 * CHAT_PREFILL_MAX_CHARS, preserves interior newlines.
 */
export function buildChatPrefillMessage(text: string): ChatMessageFromExtension {
  return { type: 'chatPrefill', text: text.trim().slice(0, CHAT_PREFILL_MAX_CHARS) };
}

// ---- Validation (webview input is untrusted) ----

/** Non-array object narrowing for nested `data` payloads. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

/** Inbound id field: non-empty string of at most {@link CHAT_ID_MAX_CHARS}. */
function parseId(value: unknown): string | undefined {
  if (typeof value !== 'string' || value === '' || value.length > CHAT_ID_MAX_CHARS) {
    return undefined;
  }
  return value;
}

/**
 * Validate one raw webview message. Returns undefined for anything not
 * exactly one of the six {@link ChatMessageToExtension} shapes (non-object,
 * unknown type, missing/mis-typed fields). The result is rebuilt
 * field-by-field — the raw object (and any extra properties on it) is never
 * returned.
 *
 * chatSend: data.text must be a string; it is trimmed, rejected when empty,
 * and sliced to {@link CHAT_INPUT_MAX_CHARS}. chatConfirm: data.id must be a
 * non-empty string ≤ {@link CHAT_ID_MAX_CHARS} and data.approved a real
 * boolean. chatUndo: data.undoId non-empty string ≤ {@link CHAT_ID_MAX_CHARS}.
 */
export function parseChatMessageToExtension(raw: unknown): ChatMessageToExtension | undefined {
  const record = asRecord(raw);
  if (!record) {
    return undefined;
  }
  switch (record.type) {
    case 'chatSync':
      return { type: 'chatSync' };
    case 'chatStop':
      return { type: 'chatStop' };
    case 'chatClear':
      return { type: 'chatClear' };
    case 'chatSend': {
      const data = asRecord(record.data);
      if (!data || typeof data.text !== 'string') {
        return undefined;
      }
      const text = data.text.trim().slice(0, CHAT_INPUT_MAX_CHARS);
      if (text === '') {
        return undefined;
      }
      return { type: 'chatSend', data: { text } };
    }
    case 'chatConfirm': {
      const data = asRecord(record.data);
      if (!data) {
        return undefined;
      }
      const id = parseId(data.id);
      if (id === undefined || (data.approved !== true && data.approved !== false)) {
        return undefined;
      }
      return { type: 'chatConfirm', data: { id, approved: data.approved } };
    }
    case 'chatUndo': {
      const data = asRecord(record.data);
      if (!data) {
        return undefined;
      }
      const undoId = parseId(data.undoId);
      if (undoId === undefined) {
        return undefined;
      }
      return { type: 'chatUndo', data: { undoId } };
    }
    default:
      return undefined;
  }
}

// ---- Mapping ----

/** Webview-safe pick of an ExecutedAction (drops serverId/routeIds). */
export function toChatAction(action: ExecutedAction): ChatAppliedAction {
  return { kind: action.kind, summary: action.summary, serverName: action.serverName };
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const num = typeof value === 'string' ? Number(value) : value;
  if (typeof num !== 'number' || !Number.isFinite(num)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(num)));
}

function sanitizeRouteSnapshot(raw: RouteChangeSnapshot): ChatRouteSnapshot {
  const name = typeof raw.name === 'string' ? clampLine(raw.name, CHAT_CONFIRM_NAME_MAX_CHARS) : '';
  const bodyPreview =
    typeof raw.bodyPreview === 'string'
      ? raw.bodyPreview.length > CHAT_CONFIRM_BODY_PREVIEW_MAX_CHARS
        ? `${raw.bodyPreview.slice(0, CHAT_CONFIRM_BODY_PREVIEW_MAX_CHARS)}…`
        : raw.bodyPreview
      : undefined;
  return {
    method: clampLine(String(raw.method ?? ''), 40),
    path: clampLine(String(raw.path ?? ''), CHAT_CONFIRM_LINE_MAX_CHARS),
    statusCode: clampInt(raw.statusCode, 0, 999, 0),
    ...(name !== '' ? { name } : {}),
    ...(typeof raw.enabled === 'boolean' ? { enabled: raw.enabled } : {}),
    responseType: clampLine(String(raw.responseType ?? ''), 20),
    headersCount: clampInt(raw.headersCount, 0, 999, 0),
    ...(bodyPreview !== undefined ? { bodyPreview } : {}),
    disclosures: (Array.isArray(raw.disclosures) ? raw.disclosures : [])
      .slice(0, CHAT_CONFIRM_DISCLOSURES_MAX)
      .map((line) => clampLine(String(line), CHAT_CONFIRM_LINE_MAX_CHARS)),
  };
}

function sanitizeFieldDiff(raw: RouteFieldDiff): ChatRouteFieldDiff {
  return {
    field: clampLine(String(raw.field ?? ''), 40),
    before: clampLine(String(raw.before ?? ''), CHAT_CONFIRM_FIELD_MAX_CHARS),
    after: clampLine(String(raw.after ?? ''), CHAT_CONFIRM_FIELD_MAX_CHARS),
  };
}

/** Rebuild a belt ConfirmChange for the wire. undefined for an unknown kind (card falls back to detail). */
export function sanitizeConfirmChange(raw: ConfirmChange): ChatConfirmChange | undefined {
  if (!(CHAT_CONFIRM_KINDS as readonly string[]).includes(raw.kind)) {
    return undefined;
  }
  const port = raw.port !== undefined ? clampInt(raw.port, 0, 65535, 0) : undefined;
  return {
    kind: raw.kind,
    serverName: clampLine(String(raw.serverName ?? ''), CHAT_CONFIRM_NAME_MAX_CHARS),
    ...(port !== undefined ? { port } : {}),
    ...(typeof raw.protocol === 'string' ? { protocol: clampLine(raw.protocol, 20) } : {}),
    ...(Array.isArray(raw.routes)
      ? { routes: raw.routes.slice(0, CHAT_CONFIRM_ROUTES_MAX).map(sanitizeRouteSnapshot) }
      : {}),
    ...(raw.before !== undefined ? { before: sanitizeRouteSnapshot(raw.before) } : {}),
    ...(raw.after !== undefined ? { after: sanitizeRouteSnapshot(raw.after) } : {}),
    ...(Array.isArray(raw.fieldDiffs)
      ? { fieldDiffs: raw.fieldDiffs.slice(0, CHAT_CONFIRM_DIFF_ROWS_MAX).map(sanitizeFieldDiff) }
      : {}),
  };
}

/**
 * Sanitize a belt ConfirmHandler action for display: the title becomes one
 * bounded line (clampLine, ≤ {@link CHAT_CONFIRM_TITLE_MAX_CHARS}); the
 * detail keeps its newlines and is sliced to
 * {@link CHAT_CONFIRM_DETAIL_MAX_CHARS} with a trailing '…' when cut; the
 * optional structured change is rebuilt field-by-field through
 * {@link sanitizeConfirmChange} and omitted when absent or unknown-kind.
 */
export function sanitizeConfirmAction(action: ConfirmAction): {
  title: string;
  detail: string;
  change?: ChatConfirmChange;
} {
  const title = clampLine(action.title, CHAT_CONFIRM_TITLE_MAX_CHARS);
  const detail =
    action.detail.length > CHAT_CONFIRM_DETAIL_MAX_CHARS
      ? `${action.detail.slice(0, CHAT_CONFIRM_DETAIL_MAX_CHARS)}…`
      : action.detail;
  const change = action.change !== undefined ? sanitizeConfirmChange(action.change) : undefined;
  return { title, detail, ...(change !== undefined ? { change } : {}) };
}
