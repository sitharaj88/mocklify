import { describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_MAX_TOOL_CALLS,
  TOOL_BUDGET_EXHAUSTED_NUDGE,
  TOOL_BUDGET_EXHAUSTED_RESULT,
  TOOL_TURN_TIMEOUT_MS,
  executeToolCall,
  extractGeminiFunctionCalls,
  extractGeminiText,
  geminiFunctionResponsePart,
  parseOpenAiToolCalls,
  sanitizeGeminiSchema,
  toolDefsToClaudeFormat,
  toolDefsToGeminiFormat,
  toolDefsToOpenAiFormat,
} from '../src/ai/providers/toolLoop';
import { ROUTES_JSON_SCHEMA } from '../src/ai/MockGenerator';
import type { AiToolDefinition } from '../src/ai/providers/types';

const TOOLS: AiToolDefinition[] = [
  {
    name: 'read_file',
    description: 'Read a file from the workspace.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_dir',
    description: 'List a directory.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

describe('constants', () => {
  it('has the documented defaults', () => {
    expect(DEFAULT_MAX_TOOL_CALLS).toBe(30);
    expect(TOOL_TURN_TIMEOUT_MS).toBe(120_000);
    expect(TOOL_BUDGET_EXHAUSTED_NUDGE).toContain('Tool budget exhausted');
    expect(TOOL_BUDGET_EXHAUSTED_RESULT).toContain('Tool budget exhausted');
  });
});

describe('toolDefsToClaudeFormat', () => {
  it('maps name/description/inputSchema to snake_case input_schema', () => {
    expect(toolDefsToClaudeFormat(TOOLS)).toEqual([
      {
        name: 'read_file',
        description: 'Read a file from the workspace.',
        input_schema: TOOLS[0].inputSchema,
      },
      {
        name: 'list_dir',
        description: 'List a directory.',
        input_schema: TOOLS[1].inputSchema,
      },
    ]);
  });

  it('returns an empty array for no tools', () => {
    expect(toolDefsToClaudeFormat([])).toEqual([]);
  });
});

describe('toolDefsToOpenAiFormat', () => {
  it('wraps each tool as a function tool with parameters', () => {
    expect(toolDefsToOpenAiFormat(TOOLS)).toEqual([
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read a file from the workspace.',
          parameters: TOOLS[0].inputSchema,
        },
      },
      {
        type: 'function',
        function: {
          name: 'list_dir',
          description: 'List a directory.',
          parameters: TOOLS[1].inputSchema,
        },
      },
    ]);
  });
});

describe('toolDefsToGeminiFormat', () => {
  it('emits a single functionDeclarations group with sanitized schemas', () => {
    expect(toolDefsToGeminiFormat(TOOLS)).toEqual([
      {
        functionDeclarations: [
          {
            name: 'read_file',
            description: 'Read a file from the workspace.',
            parameters: {
              type: 'object',
              properties: { path: { type: 'string' } },
              required: ['path'],
            },
          },
          {
            name: 'list_dir',
            description: 'List a directory.',
            parameters: { type: 'object', properties: {} },
          },
        ],
      },
    ]);
  });
});

describe('sanitizeGeminiSchema', () => {
  it('drops additionalProperties and other non-dialect keys recursively', () => {
    expect(
      sanitizeGeminiSchema({
        type: 'object',
        $schema: 'http://json-schema.org/draft-07/schema#',
        additionalProperties: false,
        properties: {
          nested: {
            type: 'object',
            properties: { a: { type: 'string' } },
            required: ['a'],
            additionalProperties: false,
          },
        },
      })
    ).toEqual({
      type: 'object',
      properties: {
        nested: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
      },
    });
  });

  it('flattens anyOf to its sanitized first variant, keeping the description', () => {
    expect(
      sanitizeGeminiSchema({
        description: 'method(s)',
        anyOf: [
          { type: 'string', enum: ['GET', 'POST'], additionalProperties: false },
          { type: 'array', items: { type: 'string' } },
        ],
      })
    ).toEqual({ type: 'string', enum: ['GET', 'POST'], description: 'method(s)' });
  });

  it('gives type-less "any JSON" subschemas an explicit type', () => {
    expect(sanitizeGeminiSchema({})).toEqual({ type: 'object' });
    expect(
      sanitizeGeminiSchema({
        type: 'object',
        properties: { content: {}, seed: { type: 'array', items: {} } },
        required: ['content'],
      })
    ).toEqual({
      type: 'object',
      properties: {
        content: { type: 'object' },
        seed: { type: 'array', items: { type: 'object' } },
      },
      required: ['content'],
    });
  });

  it('leaves the routes schema free of Gemini-rejected constructs', () => {
    const sanitized = sanitizeGeminiSchema(ROUTES_JSON_SCHEMA);
    const offenders: string[] = [];
    // Walk every subschema (root, property values, array items).
    const walk = (node: Record<string, unknown>, path: string): void => {
      if ('additionalProperties' in node || 'anyOf' in node) {
        offenders.push(`${path} (non-dialect key)`);
      }
      if (typeof node.type !== 'string') {
        offenders.push(`${path} (missing type)`);
      }
      if (node.properties !== undefined && typeof node.properties === 'object') {
        for (const [name, sub] of Object.entries(node.properties as Record<string, unknown>)) {
          walk(sub as Record<string, unknown>, `${path}.properties.${name}`);
        }
      }
      if (node.items !== undefined) {
        walk(node.items as Record<string, unknown>, `${path}.items`);
      }
    };
    walk(sanitized, 'schema');
    expect(offenders).toEqual([]);
  });
});

