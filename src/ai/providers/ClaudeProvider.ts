import * as vscode from 'vscode';
import Anthropic from '@anthropic-ai/sdk';
import {
  AiProvider,
  AiRequestOptions,
  AiToolDefinition,
  AiToolExecutor,
  AiToolLoopOptions,
  AiUnavailableError,
  isSchemaRejection,
} from './types.js';
import {
  DEFAULT_MAX_TOOL_CALLS,
  TOOL_BUDGET_EXHAUSTED_NUDGE,
  TOOL_BUDGET_EXHAUSTED_RESULT,
  TOOL_TURN_TIMEOUT_MS,
  executeToolCall,
  toolDefsToClaudeFormat,
} from './toolLoop.js';
import { ApiKeyManager } from './ApiKeyManager.js';

const DEFAULT_MODEL = 'claude-opus-4-8';

/**
 * Anthropic Claude provider using the official @anthropic-ai/sdk with an
 * API key from SecretStorage. Model is configurable via mocklify.ai.claudeModel;
 * mocklify.ai.claudeBaseUrl points at Anthropic-compatible gateways (e.g. a
 * Bedrock-backed or LiteLLM proxy) instead of the official API.
 */
export class ClaudeProvider implements AiProvider {
  readonly id = 'claude' as const;
  readonly label = 'Claude (Anthropic API)';

  constructor(private keys: ApiKeyManager) {}

  async isAvailable(): Promise<boolean> {
    // A configured gateway endpoint counts as available: many corporate
    // gateways authenticate upstream and need no Anthropic key.
    return (await this.keys.hasKey('claude')) || this.baseUrl !== undefined;
  }

  /** Stored key, or a placeholder when a gateway endpoint handles auth. */
  private async resolveApiKey(): Promise<string | undefined> {
    const key = await this.keys.getKey('claude');
    if (key) {
      return key;
    }
    return this.baseUrl ? 'mocklify-gateway' : undefined;
  }

  private get model(): string {
    return vscode.workspace.getConfiguration('mocklify').get<string>('ai.claudeModel', DEFAULT_MODEL);
  }

  private get baseUrl(): string | undefined {
    const url = vscode.workspace
      .getConfiguration('mocklify')
      .get<string>('ai.claudeBaseUrl', '')
      .trim();
    return url ? url.replace(/\/+$/, '') : undefined;
  }

