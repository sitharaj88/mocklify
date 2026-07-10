/**
 * Mirror of src/ai/chat/chatProtocol.ts — keep in sync by hand (see that file).
 *
 * The extension and webview are separate TypeScript projects that share
 * nothing at build time, so protocol types are hand-mirrored (same pattern
 * as the core types in ./index.ts mirroring src/types/core.ts).
 */

// ---- Transcript model ------------------------------------------------------

export type ChatAssistantStatus = 'running' | 'complete' | 'cancelled' | 'error';
export type ChatConfirmReason = 'user' | 'timeout' | 'cancelled' | 'disposed';
export type ChatUndoState = 'available' | 'undoing' | 'undone' | 'failed';

export interface ChatUserMessage {
  id: string;
  role: 'user';
  text: string;          // trimmed, sliced to CHAT_INPUT_MAX_CHARS
  createdAt: number;     // epoch ms
}

/** Mirror of ExecutedAction minus ids the webview must not need. */
export interface ChatAppliedAction {
  kind: string;          // ServerAgentActionKind value
  summary: string;       // e.g. 'Added 2 route(s): GET /api/users, …'
  serverName: string;
}

export interface ChatUndoInfo {
  undoId: string;
  state: ChatUndoState;
  error?: string;        // set when state === 'failed'
}

// ---- Confirm change payload (extension → webview only) ----

export type ChatConfirmChangeKind =
  | 'create_server' | 'add_route' | 'update_route'
  | 'delete_route' | 'start_server' | 'stop_server';

/** Webview-safe route snapshot (all strings clamped extension-side; render as plain text only). */
export interface ChatRouteSnapshot {
  method: string; path: string; statusCode: number;
  name?: string; enabled?: boolean;
  responseType: string; headersCount: number;
  bodyPreview?: string; disclosures: string[];
}
export interface ChatRouteFieldDiff { field: string; before: string; after: string }
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

export interface ChatAssistantMessage {
  id: string;
  role: 'assistant';
  status: ChatAssistantStatus;
  /** Live tool-progress lines (formatAgentToolProgress output), capped. */
  progress: string[];
  /** Final assistant Markdown-as-text. Streams later by resending this
   *  message with a longer text — no protocol change needed. */
  text: string;
  errorMessage?: string; // set when status === 'error'
  actions: ChatAppliedAction[];   // [] when none
  undo?: ChatUndoInfo;            // present iff the turn produced a snapshot
  createdAt: number;
}

export type ChatMessage = ChatUserMessage | ChatAssistantMessage;

export interface ChatConfirmRequest {
  id: string;
  title: string;         // clampLine'd, ≤ CHAT_CONFIRM_TITLE_MAX_CHARS
  detail: string;        // newlines preserved, sliced to CHAT_CONFIRM_DETAIL_MAX_CHARS
  createdAt: number;
  timeoutMs: number;     // so the card can render a countdown
  change?: ChatConfirmChange;  // structured diff; absent → render detail text
}

export interface ChatViewState {
  messages: ChatMessage[];
  running: boolean;
  pendingConfirm?: ChatConfirmRequest;
}

// ---- Message protocol ------------------------------------------------------

/** Webview → extension (untrusted; validated extension-side). */
export type ChatMessageToExtension =
  | { type: 'chatSync' }                                        // request full ChatViewState replay
  | { type: 'chatSend'; data: { text: string } }                // user submits a prompt
  | { type: 'chatStop' }                                        // cancel the running turn
  | { type: 'chatConfirm'; data: { id: string; approved: boolean } } // confirm-card answer
  | { type: 'chatUndo'; data: { undoId: string } }              // Undo button
  | { type: 'chatClear' };                                      // clear transcript (idle only)

/** Extension → webview. */
export type ChatMessageFromExtension =
  | { type: 'chatState'; state: ChatViewState }                          // full snapshot (sync/clear)
  | { type: 'chatUserMessage'; message: ChatUserMessage }                // append
  | { type: 'chatAssistantUpdate'; message: ChatAssistantMessage }       // upsert by id (full message)
  | { type: 'chatConfirmRequest'; request: ChatConfirmRequest }          // show confirm card
  | { type: 'chatConfirmResolved'; id: string; approved: boolean; reason: ChatConfirmReason } // hide card
  | { type: 'chatFocus' }                                                // navigate to the chat tab
  | { type: 'chatPrefill'; text: string };                               // pre-fill the input, never sends

// ---- Constants -------------------------------------------------------------

/** Max prompt length (kept equal to SERVER_AGENT_PROMPT_MAX_CHARS). */
export const CHAT_INPUT_MAX_CHARS = 4_000;
/** Prefill cap — equals the input cap it lands in. */
export const CHAT_PREFILL_MAX_CHARS = CHAT_INPUT_MAX_CHARS;
