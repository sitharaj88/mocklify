import { useState } from 'react';
import { Loader2, Wrench, ChevronDown, ChevronUp } from 'lucide-react';
import type { ChatAssistantMessage } from '../../types/chat';

/**
 * Live tool-progress lines under an assistant bubble: the last 3 while the
 * turn runs, collapsed to an expandable "N tool calls" toggle once finished.
 */
export function ChatProgressList({ message }: { message: ChatAssistantMessage }): JSX.Element | null {
  const [expanded, setExpanded] = useState(false);

  if (message.progress.length === 0) return null;

  if (message.status === 'running') {
    const visible = message.progress.slice(-3);
    return (
      <div className="max-w-[85%] space-y-0.5">
        {visible.map((line, i) => (
          <div key={i} className="flex items-center gap-1.5 text-xs text-surface-400 font-mono">
            {i === visible.length - 1 ? (
              <Loader2 size={12} className="animate-spin shrink-0" />
            ) : (
              <span className="w-3 shrink-0" />
            )}
            <span className="flex-1 min-w-0 truncate">{line}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="max-w-[85%]">
      <button
        onClick={() => setExpanded(!expanded)}
        className="focus-ring flex items-center gap-1.5 text-xs text-surface-500 hover:text-surface-300 transition-colors duration-150"
      >
        <Wrench size={12} className="shrink-0" />
        {message.progress.length} tool call{message.progress.length === 1 ? '' : 's'}
        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
      {expanded && (
        <div className="mt-1 space-y-0.5">
          {message.progress.map((line, i) => (
            <div key={i} className="text-xs text-surface-400 font-mono whitespace-pre-wrap break-words">
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
