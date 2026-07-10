import { useEffect, useRef, useState } from 'react';
import { Send, Square } from 'lucide-react';
import { useChatStore, postChatMessage } from '../../store/chat';
import { Button } from '../ui';
import { cn } from '../../lib/utils';
import { CHAT_INPUT_MAX_CHARS } from '../../types/chat';

/**
 * Prompt composer. Enter sends, Shift+Enter inserts a newline. While a turn
 * runs the textarea is disabled and Send swaps to Stop. No optimistic append —
 * the extension echoes the user message via chatUserMessage.
 */
export function ChatInput(): JSX.Element {
  const { chat } = useChatStore();
  const [draft, setDraft] = useState('');
  const chatPrefill = useChatStore((s) => s.chatPrefill);
  const setChatPrefill = useChatStore((s) => s.setChatPrefill);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Proactive hand-off: the user clicked a notification action, so replacing the
  // draft is the expected outcome. Consume once; never send automatically.
  useEffect(() => {
    if (chatPrefill !== undefined) {
      setDraft(chatPrefill);
      setChatPrefill(undefined);
      textareaRef.current?.focus();
    }
  }, [chatPrefill, setChatPrefill]);

  const send = () => {
    const text = draft.trim();
    if (!text || chat.running) return;
    postChatMessage({ type: 'chatSend', data: { text } });
    setDraft('');
  };

  return (
    <div className="flex gap-2 items-end pt-3">
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
        rows={2}
        maxLength={CHAT_INPUT_MAX_CHARS}
        disabled={chat.running}
        placeholder="Ask the agent — e.g. add a 404 route to the payments API and restart it"
        className={cn(
          'flex-1 px-3 py-2 rounded-md text-sm resize-none transition-colors duration-150',
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
  );
}
