import { useEffect, useState } from 'react';
import {
  Sparkles,
  Check,
  KeyRound,
  Trash2,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Zap,
  Bot,
} from 'lucide-react';
import { useStore, postMessage } from '../store';
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Input,
  FormGroup,
  Label,
  FormHint,
} from './ui';
import { cn } from '../lib/utils';
import type { AiProviderInfo } from '../types';

const PROVIDER_HINTS: Record<string, string> = {
  claude: 'sk-ant-…  from console.anthropic.com',
  openai: 'sk-…  from platform.openai.com',
  gemini: 'AIza…  from aistudio.google.com',
};

function ProviderStatus({ info }: { info: AiProviderInfo }) {
  if (info.available) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
        <CheckCircle2 size={12} />
        {info.requiresKey ? 'Key configured' : 'Detected'}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-surface-500">
      <AlertCircle size={12} />
      {info.requiresKey ? 'No API key' : 'Not installed'}
    </span>
  );
}

/**
 * AI provider configuration: choose Copilot/Claude/OpenAI/Gemini (or Auto),
 * manage API keys (stored in VS Code secret storage), set models, and test.
 */
export function AiSettings() {
  const { aiConfig, aiTestResult, setAiTestResult } = useStore();
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [modelDrafts, setModelDrafts] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    postMessage({ type: 'getAiConfig' });
    setAiTestResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (aiTestResult) {
      setTesting(false);
    }
  }, [aiTestResult]);

  if (!aiConfig) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center gap-2 py-12 text-surface-400">
          <Loader2 size={16} className="animate-spin" />
          Loading AI configuration…
        </CardContent>
      </Card>
    );
  }

  const selectProvider = (provider: string) => {
    postMessage({ type: 'setAiProvider', data: { provider } });
    setAiTestResult(null);
  };

  const saveKey = (provider: string) => {
    const key = keyDrafts[provider]?.trim();
    if (!key) return;
    postMessage({ type: 'setAiApiKey', data: { provider, key } });
    setKeyDrafts((d) => ({ ...d, [provider]: '' }));
  };

  const saveModel = (provider: string, fallback?: string) => {
    const model = (modelDrafts[provider] ?? fallback ?? '').trim();
    if (!model || model === fallback) return;
    postMessage({ type: 'setAiModel', data: { provider, model } });
  };

  const runTest = () => {
    setTesting(true);
    setAiTestResult(null);
    postMessage({ type: 'testAiProvider' });
  };

  const providerCards = [
    {
      id: 'auto',
      label: 'Auto',
      detail: 'First available: Copilot → Claude → OpenAI → Gemini',
      icon: Zap,
    },
    ...aiConfig.providers.map((p) => ({
      id: p.id,
      label: p.label,
      detail: undefined as string | undefined,
      icon: Bot,
      info: p,
    })),
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles size={16} className="text-violet-400" />
          AI Provider
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Active provider summary */}
        <div className="flex flex-wrap items-center gap-2 text-sm text-surface-400">
          <span>
            Active:{' '}
            <span className="text-surface-100 font-medium">
              {aiConfig.activeLabel ?? 'None available'}
            </span>
          </span>
          <Button variant="secondary" size="sm" onClick={runTest} disabled={testing}>
            {testing ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
            {testing ? 'Testing…' : 'Test Provider'}
          </Button>
        </div>

        {aiTestResult && (
          <div
            className={cn(
              'flex items-start gap-2 p-3 rounded-lg border text-sm',
              aiTestResult.ok
                ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
                : 'bg-red-500/10 border-red-500/25 text-red-300'
            )}
          >
            {aiTestResult.ok ? (
              <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
            ) : (
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
            )}
            <span>{aiTestResult.message}</span>
          </div>
        )}

        {/* Provider selection */}
        <FormGroup>
          <Label>Provider</Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
            {providerCards.map((card) => {
              const isSelected = aiConfig.provider === card.id;
              const info = 'info' in card ? card.info : undefined;
              return (
                <button
                  key={card.id}
                  onClick={() => selectProvider(card.id)}
                  className={cn(
                    'relative flex flex-col items-start gap-1 p-4 rounded-xl border-2 text-left transition-all',
                    isSelected
                      ? 'border-violet-500 bg-violet-500/10'
                      : 'border-surface-700 hover:border-surface-600 hover:bg-surface-800/50'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <card.icon
                      size={16}
                      className={isSelected ? 'text-violet-400' : 'text-surface-400'}
                    />
                    <span
                      className={cn(
                        'text-sm font-medium',
                        isSelected ? 'text-violet-300' : 'text-surface-200'
                      )}
                    >
                      {card.label}
                    </span>
                  </div>
                  {card.detail && <span className="text-xs text-surface-500">{card.detail}</span>}
                  {info && <ProviderStatus info={info} />}
                  {isSelected && (
                    <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-violet-500 flex items-center justify-center">
                      <Check size={12} className="text-white" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          <FormHint>
            GitHub Copilot is detected automatically. Other providers need an API key, stored in VS
            Code&apos;s encrypted secret storage.
          </FormHint>
        </FormGroup>

        {/* Per-provider key + model configuration */}
        <div className="border-t border-surface-700 pt-6 space-y-6">
          <h4 className="text-sm font-medium text-surface-200">API Keys &amp; Models</h4>
          {aiConfig.providers
            .filter((p) => p.requiresKey)
            .map((p) => (
              <div key={p.id} className="p-4 rounded-lg bg-surface-800/50 border border-surface-700 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-surface-200">{p.label}</span>
                    <ProviderStatus info={p} />
                  </div>
                  {p.hasKey && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="hover:text-red-400"
                      onClick={() => postMessage({ type: 'clearAiApiKey', data: { provider: p.id } })}
                      title="Remove stored API key"
                    >
                      <Trash2 size={14} />
                      Remove key
                    </Button>
                  )}
                </div>

                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <KeyRound
                      size={14}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500"
                    />
                    <Input
                      type="password"
                      className="pl-9"
                      placeholder={p.hasKey ? '••••••••  (key stored — enter to replace)' : PROVIDER_HINTS[p.id]}
                      value={keyDrafts[p.id] ?? ''}
                      onChange={(e) => setKeyDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                      onKeyDown={(e) => e.key === 'Enter' && saveKey(p.id)}
                    />
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => saveKey(p.id)}
                    disabled={!keyDrafts[p.id]?.trim()}
                  >
                    Save Key
                  </Button>
                </div>

                <FormGroup>
                  <Label className="text-xs">Model</Label>
                  <Input
                    className="w-full sm:w-72"
                    value={modelDrafts[p.id] ?? p.model ?? ''}
                    onChange={(e) => setModelDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                    onBlur={() => saveModel(p.id, p.model)}
                    onKeyDown={(e) => e.key === 'Enter' && saveModel(p.id, p.model)}
                  />
                </FormGroup>
              </div>
            ))}
        </div>
      </CardContent>
    </Card>
  );
}
