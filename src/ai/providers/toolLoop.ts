import type { AiToolCall, AiToolDefinition, AiToolExecutor } from './types.js';

/** Default cap on tool executions across one agentic loop. */
export const DEFAULT_MAX_TOOL_CALLS = 30;

/** Per-turn request timeout for tool-loop turns. */
export const TOOL_TURN_TIMEOUT_MS = 120_000;

/** Final-turn nudge sent once the tool budget is spent. */
export const TOOL_BUDGET_EXHAUSTED_NUDGE =
  'Tool budget exhausted — produce your final answer now from what you have.';

/** Error result returned for tool calls requested after the budget is spent. */
export const TOOL_BUDGET_EXHAUSTED_RESULT =
  'Tool budget exhausted — this call was not executed. Produce your final answer from what you have.';

export interface ToolCallOutcome {
  text: string;
  isError: boolean;
}

/** Run one tool call; an executor throw becomes an error outcome, not a crash. */
export async function executeToolCall(
  execute: AiToolExecutor,
  call: AiToolCall
): Promise<ToolCallOutcome> {
  try {
    return { text: await execute(call), isError: false };
  } catch (error) {
    return { text: error instanceof Error ? error.message : String(error), isError: true };
  }
}

// ---------------------------------------------------------------------------
// Claude (Anthropic Messages API)
// ---------------------------------------------------------------------------

export interface ClaudeToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export function toolDefsToClaudeFormat(tools: AiToolDefinition[]): ClaudeToolDefinition[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));
}

// ---------------------------------------------------------------------------
// OpenAI (Chat Completions API)
// ---------------------------------------------------------------------------

export function toolDefsToOpenAiFormat(tools: AiToolDefinition[]): Record<string, unknown>[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
}

export interface ParsedOpenAiToolCall {
  id: string;
  name: string;
  input: unknown;
  /** Set when the arguments string was not valid JSON. */
  parseError?: string;
}

interface RawOpenAiToolCall {
  id?: string;
  function?: { name?: string; arguments?: string };
}

/**
 * Parse the `message.tool_calls` array of a chat-completions response.
 * Malformed argument JSON yields a call with `parseError` set so it can be
 * answered with an error tool result instead of crashing the loop.
 */
export function parseOpenAiToolCalls(rawCalls: unknown): ParsedOpenAiToolCall[] {
  if (!Array.isArray(rawCalls)) {
    return [];
  }
  return rawCalls.map((raw, index) => {
    const call = (raw ?? {}) as RawOpenAiToolCall;
    const id = call.id ?? `call_${index}`;
    const name = call.function?.name ?? '';
    const args = call.function?.arguments ?? '';
    if (!args.trim()) {
      return { id, name, input: {} };
    }
    try {
      return { id, name, input: JSON.parse(args) as unknown };
    } catch {
      return {
        id,
        name,
        input: undefined,
        parseError: `Tool arguments were not valid JSON: ${args.slice(0, 200)}`,
      };
    }
  });
}

// ---------------------------------------------------------------------------
// Gemini (Generative Language API)
// ---------------------------------------------------------------------------

/** Keys accepted by Gemini's OpenAPI-subset Schema proto. */
const GEMINI_SCHEMA_KEYS = new Set([
  'type',
  'format',
  'title',
  'description',
  'nullable',
  'enum',
  'items',
  'properties',
  'required',
  'default',
  'example',
  'minimum',
  'maximum',
  'minItems',
  'maxItems',
  'minLength',
  'maxLength',
  'minProperties',
  'maxProperties',
  'pattern',
]);

/**
 * Rewrite a JSON Schema into Gemini's restrictive dialect: the
 * functionDeclarations `parameters` proto rejects the whole request with 400
 * INVALID_ARGUMENT on unknown fields (notably `additionalProperties`) and on
 * type-less subschemas. Unknown keys are dropped, `anyOf` is flattened to its
 * first variant (older gateways lack it), and empty "any JSON" subschemas
 * become a permissive object.
 */
export function sanitizeGeminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const anyOf = schema.anyOf;
  if (Array.isArray(anyOf) && anyOf.length > 0 && typeof anyOf[0] === 'object' && anyOf[0]) {
    const first = sanitizeGeminiSchema(anyOf[0] as Record<string, unknown>);
    if (typeof schema.description === 'string' && first.description === undefined) {
      first.description = schema.description;
    }
    return first;
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (!GEMINI_SCHEMA_KEYS.has(key) || value === undefined) {
      continue;
    }
    if (key === 'properties' && value !== null && typeof value === 'object') {
      const props: Record<string, unknown> = {};
      for (const [name, sub] of Object.entries(value as Record<string, unknown>)) {
        props[name] =
          sub !== null && typeof sub === 'object'
            ? sanitizeGeminiSchema(sub as Record<string, unknown>)
            : { type: 'object' };
      }
      out.properties = props;
    } else if (key === 'items') {
      out.items =
        value !== null && typeof value === 'object'
          ? sanitizeGeminiSchema(value as Record<string, unknown>)
          : { type: 'object' };
    } else {
      out[key] = value;
    }
  }
  if (out.type === undefined) {
    // A type-less schema means "any JSON" — objects are the closest steer.
    out.type = 'object';
  }
  return out;
}

export function toolDefsToGeminiFormat(tools: AiToolDefinition[]): Record<string, unknown>[] {
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: sanitizeGeminiSchema(tool.inputSchema),
      })),
    },
  ];
}

export interface GeminiFunctionCall {
  name: string;
  args: unknown;
}

/** Extract `functionCall` parts from a Gemini candidate's content parts. */
export function extractGeminiFunctionCalls(parts: unknown): GeminiFunctionCall[] {
  if (!Array.isArray(parts)) {
    return [];
  }
  const calls: GeminiFunctionCall[] = [];
  for (const part of parts) {
    const fc = (part as { functionCall?: { name?: unknown; args?: unknown } } | null)
      ?.functionCall;
    if (fc && typeof fc.name === 'string') {
      calls.push({ name: fc.name, args: fc.args ?? {} });
    }
  }
  return calls;
}

/** Concatenate the text parts of a Gemini candidate's content parts. */
export function extractGeminiText(parts: unknown): string {
  if (!Array.isArray(parts)) {
    return '';
  }
  let text = '';
  for (const part of parts) {
    const value = (part as { text?: unknown } | null)?.text;
    if (typeof value === 'string') {
      text += value;
    }
  }
  return text;
}

/** Build the `functionResponse` part answering one Gemini function call. */
export function geminiFunctionResponsePart(
  name: string,
  outcome: ToolCallOutcome
): Record<string, unknown> {
  return {
    functionResponse: {
      name,
      response: outcome.isError ? { error: outcome.text } : { output: outcome.text },
    },
  };
}
