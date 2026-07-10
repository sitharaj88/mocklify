import { describe, it, expect, vi } from 'vitest';
import {
  SERVER_AGENT_CANCELLED_TEXT,
  SERVER_AGENT_HISTORY_MAX_TURNS,
  SERVER_AGENT_HISTORY_TURN_MAX_CHARS,
  SERVER_AGENT_JUSTIFICATION,
  SERVER_AGENT_MAX_TOOL_CALLS,
  SERVER_AGENT_PROMPT_MAX_CHARS,
  buildServerAgentPrompt,
  describeAgentToolCall,
  formatAgentHistory,
  formatAgentToolProgress,
  runServerAgentTurn,
  type ServerAgentAi,
  type ServerAgentDeps,
  type ServerAgentTurnMessage,
  type ServerAgentTurnResult,
} from '../src/ai/agent/serverAgent';
import type {
  AiToolCall,
  AiToolDefinition,
  AiToolExecutor,
  AiToolLoopOptions,
} from '../src/ai/providers/types';

// ---------------------------------------------------------------------------
// Fakes (structural — the real serverTools belt is deliberately not used)
// ---------------------------------------------------------------------------

type FakeBelt = ServerAgentDeps['tools'];
type FakeAction = ServerAgentTurnResult['actions'][number];
type FakeWorkspaceTools = NonNullable<ServerAgentDeps['workspaceTools']>;

const DENIED_MESSAGE =
  'The user declined this change — it was NOT applied and the decision is final.';

const emptyObjectSchema = { type: 'object', properties: {}, additionalProperties: false };

/**
 * In-memory stand-in for the gated server tool belt: list_servers succeeds,
 * add_route appends an ExecutedAction when `confirmResult` is true and
 * returns the denial constant otherwise.
 */
function createFakeBelt(options?: { confirmResult?: boolean; seedActions?: FakeAction[] }) {
  const confirmResult = options?.confirmResult ?? true;
  const actions: FakeAction[] = [...(options?.seedActions ?? [])];
  const executed: AiToolCall[] = [];
  const belt: FakeBelt = {
    definitions: [
      { name: 'list_servers', description: 'List all mock servers.', inputSchema: emptyObjectSchema },
      {
        name: 'add_route',
        description: 'Add routes to a mock server.',
        inputSchema: {
          type: 'object',
          properties: { server: { type: 'string' }, routes: { type: 'array', items: emptyObjectSchema } },
          required: ['server', 'routes'],
          additionalProperties: false,
        },
      },
    ],
    execute: async (call) => {
      executed.push(call);
      if (call.name === 'list_servers') {
        return '[{"id":"srv-1","name":"Payments","port":4000,"running":false}]';
      }
      if (call.name === 'add_route') {
        if (!confirmResult) {
          return DENIED_MESSAGE;
        }
        actions.push({
          kind: 'add_route',
          serverId: 'srv-1',
          serverName: 'Payments',
          summary: 'Added 1 route(s): GET /api/pay',
          routeIds: ['route-1'],
        });
        return 'Added 1 route(s) to "Payments": GET /api/pay (id: route-1).';
      }
      return `Tool "${call.name}" failed: unscripted.`;
    },
    actions: () => [...actions],
    snapshot: () => undefined,
  };
  return { belt, executed };
}

/** Read-only workspace-tools fake that records the calls it receives. */
function createFakeWorkspaceTools() {
  const executed: AiToolCall[] = [];
  const tools: FakeWorkspaceTools = {
    definitions: [
      { name: 'list_files', description: 'List files.', inputSchema: emptyObjectSchema },
      { name: 'read_file', description: 'Read a file.', inputSchema: emptyObjectSchema },
      { name: 'search_code', description: 'Search code.', inputSchema: emptyObjectSchema },
    ],
    execute: async (call) => {
      executed.push(call);
      return `workspace result for ${call.name}`;
    },
    stats: () => ({ toolCalls: executed.length, bytesRead: 0, filesRead: 0 }),
  };
  return { tools, executed };
}

interface ReceivedLoop {
  prompt: string;
  tools: AiToolDefinition[];
  options: AiToolLoopOptions | undefined;
}

/**
 * Scripted AI: drives the provided executor with a fixed tool-call sequence
 * (invoking onToolCall first and honoring the token, like the real loop),
 * then resolves the final text. Mirrors the AgenticScanner test fakes.
 */
