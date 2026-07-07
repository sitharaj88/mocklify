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
  parseOpenAiToolCalls,
  toolDefsToOpenAiFormat,
} from './toolLoop.js';
import { ApiKeyManager } from './ApiKeyManager.js';

const DEFAULT_MODEL = 'gpt-4o';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

interface ChatCompletionChunk {
  choices?: { delta?: { content?: string } }[];
}

/**
 * OpenAI provider using the Chat Completions API with an API key from
 * SecretStorage. Model is configurable via mocklify.ai.openaiModel;
 * mocklify.ai.openaiBaseUrl points at OpenAI-compatible gateways/proxies.
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

  private get baseUrl(): string {
    const url = vscode.workspace
      .getConfiguration('mocklify')
      .get<string>('ai.openaiBaseUrl', '')
      .trim();
    return (url || DEFAULT_BASE_URL).replace(/\/+$/, '');
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

    // Structured-output candidates, strictest first; gateways that reject one
    // with a 400 get the next weaker variant. strict mode is off because our
    // schemas keep optional properties out of `required`, which strict:true
    // rejects; json_schema without strict still steers output to the schema.
    // Both remaining modes emit an object root — callers unwrap {"routes": [...]}.
    const formats: (Record<string, unknown> | undefined)[] = options?.jsonSchema
      ? [
          {
            type: 'json_schema',
            json_schema: { name: 'mocklify_response', strict: false, schema: options.jsonSchema },
          },
          { type: 'json_object' },
          undefined,
        ]
      : [undefined];

    let response: Response | undefined;
    for (let attempt = 0; attempt < formats.length; attempt++) {
      const responseFormat = formats[attempt];
      try {
        response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: this.model,
            messages,
            stream: true,
            ...(responseFormat ? { response_format: responseFormat } : {}),
          }),
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        throw new Error(
          this.baseUrl === DEFAULT_BASE_URL
            ? 'Could not reach the OpenAI API. Check your network connection.'
            : `Could not reach the OpenAI-compatible endpoint at ${this.baseUrl}. Check the mocklify.ai.openaiBaseUrl setting and your network.`
        );
      }

      if (response.ok) {
        break;
      }
      const error = await this.toError(response);
      if (
        attempt < formats.length - 1 &&
        isSchemaRejection(response.status, error.message, [
          'response_format',
          'json_schema',
          'json_object',
        ])
      ) {
        continue;
      }
      throw error;
    }

    if (!response?.body) {
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

  async runToolLoop(
    prompt: string,
    tools: AiToolDefinition[],
    execute: AiToolExecutor,
    options?: AiToolLoopOptions
  ): Promise<string> {
    const apiKey = await this.keys.getKey('openai');
    if (!apiKey) {
      throw new AiUnavailableError(
        'No OpenAI API key configured. Run "Mocklify: Set AI Provider API Key" to add one.',
        'openai'
      );
    }

    const openAiTools = toolDefsToOpenAiFormat(tools);
    const messages: Record<string, unknown>[] = [];
    if (options?.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });
    const maxToolCalls = options?.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;

    let used = 0;
    let totalChars = 0;
    let lastText = '';
    let finalTurn = false;

    for (;;) {
      if (options?.token?.isCancellationRequested) {
        return lastText;
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
      let payload: {
        choices?: { message?: { content?: string | null; tool_calls?: unknown } }[];
      };
      try {
        let response: Response;
        try {
          response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: this.model,
              messages,
              tools: openAiTools,
              ...(finalTurn ? { tool_choice: 'none' } : {}),
            }),
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
              ? 'Could not reach the OpenAI API. Check your network connection.'
              : `Could not reach the OpenAI-compatible endpoint at ${this.baseUrl}. Check the mocklify.ai.openaiBaseUrl setting and your network.`
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
          throw new Error('The OpenAI API returned an unreadable response.');
        }
      } finally {
        clearTimeout(timer);
        cancellation?.dispose();
      }
      const message = payload.choices?.[0]?.message;
      const text = typeof message?.content === 'string' ? message.content : '';
      if (text) {
        lastText = text;
        totalChars += text.length;
        options?.onData?.(totalChars);
      }

      const calls = parseOpenAiToolCalls(message?.tool_calls);
      if (finalTurn || calls.length === 0) {
        return lastText;
      }

      // Echo the assistant turn (incl. raw tool_calls) so the tool messages
      // below pair with their calls.
      messages.push({
        role: 'assistant',
        content: message?.content ?? null,
        tool_calls: message?.tool_calls,
      });

      for (const call of calls) {
        let resultText: string;
        if (used >= maxToolCalls) {
          resultText = `Error: ${TOOL_BUDGET_EXHAUSTED_RESULT}`;
        } else if (call.parseError) {
          resultText = `Error: ${call.parseError}`;
        } else {
          const toolCall = { name: call.name, input: call.input };
          options?.onToolCall?.(toolCall, used);
          used++;
          const outcome = await executeToolCall(execute, toolCall);
          resultText = outcome.isError ? `Error: ${outcome.text}` : outcome.text;
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content: resultText });
      }

      if (used >= maxToolCalls) {
        finalTurn = true;
        messages.push({ role: 'system', content: TOOL_BUDGET_EXHAUSTED_NUDGE });
      }
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
