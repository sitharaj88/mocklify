import * as vscode from 'vscode';
import { AiProvider, AiRequestOptions, AiUnavailableError, readSseJson } from './types.js';
import { ApiKeyManager } from './ApiKeyManager.js';

const DEFAULT_MODEL = 'gemini-2.5-flash';

interface GeminiChunk {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

/**
 * Google Gemini provider using the Generative Language API with an API key
 * from SecretStorage. Model is configurable via mocklify.ai.geminiModel.
 */
export class GeminiProvider implements AiProvider {
  readonly id = 'gemini' as const;
  readonly label = 'Google Gemini (API)';

  constructor(private keys: ApiKeyManager) {}

  async isAvailable(): Promise<boolean> {
    return this.keys.hasKey('gemini');
  }

  private get model(): string {
    return vscode.workspace.getConfiguration('mocklify').get<string>('ai.geminiModel', DEFAULT_MODEL);
  }

  async *streamRequest(
    prompt: string,
    options?: AiRequestOptions
  ): AsyncGenerator<string, void, undefined> {
    const apiKey = await this.keys.getKey('gemini');
    if (!apiKey) {
      throw new AiUnavailableError(
        'No Google Gemini API key configured. Run "Mocklify: Set AI Provider API Key" to add one.',
        'gemini'
      );
    }

    const controller = new AbortController();
    options?.token?.onCancellationRequested(() => controller.abort());

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:streamGenerateContent?alt=sse`;

    const body: Record<string, unknown> = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    };
    if (options?.systemPrompt) {
      body.systemInstruction = { parts: [{ text: options.systemPrompt }] };
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      throw new Error('Could not reach the Google Gemini API. Check your network connection.');
    }

    if (!response.ok) {
      throw await this.toError(response);
    }
    if (!response.body) {
      throw new Error('The Gemini API returned an empty response.');
    }

    try {
      for await (const chunk of readSseJson(response.body, options?.token)) {
        const parts = (chunk as GeminiChunk).candidates?.[0]?.content?.parts ?? [];
        for (const part of parts) {
          if (part.text) {
            yield part.text;
          }
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

    if (response.status === 400 && /API key/i.test(detail)) {
      return new AiUnavailableError(
        'The Google Gemini API key was rejected. Run "Mocklify: Set AI Provider API Key" to update it.',
        'gemini'
      );
    }
    if (response.status === 401 || response.status === 403) {
      return new AiUnavailableError(
        'The Google Gemini API key was rejected. Run "Mocklify: Set AI Provider API Key" to update it.',
        'gemini'
      );
    }
    if (response.status === 404) {
      return new Error(
        `Gemini model "${this.model}" was not found. Check the mocklify.ai.geminiModel setting.`
      );
    }
    if (response.status === 429) {
      return new Error('Gemini API rate limit reached. Wait a moment and try again.');
    }
    return new Error(`Gemini API error (${response.status})${detail ? `: ${detail}` : ''}`);
  }
}