function createScriptedAi(
  script: AiToolCall[],
  finalText: string,
  options?: { cancelAfterCalls?: number; onCancel?: () => void }
) {
  const received: ReceivedLoop[] = [];
  const results: string[] = [];
  const ai: ServerAgentAi = {
    async runToolLoop(
      prompt: string,
      tools: AiToolDefinition[],
      execute: AiToolExecutor,
      loopOptions?: AiToolLoopOptions
    ): Promise<string> {
      received.push({ prompt, tools, options: loopOptions });
      let index = 0;
      for (const call of script) {
        if (loopOptions?.token?.isCancellationRequested) {
          const cancelled = new Error('Cancelled');
          cancelled.name = 'Canceled';
          throw cancelled;
        }
        loopOptions?.onToolCall?.(call, index);
        results.push(await execute(call));
        index += 1;
        if (options?.cancelAfterCalls !== undefined && index >= options.cancelAfterCalls) {
          options.onCancel?.();
        }
      }
      return finalText;
    },
  };
  return { ai, received, results };
}

function fakeCancellation() {
  let cancelled = false;
  const token = {
    get isCancellationRequested() {
      return cancelled;
    },
    onCancellationRequested: () => ({ dispose: () => undefined }),
  } as unknown as NonNullable<ServerAgentDeps['token']>;
  return { token, cancel: () => (cancelled = true) };
}

const LIST_CALL: AiToolCall = { name: 'list_servers', input: {} };
const ADD_CALL: AiToolCall = {
  name: 'add_route',
  input: { server: 'Payments', routes: [{ method: 'GET', path: '/api/pay' }] },
};

// ---------------------------------------------------------------------------
// Turn contract
// ---------------------------------------------------------------------------

