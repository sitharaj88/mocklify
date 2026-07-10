import { useEffect, useRef } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Sparkles, Trash2 } from 'lucide-react';
import { useChatStore, postChatMessage } from '../../store/chat';
import { Button } from '../ui';
import { cn } from '../../lib/utils';
import { ChatMessageBubble } from './ChatMessageBubble';
import { ChatProgressList } from './ChatProgressList';
import { ChatConfirmCard } from './ChatConfirmCard';
import { ChatActionsCard } from './ChatActionsCard';
import { ChatInput } from './ChatInput';
import type { ChatAssistantMessage } from '../../types/chat';

const SUGGESTIONS = [
  'List my servers and their status',
  'Add a 404 route for missing orders to my API',
  'Create a payments mock and start it',
];

/** How close (px) to the bottom the transcript must be for auto-scroll. */
const AUTO_SCROLL_THRESHOLD_PX = 80;

/** Assistant turn: bubble + live tool progress + applied-changes card. */
function ChatAssistantBlock({ message }: { message: ChatAssistantMessage }): JSX.Element {
  return (
    <div className="space-y-1.5">
      <ChatMessageBubble message={message} />
      <ChatProgressList message={message} />
      <ChatActionsCard message={message} />
    </div>
  );
}

/**
 * The AI chat tab: transcript of user/assistant turns with live tool
 * progress, mutation approval cards, undo, and a prompt composer. The
 * extension owns the transcript — this view only renders extension messages
 * (dispatched by App.tsx's handleMessage) and replays via chatSync on mount.
 */
export function ChatPanel(): JSX.Element {
  const { chat } = useChatStore();
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

  const handleScroll = () => {
    const el = transcriptRef.current;
    if (el) {
      nearBottomRef.current =
        el.scrollHeight - el.scrollTop - el.clientHeight < AUTO_SCROLL_THRESHOLD_PX;
    }
  };

  const sendSuggestion = (text: string) => {
    if (chat.running) return;
    postChatMessage({ type: 'chatSend', data: { text } });
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <div className="p-1.5 rounded-md bg-violet-500/15">
          <Sparkles className="w-4 h-4 text-violet-600 dark:text-violet-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold text-surface-50">AI Chat</h1>
          <p className="text-xs text-surface-400 truncate">
            Ask the Mocklify agent to inspect and change your mock servers — every change needs
            your approval
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={chat.running}
          onClick={() => postChatMessage({ type: 'chatClear' })}
        >
          <Trash2 size={14} />
          Clear
        </Button>
      </div>

      {/* Transcript */}
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
          chat.messages.map((m) =>
            m.role === 'user' ? (
              <ChatMessageBubble key={m.id} message={m} />
            ) : (
              <ChatAssistantBlock key={m.id} message={m} />
            )
          )
        )}
        <AnimatePresence>
          {chat.pendingConfirm && <ChatConfirmCard request={chat.pendingConfirm} />}
        </AnimatePresence>
      </div>

      <ChatInput />
    </div>
  );
}
