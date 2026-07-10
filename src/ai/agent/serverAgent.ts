import type * as vscode from 'vscode';
import type { AiToolCall, AiToolDefinition, AiToolExecutor, AiToolLoopOptions } from '../providers/types.js';
import type { ServerToolBelt, ExecutedAction } from './serverTools.js';
import type { WorkspaceTools } from './workspaceTools.js';
import type { KnowledgeTool } from './knowledgeTool.js';

/**
 * One conversational server-agent turn (`@mocklify /agent …`).
 *
 * PLAIN TOOL LOOP BY DESIGN — one user turn is one bounded `runToolLoop`
 * call with a human confirming each mutation interactively; there is nothing
 * to fan out or checkpoint, and the ConfirmHandler is not serializable, so
 * LangGraph would add cost without value here. The module is pure
 * data-in/data-out (`ServerAgentDeps` structural, like `ScanGraphAi` in
 * scanGraph.ts) precisely so a future LangGraph can wrap `runServerAgentTurn`
 * as one node for checkpointed background jobs.
 *
 * Fully vitest-importable: no vscode value imports.
 */

// ---- Constants ----

/** Tool-execution cap for one agent turn. */
export const SERVER_AGENT_MAX_TOOL_CALLS = 20;
/** Conversation turns kept in the mission prompt. */
export const SERVER_AGENT_HISTORY_MAX_TURNS = 8;
/** Per-history-turn character cap. */
export const SERVER_AGENT_HISTORY_TURN_MAX_CHARS = 1_500;
/** User-request character cap. */
export const SERVER_AGENT_PROMPT_MAX_CHARS = 4_000;
/** Copilot consent line. */
export const SERVER_AGENT_JUSTIFICATION =
  "Mocklify's server agent is inspecting and (with your approval) modifying your mock servers.";
/** Final text when the turn is cancelled mid-loop. */
export const SERVER_AGENT_CANCELLED_TEXT =
  'Stopped before finishing. Changes already approved and applied are listed below; use Undo to roll them back.';

// ---- Types ----

/**
 * The slice of Mocklify's AI layer one agent turn calls. AiService satisfies
 * this structurally (same pattern as ScanGraphAi).
 */
export interface ServerAgentAi {
  runToolLoop(
    prompt: string,
    tools: AiToolDefinition[],
    execute: AiToolExecutor,
    options?: AiToolLoopOptions
  ): Promise<string>;
}

/** One prior conversation turn, most recent last. */
export interface ServerAgentTurnMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ServerAgentDeps {
  ai: ServerAgentAi;
  /** The gated mock-server tool belt (createServerToolBelt). */
  tools: ServerToolBelt;
  /** Optional hardened read-only codebase tools (createWorkspaceTools). */
  workspaceTools?: WorkspaceTools;
  /** Optional read-only knowledge tool (createKnowledgeTool). */
  knowledgeTool?: KnowledgeTool;
  /** One human-readable line per tool call (stream.progress in production). */
  onProgress?: (line: string) => void;
  token?: vscode.CancellationToken;
  /** Override for SERVER_AGENT_MAX_TOOL_CALLS (tests). */
  maxToolCalls?: number;
}

export interface ServerAgentRequest {
  prompt: string;
  /** Short prior conversation, oldest first. Clamped by the prompt builder. */
  history?: ServerAgentTurnMessage[];
}

export interface ServerAgentTurnResult {
  /** Final assistant Markdown. */
  text: string;
  /** Mutations executed during THIS turn (chronological). */
  actions: ExecutedAction[];
}

// ---- Pure helpers ----

/** Flatten a model-supplied field to one short line ('' for non-strings). */
function clampField(value: unknown, maxChars = 60): string {
  if (typeof value !== 'string') {
    return '';
  }
  const flattened = value.replace(/\s+/g, ' ').trim();
  return flattened.length > maxChars ? `${flattened.slice(0, maxChars)}…` : flattened;
}

/**
 * Human phrase for one tool call, e.g. 'adding 2 route(s) to "Payments"' —
 * input fields clamped to one short line.
 */