describe('runServerAgentTurn', () => {
  it('resolves the final text and only this turn\'s actions', async () => {
    const seed: FakeAction = {
      kind: 'create_server',
      serverId: 'srv-0',
      serverName: 'Old',
      summary: 'Created earlier in the session',
    };
    const { belt } = createFakeBelt({ seedActions: [seed] });
    const { ai } = createScriptedAi([LIST_CALL, ADD_CALL], 'Added the payments route.');

    const result = await runServerAgentTurn({ ai, tools: belt }, { prompt: 'add a payments route' });

    expect(result.text).toBe('Added the payments route.');
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]!.kind).toBe('add_route');
    expect(result.actions[0]!.serverId).toBe('srv-1');
    expect(result.actions[0]!.summary).toContain('GET /api/pay');
    expect(result.actions).not.toContainEqual(seed);
  });

  it('records one add_route action for a list → add script', async () => {
    const { belt, executed } = createFakeBelt();
    const { ai } = createScriptedAi([LIST_CALL, ADD_CALL], 'Done.');

    const result = await runServerAgentTurn({ ai, tools: belt }, { prompt: 'add route' });

    expect(executed.map((c) => c.name)).toEqual(['list_servers', 'add_route']);
    expect(result.actions).toEqual([
      {
        kind: 'add_route',
        serverId: 'srv-1',
        serverName: 'Payments',
        summary: 'Added 1 route(s): GET /api/pay',
        routeIds: ['route-1'],
      },
    ]);
  });

  it('emits one progress line per tool call matching formatAgentToolProgress', async () => {
    const { belt } = createFakeBelt();
    const { ai } = createScriptedAi([LIST_CALL, ADD_CALL], 'Done.');
    const lines: string[] = [];

    await runServerAgentTurn(
      { ai, tools: belt, onProgress: (line) => lines.push(line) },
      { prompt: 'add route' }
    );

    expect(lines).toEqual([
      formatAgentToolProgress(LIST_CALL, 0, SERVER_AGENT_MAX_TOOL_CALLS),
      formatAgentToolProgress(ADD_CALL, 1, SERVER_AGENT_MAX_TOOL_CALLS),
    ]);
    expect(lines[0]).toBe('Server agent: listing mock servers (call 1/20)…');
    expect(lines[1]).toContain('adding 1 route(s) to "Payments"');
    expect(lines[1]).toContain('(call 2/20)…');
  });

  it('routes workspace tool names to workspaceTools.execute', async () => {
    const { belt, executed: beltCalls } = createFakeBelt();
    const ws = createFakeWorkspaceTools();
    const readCall: AiToolCall = { name: 'read_file', input: { path: 'src/api.ts' } };
    const { ai, results } = createScriptedAi([readCall, LIST_CALL], 'Done.');

    await runServerAgentTurn({ ai, tools: belt, workspaceTools: ws.tools }, { prompt: 'inspect' });

    expect(ws.executed.map((c) => c.name)).toEqual(['read_file']);
    expect(beltCalls.map((c) => c.name)).toEqual(['list_servers']);
    expect(results[0]).toBe('workspace result for read_file');
  });

  it('returns an unknown-tool message for read_file without workspaceTools', async () => {
    const { belt } = createFakeBelt();
    const readCall: AiToolCall = { name: 'read_file', input: { path: 'src/api.ts' } };
    const { ai, results } = createScriptedAi([readCall], 'Done.');

    const result = await runServerAgentTurn({ ai, tools: belt }, { prompt: 'inspect' });

    expect(results[0]).toBe('Unknown tool "read_file". Available tools: list_servers, add_route.');
    expect(result.text).toBe('Done.');
  });

  it('offers belt + workspace definitions to the loop (belt only when ws absent)', async () => {
    const { belt } = createFakeBelt();
    const ws = createFakeWorkspaceTools();
    const withWs = createScriptedAi([], 'ok');
    await runServerAgentTurn({ ai: withWs.ai, tools: belt, workspaceTools: ws.tools }, { prompt: 'x' });
    expect(withWs.received[0]!.tools.map((d) => d.name)).toEqual([
      'list_servers',
      'add_route',
      'list_files',
      'read_file',
      'search_code',
    ]);

    const withoutWs = createScriptedAi([], 'ok');
    await runServerAgentTurn({ ai: withoutWs.ai, tools: belt }, { prompt: 'x' });
    expect(withoutWs.received[0]!.tools.map((d) => d.name)).toEqual(['list_servers', 'add_route']);
  });

  it('continues past a denied mutation and reports no actions', async () => {
    const { belt } = createFakeBelt({ confirmResult: false });
    const { ai, results } = createScriptedAi([ADD_CALL, LIST_CALL], 'Understood — nothing changed.');

    const result = await runServerAgentTurn({ ai, tools: belt }, { prompt: 'add route' });

    expect(results[0]).toBe(DENIED_MESSAGE);
    expect(results).toHaveLength(2);
    expect(result.text).toBe('Understood — nothing changed.');
    expect(result.actions).toEqual([]);
  });

  it('resolves with the cancelled text and partial actions when the loop is cancelled', async () => {
    const { belt } = createFakeBelt();
    const cancellation = fakeCancellation();
    const { ai } = createScriptedAi([ADD_CALL, LIST_CALL], 'never reached', {
      cancelAfterCalls: 1,
      onCancel: cancellation.cancel,
    });

    const result = await runServerAgentTurn(
      { ai, tools: belt, token: cancellation.token },
      { prompt: 'add route then list' }
    );

    expect(result.text).toBe(SERVER_AGENT_CANCELLED_TEXT);
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]!.kind).toBe('add_route');
  });

  it('rethrows non-cancellation loop errors', async () => {
    const { belt } = createFakeBelt();
    const ai: ServerAgentAi = {
      runToolLoop: async () => {
        throw new Error('model exploded');
      },
    };
    await expect(runServerAgentTurn({ ai, tools: belt }, { prompt: 'x' })).rejects.toThrow(
      'model exploded'
    );
  });

  it('synthesizes final text from actions when the model returns whitespace', async () => {
    const applied = createFakeBelt();
    const appliedAi = createScriptedAi([ADD_CALL], '   ');
    const withActions = await runServerAgentTurn(
      { ai: appliedAi.ai, tools: applied.belt },
      { prompt: 'add route' }
    );
    expect(withActions.text).toBe('Done — applied 1 change(s).');

    const idle = createFakeBelt();
    const idleAi = createScriptedAi([LIST_CALL], '');
    const withoutActions = await runServerAgentTurn(
      { ai: idleAi.ai, tools: idle.belt },
      { prompt: 'list' }
    );
    expect(withoutActions.text).toBe('No changes were made.');
  });

  it('forwards justification, token, and maxToolCalls (default and override)', async () => {
    const { belt } = createFakeBelt();
    const cancellation = fakeCancellation();

    const defaults = createScriptedAi([], 'ok');
    await runServerAgentTurn(
      { ai: defaults.ai, tools: belt, token: cancellation.token },
      { prompt: 'x' }
    );
    const defaultOptions = defaults.received[0]!.options;
    expect(defaultOptions?.maxToolCalls).toBe(SERVER_AGENT_MAX_TOOL_CALLS);
    expect(defaultOptions?.maxToolCalls).toBe(20);
    expect(defaultOptions?.justification).toBe(SERVER_AGENT_JUSTIFICATION);
    expect(defaultOptions?.token).toBe(cancellation.token);

    const overridden = createScriptedAi([LIST_CALL], 'ok');
    const lines: string[] = [];
    await runServerAgentTurn(
      { ai: overridden.ai, tools: belt, maxToolCalls: 5, onProgress: (line) => lines.push(line) },
      { prompt: 'x' }
    );
    expect(overridden.received[0]!.options?.maxToolCalls).toBe(5);
    expect(overridden.received[0]!.options?.token).toBeUndefined();
    expect(lines[0]).toContain('(call 1/5)…');
  });

  it('does not double-charge onProgress when absent', async () => {
    const { belt } = createFakeBelt();
    const { ai } = createScriptedAi([LIST_CALL], 'ok');
    // No onProgress — onToolCall must still be safe to invoke.
    await expect(runServerAgentTurn({ ai, tools: belt }, { prompt: 'x' })).resolves.toMatchObject({
      text: 'ok',
    });
  });

  it('passes the built mission prompt (with workspace paragraph toggled) to the loop', async () => {
    const { belt } = createFakeBelt();
    const ws = createFakeWorkspaceTools();
    const request = { prompt: 'add a route', history: [{ role: 'user' as const, content: 'hi' }] };

    const withWs = createScriptedAi([], 'ok');
    await runServerAgentTurn({ ai: withWs.ai, tools: belt, workspaceTools: ws.tools }, request);
    expect(withWs.received[0]!.prompt).toBe(buildServerAgentPrompt(request, true));

    const withoutWs = createScriptedAi([], 'ok');
    await runServerAgentTurn({ ai: withoutWs.ai, tools: belt }, request);
    expect(withoutWs.received[0]!.prompt).toBe(buildServerAgentPrompt(request, false));
  });
});

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

