import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ShieldQuestion, CheckCircle2, X } from 'lucide-react';
import { postChatMessage } from '../../store/chat';
import { Button } from '../ui';
import { ChatConfirmDiff } from './ChatConfirmDiff';
import type { ChatConfirmRequest } from '../../types/chat';

/**
 * Approval card for a pending mutation (HITL). Both buttons disable after the
 * first click; the extension's exactly-once bridge still guards duplicates.
 * The card disappears when the store's pendingConfirm clears.
 */
export function ChatConfirmCard({ request }: { request: ChatConfirmRequest }): JSX.Element {
  const [answered, setAnswered] = useState(false);

  // Fresh buttons for every new confirm request
  useEffect(() => {
    setAnswered(false);
  }, [request.id]);

  const answer = (approved: boolean) => {
    if (answered) return;
    setAnswered(true);
    postChatMessage({ type: 'chatConfirm', data: { id: request.id, approved } });
  };

  // Guard against an out-of-date extension/webview pair: an unrecognized kind
  // falls back to the plain-text detail block (ChatConfirmDiff renders null).
  const hasDiff =
    request.change !== undefined &&
    ['create_server', 'add_route', 'update_route', 'delete_route', 'start_server', 'stop_server'].includes(
      request.change.kind
    );

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-3 rounded-md bg-amber-500/10 border border-amber-500/30 space-y-2"
    >
      <div className="flex items-start gap-2 text-sm font-medium text-amber-700 dark:text-amber-300">
        <ShieldQuestion size={16} className="mt-0.5 shrink-0 animate-pulse" />
        <span className="flex-1">{request.title}</span>
      </div>
      {hasDiff && request.change ? (
        <div className="max-h-64 overflow-y-auto">
          <ChatConfirmDiff change={request.change} />
        </div>
      ) : (
        <div className="text-xs text-surface-300 whitespace-pre-wrap break-words font-mono max-h-48 overflow-y-auto">
          {request.detail}
        </div>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() => answer(true)}
          disabled={answered}
          className="bg-emerald-600 hover:bg-emerald-500 text-white"
        >
          <CheckCircle2 size={14} />
          Apply
        </Button>
        <Button variant="secondary" size="sm" onClick={() => answer(false)} disabled={answered}>
          <X size={14} />
          Cancel
        </Button>
      </div>
      <div className="text-[11px] text-surface-400">
        No answer within {Math.round(request.timeoutMs / 60000)} minutes cancels this change
        automatically.
      </div>
    </motion.div>
  );
}
