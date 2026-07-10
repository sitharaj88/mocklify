import { motion } from 'framer-motion';
import { Loader2, AlertCircle } from 'lucide-react';
import type { ChatMessage } from '../../types/chat';

/**
 * A single transcript bubble. All model-derived strings render as plain text
 * (whitespace-pre-wrap break-words) — never HTML or markdown.
 */
export function ChatMessageBubble({ message }: { message: ChatMessage }): JSX.Element {
  if (message.role === 'user') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-[85%] ml-auto rounded-lg px-3 py-2 bg-brand-600/20 border border-brand-500/30 text-surface-100 text-sm whitespace-pre-wrap break-words"
      >
        {message.text}
      </motion.div>
    );
  }

  const thinking = message.status === 'running' && message.text === '';
  const latestProgress = message.progress[message.progress.length - 1];

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-[85%] rounded-lg px-3 py-2 bg-surface-800/80 border border-surface-700 text-surface-200 text-sm whitespace-pre-wrap break-words"
    >
      {message.status === 'cancelled' && (
        <div className="text-xs text-surface-400 mb-1">Stopped</div>
      )}
      {thinking ? (
        <span className="flex items-center gap-2 text-surface-400">
          <Loader2 size={14} className="animate-spin shrink-0" />
          <span className="flex-1 min-w-0 truncate">{latestProgress ?? 'Thinking…'}</span>
        </span>
      ) : (
        message.text
      )}
      {message.status === 'error' && (
        <div className="mt-2 flex items-start gap-2 p-2 rounded-md bg-red-500/10 border border-red-500/25 text-xs text-red-700 dark:text-red-300">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span className="flex-1 whitespace-pre-wrap break-words">{message.errorMessage}</span>
        </div>
      )}
    </motion.div>
  );
}