describe('buildServerAgentPrompt', () => {
  it('contains the role, discovery rule, etiquette, budget, and output contract', () => {
    const prompt = buildServerAgentPrompt({ prompt: 'list my servers' }, false);
    expect(prompt).toContain('You are the Mocklify server agent inside VS Code');
    expect(prompt).toContain('ALWAYS call list_servers before');
    expect(prompt).toContain('never guess ids');
    expect(prompt).toContain('a refusal is');
    expect(prompt).toContain(`You have at most ${SERVER_AGENT_MAX_TOOL_CALLS} tool calls`);
    expect(prompt).toContain('Finish with a concise Markdown answer');
    expect(prompt).toContain('User request:\nlist my servers');
  });

  it('includes the codebase paragraph only when workspace tools exist', () => {
    const withWs = buildServerAgentPrompt({ prompt: 'x' }, true);
    const withoutWs = buildServerAgentPrompt({ prompt: 'x' }, false);
    expect(withWs).toContain("read the user's codebase (list_files, read_file, search_code)");
    expect(withoutWs).not.toContain('list_files, read_file, search_code');
  });

  it('omits the conversation block when history is empty', () => {
    expect(buildServerAgentPrompt({ prompt: 'x' }, false)).not.toContain('Conversation so far:');
    expect(buildServerAgentPrompt({ prompt: 'x', history: [] }, false)).not.toContain(
      'Conversation so far:'
    );
  });

  it('clamps history to the last turns and each turn to the char cap', () => {
    const history: ServerAgentTurnMessage[] = [];
    for (let i = 0; i < SERVER_AGENT_HISTORY_MAX_TURNS + 3; i += 1) {
      history.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `turn number ${i}` });
    }
    history.push({ role: 'assistant', content: 'y'.repeat(SERVER_AGENT_HISTORY_TURN_MAX_CHARS + 500) });

    const prompt = buildServerAgentPrompt({ prompt: 'x', history }, false);
    expect(prompt).toContain('Conversation so far:');
    expect(prompt).not.toContain('turn number 0');
    expect(prompt).not.toContain('turn number 3');
    expect(prompt).toContain('turn number 4');
    expect(prompt).toContain(`${'y'.repeat(SERVER_AGENT_HISTORY_TURN_MAX_CHARS)}…`);
    expect(prompt).not.toContain('y'.repeat(SERVER_AGENT_HISTORY_TURN_MAX_CHARS + 1));
  });

  it('clamps the user request to SERVER_AGENT_PROMPT_MAX_CHARS', () => {
    const long = 'z'.repeat(SERVER_AGENT_PROMPT_MAX_CHARS + 1_000);
    const prompt = buildServerAgentPrompt({ prompt: long }, false);
    expect(prompt).toContain(`User request:\n${'z'.repeat(SERVER_AGENT_PROMPT_MAX_CHARS)}…`);
    expect(prompt).not.toContain('z'.repeat(SERVER_AGENT_PROMPT_MAX_CHARS + 1));
  });
});

