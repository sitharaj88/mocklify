import { create } from 'zustand';
import { postMessage } from './index';
import type {
  ChatViewState,
  ChatUserMessage,
  ChatAssistantMessage,
  ChatConfirmRequest,
  ChatMessageToExtension,
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

  // Actions
  setChatState: (state: ChatViewState) => void;
  addChatUserMessage: (message: ChatUserMessage) => void;
  upsertChatAssistant: (message: ChatAssistantMessage) => void;
  setChatConfirm: (request: ChatConfirmRequest | undefined) => void;
  resolveChatConfirm: (id: string) => void;
  setChatPrefill: (text: string | undefined) => void;
}

export const useChatStore = create<ChatStore>((set) => ({
  // Initial state
  chat: { messages: [], running: false },
  chatPrefill: undefined,

  // Actions
  setChatState: (state) => set({ chat: state }),
  addChatUserMessage: (message) =>
    set((s) => ({ chat: { ...s.chat, messages: [...s.chat.messages, message] } })),
  upsertChatAssistant: (message) =>
    set((s) => {
      const i = s.chat.messages.findIndex((m) => m.id === message.id);
      const messages =
        i === -1
          ? [...s.chat.messages, message]
          : s.chat.messages.map((m) => (m.id === message.id ? message : m));
      return { chat: { ...s.chat, messages, running: message.status === 'running' } };
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
}));

/**
 * Typed postMessage for chat traffic. ChatMessageToExtension is part of the
 * MessageToExtension union (types/index.ts re-exports ./chat).
 */
export function postChatMessage(message: ChatMessageToExtension): void {
  postMessage(message);
}
