import * as vscode from 'vscode';
import {
  AiProvider,
  AiRequestOptions,
  AiToolDefinition,
  AiToolExecutor,
  AiToolLoopOptions,
  AiUnavailableError,
  isSchemaRejection,
  readSseJson,
} from './types.js';
import {
  DEFAULT_MAX_TOOL_CALLS,
  TOOL_BUDGET_EXHAUSTED_NUDGE,
  TOOL_BUDGET_EXHAUSTED_RESULT,
  TOOL_TURN_TIMEOUT_MS,
  executeToolCall,
  extractGeminiFunctionCalls,
  extractGeminiText,
  geminiFunctionResponsePart,
  toolDefsToGeminiFormat,
} from './toolLoop.js';
import { ApiKeyManager } from './ApiKeyManager.js';

const DEFAULT_MODEL = 'gemini-2.5-flash';
const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

interface GeminiChunk {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

/**
 * Google Gemini provider using the Generative Language API with an API key
 * from SecretStorage. Model is configurable via mocklify.ai.geminiModel;
 * mocklify.ai.geminiBaseUrl points at Gemini-compatible gateways/proxies.
 */
export class GeminiProvider implements AiProvider {
  readonly id = 'gemini' as const;
  readonly label = 'Google Gemini (API)';

  constructor(private keys: ApiKeyManager) {}

  async isAvailable(): Promise<boolean> {
    // A configured gateway endpoint counts as available: many corporate
    // gateways authenticate upstream and need no Gemini key.
    return (await this.keys.hasKey('gemini')) || this.baseUrl !== DEFAULT_BASE_URL;
  }

  /** Stored key, or a placeholder when a gateway endpoint handles auth. */
  private async resolveApiKey(): Promise<string | undefined> {
    const key = await this.keys.getKey('gemini');
    if (key) {
      return key;
    }
    return this.baseUrl !== DEFAULT_BASE_URL ? 'mocklify-gateway' : undefined;
  }

  private get model(): string {
    return vscode.workspace.getConfiguration('mocklify').get<string>('ai.geminiModel', DEFAULT_MODEL);
  }

  private get baseUrl(): string {
    const url = vscode.workspace
      .getConfiguration('mocklify')
      .get<string>('ai.geminiBaseUrl', '')
      .trim();
    return (url || DEFAULT_BASE_URL).replace(/\/+$/, '');
  }

  async *streamRequest(
    prompt: string,
    options?: AiRequestOptions
  ): AsyncGenerator<string, void, undefined> {
    const apiKey = await this.resolveApiKey();
    if (!apiKey) {
      throw new AiUnavailableError(
        'No Google Gemini API key configured. Run "Mocklify: Set AI Provider API Key" to add one, or set mocklify.ai.geminiBaseUrl to use a company gateway.',
        'gemini'
      );
    }

    const controller = new AbortController();
    options?.token?.onCancellationRequested(() => controller.abort());

    const url = `${this.baseUrl}/models/${encodeURIComponent(this.model)}:streamGenerateContent?alt=sse`;

    // Gemini's responseSchema dialect is restrictive, so only the mime type is
    // enforced natively; gateways that reject even that get one plain retry.
    const configs: (Record<string, unknown> | undefined)[] = options?.jsonSchema
      ? [{ responseMimeType: 'application/json' }, undefined]
      : [undefined];

    let response: Response | undefined;
    for (let attempt = 0; attempt < configs.length; attempt++) {
      const generationConfig = configs[attempt];
      const body: Record<string, unknown> = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      };
      if (options?.systemPrompt) {
        body.systemInstruction = { parts: [{ text: options.systemPrompt }] };
      }
      if (generationConfig) {
        body.generationConfig = generationConfig;
      }

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
        throw new Error(
          this.baseUrl === DEFAULT_BASE_URL
            ? 'Could not reach the Google Gemini API. Check your network connection.'
            : `Could not reach the Gemini-compatible endpoint at ${this.baseUrl}. Check the mocklify.ai.geminiBaseUrl setting and your network.`
        );
      }

      if (response.ok) {
        break;
      }
      const error = await this.toError(response);
      if (
        attempt < configs.length - 1 &&
        isSchemaRejection(response.status, error.message, [
          'generationConfig',
          'generation_config',
          'mimeType',
          'mime_type',
        ])
      ) {
        continue;
      }
      throw error;
    }