export function describeAgentToolCall(call: AiToolCall): string {
  const input = (call.input ?? {}) as Record<string, unknown>;
  const server = clampField(input.server);
  const route = clampField(input.route);
  switch (call.name) {
    case 'list_servers':
      return 'listing mock servers';
    case 'get_route':
      return `reading route ${route || '?'} on "${server || '?'}"`;
    case 'get_request_logs':
      return server ? `reading request logs for "${server}"` : 'reading request logs';
    case 'create_server':
      return `creating mock server "${clampField(input.name) || '?'}"`;
    case 'add_route': {
      const count = Array.isArray(input.routes) ? input.routes.length : 0;
      return `adding ${count} route(s) to "${server || '?'}"`;
    }
    case 'update_route':
      return `updating route ${route || '?'} on "${server || '?'}"`;
    case 'delete_route':
      return `deleting route ${route || '?'} from "${server || '?'}"`;
    case 'start_server':
      return `starting "${server || '?'}"`;
    case 'stop_server':
      return `stopping "${server || '?'}"`;
    case 'list_files':
      return `listing files ${clampField(input.glob) || ''}`.trim();
    case 'read_file':
      return `reading ${clampField(input.path) || 'a file'}`;
    case 'search_code':
      return `searching code for "${clampField(input.pattern)}"`;
    case 'query_knowledge':
      return `answering from Mocklify knowledge (${clampField(input.topic) || '?'})`;
    default:
      return `calling ${call.name}`;
  }
}

/** Progress line: `Server agent: <description> (call <i+1>/<max>)…` */
export function formatAgentToolProgress(call: AiToolCall, index: number, maxCalls: number): string {
  return `Server agent: ${describeAgentToolCall(call)} (call ${index + 1}/${maxCalls})…`;
}

/**
 * Clamp history to the last SERVER_AGENT_HISTORY_MAX_TURNS turns, each to
 * SERVER_AGENT_HISTORY_TURN_MAX_CHARS chars, formatted as a
 * `User:`/`Assistant:` transcript block ('' when empty).
 */
export function formatAgentHistory(history: ServerAgentTurnMessage[] | undefined): string {
  if (!history || history.length === 0) {
    return '';
  }
  return history
    .slice(-SERVER_AGENT_HISTORY_MAX_TURNS)
    .map((turn) => {
      const label = turn.role === 'user' ? 'User' : 'Assistant';
      const content = turn.content.trim();
      const clamped =
        content.length > SERVER_AGENT_HISTORY_TURN_MAX_CHARS
          ? `${content.slice(0, SERVER_AGENT_HISTORY_TURN_MAX_CHARS)}…`
          : content;
      return `${label}: ${clamped}`;
    })
    .join('\n');
}

/** Build the full mission prompt. hasWorkspaceTools toggles the codebase-tools
 *  paragraph; hasKnowledgeTool toggles the query_knowledge paragraph. */
export function buildServerAgentPrompt(
  request: ServerAgentRequest,
  hasWorkspaceTools: boolean,
  hasKnowledgeTool = false
): string {
  const sections: string[] = [];
  sections.push(
    'You are the Mocklify server agent inside VS Code. Mocklify is an API mocking extension: ' +
      'mock HTTP/GraphQL/WebSocket servers with routes, dynamic Handlebars+faker templates, ' +
      'request matching, stateful CRUD collections, chaos, and request logging.'
  );
  sections.push(
    'You know NOTHING about the current servers until you look. ALWAYS call list_servers before ' +
      'referencing, modifying, or answering about any server or route — never guess ids.'
  );
  sections.push(
    'Every create/add/update/delete/start/stop asks the user to approve the change; a refusal is ' +
      'final for that change — adapt or ask, never retry it. Batch related routes into ONE ' +
      'add_route call. Read a route with get_route before update_route or delete_route. Use ' +
      'get_request_logs when debugging server behavior.'
  );
  if (hasWorkspaceTools) {
    sections.push(
      "You may also read the user's codebase (list_files, read_file, search_code) to ground mock " +
        'routes and response data in the real API surface.'
    );
  }
  if (hasKnowledgeTool) {
    sections.push(
      'Use query_knowledge to answer questions from what Mocklify already knows — topics: ' +
        "'scan-memory' (what previous codebase scans learned), 'request-logs' (recent requests, " +
        "failures, and contract violations), 'specs' (imported API specs and the endpoints they " +
        "declare), 'diagnostics' (server counts, runtime errors, last scan, last error), and " +
        "'routes' (every route across servers). It is read-only and needs no approval — prefer it " +
        'over guessing or re-listing.'
    );
  }
  sections.push(
    `You have at most ${SERVER_AGENT_MAX_TOOL_CALLS} tool calls — be economical; do not re-list ` +
      'servers you already listed this turn.'
  );
  sections.push(
    'Finish with a concise Markdown answer. When you changed things, list each applied change; ' +
      'when a change was declined, say so. Never dump raw JSON configs unless asked.'
  );
  const historyBlock = formatAgentHistory(request.history);
  if (historyBlock !== '') {
    sections.push(`Conversation so far:\n${historyBlock}`);
  }
  const prompt = request.prompt.trim();
  const clampedPrompt =
    prompt.length > SERVER_AGENT_PROMPT_MAX_CHARS
      ? `${prompt.slice(0, SERVER_AGENT_PROMPT_MAX_CHARS)}…`
      : prompt;
  sections.push(`User request:\n${clampedPrompt}`);
  return sections.join('\n\n');
}

