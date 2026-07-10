import { CheckCircle2, Undo2, Loader2 } from 'lucide-react';
import { useChatStore, postChatMessage } from '../../store/chat';
import { Button } from '../ui';
import type { ChatAssistantMessage } from '../../types/chat';

/**
 * "Applied changes" summary under an assistant message, with an Undo button
 * while the turn's snapshot is still available.
 */
export function ChatActionsCard({ message }: { message: ChatAssistantMessage }): JSX.Element | null {
  const { chat } = useChatStore();

  if (message.actions.length === 0) return null;

  const undo = message.undo;

  return (
    <div className="max-w-[85%] p-3 rounded-md bg-emerald-500/10 border border-emerald-500/25 space-y-2">
      <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 size={16} className="shrink-0" />
        <span className="font-medium">Applied changes</span>
      </div>
      <ul className="text-xs text-surface-300 list-disc pl-4 space-y-0.5">
        {message.actions.map((a, i) => (
          <li key={i} className="whitespace-pre-wrap break-words">
            {a.summary}
          </li>
        ))}
      </ul>
      {undo?.state === 'available' && (
        <Button
          variant="secondary"
          size="sm"
          disabled={chat.running}
          onClick={() => postChatMessage({ type: 'chatUndo', data: { undoId: undo.undoId } })}
        >
          <Undo2 size={14} />
          Undo these changes
        </Button>
      )}
      {undo?.state === 'undoing' && (
        <Button variant="secondary" size="sm" disabled>
          <Loader2 size={14} className="animate-spin" />
          Undoing…
        </Button>
      )}
      {undo?.state === 'undone' && (
        <div className="text-xs text-surface-400">Changes rolled back.</div>
      )}
      {undo?.state === 'failed' && (
        <div className="text-xs text-red-700 dark:text-red-300">{undo.error}</div>
      )}
      {undo?.state === 'expired' && (
        <div className="text-xs text-surface-500">
          Undo expired — changes from an earlier window can't be rolled back here.
        </div>
      )}
    </div>
  );
}