    if (!response?.body) {
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

  async runToolLoop(
    prompt: string,
    tools: AiToolDefinition[],
    execute: AiToolExecutor,
    options?: AiToolLoopOptions
  ): Promise<string> {
    const apiKey = await this.resolveApiKey();
    if (!apiKey) {
      throw new AiUnavailableError(
        'No Google Gemini API key configured. Run "Mocklify: Set AI Provider API Key" to add one, or set mocklify.ai.geminiBaseUrl to use a company gateway.',
        'gemini'
      );
    }

    const url = `${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent`;
    const geminiTools = toolDefsToGeminiFormat(tools);
    const contents: Record<string, unknown>[] = [
      { role: 'user', parts: [{ text: prompt }] },
    ];
    const maxToolCalls = options?.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;

    let used = 0;
    let totalChars = 0;
    let lastText = '';
    let finalTurn = false;

    for (;;) {
      if (options?.token?.isCancellationRequested) {
        return lastText;
      }

      const body: Record<string, unknown> = { contents, tools: geminiTools };
      if (options?.systemPrompt) {
        body.systemInstruction = { parts: [{ text: options.systemPrompt }] };
      }
      if (finalTurn) {
        body.toolConfig = { functionCallingConfig: { mode: 'NONE' } };
      }

      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, TOOL_TURN_TIMEOUT_MS);
      const cancellation = options?.token?.onCancellationRequested(() => controller.abort());

      // The timer and cancellation subscription must stay live until the body
      // is fully read — a stalled body after 200 headers is as dead as a
      // stalled connect.
      let payload: { candidates?: { content?: { parts?: unknown[] } }[] };
      try {
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
        } catch {
          if (options?.token?.isCancellationRequested) {
            return lastText;
          }
          if (timedOut) {
            throw new Error(
              `${this.label} stopped responding (no reply within ${Math.round(TOOL_TURN_TIMEOUT_MS / 1000)}s). Try again or switch providers.`
            );
          }
          throw new Error(
            this.baseUrl === DEFAULT_BASE_URL
              ? 'Could not reach the Google Gemini API. Check your network connection.'
              : `Could not reach the Gemini-compatible endpoint at ${this.baseUrl}. Check the mocklify.ai.geminiBaseUrl setting and your network.`
          );
        }

        if (!response.ok) {
          const error = await this.toError(response);
          if (options?.token?.isCancellationRequested) {
            return lastText;
          }
          throw error;
        }

        try {
          payload = (await response.json()) as typeof payload;
        } catch {
          if (options?.token?.isCancellationRequested) {
            return lastText;
          }
          if (timedOut) {
            throw new Error(
              `${this.label} stopped responding (no reply within ${Math.round(TOOL_TURN_TIMEOUT_MS / 1000)}s). Try again or switch providers.`
            );
          }
          throw new Error('The Gemini API returned an unreadable response.');
        }
      } finally {
        clearTimeout(timer);
        cancellation?.dispose();
      }
      const parts = payload.candidates?.[0]?.content?.parts ?? [];

      const text = extractGeminiText(parts);
      if (text) {
        lastText = text;
        totalChars += text.length;
        options?.onData?.(totalChars);
      }

      const calls = extractGeminiFunctionCalls(parts);
      if (finalTurn || calls.length === 0) {
        return lastText;
      }

      contents.push({ role: 'model', parts });

      const responseParts: Record<string, unknown>[] = [];
      for (const fc of calls) {
        if (used >= maxToolCalls) {
          responseParts.push(
            geminiFunctionResponsePart(fc.name, {
              text: TOOL_BUDGET_EXHAUSTED_RESULT,
              isError: true,
            })
          );
          continue;
        }
        const call = { name: fc.name, input: fc.args };
        options?.onToolCall?.(call, used);
        used++;
        const outcome = await executeToolCall(execute, call);
        responseParts.push(geminiFunctionResponsePart(fc.name, outcome));
      }

      if (used >= maxToolCalls) {
        finalTurn = true;
        responseParts.push({ text: TOOL_BUDGET_EXHAUSTED_NUDGE });
      }
      contents.push({ role: 'user', parts: responseParts });
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
