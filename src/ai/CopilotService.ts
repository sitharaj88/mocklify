import * as vscode from 'vscode';
import { extractJson } from './extractJson.js';
import { AiUnavailableError } from './providers/types.js';

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
