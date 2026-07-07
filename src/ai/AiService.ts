import * as vscode from 'vscode';
import { CopilotService } from './CopilotService.js';
import { extractJson } from './extractJson.js';
import {
  AiProvider,
  AiProviderId,
  AiRequestOptions,
  AiUnavailableError,
} from './providers/types.js';
import { ApiKeyManager } from './providers/ApiKeyManager.js';
import { ClaudeProvider } from './providers/ClaudeProvider.js';
import { OpenAiProvider } from './providers/OpenAiProvider.js';
import { GeminiProvider } from './providers/GeminiProvider.js';

export type { AiRequestOptions } from './providers/types.js';

/** Auto-mode preference order. */
const AUTO_ORDER: AiProviderId[] = ['copilot', 'claude', 'openai', 'gemini'];

const NO_PROVIDER_MESSAGE =
  'No AI provider is available. Install GitHub Copilot, or add a Claude/OpenAI/Gemini API key with "Mocklify: Set AI Provider API Key".';

/**
 * Routes all Mocklify AI requests to the active provider: GitHub Copilot
 * (vscode.lm), Anthropic Claude, OpenAI, or Google Gemini. The provider is
 * chosen via the mocklify.ai.provider setting; "auto" picks the first
 * available one.
 */
export class AiService {
  private providers: Map<AiProviderId, AiProvider>;

  constructor(copilot: CopilotService, keys: ApiKeyManager) {
    const copilotProvider: AiProvider = {
      id: 'copilot',
      label: 'GitHub Copilot',
      isAvailable: () => copilot.isAvailable(),
      streamRequest: (prompt, options) => copilot.streamRequest(prompt, options),
    };

    this.providers = new Map<AiProviderId, AiProvider>([
      ['copilot', copilotProvider],
      ['claude', new ClaudeProvider(keys)],
      ['openai', new OpenAiProvider(keys)],
      ['gemini', new GeminiProvider(keys)],
    ]);
  }

  getProvider(id: AiProviderId): AiProvider {
    return this.providers.get(id)!;
  }

  getAllProviders(): AiProvider[] {
    return Array.from(this.providers.values());
  }

  /** The configured provider id, or 'auto'. */
  getConfiguredProviderId(): AiProviderId | 'auto' {
    return vscode.workspace
      .getConfiguration('mocklify')
      .get<AiProviderId | 'auto'>('ai.provider', 'auto');
  }

  /**
   * Resolve the provider that will serve the next request.
   * Throws AiUnavailableError with actionable guidance when none can.
   */
  async resolveProvider(): Promise<AiProvider> {
    const configured = this.getConfiguredProviderId();

    if (configured !== 'auto') {
      const provider = this.providers.get(configured);
      if (!provider) {
        throw new AiUnavailableError(`Unknown AI provider "${configured}".`);
      }
      if (!(await provider.isAvailable())) {
        throw new AiUnavailableError(
          configured === 'copilot'
            ? 'GitHub Copilot is selected as the AI provider but is not available. Install and sign in to GitHub Copilot, or switch providers with "Mocklify: Select AI Provider".'
            : `${provider.label} is selected as the AI provider but no API key is configured. Run "Mocklify: Set AI Provider API Key".`,
          configured
        );
      }
      return provider;
    }

    for (const id of AUTO_ORDER) {
      const provider = this.providers.get(id)!;
      if (await provider.isAvailable()) {
        return provider;
      }
    }

    throw new AiUnavailableError(NO_PROVIDER_MESSAGE);
  }

  /** Label of the provider that would serve the next request, if any. */
  async getActiveProviderLabel(): Promise<string | undefined> {
    try {
      return (await this.resolveProvider()).label;
    } catch {
      return undefined;
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.resolveProvider();
      return true;
    } catch {
      return false;
    }
  }

  async *streamRequest(
    prompt: string,
    options?: AiRequestOptions
  ): AsyncGenerator<string, void, undefined> {
    const provider = await this.resolveProvider();
    yield* provider.streamRequest(prompt, options);
  }

  async sendRequest(prompt: string, options?: AiRequestOptions): Promise<string> {
    let result = '';
    for await (const fragment of this.streamRequest(prompt, options)) {
      result += fragment;
    }
    return result;
  }

  /**
   * Send a prompt that must return JSON; extracts and parses the first JSON
   * value in the response (tolerates markdown code fences and prose).
   * Retries once with a corrective prompt when the response isn't valid JSON.
   *
   * When a JSON Schema is given (argument or options.jsonSchema), it is
   * forwarded so providers with native structured outputs enforce it; the
   * extract-and-retry path stays as the universal fallback (Copilot ignores
   * the schema entirely).
   */
  async sendJsonRequest<T = unknown>(
    prompt: string,
    options?: AiRequestOptions,
    schema?: Record<string, unknown>
  ): Promise<T> {
    const jsonSchema = schema ?? options?.jsonSchema;
    const requestOptions: AiRequestOptions | undefined = jsonSchema
      ? { ...options, jsonSchema }
      : options;

    const text = await this.sendRequest(prompt, requestOptions);
    try {
      return extractJson<T>(text);
    } catch (firstError) {
      if (options?.token?.isCancellationRequested) {
        throw firstError;
      }
      const reason = firstError instanceof Error ? firstError.message : 'invalid JSON';
      const retryText = await this.sendRequest(
        `${prompt}\n\nYour previous response could not be used (${reason}). Respond again with ONLY the valid JSON value — no prose, no markdown code fences, no trailing commentary.`,
        requestOptions
      );
      return extractJson<T>(retryText);
    }
  }
}
