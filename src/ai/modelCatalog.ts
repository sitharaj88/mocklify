import type { AiProviderId } from './providers/types.js';

export type ModelProviderId = Exclude<AiProviderId, 'copilot'>;

export interface ModelCatalogEntry {
  label: string;
  settingKey: string;
  customHint: string;
  models: { id: string; detail: string }[];
}

/**
 * Known models per provider, shown by "Mocklify: Select AI Model" and the
 * dashboard model dropdown. The list is a convenience, not a gate — custom
 * IDs cover gateway-specific names (e.g. Bedrock-style
 * `anthropic.claude-opus-4-8`) and models released later.
 */
export const MODEL_CATALOG: Record<ModelProviderId, ModelCatalogEntry> = {
  claude: {
    label: 'Claude (Anthropic)',
    settingKey: 'ai.claudeModel',
    customHint: 'e.g. anthropic.claude-opus-4-8 for a Bedrock-compatible gateway',
    models: [
      { id: 'claude-opus-4-8', detail: 'Most capable Opus — recommended default' },
      { id: 'claude-sonnet-5', detail: 'Best balance of speed and intelligence' },
      { id: 'claude-sonnet-4-6', detail: 'Previous-generation Sonnet' },
      { id: 'claude-haiku-4-5', detail: 'Fastest and most cost-effective' },
      { id: 'claude-opus-4-7', detail: 'Previous-generation Opus' },
      { id: 'claude-opus-4-6', detail: 'Older Opus' },
    ],
  },
  openai: {
    label: 'OpenAI',
    settingKey: 'ai.openaiModel',
    customHint: 'e.g. a deployment name on an Azure OpenAI-compatible gateway',
    models: [
      { id: 'gpt-4o', detail: 'Flagship multimodal model' },
      { id: 'gpt-4o-mini', detail: 'Fast and cost-effective' },
      { id: 'gpt-4.1', detail: 'Strong coding and instruction following' },
      { id: 'gpt-4.1-mini', detail: 'Smaller, faster 4.1' },
    ],
  },
  gemini: {
    label: 'Google Gemini',
    settingKey: 'ai.geminiModel',
    customHint: 'e.g. a model ID exposed by your Gemini-compatible gateway',
    models: [
      { id: 'gemini-2.5-flash', detail: 'Fast, cost-effective default' },
      { id: 'gemini-2.5-pro', detail: 'Most capable Gemini' },
      { id: 'gemini-2.0-flash', detail: 'Previous-generation Flash' },
    ],
  },
};