// ---- Turn ----

/** Same cancellation predicate as scanGraph's isCancellationLike. */
function isCancellationLike(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'Canceled' || error.name === 'AbortError' || error.name === 'CancellationError')
  );
}

/**
 * Run ONE conversational agent turn: compose the mission prompt, run a single
 * bounded tool loop over the injected belts, and return the final text plus
 * every mutation executed during the turn. Cancellation resolves (with the
 * partial actions) rather than throwing, so callers can still offer undo.
 */
export async function runServerAgentTurn(
  deps: ServerAgentDeps,
  request: ServerAgentRequest
): Promise<ServerAgentTurnResult> {
  const startCount = deps.tools.actions().length;
  const maxToolCalls = deps.maxToolCalls ?? SERVER_AGENT_MAX_TOOL_CALLS;

  const beltNames = new Set(deps.tools.definitions.map((d) => d.name));
  const wsNames = deps.workspaceTools
    ? new Set(deps.workspaceTools.definitions.map((d) => d.name))
    : undefined;
  const knNames = deps.knowledgeTool
    ? new Set(deps.knowledgeTool.definitions.map((d) => d.name))
    : undefined;
  const toolList = [
    ...deps.tools.definitions,
    ...(deps.workspaceTools?.definitions ?? []),
    ...(deps.knowledgeTool?.definitions ?? []),
  ];

  // Routed executor — never throws for unknown names, so the loop continues.
  const execute: AiToolExecutor = async (call) => {
    if (beltNames.has(call.name)) {
      return deps.tools.execute(call);
    }
    if (deps.workspaceTools && wsNames!.has(call.name)) {
      return deps.workspaceTools.execute(call);
    }
    if (deps.knowledgeTool && knNames!.has(call.name)) {
      return deps.knowledgeTool.execute(call);
    }
    return `Unknown tool "${call.name}". Available tools: ${[...beltNames, ...(wsNames ?? []), ...(knNames ?? [])].join(', ')}.`;
  };

  let text: string;
  try {
    const options: AiToolLoopOptions = {
      justification: SERVER_AGENT_JUSTIFICATION,
      maxToolCalls,
      ...(deps.token !== undefined ? { token: deps.token } : {}),
      onToolCall: (call, index) => deps.onProgress?.(formatAgentToolProgress(call, index, maxToolCalls)),
    };
    text = await deps.ai.runToolLoop(
      buildServerAgentPrompt(request, deps.workspaceTools !== undefined, deps.knowledgeTool !== undefined),
      toolList,
      execute,
      options
    );
  } catch (error) {
    if (isCancellationLike(error) || deps.token?.isCancellationRequested) {
      text = SERVER_AGENT_CANCELLED_TEXT;
    } else {
      throw error;
    }
  }

  const actions = deps.tools.actions().slice(startCount);
  if (text.trim() === '') {
    text = actions.length > 0 ? `Done — applied ${actions.length} change(s).` : 'No changes were made.';
  }
  return { text, actions };
}
