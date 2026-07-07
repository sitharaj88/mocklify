import * as vscode from 'vscode';
import { extractJson } from './extractJson.js';
import {
  AgenticScanUnavailableError,
  AiToolDefinition,
  AiToolExecutor,
  AiToolLoopOptions,
  AiUnavailableError,
} from './providers/types.js';
import {
  DEFAULT_MAX_TOOL_CALLS,
  TOOL_BUDGET_EXHAUSTED_NUDGE,
  TOOL_BUDGET_EXHAUSTED_RESULT,
  TOOL_TURN_TIMEOUT_MS,
  executeToolCall,
} from './providers/toolLoop.js';

/**
 * Preferred Copilot model families, best first. Falls back to any available
 * chat model when none of these match.
 */
const PREFERRED_FAMILIES = ['claude-sonnet-4.5', 'gpt-4o', 'claude-3.5-sonnet', 'gpt-4o-mini'];

export interface CopilotRequestOptions {
  /** System-style instructions prepended as a User message (LM API has no system role for extensions). */
  systemPrompt?: string;
  justification?: string;
  token?: vscode.CancellationToken;
}

export class CopilotUnavailableError extends AiUnavailableError {
  constructor(message = 'GitHub Copilot language models are not available. Install and sign in to GitHub Copilot to use AI features.') {
    super(message, 'copilot');
    this.name = 'CopilotUnavailableError';
  }
}

/**
 * Thin wrapper around the VS Code Language Model API (vscode.lm) that talks to
 * GitHub Copilot. All Mocklify AI features go through this service so model
 * selection, consent, quota, and error handling live in one place.
 */
