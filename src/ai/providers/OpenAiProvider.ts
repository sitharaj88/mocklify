import * as vscode from 'vscode';
import { AiProvider, AiRequestOptions, AiUnavailableError, readSseJson } from './types.js';
import { ApiKeyManager } from './ApiKeyManager.js';

const DEFAULT_MODEL = 'gpt-4o';

interface ChatCompletionChunk {
  choices?: { delta?: { content?: string } }[];
}

/**
 * OpenAI provider using the Chat Completions API with an API key from
 * SecretStorage. Model is configurable via mocklify.ai.openaiModel.
 */
export class OpenAiProvider implements AiProvider {
  readonly id = 'openai' as const;
  readonly label = 'OpenAI (API)';

  constructor(private keys: ApiKeyManager) {}

  async isAvailable(): Promise<boolean> {
    return this.keys.hasKey('openai');
  }

  private get model(): string {
    return vscode.workspace.getConfiguration('mocklify').get<string>('ai.openaiModel', DEFAULT_MODEL);
  }

  async *streamRequest(
    prompt: string,
    options?: AiRequestOptions
  ): AsyncGenerator<string, void, undefined> {
    const apiKey = await this.keys.getKey('openai');
    if (!apiKey) {
      throw new AiUnavailableError(
        'No OpenAI API key configured. Run "Mocklify: Set AI Provider API Key" to add one.',
        'openai'
      );
    }

    const controller = new AbortController();
    options?.token?.onCancellationRequested(() => controller.abort());

    const messages: { role: string; content: string }[] = [];
    if (options?.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    let response: Response;
    try {
      response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model: this.model, messages, stream: true }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      throw new Error('Could not reach the OpenAI API. Check your network connection.');
    }

    if (!response.ok) {
      throw await this.toError(response);
    }
    if (!response.body) {
      throw new Error('The OpenAI API returned an empty response.');
    }

    try {
      for await (const chunk of readSseJson(response.body, options?.token)) {
        const text = (chunk as ChatCompletionChunk).choices?.[0]?.delta?.content;
        if (text) {
          yield text;
        }
      }
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      throw error;
    }
  }

  private async toError(response: Response): Promise<Error> {
    let detail = '';
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      detail = body.error?.message ?? '';
    } catch {
      // Non-JSON error body
    }

    if (response.status === 401) {
      return new AiUnavailableError(
        'The OpenAI API key was rejected. Run "Mocklify: Set AI Provider API Key" to update it.',
        'openai'
      );
    }
    if (response.status === 404) {
      return new Error(
        `OpenAI model "${this.model}" was not found. Check the mocklify.ai.openaiModel setting.`
      );
    }
    if (response.status === 429) {
      return new Error('OpenAI API rate limit reached. Wait a moment and try again.');
    }
    return new Error(`OpenAI API error (${response.status})${detail ? `: ${detail}` : ''}`);
  }
}