// ---------------------------------------------------------------------------
// History formatting
// ---------------------------------------------------------------------------

describe('formatAgentHistory', () => {
  it('returns the empty string for undefined or empty history', () => {
    expect(formatAgentHistory(undefined)).toBe('');
    expect(formatAgentHistory([])).toBe('');
  });

  it('formats a User/Assistant transcript', () => {
    const text = formatAgentHistory([
      { role: 'user', content: 'start the payments server' },
      { role: 'assistant', content: 'Started it on port 4000.' },
    ]);
    expect(text).toBe('User: start the payments server\nAssistant: Started it on port 4000.');
  });

  it('keeps only the most recent SERVER_AGENT_HISTORY_MAX_TURNS turns', () => {
    const history: ServerAgentTurnMessage[] = Array.from({ length: 12 }, (_, i) => ({
      role: 'user' as const,
      content: `message-${i}`,
    }));
    const text = formatAgentHistory(history);
    expect(text.split('\n')).toHaveLength(SERVER_AGENT_HISTORY_MAX_TURNS);
    expect(text).not.toContain('message-3');
    expect(text).toContain('message-4');
    expect(text).toContain('message-11');
  });
});

// ---------------------------------------------------------------------------
// Tool-call descriptions
// ---------------------------------------------------------------------------

describe('describeAgentToolCall / formatAgentToolProgress', () => {
  it('describes each belt tool with clamped fields', () => {
    expect(describeAgentToolCall({ name: 'list_servers', input: {} })).toBe('listing mock servers');
    expect(
      describeAgentToolCall({
        name: 'add_route',
        input: { server: 'Payments', routes: [{}, {}] },
      })
    ).toBe('adding 2 route(s) to "Payments"');
    expect(
      describeAgentToolCall({ name: 'get_route', input: { server: 'Payments', route: 'GET /pay' } })
    ).toBe('reading route GET /pay on "Payments"');
    expect(describeAgentToolCall({ name: 'create_server', input: { name: 'Orders API' } })).toBe(
      'creating mock server "Orders API"'
    );
    expect(describeAgentToolCall({ name: 'start_server', input: { server: 'Orders API' } })).toBe(
      'starting "Orders API"'
    );
    expect(describeAgentToolCall({ name: 'stop_server', input: { server: 'Orders API' } })).toBe(
      'stopping "Orders API"'
    );
    expect(
      describeAgentToolCall({ name: 'delete_route', input: { server: 'Orders', route: 'r-1' } })
    ).toBe('deleting route r-1 from "Orders"');
    expect(
      describeAgentToolCall({ name: 'update_route', input: { server: 'Orders', route: 'r-1' } })
    ).toBe('updating route r-1 on "Orders"');
    expect(describeAgentToolCall({ name: 'get_request_logs', input: {} })).toBe(
      'reading request logs'
    );
    expect(describeAgentToolCall({ name: 'read_file', input: { path: 'src/a.ts' } })).toBe(
      'reading src/a.ts'
    );
    expect(describeAgentToolCall({ name: 'mystery_tool', input: {} })).toBe('calling mystery_tool');
  });

  it('clamps long and multi-line input fields to one short line', () => {
    const name = `${'a'.repeat(80)}\nnewline`;
    const description = describeAgentToolCall({ name: 'create_server', input: { name } });
    expect(description).toContain('a'.repeat(60));
    expect(description).not.toContain('\n');
    expect(description).not.toContain('a'.repeat(61));
  });

  it('tolerates malformed input (non-object, missing fields)', () => {
    expect(describeAgentToolCall({ name: 'add_route', input: null })).toBe(
      'adding 0 route(s) to "?"'
    );
    expect(describeAgentToolCall({ name: 'get_route', input: 'nonsense' })).toBe(
      'reading route ? on "?"'
    );
    expect(describeAgentToolCall({ name: 'create_server', input: { name: 42 } })).toBe(
      'creating mock server "?"'
    );
  });

  it('formats the progress line with a 1-based call counter', () => {
    expect(formatAgentToolProgress({ name: 'list_servers', input: {} }, 0, 20)).toBe(
      'Server agent: listing mock servers (call 1/20)…'
    );
    expect(formatAgentToolProgress({ name: 'list_servers', input: {} }, 4, 5)).toBe(
      'Server agent: listing mock servers (call 5/5)…'
    );
  });
});

