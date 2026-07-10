import { useEffect, useRef, useState } from 'react';
import { Pencil, Trash2, Plus } from 'lucide-react';
import { useChatStore, postChatMessage } from '../../store/chat';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from '../ui/Dialog';
import { Button } from '../ui';
import { cn } from '../../lib/utils';
import { ChatTimestamp } from './ChatTimestamp';
import { CHAT_SESSION_TITLE_MAX_CHARS } from '../../types/chat';
import type { ChatSessionMeta } from '../../types/chat';

/** How long the two-step 'Delete?' confirm stays armed. */
const DELETE_CONFIRM_MS = 3000;

function SessionRow({
  session,
  active,
  onSwitch,
}: {
  session: ChatSessionMeta;
  active: boolean;
  onSwitch: () => void;
}): JSX.Element {
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const renameRef = useRef<HTMLInputElement>(null);
  const deleteTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (renaming) {
      renameRef.current?.focus();
      renameRef.current?.select();
    }
  }, [renaming]);

  useEffect(() => {
    return () => {
      if (deleteTimeoutRef.current !== undefined) clearTimeout(deleteTimeoutRef.current);
    };
  }, []);

  const commitRename = () => {
    setRenaming(false);
    const next = renameDraft.trim();
    if (next !== '' && next !== session.title) {
      postChatMessage({ type: 'chatRenameSession', data: { id: session.id, title: next } });
    }
  };

  const handleDelete = () => {
    if (confirmingDelete) {
      if (deleteTimeoutRef.current !== undefined) clearTimeout(deleteTimeoutRef.current);
      setConfirmingDelete(false);
      postChatMessage({ type: 'chatDeleteSession', data: { id: session.id } });
    } else {
      setConfirmingDelete(true);
      deleteTimeoutRef.current = setTimeout(() => setConfirmingDelete(false), DELETE_CONFIRM_MS);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSwitch}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !renaming) onSwitch();
      }}
      className={cn(
        'focus-ring group flex items-center gap-2 px-2 py-2 rounded-md hover:bg-surface-800/80 cursor-pointer transition-colors duration-150',
        active && 'bg-violet-500/10 border border-violet-500/30'
      )}
    >
      <div className="flex-1 min-w-0">
        {renaming ? (
          <input
            ref={renameRef}
            value={renameDraft}
            maxLength={CHAT_SESSION_TITLE_MAX_CHARS}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setRenameDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                e.preventDefault();
                commitRename();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                // Neutralize the draft so a following blur-commit is a no-op.
                setRenameDraft(session.title);
                setRenaming(false);
              }
            }}
            className={cn(
              'w-full px-2 py-0.5 rounded-md text-sm transition-colors duration-150',
              'bg-surface-800/80 border border-surface-600 text-surface-100 placeholder:text-surface-500',
              'focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500'
            )}
          />
        ) : (
          <div className="text-sm text-surface-100 truncate">{session.title}</div>
        )}
        <div className="text-[11px] text-surface-500">
          <ChatTimestamp epochMs={session.updatedAt} className="text-[11px]" /> ·{' '}
          {session.messageCount} message{session.messageCount === 1 ? '' : 's'}
        </div>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setRenameDraft(session.title);
            setRenaming(true);
          }}
          title="Rename chat"
          aria-label="Rename chat"
          className="focus-ring p-1 rounded text-surface-500 hover:text-surface-300"
        >
          <Pencil size={12} />
        </button>
        {confirmingDelete ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleDelete();
            }}
            className="focus-ring px-1 rounded text-xs text-red-500 font-medium"
          >
            Delete?
          </button>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleDelete();
            }}
            title="Delete chat"
            aria-label="Delete chat"
            className="focus-ring p-1 rounded text-surface-500 hover:text-red-500"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Chat-history dialog: switch, rename, and delete sessions. The list is the
 * store's `chat.sessions` (already updatedAt-desc from the extension).
 */
export function ChatSessionList({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const sessions = useChatStore((s) => s.chat.sessions);
  const activeSessionId = useChatStore((s) => s.chat.activeSessionId);

  const switchTo = (id: string) => {
    if (id !== activeSessionId) {
      postChatMessage({ type: 'chatSwitchSession', data: { id } });
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Chat history</DialogTitle>
        </DialogHeader>
        <DialogBody className="max-h-[60vh] overflow-y-auto space-y-1">
          {sessions.length === 0 ? (
            <p className="text-sm text-surface-400 text-center py-4">No chats yet.</p>
          ) : (
            sessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                active={session.id === activeSessionId}
                onSwitch={() => switchTo(session.id)}
              />
            ))
          )}
        </DialogBody>
        <DialogFooter>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              postChatMessage({ type: 'chatNewSession' });
              onOpenChange(false);
            }}
          >
            <Plus size={14} />
            New chat
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
