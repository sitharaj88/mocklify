import type * as vscode from 'vscode';

export type AiProviderId = 'copilot' | 'claude' | 'openai' | 'gemini';

export interface AiRequestOptions {
  /** System-style instructions. */
  systemPrompt?: string;
  /** Shown to the user when a provider needs consent (Copilot). */
  justification?: string;
  /**
   * A JSON Schema the response must satisfy. Providers that can enforce it
   * natively do so; others ignore it (prompt-based JSON instructions still
   * apply upstream).
   */
  jsonSchema?: Record<string, unknown>;
  /**
   * Called as response text streams in, with the total characters received
   * so far. Lets long-running callers show liveness in progress UI.
   */
  onData?: (totalChars: number) => void;
  token?: vscode.CancellationToken;
}

/** A client-executed tool the model may call during an agentic loop. */
export interface AiToolDefinition {
  name: string;
  description: string;
  /** JSON Schema (object root) describing the tool input. */
  inputSchema: Record<string, unknown>;
}

/** One tool invocation requested by the model. */
export interface AiToolCall {
  name: string;
  input: unknown;
}

/**
 * Executes a tool call and returns the result text. Throwing sends the error
 * message back to the model as a tool result marked as an error.
 */
export type AiToolExecutor = (call: AiToolCall) => Promise<string>;

export interface AiToolLoopOptions extends AiRequestOptions {
  /** Maximum tool executions across the whole loop (default 30). */
  maxToolCalls?: number;
  /** Called before each tool executes, with the running 0-based call index. */
  onToolCall?: (call: AiToolCall, index: number) => void;
}

/**
 * A text-generation backend. Implementations: GitHub Copilot (vscode.lm),
 * Anthropic Claude, OpenAI, and Google Gemini.
 */
export interface AiProvider {
  readonly id: AiProviderId;
  readonly label: string;
  /** Whether this provider can serve requests right now (installed / key configured). */
  isAvailable(): Promise<boolean>;
  /** Stream response text fragments for a prompt. */
  streamRequest(prompt: string, options?: AiRequestOptions): AsyncGenerator<string, void, undefined>;
  /**
   * Run a bounded agentic loop in which the model may call client-executed
   * tools; resolves with the final assistant text. Optional — callers must
   * fall back when the resolved provider does not implement it.
   */
  runToolLoop?(
    prompt: string,
    tools: AiToolDefinition[],
    execute: AiToolExecutor,
    options?: AiToolLoopOptions
  ): Promise<string>;
}

/**
 * Thrown when the resolved provider (or its selected model) cannot run
 * agentic tool loops — callers fall back to the fast scan.
 */
export class AgenticScanUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgenticScanUnavailableError';
  }
}

/**
 * Thrown when no AI provider can serve a request. The message is
 * user-facing and explains how to fix the situation.
 */
export class AiUnavailableError extends Error {
  constructor(
    message: string,
    /** Provider the error relates to, when specific. */
    readonly providerId?: AiProviderId
  ) {
    super(message);
    this.name = 'AiUnavailableError';
  }
}

/**
 * Whether an HTTP 400 rejection points at a structured-output field. Gateways
 * and models that don't support native JSON schemas reject the whole request,
 * so providers retry once without the structured-output config.
 */
export function isSchemaRejection(
  status: number | undefined,
  message: string | undefined,
  fields: readonly string[]
): boolean {
  if (status !== 400 || !message) {
    return false;
  }
  const lower = message.toLowerCase();
  return fields.some((field) => lower.includes(field.toLowerCase()));
}

/** Read a fetch/SSE stream of `data: {...}` lines, yielding each JSON payload. */
export async function* readSseJson(
  body: ReadableStream<Uint8Array>,
  token?: vscode.CancellationToken
): AsyncGenerator<unknown, void, undefined> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      if (token?.isCancellationRequested) {
        return;
      }
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line.startsWith('data:')) {
          continue;
        }
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') {
          continue;
        }
        try {
          yield JSON.parse(payload);
        } catch {
          // Ignore malformed keep-alive chunks
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