describe('parseOpenAiToolCalls', () => {
  it('parses well-formed function calls', () => {
    const calls = parseOpenAiToolCalls([
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'read_file', arguments: '{"path":"src/app.ts"}' },
      },
    ]);
    expect(calls).toEqual([{ id: 'call_1', name: 'read_file', input: { path: 'src/app.ts' } }]);
  });

  it('turns malformed argument JSON into a parseError instead of throwing', () => {
    const calls = parseOpenAiToolCalls([
      { id: 'call_2', type: 'function', function: { name: 'read_file', arguments: '{"path": ' } },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0].id).toBe('call_2');
    expect(calls[0].name).toBe('read_file');
    expect(calls[0].input).toBeUndefined();
    expect(calls[0].parseError).toContain('not valid JSON');
  });

  it('treats empty/whitespace arguments as an empty object input', () => {
    const calls = parseOpenAiToolCalls([
      { id: 'a', function: { name: 'list_dir', arguments: '' } },
      { id: 'b', function: { name: 'list_dir', arguments: '   ' } },
      { id: 'c', function: { name: 'list_dir' } },
    ]);
    expect(calls.map((c) => c.input)).toEqual([{}, {}, {}]);
    expect(calls.every((c) => c.parseError === undefined)).toBe(true);
  });

  it('fills in a fallback id and name for degenerate entries', () => {
    const calls = parseOpenAiToolCalls([null, { function: { arguments: '{}' } }]);
    expect(calls[0]).toEqual({ id: 'call_0', name: '', input: {} });
    expect(calls[1]).toEqual({ id: 'call_1', name: '', input: {} });
  });

  it('returns an empty array for non-array input', () => {
    expect(parseOpenAiToolCalls(undefined)).toEqual([]);
    expect(parseOpenAiToolCalls(null)).toEqual([]);
    expect(parseOpenAiToolCalls('nope')).toEqual([]);
    expect(parseOpenAiToolCalls({})).toEqual([]);
  });
});

describe('extractGeminiFunctionCalls', () => {
  it('collects functionCall parts and defaults missing args to {}', () => {
    const calls = extractGeminiFunctionCalls([
      { text: 'thinking about it' },
      { functionCall: { name: 'read_file', args: { path: 'a.ts' } } },
      { functionCall: { name: 'list_dir' } },
    ]);
    expect(calls).toEqual([
      { name: 'read_file', args: { path: 'a.ts' } },
      { name: 'list_dir', args: {} },
    ]);
  });

  it('ignores malformed parts and non-array input', () => {
    expect(extractGeminiFunctionCalls([null, {}, { functionCall: { name: 42 } }])).toEqual([]);
    expect(extractGeminiFunctionCalls(undefined)).toEqual([]);
    expect(extractGeminiFunctionCalls('x')).toEqual([]);
  });
});

describe('extractGeminiText', () => {
  it('concatenates text parts and skips everything else', () => {
    expect(
      extractGeminiText([
        { text: 'Hello ' },
        { functionCall: { name: 'read_file', args: {} } },
        { text: 'world' },
        null,
        { text: 7 },
      ])
    ).toBe('Hello world');
  });

  it('returns empty string for non-array input', () => {
    expect(extractGeminiText(undefined)).toBe('');
  });
});

describe('geminiFunctionResponsePart', () => {
  it('wraps a success as an output response', () => {
    expect(geminiFunctionResponsePart('read_file', { text: 'file contents', isError: false })).toEqual({
      functionResponse: { name: 'read_file', response: { output: 'file contents' } },
    });
  });

  it('wraps a failure as an error response', () => {
    expect(geminiFunctionResponsePart('read_file', { text: 'ENOENT', isError: true })).toEqual({
      functionResponse: { name: 'read_file', response: { error: 'ENOENT' } },
    });
  });
});

describe('executeToolCall', () => {
  it('returns the executor result on success', async () => {
    const execute = vi.fn().mockResolvedValue('ok');
    const outcome = await executeToolCall(execute, { name: 'read_file', input: { path: 'a' } });
    expect(outcome).toEqual({ text: 'ok', isError: false });
    expect(execute).toHaveBeenCalledWith({ name: 'read_file', input: { path: 'a' } });
  });

  it('maps a thrown Error to an is-error outcome with its message', async () => {
    const outcome = await executeToolCall(
      async () => {
        throw new Error('file not found');
      },
      { name: 'read_file', input: {} }
    );
    expect(outcome).toEqual({ text: 'file not found', isError: true });
  });

  it('stringifies non-Error throws', async () => {
    const outcome = await executeToolCall(
      async () => {
        throw 'plain string failure';
      },
      { name: 'read_file', input: {} }
    );
    expect(outcome).toEqual({ text: 'plain string failure', isError: true });
  });
});
