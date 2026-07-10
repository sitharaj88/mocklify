import { Fragment, useEffect, useRef } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import { useChatStore, postChatMessage } from '../../store/chat';
import { cn } from '../../lib/utils';
import { dayKey } from '../../lib/time';
import { ChatMessageBubble } from './ChatMessageBubble';
import { ChatProgressList } from './ChatProgressList';
import { ChatConfirmCard } from './ChatConfirmCard';
import { ChatActionsCard } from './ChatActionsCard';
import { ChatInput } from './ChatInput';
import { ChatSessionHeader } from './ChatSessionHeader';
import { ChatDayDivider } from './ChatDayDivider';
import { ChatScrollButton } from './ChatScrollButton';
import type { ChatAssistantMessage } from '../../types/chat';

const SUGGESTIONS = [
  'List my servers and their status',
  'Add a 404 route for missing orders to my API',
  'Create a payments mock and start it',
];

/** How close (px) to the bottom the transcript must be for auto-scroll. */
const AUTO_SCROLL_THRESHOLD_PX = 80;

/** Assistant turn: bubble + live tool progress + applied-changes card. */
function ChatAssistantBlock({
  message,
  isLastAssistant,
}: {
  message: ChatAssistantMessage;
  isLastAssistant: boolean;
}): JSX.Element {
  return (
    <div className="space-y-1.5">
      <ChatMessageBubble message={message} isLastAssistant={isLastAssistant} />
      <ChatProgressList message={message} />
      <ChatActionsCard message={message} />
    </div>
  );
}

/**
 * The AI chat tab: transcript of user/assistant turns with live tool
 * progress, mutation approval cards, undo, session history, and a prompt
 * composer. The extension owns the transcript — this view only renders
 * extension messages (dispatched by App.tsx's handleMessage) and replays via
 * chatSync on mount.
 */
export function ChatPanel(): JSX.Element {
  const { chat } = useChatStore();
  const chatAtBottom = useChatStore((s) => s.chatAtBottom);
  const chatNewBelow = useChatStore((s) => s.chatNewBelow);
  const setChatAtBottom = useChatStore((s) => s.setChatAtBottom);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);

  // Replay the extension-side transcript on mount (covers panel reopen;
  // hide/show needs nothing thanks to retainContextWhenHidden).
  useEffect(() => {
    postChatMessage({ type: 'chatSync' });
  }, []);

  // Follow new messages, but only when the user is already near the bottom.
  useEffect(() => {
    const el = transcriptRef.current;
    if (el && nearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [chat.messages, chat.pendingConfirm]);

  // Switching sessions lands at the latest messages.
  useEffect(() => {
    const el = transcriptRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
    nearBottomRef.current = true;
    setChatAtBottom(true);
  }, [chat.activeSessionId, setChatAtBottom]);

  const handleScroll = () => {
    const el = transcriptRef.current;
    if (el) {
      const nearBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight < AUTO_SCROLL_THRESHOLD_PX;
      // Mirror into the store only on threshold crossings (no render storms).
      if (nearBottom !== nearBottomRef.current) {
        nearBottomRef.current = nearBottom;
        setChatAtBottom(nearBottom);
      }
    }
  };

  const scrollToBottom = () => {
    const el = transcriptRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
    nearBottomRef.current = true;
    setChatAtBottom(true);
  };

  const sendSuggestion = (text: string) => {
    if (chat.running) return;
    postChatMessage({ type: 'chatSend', data: { text } });
  };

  const lastAssistantId = [...chat.messages].reverse().find((m) => m.role === 'assistant')?.id;

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-4 sm:p-6">
      <ChatSessionHeader />

      {/* Transcript */}
      <div className="relative flex-1 min-h-0 flex flex-col">
        <div
          ref={transcriptRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto space-y-3"
        >
          {chat.messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center gap-3 px-6">
              <div className="p-3 rounded-full bg-violet-500/10">
                <Sparkles className="w-6 h-6 text-violet-600 dark:text-violet-400" />
              </div>
              <p className="text-sm text-surface-400 max-w-sm">
                Start a conversation — the agent can list, create, edit, start, and stop your mock
                servers.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => sendSuggestion(suggestion)}
                    className={cn(
                      'focus-ring px-3 py-1 rounded-full text-xs transition-colors duration-150',
                      'bg-surface-800/80 border border-surface-700 text-surface-300',
                      'hover:border-violet-500/50 hover:text-violet-700 dark:hover:text-violet-300'
                    )}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            chat.messages.map((m, i) => (
              <Fragment key={m.id}>
                {(i === 0 || dayKey(chat.messages[i - 1].createdAt) !== dayKey(m.createdAt)) && (
                  <ChatDayDivider epochMs={m.createdAt} />
                )}
                {m.role === 'user' ? (
                  <ChatMessageBubble message={m} />
                ) : (
                  <ChatAssistantBlock
                    message={m}
                    isLastAssistant={
                      m.id === lastAssistantId && i === chat.messages.length - 1
                    }
                  />
                )}
              </Fragment>
            ))
          )}
          <AnimatePresence>
            {chat.pendingConfirm && <ChatConfirmCard request={chat.pendingConfirm} />}
          </AnimatePresence>
        </div>
        <ChatScrollButton visible={!chatAtBottom} hasNew={chatNewBelow} onClick={scrollToBottom} />
      </div>

      <ChatInput />
    </div>
  );
}
