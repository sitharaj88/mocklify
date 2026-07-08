import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  X,
  FolderSearch,
} from 'lucide-react';
import { useStore, postMessage } from '../store';
import { Button } from './ui';
import { cn } from '../lib/utils';

const SUGGESTIONS = [
  'E-commerce API with products, carts, and orders',
  'Social media API with users, posts, and comments',
  'Banking API with accounts and transactions',
  'Task manager API with projects and tasks',
];

/**
 * Prompt box that turns a plain-English description into a complete mock
 * server (powered by GitHub Copilot on the extension side).
 */
export function AiCreatePanel() {
  const { aiGeneration, setAiGeneration, setSelectedServerId, setActiveView } = useStore();
  const [description, setDescription] = useState('');
  const [autoStart, setAutoStart] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  const isGenerating = aiGeneration.status === 'generating';

  // Clear the prompt after a successful generation
  useEffect(() => {
    if (aiGeneration.status === 'done') {
      setDescription('');
    }
  }, [aiGeneration.status]);

  const handleGenerate = (text?: string) => {
    const prompt = (text ?? description).trim();
    if (!prompt || isGenerating) return;
    if (text) setDescription(text);
    postMessage({ type: 'aiGenerateServer', data: { description: prompt, autoStart } });
  };

  const handleViewServer = () => {
    if (aiGeneration.serverId) {
      setSelectedServerId(aiGeneration.serverId);
      setActiveView('routes');
    }
    setAiGeneration({ status: 'idle' });
  };

  return (
    <div
      className={cn(
        'relative rounded-lg border p-4 sm:p-5 mb-6 overflow-hidden',
        'border-violet-500/30 bg-violet-500/5'
      )}
    >
      <div className="flex items-center gap-2 mb-3">
        <div className="p-1.5 rounded-md bg-violet-500/15">
          <Sparkles className="w-4 h-4 text-violet-600 dark:text-violet-400" />
        </div>
        <h2 className="font-semibold text-surface-50">Create with AI</h2>
        <span className="text-xs text-surface-400 hidden sm:inline">
          Describe your API — get a running mock server with realistic data
        </span>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <input
          ref={inputRef}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
          disabled={isGenerating}
          placeholder="e.g. ecommerce api server with products, carts, and orders"
          className={cn(
            'flex-1 px-3 py-2 rounded-md text-sm transition-colors duration-150',
            'bg-surface-800/80 border border-surface-600 text-surface-100 placeholder:text-surface-500',
            'focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500',
            'disabled:opacity-60'
          )}
        />
        <Button
          onClick={() => handleGenerate()}
          disabled={isGenerating || !description.trim()}
          className="bg-violet-600 hover:bg-violet-500 text-white"
        >
          {isGenerating ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Generating…
            </>
          ) : (
            <>
              <Sparkles size={16} />
              Generate
            </>
          )}
        </Button>
        <Button
          variant="secondary"
          onClick={() => postMessage({ type: 'aiGenerateFromCodebase', data: { autoStart } })}
          disabled={isGenerating}
          title="Scan this workspace's source code for API calls and generate a mock server covering them"
        >
          <FolderSearch size={16} />
          From Codebase
        </Button>
      </div>

      <label className="flex items-center gap-2 mt-2 text-xs text-surface-400 cursor-pointer select-none w-fit">
        <input
          type="checkbox"
          checked={autoStart}
          onChange={(e) => setAutoStart(e.target.checked)}
          disabled={isGenerating}
          className="accent-violet-500"
        />
        Start the server immediately
      </label>

      {/* Suggestion chips */}
      {aiGeneration.status === 'idle' && !description && (
        <div className="flex flex-wrap gap-2 mt-3">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              onClick={() => handleGenerate(suggestion)}
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
      )}

      {/* Status */}
      <AnimatePresence>
        {isGenerating && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-3 space-y-2"
          >
            <div className="flex items-center gap-2 text-sm text-violet-700 dark:text-violet-300">
              <Loader2 size={14} className="animate-spin shrink-0" />
              <span className="flex-1 min-w-0 truncate">
                {aiGeneration.message ??
                  `${aiGeneration.provider ?? 'AI'} is designing your API — routes, realistic data, and error cases…`}
              </span>
              <button
                onClick={() => postMessage({ type: 'aiCancelGeneration' })}
                className="focus-ring shrink-0 px-2 py-0.5 rounded text-xs border border-surface-600 text-surface-300 hover:border-red-500/50 hover:text-red-600 dark:hover:text-red-300 transition-colors duration-150"
              >
                Cancel
              </button>
            </div>
            {typeof aiGeneration.fraction === 'number' && (
              <div className="h-1 rounded-full bg-surface-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-violet-500 transition-all duration-300"
                  style={{ width: `${Math.round(Math.min(1, aiGeneration.fraction) * 100)}%` }}
                />
              </div>
            )}
          </motion.div>
        )}

        {aiGeneration.status === 'done' && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-3 flex flex-wrap items-center gap-3 p-3 rounded-md bg-emerald-500/10 border border-emerald-500/25 text-sm text-emerald-700 dark:text-emerald-300"
          >
            <CheckCircle2 size={16} />
            <span>
              {aiGeneration.servers && aiGeneration.servers.length > 1 ? (
                <>
                  Created <strong>{aiGeneration.servers.length} mock servers</strong> — one per
                  API surface:
                  <span className="block mt-1">
                    {aiGeneration.servers.map((s) => (
                      <span key={s.serverId} className="block text-xs">
                        <strong>{s.serverName}</strong> · {s.routeCount} routes at{' '}
                        <span className="font-mono">localhost:{s.port}</span>
                      </span>
                    ))}
                  </span>
                </>
              ) : aiGeneration.serverName ? (
                <>
                  Created <strong>{aiGeneration.serverName}</strong> with{' '}
                  {aiGeneration.routeCount} routes
                  {aiGeneration.port ? (
                    <>
                      {' '}
                      at <span className="font-mono">localhost:{aiGeneration.port}</span>
                    </>
                  ) : null}
                </>
              ) : null}
              {aiGeneration.message ? (
                <span
                  className={
                    aiGeneration.serverName || (aiGeneration.servers?.length ?? 0) > 1
                      ? 'block text-xs text-emerald-700/80 dark:text-emerald-400/80 mt-1'
                      : 'block'
                  }
                >
                  {aiGeneration.message}
                </span>
              ) : null}
            </span>
            {aiGeneration.serverId ? (
              <Button variant="secondary" size="sm" onClick={handleViewServer}>
                View Routes
                <ArrowRight size={14} />
              </Button>
            ) : null}
            <button
              onClick={() => setAiGeneration({ status: 'idle' })}
              className="focus-ring ml-auto p-1 rounded hover:bg-surface-700/50 text-surface-400 transition-colors duration-150"
              title="Dismiss"
            >
              <X size={14} />
            </button>
          </motion.div>
        )}

        {aiGeneration.status === 'error' && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-3 flex items-start gap-2 p-3 rounded-md bg-red-500/10 border border-red-500/25 text-sm text-red-700 dark:text-red-300"
          >
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span className="flex-1">{aiGeneration.message}</span>
            <button
              onClick={() => setAiGeneration({ status: 'idle' })}
              className="focus-ring p-1 rounded hover:bg-surface-700/50 text-surface-400 transition-colors duration-150"
              title="Dismiss"
            >
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
