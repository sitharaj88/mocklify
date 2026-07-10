import { useEffect, useLayoutEffect, useRef } from 'react';
import { Send, Square } from 'lucide-react';
import { useChatStore, postChatMessage } from '../../store/chat';
import { Button } from '../ui';
import { cn } from '../../lib/utils';
import { CHAT_INPUT_MAX_CHARS } from '../../types/chat';

/** Autosize cap (~8 lines). */
const TEXTAREA_MAX_HEIGHT_PX = 176;
/** Show the character counter once within this many chars of the cap. */
const COUNTER_SHOW_THRESHOLD = 500;

/**
 * Prompt composer. Enter sends, Shift+Enter inserts a newline. While a turn
 * runs the textarea is disabled and Send swaps to Stop. No optimistic append —
 * the extension echoes the user message via chatUserMessage. Drafts live in
 * the store per session, so switching sessions preserves each one.
 */
export function ChatInput(): JSX.Element {
  const { chat } = useChatStore();
  const activeId = useChatStore((s) => s.chat.activeSessionId);
  const draft = useChatStore((s) => s.drafts[s.chat.activeSessionId] ?? '');
  const setDraft = useChatStore((s) => s.setDraft);
  const chatPrefill = useChatStore((s) => s.chatPrefill);
  const setChatPrefill = useChatStore((s) => s.setChatPrefill);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Proactive hand-off: the user clicked a notification action, so replacing the
  // draft is the expected outcome. Consume once; never send automatically.
  // Hold the prefill until the chatSync round trip delivers the real session id
  // (activeId is '' before the first chatState) — consuming it into drafts['']
  // would strand it on a key the store later prunes. The activeId dependency
  // re-runs this effect as soon as the id arrives.
  useEffect(() => {
    if (chatPrefill !== undefined && activeId !== '') {
      setDraft(activeId, chatPrefill);
      setChatPrefill(undefined);
      textareaRef.current?.focus();
    }
  }, [chatPrefill, setChatPrefill, setDraft, activeId]);

  // Autosize with the draft, capped at ~8 lines (scrolls beyond).
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT_PX) + 'px';
    }
  }, [draft]);

  const send = () => {
    const text = draft.trim();
    if (!text || chat.running) return;
    postChatMessage({ type: 'chatSend', data: { text } });
    setDraft(activeId, '');
  };

  const remaining = CHAT_INPUT_MAX_CHARS - draft.length;

  return (
    <div className="pt-3">
      <div className="flex gap-2 items-end">
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(activeId, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={1}
          maxLength={CHAT_INPUT_MAX_CHARS}
          disabled={chat.running}
          placeholder="Ask the agent — e.g. add a 404 route to the payments API and restart it"
          className={cn(
            'flex-1 px-3 py-2 rounded-md text-sm resize-none transition-colors duration-150',
            'max-h-44 overflow-y-auto',
            'bg-surface-800/80 border border-surface-600 text-surface-100 placeholder:text-surface-500',
            'focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500',
            'disabled:opacity-60'
          )}
        />
        {chat.running ? (
          <Button variant="danger" onClick={() => postChatMessage({ type: 'chatStop' })}>
            <Square size={14} />
            Stop
          </Button>
        ) : (
          <Button
            onClick={send}
            disabled={!draft.trim()}
            className="bg-violet-600 hover:bg-violet-500 text-white"
          >
            <Send size={16} />
            Send
          </Button>
        )}
      </div>
      {remaining <= COUNTER_SHOW_THRESHOLD && (
        <div
          className={cn(
            'text-right text-[10px] mt-1',
            remaining <= 0
              ? 'text-red-500'
              : remaining <= 100
                ? 'text-amber-500'
                : 'text-surface-500'
          )}
        >
          {draft.length.toLocaleString()} / {CHAT_INPUT_MAX_CHARS.toLocaleString()}
        </div>
      )}
    </div>
  );
}
