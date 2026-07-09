import type { AiToolDefinition } from '../providers/types.js';
import type { HumanQuestion, QuestionHandler } from './graphRuntime.js';

/**
 * The ask_user tool: lets a surface-exploration branch pause and ask the
 * human developer ONE decisive question through the scan runtime's
 * HumanQuestion channel (the same {@link HumanQuestion} shape interrupts
 * surface through — QuickPick with options, free-text InputBox fallback).
 *
 * The bridge is deliberately a direct callback rather than a LangGraph
 * interrupt(): interrupts replay their node from the top on resume, which
 * would re-run the whole (non-deterministic, billed) exploration tool loop.
 * Answering in place keeps the loop's conversation intact; the runtime's
 * QuestionHandler is still the single UI channel for both mechanisms.
 *
 * Constraints enforced here, not by the model:
 * - at most {@link MAX_QUESTIONS_PER_SURFACE} questions per surface branch;
 * - question/options sanitized to single lines with hard char caps;
 * - a {@link ASK_USER_ANSWER_TIMEOUT_MS} answer timeout that resumes the
 *   loop with {@link NO_ANSWER_FALLBACK};
 * - cancellation during a pending question rejects with an AbortError so the
 *   branch unwinds cleanly (leaving a resumable checkpoint behind).
 *
 * Pure logic — fully vitest-importable, no vscode, no LangChain.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Questions ONE exploration branch may ask, total. */
export const MAX_QUESTIONS_PER_SURFACE = 2;
/** How long a pending question waits for the human before self-answering. */
export const ASK_USER_ANSWER_TIMEOUT_MS = 120_000;
/** Question text cap (single line). */
export const ASK_USER_QUESTION_MAX_CHARS = 200;
/** Per-option cap (single line). */
export const ASK_USER_OPTION_MAX_CHARS = 60;
/** Options below this count are dropped (free-text question instead). */
export const ASK_USER_MIN_OPTIONS = 2;
/** Options beyond this count are cut. */
export const ASK_USER_MAX_OPTIONS = 4;
/** Answer text cap (defensive — answers come from trusted UI, but still). */
export const ASK_USER_ANSWER_MAX_CHARS = 500;

/** Tool result when the human did not answer in time (or the UI failed). */
export const NO_ANSWER_FALLBACK = 'No answer — decide yourself and note the assumption.';
/** Tool result once the per-surface question budget is spent. */
export const ASK_USER_BUDGET_MESSAGE =
  'You have used your question budget for this surface — decide yourself and note the assumption.';
/** Tool result for a malformed ask_user call. */
export const ASK_USER_INVALID_MESSAGE =
  'ask_user needs {"question": "one short, specific question"} (optionally "options": ["…", "…"]) — or better, decide yourself from the code.';
/** Tool result when the model calls ask_user but no question UI is wired. */
export const ASK_USER_UNAVAILABLE_MESSAGE =
  'Asking the user is not available in this run — decide yourself and note the assumption.';

export const ASK_USER_TOOL: AiToolDefinition = {
  name: 'ask_user',
  description:
    'Ask the human developer one short, decisive question. Call ONLY when a decision materially changes the mock and cannot be inferred from code — e.g. multiple auth flows, ambiguous base URL, conflicting API versions. Never ask about things you can read. You may ask at most 2 questions; if no answer arrives, decide yourself and note the assumption.',
  inputSchema: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'One short, specific question (single line, under 200 characters).',
      },
      options: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional: 2-4 short answer choices (under 60 characters each) the user can pick from. The user may still answer in free text.',
      },
    },
    required: ['question'],
    additionalProperties: false,
  },
};

// ---------------------------------------------------------------------------
// Sanitization (pure)
// ---------------------------------------------------------------------------

function singleLine(raw: string, maxChars: number): string {
  const flattened = raw.replace(/\s+/g, ' ').trim();
  return flattened.length > maxChars ? `${flattened.slice(0, maxChars)}…` : flattened;
}

export interface AskUserInput {
  question: string;
  options?: string[];
}

/**
 * Validate and sanitize a raw ask_user tool input: the question becomes one
 * bounded line; options are deduped, bounded, and kept only when there are
 * {@link ASK_USER_MIN_OPTIONS}–{@link ASK_USER_MAX_OPTIONS} usable ones.
 * Returns undefined when there is no usable question at all.
 */