// ---------------------------------------------------------------------------
// Knowledge tool injection
// ---------------------------------------------------------------------------

type FakeKnowledgeTool = NonNullable<ServerAgentDeps['knowledgeTool']>;

/** Read-only knowledge-tool fake (one query_knowledge definition). */
function createFakeKnowledgeTool() {
  const execute = vi.fn(async () => 'knowledge!');
  const tool: FakeKnowledgeTool = {
    definitions: [
      { name: 'query_knowledge', description: 'x', inputSchema: emptyObjectSchema },
    ],
    execute,
  };
  return { tool, execute };
}

describe('runServerAgentTurn knowledge tool', () => {
  it('offers query_knowledge after the belt + workspace definitions', async () => {
    const { belt } = createFakeBelt();
    const ws = createFakeWorkspaceTools();
    const kn = createFakeKnowledgeTool();
    const { ai, received } = createScriptedAi([], 'ok');

    await runServerAgentTurn(
      { ai, tools: belt, workspaceTools: ws.tools, knowledgeTool: kn.tool },
      { prompt: 'x' }
    );

    expect(received[0]!.tools.map((d) => d.name)).toEqual([
      'list_servers',
      'add_route',
      'list_files',
      'read_file',
      'search_code',
      'query_knowledge',
    ]);
  });

  it('routes query_knowledge calls to knowledgeTool.execute', async () => {
    const { belt, executed: beltCalls } = createFakeBelt();
    const kn = createFakeKnowledgeTool();
    const knowledgeCall: AiToolCall = { name: 'query_knowledge', input: {} };
    const { ai, results } = createScriptedAi([knowledgeCall, LIST_CALL], 'Done.');

    await runServerAgentTurn({ ai, tools: belt, knowledgeTool: kn.tool }, { prompt: 'ask' });

    expect(kn.execute).toHaveBeenCalledTimes(1);
    expect(results[0]).toBe('knowledge!');
    expect(beltCalls.map((c) => c.name)).toEqual(['list_servers']);
  });

  it('lists query_knowledge in the unknown-tool message when injected', async () => {
    const { belt } = createFakeBelt();
    const kn = createFakeKnowledgeTool();
    const { ai, results } = createScriptedAi([{ name: 'mystery_tool', input: {} }], 'Done.');

    await runServerAgentTurn({ ai, tools: belt, knowledgeTool: kn.tool }, { prompt: 'x' });

    expect(results[0]).toBe(
      'Unknown tool "mystery_tool". Available tools: list_servers, add_route, query_knowledge.'
    );
  });

  it('mentions query_knowledge in the prompt iff hasKnowledgeTool (default false)', () => {
    const request = { prompt: 'x' };
    expect(buildServerAgentPrompt(request, false, true)).toContain('query_knowledge');
    expect(buildServerAgentPrompt(request, false)).not.toContain('query_knowledge');
  });

  it('describes a query_knowledge call with its topic', () => {
    expect(describeAgentToolCall({ name: 'query_knowledge', input: { topic: 'routes' } })).toBe(
      'answering from Mocklify knowledge (routes)'
    );
    expect(describeAgentToolCall({ name: 'query_knowledge', input: {} })).toBe(
      'answering from Mocklify knowledge (?)'
    );
  });
});
