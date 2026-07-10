import { useEffect, useState } from 'react';
import { Loader2, Wrench, ChevronDown, ChevronUp } from 'lucide-react';
import type { ChatAssistantMessage } from '../../types/chat';

/**
 * Live tool-progress lines under an assistant bubble: a 'Working…' group
 * (last 3 lines, expandable to all) while the turn runs, auto-collapsed to an
 * expandable "N tool calls" toggle once finished.
 */
export function ChatProgressList({ message }: { message: ChatAssistantMessage }): JSX.Element | null {
  const [expanded, setExpanded] = useState(false);
  const [runningExpanded, setRunningExpanded] = useState(false);

  // Auto-collapse: reset the running expansion whenever the turn finishes.
  useEffect(() => {
    if (message.status !== 'running') {
      setRunningExpanded(false);
    }
  }, [message.status]);

  if (message.progress.length === 0) return null;

  if (message.status === 'running') {
    const visible = runningExpanded ? message.progress : message.progress.slice(-3);
    return (
      <div className="max-w-[85%]">
        <button
          onClick={() => setRunningExpanded(!runningExpanded)}
          className="focus-ring flex items-center gap-1.5 text-xs text-surface-400 hover:text-surface-300 transition-colors duration-150"
        >
          <Loader2 size={12} className="animate-spin shrink-0" />
          Working…
          {runningExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
        <div
          className={
            runningExpanded ? 'mt-1 space-y-0.5 max-h-40 overflow-y-auto' : 'mt-1 space-y-0.5'
          }
        >
          {visible.map((line, i) => (
            <div key={i} className="text-xs text-surface-400 font-mono truncate">
              {line}
            </div>
          ))}
        </div>
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
