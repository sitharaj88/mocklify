import { useEffect, useRef, useState } from 'react';
import { Sparkles, Pencil, History, Plus, Trash2 } from 'lucide-react';
import { useChatStore, postChatMessage } from '../../store/chat';
import { Button } from '../ui';
import { cn } from '../../lib/utils';
import { ChatSessionList } from './ChatSessionList';
import { CHAT_SESSION_TITLE_MAX_CHARS } from '../../types/chat';

/**
 * Chat tab header: active-session title with inline rename, history dialog,
 * new-chat, and clear-transcript actions. Session content itself is owned by
 * the extension — every action here just posts a message.
 */
export function ChatSessionHeader(): JSX.Element {
  const sessions = useChatStore((s) => s.chat.sessions);
  const activeSessionId = useChatStore((s) => s.chat.activeSessionId);
  const running = useChatStore((s) => s.chat.running);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const renameRef = useRef<HTMLInputElement>(null);

  const active = sessions.find((s) => s.id === activeSessionId);
  const title = activeSessionId === '' ? 'AI Chat' : active?.title ?? 'AI Chat';

  useEffect(() => {
    if (renaming) {
      renameRef.current?.focus();
      renameRef.current?.select();
    }
  }, [renaming]);

  const startRename = () => {
    if (activeSessionId === '') return;
    setRenameDraft(title);
    setRenaming(true);
  };

  const commitRename = () => {
    setRenaming(false);
    const next = renameDraft.trim();
    if (next !== '' && next !== title) {
      postChatMessage({ type: 'chatRenameSession', data: { id: activeSessionId, title: next } });
    }
  };

  return (
    <>
      <div className="flex items-center gap-2 mb-3">
        <div className="p-1.5 rounded-md bg-violet-500/15">
          <Sparkles className="w-4 h-4 text-violet-600 dark:text-violet-400" />
        </div>
        <div className="flex-1 min-w-0 group">
          {renaming ? (
            <input
              ref={renameRef}
              value={renameDraft}
              maxLength={CHAT_SESSION_TITLE_MAX_CHARS}
              onChange={(e) => setRenameDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitRename();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  // Neutralize the draft so a following blur-commit is a no-op.
                  setRenameDraft(title);
                  setRenaming(false);
                }
              }}
              className={cn(
                'w-full max-w-xs px-2 py-0.5 rounded-md text-sm font-semibold transition-colors duration-150',
                'bg-surface-800/80 border border-surface-600 text-surface-100 placeholder:text-surface-500',
                'focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500'
              )}
            />
          ) : (
            <div className="flex items-center gap-1.5 min-w-0">
              <h1 className="font-semibold text-surface-50 truncate">{title}</h1>
              {activeSessionId !== '' && (
                <button
                  onClick={startRename}
                  title="Rename chat"
                  aria-label="Rename chat"
                  className="focus-ring shrink-0 p-0.5 rounded text-surface-500 hover:text-surface-300 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                >
                  <Pencil size={12} />
                </button>
              )}
            </div>
          )}
          <p className="text-xs text-surface-400 truncate">
            Ask the Mocklify agent to inspect and change your mock servers — every change needs
            your approval
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}>
          <History size={14} />
          <span className="hidden sm:inline">History</span>
          {sessions.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-surface-700 text-surface-300">
              {sessions.length}
            </span>
          )}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => postChatMessage({ type: 'chatNewSession' })}>
          <Plus size={14} />
          <span className="hidden sm:inline">New chat</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={running}
          onClick={() => postChatMessage({ type: 'chatClear' })}
        >
          <Trash2 size={14} />
          Clear
        </Button>
      </div>
      <ChatSessionList open={historyOpen} onOpenChange={setHistoryOpen} />
    </>
  );
}
