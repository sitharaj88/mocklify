import { describe, it, expect } from 'vitest';
import {
  ASK_USER_ANSWER_MAX_CHARS,
  ASK_USER_BUDGET_MESSAGE,
  ASK_USER_INVALID_MESSAGE,
  ASK_USER_MAX_OPTIONS,
  ASK_USER_OPTION_MAX_CHARS,
  ASK_USER_QUESTION_MAX_CHARS,
  ASK_USER_TOOL,
  MAX_QUESTIONS_PER_SURFACE,
  NO_ANSWER_FALLBACK,
  createAskUserState,
  executeAskUser,
  sanitizeAskUserInput,
} from '../src/ai/agent/askUser';
import type { HumanQuestion } from '../src/ai/agent/graphRuntime';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('ASK_USER_TOOL', () => {
  it('is a strict-dialect tool with a prescriptive description', () => {
    expect(ASK_USER_TOOL.name).toBe('ask_user');
    expect(ASK_USER_TOOL.description).toContain('ONLY when a decision materially changes the mock');
    expect(ASK_USER_TOOL.description).toContain('Never ask about things you can read');
    expect(ASK_USER_TOOL.inputSchema).toMatchObject({
      type: 'object',
      required: ['question'],
      additionalProperties: false,
    });
    // Strict schema dialect: option cardinality lives in the description, not minItems/maxItems.
    expect(JSON.stringify(ASK_USER_TOOL.inputSchema)).not.toMatch(/minItems|maxItems|minLength|maxLength/);
  });
});

describe('sanitizeAskUserInput', () => {
  it('flattens the question to one bounded line', () => {
    const input = sanitizeAskUserInput({ question: '  Which auth\n\tflow   should\r\nI mock?  ' });
    expect(input?.question).toBe('Which auth flow should I mock?');
    const long = sanitizeAskUserInput({ question: 'x'.repeat(500) });
    expect(long?.question.length).toBeLessThanOrEqual(ASK_USER_QUESTION_MAX_CHARS + 1);
    expect(long?.question.endsWith('…')).toBe(true);
  });

  it('rejects inputs without a usable question', () => {
    expect(sanitizeAskUserInput(null)).toBeUndefined();
    expect(sanitizeAskUserInput('Which?')).toBeUndefined();
    expect(sanitizeAskUserInput({})).toBeUndefined();
    expect(sanitizeAskUserInput({ question: 42 })).toBeUndefined();
    expect(sanitizeAskUserInput({ question: '   \n ' })).toBeUndefined();
  });

  it('sanitizes options: dedupes, bounds each line, keeps 2-4, drops fewer', () => {
    const input = sanitizeAskUserInput({
      question: 'Pick one?',
      options: ['  OAuth\n2.0 ', 'API key', 'OAuth 2.0', 7, '', 'y'.repeat(200), 'Basic', 'Extra fifth'],
    });
    expect(input?.options).toHaveLength(ASK_USER_MAX_OPTIONS);
    expect(input?.options?.[0]).toBe('OAuth 2.0');
    expect(input?.options?.[1]).toBe('API key');
    for (const option of input?.options ?? []) {
      expect(option.length).toBeLessThanOrEqual(ASK_USER_OPTION_MAX_CHARS + 1);
      expect(option).not.toContain('\n');
    }
    // A single usable option is dropped entirely — the question goes free-text.
    expect(sanitizeAskUserInput({ question: 'Pick?', options: ['only one'] })?.options).toBeUndefined();
    expect(sanitizeAskUserInput({ question: 'Pick?', options: 'a,b' })?.options).toBeUndefined();
  });
});

describe('executeAskUser', () => {
  it('round-trips: sanitized question to the handler, answer back to the model', async () => {
    const state = createAskUserState();
    const questions: HumanQuestion[] = [];
    const result = await executeAskUser(
      state,
      { question: ' Which\nbase URL? ', options: ['https://api.a', 'https://api.b'] },
      {
        ask: (question) => {
          questions.push(question);
          return 'https://api.a';
        },
      }
    );
    expect(questions).toHaveLength(1);
    expect(questions[0].question).toBe('Which base URL?');
    expect(questions[0].options).toEqual(['https://api.a', 'https://api.b']);
    expect(questions[0].freeText).toBe(true);
    expect(questions[0].id).not.toBe('');
    expect(result).toContain('The user answered: "https://api.a"');
    expect(state.asked).toBe(1);
  });

  it('sanitizes the answer to one bounded line and treats empty as no answer', async () => {
    const state = createAskUserState();
    const messy = await executeAskUser(state, { question: 'q?' }, { ask: () => ' line one\nline two ' });
    expect(messy).toContain('"line one line two"');
    const huge = await executeAskUser(state, { question: 'q?' }, { ask: () => 'z'.repeat(2000) });
    expect(huge.length).toBeLessThanOrEqual(ASK_USER_ANSWER_MAX_CHARS + 100);
    const state2 = createAskUserState();
    expect(await executeAskUser(state2, { question: 'q?' }, { ask: () => '   ' })).toBe(NO_ANSWER_FALLBACK);
  });

  it('resumes with the no-answer fallback when the human never answers in time', async () => {
    const state = createAskUserState();
    const result = await executeAskUser(
      state,
      { question: 'Anyone there?' },
      { ask: () => new Promise<string>(() => undefined), timeoutMs: 15 }
    );
    expect(result).toBe(NO_ANSWER_FALLBACK);
    expect(state.asked).toBe(1); // a timed-out question still burns budget
  });

  it('falls back instead of failing the branch when the answer UI throws', async () => {
    const result = await executeAskUser(createAskUserState(), { question: 'q?' }, {
      ask: () => {
        throw new Error('QuickPick exploded');
      },
    });
    expect(result).toBe(NO_ANSWER_FALLBACK);
  });

  it('enforces the per-surface question cap without calling the handler again', async () => {
    const state = createAskUserState();
    let handled = 0;
    const ask = (): string => {
      handled += 1;
      return `answer ${handled}`;
    };
    for (let i = 0; i < MAX_QUESTIONS_PER_SURFACE; i++) {
      expect(await executeAskUser(state, { question: `q${i}?` }, { ask })).toContain(`answer ${i + 1}`);
    }
    expect(await executeAskUser(state, { question: 'one more?' }, { ask })).toBe(ASK_USER_BUDGET_MESSAGE);
    expect(handled).toBe(MAX_QUESTIONS_PER_SURFACE);
    expect(state.asked).toBe(MAX_QUESTIONS_PER_SURFACE);
  });

  it('rejects malformed calls without burning budget or bothering the human', async () => {
    const state = createAskUserState();
    let handled = 0;
    const result = await executeAskUser(state, { prompt: 'wrong field' }, {
      ask: () => {
        handled += 1;
        return 'never';
      },
    });
    expect(result).toBe(ASK_USER_INVALID_MESSAGE);
    expect(handled).toBe(0);
    expect(state.asked).toBe(0);
  });

  it('aborts cleanly when cancelled during a pending question', async () => {
    const controller = new AbortController();
    const pending = executeAskUser(
      createAskUserState(),
      { question: 'q?' },
      { ask: () => new Promise<string>(() => undefined), signal: controller.signal, timeoutMs: 5_000 }
    );
    await sleep(10);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects immediately on a pre-cancelled signal, before asking anything', async () => {
    const controller = new AbortController();
    controller.abort();
    let handled = 0;
    await expect(
      executeAskUser(createAskUserState(), { question: 'q?' }, {
        ask: () => {
          handled += 1;
          return 'never';
        },
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(handled).toBe(0);
  });
});
