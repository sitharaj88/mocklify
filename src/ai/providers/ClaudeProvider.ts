import * as vscode from 'vscode';
import Anthropic from '@anthropic-ai/sdk';
import { AiProvider, AiRequestOptions, AiUnavailableError } from './types.js';
import { ApiKeyManager } from './ApiKeyManager.js';

const DEFAULT_MODEL = 'claude-opus-4-8';

/**
 * Anthropic Claude provider using the official @anthropic-ai/sdk with an
 * API key from SecretStorage. Model is configurable via mocklify.ai.claudeModel.
 */
export class ClaudeProvider implements AiProvider {
  readonly id = 'claude' as const;
  readonly label = 'Claude (Anthropic API)';

  constructor(private keys: ApiKeyManager) {}

  async isAvailable(): Promise<boolean> {
    return this.keys.hasKey('claude');
  }

  private get model(): string {
    return vscode.workspace.getConfiguration('mocklify').get<string>('ai.claudeModel', DEFAULT_MODEL);
  }

  async *streamRequest(
    prompt: string,
    options?: AiRequestOptions
  ): AsyncGenerator<string, void, undefined> {
    const apiKey = await this.keys.getKey('claude');
    if (!apiKey) {
      throw new AiUnavailableError(
        'No Anthropic API key configured. Run "Mocklify: Set AI Provider API Key" to add one.',
        'claude'
      );
    }

    const client = new Anthropic({ apiKey });

    // `thinking` is intentionally omitted so any configured Claude model works
    // with its own default (Opus 4.8: off, Sonnet 5: adaptive, Fable 5: always on).
    const stream = client.messages.stream({
      model: this.model,
      max_tokens: 32000,
      system: options?.systemPrompt,
      messages: [{ role: 'user', content: prompt }],
    });

    options?.token?.onCancellationRequested(() => stream.abort());

    try {
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield event.delta.text;
        }
      }

      const message = await stream.finalMessage();
      if (message.stop_reason === 'refusal') {
        throw new Error('Claude declined this request (safety refusal). Try rephrasing.');
      }
    } catch (error) {
      if (options?.token?.isCancellationRequested) {
        return; // user cancelled — end quietly
      }
      throw this.normalizeError(error);
    }
  }

  private normalizeError(error: unknown): Error {
    if (error instanceof Anthropic.AuthenticationError) {
      return new AiUnavailableError(
        'The Anthropic API key was rejected. Run "Mocklify: Set AI Provider API Key" to update it.',
        'claude'
      );
    }
    if (error instanceof Anthropic.NotFoundError) {
      return new Error(
        `Claude model "${this.model}" was not found. Check the mocklify.ai.claudeModel setting.`
      );
    }
    if (error instanceof Anthropic.RateLimitError) {
      return new Error('Anthropic API rate limit reached. Wait a moment and try again.');
    }
    if (error instanceof Anthropic.APIConnectionError) {
      return new Error('Could not reach the Anthropic API. Check your network connection.');
    }
    if (error instanceof Anthropic.APIError) {
      return new Error(`Anthropic API error (${error.status}): ${error.message}`);
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}
