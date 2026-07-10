import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, AlertCircle, Copy, Check, RefreshCw } from 'lucide-react';
import { useChatStore, postChatMessage } from '../../store/chat';
import { copyText } from '../../lib/clipboard';
import { cn } from '../../lib/utils';
import { ChatMarkdown } from './ChatMarkdown';
import { ChatTimestamp } from './ChatTimestamp';
import type { ChatMessage } from '../../types/chat';

/** Small hover copy button with 1.5 s Check feedback. */
function CopyButton({ text, label }: { text: string; label: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== undefined) clearTimeout(timeoutRef.current);
    };
  }, []);

  return (
    <button
      onClick={async () => {
        if (await copyText(text)) {
          setCopied(true);
          if (timeoutRef.current !== undefined) clearTimeout(timeoutRef.current);
          timeoutRef.current = setTimeout(() => setCopied(false), 1500);
        }
      }}
      title={label}
      aria-label={label}
      className="focus-ring p-0.5 rounded text-surface-500 hover:text-surface-300 transition-colors duration-150"
    >
      {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
    </button>
  );
}

/**
 * A single transcript bubble. User text renders as plain text
 * (whitespace-pre-wrap break-words); assistant text renders through
 * ChatMarkdown (React elements only — never HTML strings).
 */
export function ChatMessageBubble({
  message,
  isLastAssistant,
}: {
  message: ChatMessage;
  isLastAssistant?: boolean;
}): JSX.Element {
  const chatRunning = useChatStore((s) => s.chat.running);

  if (message.role === 'user') {
    return (
      <div className="group relative">
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-[85%] ml-auto rounded-lg px-3 py-2 bg-brand-600/20 border border-brand-500/30 text-surface-100 text-sm whitespace-pre-wrap break-words"
        >
          {message.text}
        </motion.div>
        <div className="flex items-center justify-end gap-2 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <ChatTimestamp epochMs={message.createdAt} />
          <CopyButton text={message.text} label="Copy message" />
        </div>
      </div>
    );
  }

  const thinking = message.status === 'running' && message.text === '';
  const latestProgress = message.progress[message.progress.length - 1];
  const showRegenerate =
    isLastAssistant === true && message.status !== 'running' && !chatRunning;

  return (
    <div className="group relative">
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn(
          'max-w-[85%] rounded-lg px-3 py-2 bg-surface-800/80 border border-surface-700 text-surface-200 text-sm break-words',
          // Markdown supplies its own block spacing; the running/error branches
          // are plain text and keep their newlines.
          message.status === 'running' && 'whitespace-pre-wrap'
        )}
      >
        {message.status === 'cancelled' && (
          <div className="text-xs text-surface-400 mb-1">Stopped</div>
        )}
        {thinking ? (
          <span className="flex items-center gap-2 text-surface-400">
            <Loader2 size={14} className="animate-spin shrink-0" />
            <span className="flex-1 min-w-0 truncate">{latestProgress ?? 'Working…'}</span>
          </span>
        ) : message.status === 'running' ? (
          message.text
        ) : message.text !== '' ? (
          <ChatMarkdown text={message.text} />
        ) : null}
        {message.status === 'error' && (
          <div className="mt-2 flex items-start gap-2 p-2 rounded-md bg-red-500/10 border border-red-500/25 text-xs text-red-700 dark:text-red-300">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span className="flex-1 whitespace-pre-wrap break-words">{message.errorMessage}</span>
          </div>
        )}
      </motion.div>
      <div className="flex items-center gap-2 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <ChatTimestamp epochMs={message.createdAt} />
        {message.text !== '' && <CopyButton text={message.text} label="Copy response" />}
        {showRegenerate && (
          <button
            onClick={() => postChatMessage({ type: 'chatRegenerate' })}
            className="focus-ring flex items-center gap-1 text-[11px] text-surface-500 hover:text-surface-300 transition-colors duration-150"
          >
            <RefreshCw size={12} />
            Regenerate
          </button>
        )}
      </div>
    </div>
  );
}
