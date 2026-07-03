import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Loader2, CheckCircle2, AlertCircle, ArrowRight, X } from 'lucide-react';
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
        'relative rounded-xl border p-4 sm:p-5 mb-6 overflow-hidden',
        'border-violet-500/30 bg-gradient-to-br from-violet-500/10 via-transparent to-blue-500/10'
      )}
    >
      <div className="flex items-center gap-2 mb-3">
        <div className="p-1.5 rounded-lg bg-violet-500/15">
          <Sparkles className="w-4 h-4 text-violet-400" />
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
            'flex-1 px-3 py-2 rounded-lg text-sm',
            'bg-surface-900/60 border border-surface-700 text-surface-100 placeholder:text-surface-500',
            'focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/50',
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
                'px-3 py-1 rounded-full text-xs transition-colors',
                'bg-surface-800/80 border border-surface-700 text-surface-300',
                'hover:border-violet-500/50 hover:text-violet-300'
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
            className="mt-3 flex items-center gap-2 text-sm text-violet-300"
          >
            <Loader2 size={14} className="animate-spin" />
            {aiGeneration.provider ?? 'AI'} is designing your API — routes, realistic data, and
            error cases…
          </motion.div>
        )}

        {aiGeneration.status === 'done' && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-3 flex flex-wrap items-center gap-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-sm text-emerald-300"
          >
            <CheckCircle2 size={16} />
            <span>
              Created <strong>{aiGeneration.serverName}</strong> with {aiGeneration.routeCount}{' '}
              routes
              {aiGeneration.port ? (
                <>
                  {' '}
                  at <span className="font-mono">localhost:{aiGeneration.port}</span>
                </>
              ) : null}
            </span>
            <Button variant="secondary" size="sm" onClick={handleViewServer}>
              View Routes
              <ArrowRight size={14} />
            </Button>
            <button
              onClick={() => setAiGeneration({ status: 'idle' })}
              className="ml-auto p-1 rounded hover:bg-surface-700/50 text-surface-400"
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
            className="mt-3 flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/25 text-sm text-red-300"
          >
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span className="flex-1">{aiGeneration.message}</span>
            <button
              onClick={() => setAiGeneration({ status: 'idle' })}
              className="p-1 rounded hover:bg-surface-700/50 text-surface-400"
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
