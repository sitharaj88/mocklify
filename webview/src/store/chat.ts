import { create } from 'zustand';
import { postMessage } from './index';
import type {
  ChatViewState,
  ChatUserMessage,
  ChatAssistantMessage,
  ChatConfirmRequest,
  ChatMessageToExtension,
  ChatSessionMeta,
} from '../types/chat';
import { CHAT_PREFILL_MAX_CHARS } from '../types/chat';

/**
 * Chat slice for the AI chat tab. Lives in its own store so the chat feature
 * is self-contained; the extension is the source of truth — the webview never
 * mutates transcript content locally except via extension messages, and
 * `chatSync` on mount reconciles all races.
 */
interface ChatStore {
  // State
  chat: ChatViewState;
  /** One-shot draft seed from the extension (proactive hand-off); consumed by ChatInput. */
  chatPrefill: string | undefined;
  /** Per-session input drafts, store-side only (never persisted, never sent). */
  drafts: Record<string, string>;
  /** True while the transcript viewport is scrolled near the bottom. */
  chatAtBottom: boolean;
  /** A message arrived while scrolled up — drives the scroll-button dot. */
  chatNewBelow: boolean;

  // Actions
  setChatState: (state: ChatViewState) => void;
  addChatUserMessage: (message: ChatUserMessage) => void;
  upsertChatAssistant: (message: ChatAssistantMessage) => void;
  setChatConfirm: (request: ChatConfirmRequest | undefined) => void;
  resolveChatConfirm: (id: string) => void;
  setChatPrefill: (text: string | undefined) => void;
  setChatSessions: (sessions: ChatSessionMeta[], activeSessionId: string) => void;
  setDraft: (sessionId: string, text: string) => void;
  setChatAtBottom: (atBottom: boolean) => void;
}

/** Keep only drafts whose session still exists (plus the active session's). */
function prune(
  drafts: Record<string, string>,
  sessions: ChatSessionMeta[],
  activeSessionId: string
): Record<string, string> {
  const keep = new Set(sessions.map((s) => s.id));
  keep.add(activeSessionId);
  const next: Record<string, string> = {};
  for (const [id, text] of Object.entries(drafts)) {
    if (keep.has(id)) {
      next[id] = text;
    }
  }
  return next;
}

export const useChatStore = create<ChatStore>((set) => ({
  // Initial state
  chat: { messages: [], running: false, sessions: [], activeSessionId: '' },
  chatPrefill: undefined,
  drafts: {},
  chatAtBottom: true,
  chatNewBelow: false,

  // Actions
  // Full snapshot (now carries the session list). Prune drafts here too —
  // deleting the active session / cap eviction reach the webview only via a
  // full chatState (activateSession → sync), never a chatSessionsUpdate.
  setChatState: (state) =>
    set((s) => ({ chat: state, drafts: prune(s.drafts, state.sessions, state.activeSessionId) })),
  addChatUserMessage: (message) =>
    set((s) => ({
      chat: { ...s.chat, messages: [...s.chat.messages, message] },
      chatNewBelow: s.chatAtBottom ? s.chatNewBelow : true,
    })),
  upsertChatAssistant: (message) =>
    set((s) => {
      const i = s.chat.messages.findIndex((m) => m.id === message.id);
      const messages =
        i === -1
          ? [...s.chat.messages, message]
          : s.chat.messages.map((m) => (m.id === message.id ? message : m));
      return {
        chat: { ...s.chat, messages, running: message.status === 'running' },
        chatNewBelow: s.chatAtBottom ? s.chatNewBelow : true,
      };
    }),
  setChatConfirm: (request) =>
    set((s) => ({ chat: { ...s.chat, pendingConfirm: request } })),
  resolveChatConfirm: (id) =>
    set((s) =>
      s.chat.pendingConfirm?.id === id
        ? { chat: { ...s.chat, pendingConfirm: undefined } }
        : s
    ),
  // Defensive clamp even though the extension already clamped.
  setChatPrefill: (text) =>
    set({ chatPrefill: text && text.trim() !== '' ? text.slice(0, CHAT_PREFILL_MAX_CHARS) : undefined }),
  // Metadata-only refresh — messages/running/pendingConfirm untouched.
  setChatSessions: (sessions, activeSessionId) =>
    set((s) => ({
      chat: { ...s.chat, sessions, activeSessionId },
      drafts: prune(s.drafts, sessions, activeSessionId),
    })),
  setDraft: (sessionId, text) =>
    set((s) => ({ drafts: { ...s.drafts, [sessionId]: text } })),
  setChatAtBottom: (atBottom) =>
    set((s) => ({ chatAtBottom: atBottom, chatNewBelow: atBottom ? false : s.chatNewBelow })),
}));

/**
 * Typed postMessage for chat traffic. ChatMessageToExtension is part of the
 * MessageToExtension union (types/index.ts re-exports ./chat).
 */
export function postChatMessage(message: ChatMessageToExtension): void {
  postMessage(message);
}