export function sanitizeAskUserInput(input: unknown): AskUserInput | undefined {
  if (input === null || typeof input !== 'object') {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  if (typeof record.question !== 'string') {
    return undefined;
  }
  const question = singleLine(record.question, ASK_USER_QUESTION_MAX_CHARS);
  if (question === '') {
    return undefined;
  }
  const result: AskUserInput = { question };
  if (Array.isArray(record.options)) {
    const cleaned = record.options
      .filter((option): option is string => typeof option === 'string')
      .map((option) => singleLine(option, ASK_USER_OPTION_MAX_CHARS))
      .filter((option) => option !== '');
    const unique = [...new Set(cleaned)];
    if (unique.length >= ASK_USER_MIN_OPTIONS) {
      result.options = unique.slice(0, ASK_USER_MAX_OPTIONS);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

/** Per-branch question bookkeeping. */
export interface AskUserState {
  asked: number;
}

export function createAskUserState(): AskUserState {
  return { asked: 0 };
}

export interface ExecuteAskUserOptions {
  /** The runtime's question channel (QuickPick / InputBox in production). */
  ask: QuestionHandler;
  /** Cancellation: a pending question rejects with AbortError when this fires. */
  signal?: AbortSignal;
  /** Answer timeout override (default {@link ASK_USER_ANSWER_TIMEOUT_MS}). */
  timeoutMs?: number;
}

function abortError(): Error {
  const error = new Error('The scan was cancelled while waiting for an answer.');
  error.name = 'AbortError';
  return error;
}

let questionCounter = 0;

/**
 * Handle one ask_user tool call from an exploration branch. Resolves with the
 * tool-result text to feed back to the model: the user's answer, or one of
 * the self-serve fallbacks (invalid call, budget spent, timeout, UI failure).
 * Rejects ONLY on cancellation, so the branch unwinds like any other abort.
 */
export async function executeAskUser(
  state: AskUserState,
  rawInput: unknown,
  options: ExecuteAskUserOptions
): Promise<string> {
  const input = sanitizeAskUserInput(rawInput);
  if (input === undefined) {
    return ASK_USER_INVALID_MESSAGE;
  }
  if (options.signal?.aborted) {
    throw abortError();
  }
  if (state.asked >= MAX_QUESTIONS_PER_SURFACE) {
    return ASK_USER_BUDGET_MESSAGE;
  }
  state.asked += 1;

  const question: HumanQuestion = {
    id: `ask-user-${++questionCounter}`,
    question: input.question,
    freeText: true,
  };
  if (input.options !== undefined) {
    question.options = input.options;
  }

  const answer = await waitForAnswer(
    options.ask,
    question,
    options.timeoutMs ?? ASK_USER_ANSWER_TIMEOUT_MS,
    options.signal
  );
  if (answer === undefined) {
    return NO_ANSWER_FALLBACK;
  }
  const cleaned = singleLine(answer, ASK_USER_ANSWER_MAX_CHARS);
  if (cleaned === '') {
    return NO_ANSWER_FALLBACK;
  }
  return `The user answered: "${cleaned}". Honor this decision and continue.`;
}

/**
 * Race the question handler against the timeout and the abort signal.
 * Resolves with the answer, resolves undefined on timeout or handler failure
 * (a broken answer UI must never kill the branch), rejects on abort.
 */
async function waitForAnswer(
  ask: QuestionHandler,
  question: HumanQuestion,
  timeoutMs: number,
  signal: AbortSignal | undefined
): Promise<string | undefined> {
  return await new Promise<string | undefined>((resolve, reject) => {
    let settled = false;
    const onAbort = (): void => settle(() => reject(abortError()));
    // `settle` and `timer` reference each other; both are only ever *called*
    // after this scope finishes initializing, so the forward reference is safe.
    const settle = (finish: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      finish();
    };
    const timer = setTimeout(() => settle(() => resolve(undefined)), timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    void (async () => {
      try {
        const answer = await ask(question);
        settle(() => resolve(answer));
      } catch {
        settle(() => resolve(undefined));
      }
    })();
  });
}