  async *streamRequest(
    prompt: string,
    options?: AiRequestOptions
  ): AsyncGenerator<string, void, undefined> {
    const apiKey = await this.resolveApiKey();
    if (!apiKey) {
      throw new AiUnavailableError(
        'No Anthropic API key configured. Run "Mocklify: Set AI Provider API Key" to add one, or set mocklify.ai.claudeBaseUrl to use a company gateway.',
        'claude'
      );
    }

    const client = new Anthropic({ apiKey, baseURL: this.baseUrl });

    let jsonSchema = options?.jsonSchema;
    let yieldedAny = false;
    for (;;) {
      // `thinking` is intentionally omitted so any configured Claude model works
      // with its own default (Opus 4.8: off, Sonnet 5: adaptive, Fable 5: always on).
      const stream = client.messages.stream({
        model: this.model,
        max_tokens: 32000,
        system: options?.systemPrompt,
        messages: [{ role: 'user', content: prompt }],
        ...(jsonSchema
          ? { output_config: { format: { type: 'json_schema' as const, schema: jsonSchema } } }
          : {}),
      });

      const cancellation = options?.token?.onCancellationRequested(() => stream.abort());

      try {
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            yieldedAny = true;
            yield event.delta.text;
          }
        }

        const message = await stream.finalMessage();
        if (message.stop_reason === 'refusal') {
          throw new Error('Claude declined this request (safety refusal). Try rephrasing.');
        }
        return;
      } catch (error) {
        if (options?.token?.isCancellationRequested) {
          return; // user cancelled — end quietly
        }
        // Gateways behind claudeBaseUrl may serve models that reject
        // output_config — retry once without structured output. Only safe
        // while nothing has been yielded; retrying after partial output would
        // duplicate text in the consumer's accumulated response.
        if (
          jsonSchema &&
          !yieldedAny &&
          error instanceof Anthropic.APIError &&
          isSchemaRejection(error.status, error.message, ['output_config', 'format', 'schema'])
        ) {
          jsonSchema = undefined;
          continue;
        }
        throw this.normalizeError(error);
      } finally {
        cancellation?.dispose();
      }
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
        'No Anthropic API key configured. Run "Mocklify: Set AI Provider API Key" to add one, or set mocklify.ai.claudeBaseUrl to use a company gateway.',
        'claude'
      );
    }

    const client = new Anthropic({ apiKey, baseURL: this.baseUrl });
    const claudeTools = toolDefsToClaudeFormat(tools) as Anthropic.Messages.Tool[];
    const messages: Anthropic.Messages.MessageParam[] = [{ role: 'user', content: prompt }];
    const maxToolCalls = options?.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;

    let used = 0;
    let totalChars = 0;
    let lastText = '';
    let finalTurn = false;

    for (;;) {
      if (options?.token?.isCancellationRequested) {
        return lastText;
      }

      // Streaming turns: tool_use streams fine, large submit_routes outputs
      // are not killed by a whole-turn deadline (the watchdog only fires on
      // TOOL_TURN_TIMEOUT_MS of *inactivity*), and onData gives liveness
      // while the model generates.
      const stream = client.messages.stream({
        model: this.model,
        max_tokens: 32000,
        system: options?.systemPrompt,
        messages,
        tools: claudeTools,
        ...(finalTurn ? { tool_choice: { type: 'none' as const } } : {}),
      });

      let timedOut = false;
      let watchdog = setTimeout(() => {
        timedOut = true;
        stream.abort();
      }, TOOL_TURN_TIMEOUT_MS);
      const bumpWatchdog = () => {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => {
          timedOut = true;
          stream.abort();
        }, TOOL_TURN_TIMEOUT_MS);
      };
      const cancellation = options?.token?.onCancellationRequested(() => stream.abort());

      let response: Anthropic.Messages.Message;
      try {
        for await (const event of stream) {
          bumpWatchdog();
          if (event.type === 'content_block_delta') {
            // Both text and tool-input JSON count as liveness.
            if (event.delta.type === 'text_delta') {
              totalChars += event.delta.text.length;
              options?.onData?.(totalChars);
            } else if (event.delta.type === 'input_json_delta') {
              totalChars += event.delta.partial_json.length;
              options?.onData?.(totalChars);
            }
          }
        }
        response = await stream.finalMessage();
      } catch (error) {
        if (options?.token?.isCancellationRequested) {
          return lastText;
        }
        if (timedOut) {
          throw new Error(
            `${this.label} stopped responding (no data for ${Math.round(TOOL_TURN_TIMEOUT_MS / 1000)}s). Try again or switch providers.`
          );
        }
        throw this.normalizeError(error);
      } finally {
        clearTimeout(watchdog);
        cancellation?.dispose();
      }

      if (response.stop_reason === 'refusal') {
        throw new Error('Claude declined this request (safety refusal). Try rephrasing.');
      }

      const text = response.content
        .filter((block): block is Anthropic.Messages.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');
      if (text) {
        lastText = text; // totalChars already counted while streaming
      }

      const toolUses = response.content.filter(
        (block): block is Anthropic.Messages.ToolUseBlock => block.type === 'tool_use'
      );
      if (finalTurn || response.stop_reason !== 'tool_use' || toolUses.length === 0) {
        return lastText;
      }

      messages.push({ role: 'assistant', content: response.content });

      const userContent: Anthropic.Messages.ContentBlockParam[] = [];
      for (const block of toolUses) {
        if (used >= maxToolCalls) {
          userContent.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: TOOL_BUDGET_EXHAUSTED_RESULT,
            is_error: true,
          });
          continue;
        }
        const call = { name: block.name, input: block.input };
        options?.onToolCall?.(call, used);
        used++;
        const outcome = await executeToolCall(execute, call);
        userContent.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: outcome.text,
          is_error: outcome.isError,
        });
      }

      if (used >= maxToolCalls) {
        finalTurn = true;
        userContent.push({ type: 'text', text: TOOL_BUDGET_EXHAUSTED_NUDGE });
      }
      messages.push({ role: 'user', content: userContent });
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
      return new Error(
        this.baseUrl
          ? `Could not reach the Claude endpoint at ${this.baseUrl}. Check the mocklify.ai.claudeBaseUrl setting and your network.`
          : 'Could not reach the Anthropic API. Check your network connection.'
      );
    }
    if (error instanceof Anthropic.APIError) {
      return new Error(`Anthropic API error (${error.status}): ${error.message}`);
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}
