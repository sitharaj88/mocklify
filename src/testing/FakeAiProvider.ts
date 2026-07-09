import { readFileSync } from 'node:fs';
import type {
  AiProvider,
  AiProviderId,
  AiRequestOptions,
  AiToolCall,
  AiToolDefinition,
  AiToolExecutor,
  AiToolLoopOptions,
} from '../ai/providers/types.js';

/**
 * Deterministic, offline stand-in for a real AI provider, used by the E2E
 * harness so agentic and generation flows run without a network, an API key,
 * or GitHub Copilot. It replays scripted responses keyed by a substring match
 * against the prompt, records every call for assertions, and can emit
 * `submit_routes` (or any) tool calls so the agentic tool-loop path exercises
 * end to end.
 *
 * PRODUCTION-UNREACHABILITY: this module is inert unless something instantiates
 * it. INTEGRATION only constructs it behind the MOCKLIFY_FAKE_AI env gate, which
 * the Marketplace/production host never sets. It contains no vscode import, so
 * it also imports cleanly under vitest.
 */

/** One scripted streaming reply. `match` undefined ⇒ matches any prompt. */
export interface FakeStreamScript {
  /** Case-insensitive substring the prompt must contain to select this reply. */
  match?: string;
  /** Full response text streamed back (chunked to exercise onData). */
  response: string;
}

/** One scripted agentic tool loop. `match` undefined ⇒ matches any prompt. */
export interface FakeToolLoopScript {
  match?: string;
  /**
   * Tool calls the model "makes", in order. Each is passed to the caller's
   * executor (so e.g. submit_routes runs the real handler) and reported via
   * options.onToolCall before the loop resolves with `final`.
   */
  toolCalls?: AiToolCall[];
  /** Final assistant text the loop resolves with. */
  final: string;
}

/** The scriptable behavior, also the on-disk fixtures-file shape. */
export interface FakeAiScript {
  /** Provider id to impersonate (default 'copilot'). */
  id?: AiProviderId;
  /** Human-readable label (default 'Fake AI (test)'). */
  label?: string;
  /** Whether isAvailable() resolves true (default true). */
  available?: boolean;
  /**
   * Whether runToolLoop is offered. When false the method is removed from the
   * instance so callers that feature-detect (`typeof provider.runToolLoop`)
   * see no tool support — used to force the fast (non-agentic) scan path.
   * Default true.
   */
  supportsToolLoop?: boolean;
  /** Streaming replies, tried in order; first match wins. */
  streamResponses?: FakeStreamScript[];
  /** Tool-loop scripts, tried in order; first match wins. */
  toolLoops?: FakeToolLoopScript[];
  /** Fallback text when no script matches (default ''). */
  defaultResponse?: string;
}

/** A recorded invocation, for test assertions. */
export interface FakeCall {
  kind: 'stream' | 'toolLoop';
  prompt: string;
  /** Tool names offered on a toolLoop call. */
  tools?: string[];
}

function matches(prompt: string, match: string | undefined): boolean {
  return match === undefined || prompt.toLowerCase().includes(match.toLowerCase());
}

export class FakeAiProvider implements AiProvider {
  readonly id: AiProviderId;
  readonly label: string;
  /** Every streamRequest / runToolLoop call in invocation order. */
  readonly calls: FakeCall[] = [];

  private readonly script: FakeAiScript;
  private readonly available: boolean;

  constructor(script: FakeAiScript = {}) {
    this.script = script;
    this.id = script.id ?? 'copilot';
    this.label = script.label ?? 'Fake AI (test)';
    this.available = script.available ?? true;
    if (script.supportsToolLoop === false) {
      // Hide tool support from feature-detecting callers (forces fast scan).
      (this as { runToolLoop?: unknown }).runToolLoop = undefined;
    }
  }

  static fromScript(script: FakeAiScript): FakeAiProvider {
    return new FakeAiProvider(script);
  }

  /** Build from a JSON fixtures file (MOCKLIFY_FAKE_AI_FIXTURES path). */
  static fromFixturesFile(path: string): FakeAiProvider {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as FakeAiScript;
    return new FakeAiProvider(parsed);
  }

  async isAvailable(): Promise<boolean> {
    return this.available;
  }

  async *streamRequest(
    prompt: string,
    options?: AiRequestOptions
  ): AsyncGenerator<string, void, undefined> {
    this.calls.push({ kind: 'stream', prompt });
    const script = (this.script.streamResponses ?? []).find((s) => matches(prompt, s.match));
    const text = script ? script.response : (this.script.defaultResponse ?? '');

    let sent = 0;
    // Chunk so callers observing onData see real streaming progress.
    for (let i = 0; i < text.length; i += 40) {
      if (options?.token?.isCancellationRequested) {
        return;
      }
      const chunk = text.slice(i, i + 40);
      sent += chunk.length;
      options?.onData?.(sent);
      yield chunk;
    }
  }

  async runToolLoop(
    prompt: string,
    tools: AiToolDefinition[],
    execute: AiToolExecutor,
    options?: AiToolLoopOptions
  ): Promise<string> {
    this.calls.push({ kind: 'toolLoop', prompt, tools: tools.map((t) => t.name) });
    const script = (this.script.toolLoops ?? []).find((s) => matches(prompt, s.match));
    if (!script) {
      return this.script.defaultResponse ?? '';
    }

    let index = 0;
    for (const call of script.toolCalls ?? []) {
      options?.onToolCall?.(call, index++);
      // Run the caller's executor so agentic side effects (e.g. submit_routes)
      // actually happen; a throwing executor mirrors a tool error in real life.
      await execute(call);
    }
    options?.onData?.(script.final.length);
    return script.final;
  }
}