export class CopilotService {
  /**
   * Whether any Copilot chat model is currently available.
   */
  async isAvailable(): Promise<boolean> {
    try {
      const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
      return models.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Select the best available Copilot chat model.
   */
  async selectModel(): Promise<vscode.LanguageModelChat> {
    let models: vscode.LanguageModelChat[] = [];
    try {
      models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    } catch {
      // selectChatModels can throw when no LM extension is installed
    }

    if (models.length === 0) {
      throw new CopilotUnavailableError();
    }

    for (const family of PREFERRED_FAMILIES) {
      const match = models.find((m) => m.family.toLowerCase().includes(family));
      if (match) {
        return match;
      }
    }

    return models[0];
  }

  /**
   * Send a prompt and collect the complete response text.
   */
  async sendRequest(prompt: string, options?: CopilotRequestOptions): Promise<string> {
    let result = '';
    for await (const fragment of this.streamRequest(prompt, options)) {
      result += fragment;
    }
    return result;
  }

  /**
   * Send a prompt and stream response fragments as they arrive.
   */
  async *streamRequest(
    prompt: string,
    options?: CopilotRequestOptions
  ): AsyncGenerator<string, void, undefined> {
    const model = await this.selectModel();

    const messages: vscode.LanguageModelChatMessage[] = [];
    if (options?.systemPrompt) {
      messages.push(vscode.LanguageModelChatMessage.User(options.systemPrompt));
    }
    messages.push(vscode.LanguageModelChatMessage.User(prompt));

    try {
      const response = await model.sendRequest(
        messages,
        { justification: options?.justification ?? 'Mocklify uses Copilot to generate mock APIs and documentation.' },
        options?.token ?? new vscode.CancellationTokenSource().token
      );

      for await (const fragment of response.text) {
        yield fragment;
      }
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  /**
   * Run a bounded agentic loop via the VS Code Language Model tool-calling
   * API (LanguageModelChatTool / LanguageModelToolCallPart /
   * LanguageModelToolResultPart); resolves with the final assistant text.
   */
  async runToolLoop(
    prompt: string,
    tools: AiToolDefinition[],
    execute: AiToolExecutor,
    options?: AiToolLoopOptions
  ): Promise<string> {
    const model = await this.selectModel();

    const lmTools: vscode.LanguageModelChatTool[] = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));

    const messages: vscode.LanguageModelChatMessage[] = [];
    if (options?.systemPrompt) {
      messages.push(vscode.LanguageModelChatMessage.User(options.systemPrompt));
    }
    messages.push(vscode.LanguageModelChatMessage.User(prompt));

    const maxToolCalls = options?.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
    let used = 0;
    let totalChars = 0;
    let lastText = '';
    let finalTurn = false;
    let firstTurn = true;

    for (;;) {
      if (options?.token?.isCancellationRequested) {
        return lastText;
      }

      const turnSource = new vscode.CancellationTokenSource();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        turnSource.cancel();
      }, TOOL_TURN_TIMEOUT_MS);
      const cancellation = options?.token?.onCancellationRequested(() => turnSource.cancel());

      let text = '';
      const toolCalls: vscode.LanguageModelToolCallPart[] = [];
      try {
        const response = await model.sendRequest(
          messages,
          {
            justification:
              options?.justification ??
              'Mocklify uses Copilot to generate mock APIs and documentation.',
            tools: lmTools,
          },
          turnSource.token
        );
        for await (const part of response.stream) {
          if (part instanceof vscode.LanguageModelTextPart) {
            text += part.value;
            totalChars += part.value.length;
            options?.onData?.(totalChars);
          } else if (part instanceof vscode.LanguageModelToolCallPart) {
            toolCalls.push(part);
          }
        }
      } catch (error) {
        if (options?.token?.isCancellationRequested) {
          return lastText;
        }
        if (timedOut) {
          throw new Error(
            `GitHub Copilot stopped responding (no reply within ${Math.round(TOOL_TURN_TIMEOUT_MS / 1000)}s). Check that Copilot is signed in and reachable, then try again.`
          );
        }
        // The stable LM API exposes no tool-support capability flag, so a
        // generic LanguageModelError on the very first turn — tools sent,
        // none executed yet — is read as "this model cannot do tool calling"
        // and surfaced so callers can fall back to the fast scan.
        if (
          firstTurn &&
          error instanceof vscode.LanguageModelError &&
          error.code !== vscode.LanguageModelError.NoPermissions.name &&
          error.code !== vscode.LanguageModelError.Blocked.name &&
          error.code !== vscode.LanguageModelError.NotFound.name
        ) {
          throw new AgenticScanUnavailableError(
            `The selected GitHub Copilot model (${model.family}) rejected the tool-calling request (${error.message}). Use the fast scan instead, or switch providers with "Mocklify: Select AI Provider".`
          );
        }
        throw this.normalizeError(error);
      } finally {
        clearTimeout(timer);
        cancellation?.dispose();
        turnSource.dispose();
      }
      firstTurn = false;

      // A cancelled LM request may also end the stream quietly instead of
      // throwing — handle both outcomes here.
      if (options?.token?.isCancellationRequested) {
        return lastText;
      }
      if (timedOut) {
        throw new Error(
          `GitHub Copilot stopped responding (no reply within ${Math.round(TOOL_TURN_TIMEOUT_MS / 1000)}s). Check that Copilot is signed in and reachable, then try again.`
        );
      }

      if (text) {
        lastText = text;
      }
      if (finalTurn || toolCalls.length === 0) {
        return lastText;
      }

      const assistantParts: (vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart)[] =
        [];
      if (text) {
        assistantParts.push(new vscode.LanguageModelTextPart(text));
      }
      assistantParts.push(...toolCalls);
      messages.push(vscode.LanguageModelChatMessage.Assistant(assistantParts));

      const resultParts: vscode.LanguageModelToolResultPart[] = [];
      for (const callPart of toolCalls) {
        let resultText: string;
        if (used >= maxToolCalls) {
          resultText = `Error: ${TOOL_BUDGET_EXHAUSTED_RESULT}`;
        } else {
          const call = { name: callPart.name, input: callPart.input };
          options?.onToolCall?.(call, used);
          used++;
          const outcome = await executeToolCall(execute, call);
          resultText = outcome.isError ? `Error: ${outcome.text}` : outcome.text;
        }
        resultParts.push(
          new vscode.LanguageModelToolResultPart(callPart.callId, [
            new vscode.LanguageModelTextPart(resultText),
          ])
        );
      }
      messages.push(vscode.LanguageModelChatMessage.User(resultParts));

      if (used >= maxToolCalls) {
        finalTurn = true;
        messages.push(vscode.LanguageModelChatMessage.User(TOOL_BUDGET_EXHAUSTED_NUDGE));
      }
    }
  }

  /**
   * Send a prompt that must return JSON; extracts and parses the first JSON
   * value in the response (tolerates markdown code fences and prose).
   */
  async sendJsonRequest<T = unknown>(prompt: string, options?: CopilotRequestOptions): Promise<T> {
    const text = await this.sendRequest(prompt, options);
    return extractJson<T>(text);
  }

  private normalizeError(error: unknown): Error {
    if (error instanceof vscode.LanguageModelError) {
      switch (error.code) {
        case vscode.LanguageModelError.NoPermissions.name:
          return new Error(
            'Permission to use GitHub Copilot was not granted. Approve the consent dialog and try again.'
          );
        case vscode.LanguageModelError.Blocked.name:
          return new Error('The request was blocked by GitHub Copilot (quota or content filter).');
        case vscode.LanguageModelError.NotFound.name:
          return new CopilotUnavailableError();
        default:
          return new Error(`GitHub Copilot request failed: ${error.message}`);
      }
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}
