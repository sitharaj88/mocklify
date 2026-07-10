import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  CHAT_PERSIST_ACTIONS_MAX,
  CHAT_PERSIST_ACTION_SUMMARY_MAX_CHARS,
  CHAT_PERSIST_ASSISTANT_TEXT_MAX_CHARS,
  CHAT_PERSIST_DEBOUNCE_MS,
  CHAT_PERSIST_ERROR_MESSAGE_MAX_CHARS,
  CHAT_PERSIST_KEY,
  CHAT_PERSIST_MAX_BYTES,
  CHAT_PERSIST_PROGRESS_LINE_MAX_CHARS,
  CHAT_PERSIST_VERSION,
  CHAT_SESSIONS_MAX,
  ChatSessionStore,
  applyPersistCaps,
  deriveSessionTitle,
  emptyPersistedChatState,
  fromPersistedMessages,
  parsePersistedChatState,
  toPersistedMessages,
  type ChatStateStorage,
  type PersistedChatMessage,
  type PersistedChatSession,
  type PersistedChatState,
} from '../src/ai/chat/chatSessionStore';
import {
  CHAT_SESSION_DEFAULT_TITLE,
  CHAT_SESSION_TITLE_MAX_CHARS,
  CHAT_TRANSCRIPT_MAX_MESSAGES,
  type ChatAssistantMessage,
  type ChatMessage,
  type ChatUndoState,
} from '../src/ai/chat/chatProtocol';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

class MemStorage implements ChatStateStorage {
  data = new Map<string, unknown>();
  writes = 0;
  get(k: string): unknown {
    return this.data.get(k);
  }
  update(k: string, v: unknown): unknown {
    this.writes += 1;
    this.data.set(k, structuredClone(v));
    return undefined;
  }
}

function userMessage(id: string, text = 'hello', createdAt = 1): PersistedChatMessage {
  return { id, role: 'user', text, createdAt };
}

function assistantMessage(
  id: string,
  overrides: Partial<Extract<PersistedChatMessage, { role: 'assistant' }>> = {}
): PersistedChatMessage {
  return {
    id,
    role: 'assistant',
    status: 'complete',
    text: 'Done.',
    progress: [],
    actions: [],
    createdAt: 2,
    ...overrides,
  };
}

function session(id: string, updatedAt: number, messages: PersistedChatMessage[] = []): PersistedChatSession {
  return { id, title: `Session ${id}`, createdAt: 1, updatedAt, messages };
}

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Constants + empty state
// ---------------------------------------------------------------------------

describe('chatSessionStore constants', () => {
  it('exposes the documented values', () => {
    expect(CHAT_PERSIST_VERSION).toBe(1);
    expect(CHAT_PERSIST_KEY).toBe('mocklify.chat.v1');
    expect(CHAT_PERSIST_DEBOUNCE_MS).toBe(750);
    expect(CHAT_PERSIST_MAX_BYTES).toBe(512_000);
    expect(CHAT_SESSIONS_MAX).toBe(30);
    expect(CHAT_PERSIST_ASSISTANT_TEXT_MAX_CHARS).toBe(20_000);
    expect(CHAT_PERSIST_PROGRESS_LINE_MAX_CHARS).toBe(500);
    expect(CHAT_PERSIST_ACTION_SUMMARY_MAX_CHARS).toBe(300);
    expect(CHAT_PERSIST_ACTIONS_MAX).toBe(40);
  });

  it('emptyPersistedChatState returns the canonical empty blob', () => {
    expect(emptyPersistedChatState()).toEqual({ version: 1, activeSessionId: null, sessions: [] });
  });
});

// ---------------------------------------------------------------------------
// Round trip
// ---------------------------------------------------------------------------

describe('ChatSessionStore round trip', () => {
  it('saveImmediate → load deep-equals the (post-cap) state', () => {
    const storage = new MemStorage();
    const store = new ChatSessionStore({ storage });
    const state: PersistedChatState = {
      version: 1,
      activeSessionId: 's-2',
      sessions: [
        session('s-2', 20, [
          userMessage('u-1', 'add a route'),
          assistantMessage('a-1', {
            text: 'Added it.',
            progress: ['Server agent: adding…'],
            actions: [{ kind: 'add_route', summary: 'Added 1 route(s)', serverName: 'Payments' }],
            undoState: 'expired',
          }),
        ]),
        session('s-1', 10, [
          userMessage('u-0', 'hi'),
          assistantMessage('a-0', { status: 'error', text: '', errorMessage: 'boom' }),
        ]),
      ],
    };

    store.saveImmediate(state);
    expect(store.load()).toEqual(state);
  });
});

// ---------------------------------------------------------------------------
// Corruption matrix
// ---------------------------------------------------------------------------

describe('parsePersistedChatState corruption handling', () => {
  it('collapses undefined, non-objects, wrong versions, and non-array sessions to empty', () => {
    expect(parsePersistedChatState(undefined)).toEqual(emptyPersistedChatState());
    expect(parsePersistedChatState('garbage')).toEqual(emptyPersistedChatState());
    expect(parsePersistedChatState(42)).toEqual(emptyPersistedChatState());
    expect(parsePersistedChatState([])).toEqual(emptyPersistedChatState());
    expect(parsePersistedChatState({ version: 2, activeSessionId: null, sessions: [] })).toEqual(
      emptyPersistedChatState()
    );
    expect(parsePersistedChatState({ version: 1, activeSessionId: null, sessions: 'x' })).toEqual(
      emptyPersistedChatState()
    );
  });

  it('skips sessions missing id/title/timestamps and keeps the valid ones', () => {
    const good = session('s-1', 10, [userMessage('u-1')]);
    const parsed = parsePersistedChatState({
      version: 1,
      activeSessionId: 's-1',
      sessions: [
        good,
        { title: 'no id', createdAt: 1, updatedAt: 2, messages: [] },
        { id: 's-3', createdAt: 1, updatedAt: 2, messages: [] },
        { id: 's-4', title: 'bad times', createdAt: 'x', updatedAt: 2, messages: [] },
        { id: 's-5', title: 'nan', createdAt: 1, updatedAt: Number.NaN, messages: [] },
        null,
        'junk',
      ],
    });
    expect(parsed.sessions).toEqual([good]);
    expect(parsed.activeSessionId).toBe('s-1');
  });

  it('skips messages with status running, non-string text, or unknown roles', () => {
    const parsed = parsePersistedChatState({
      version: 1,
      activeSessionId: null,
      sessions: [
        session('s-1', 10, [
          userMessage('u-1'),
          assistantMessage('a-run', { status: 'running' as never }),
          { id: 'u-2', role: 'user', text: 42, createdAt: 1 } as never,
          { id: 'x-1', role: 'system', text: 'x', createdAt: 1 } as never,
          assistantMessage('a-1'),
        ]),
      ],
    });
    expect(parsed.sessions[0]!.messages.map((m) => m.id)).toEqual(['u-1', 'a-1']);
  });

  it('drops undoState values other than undone/expired', () => {
    const parsed = parsePersistedChatState({
      version: 1,
      activeSessionId: null,
      sessions: [
        session('s-1', 10, [
          assistantMessage('a-1', { undoState: 'available' as never }),
          assistantMessage('a-2', { undoState: 'undone' }),
        ]),
      ],
    });
    const [first, second] = parsed.sessions[0]!.messages as Extract<
      PersistedChatMessage,
      { role: 'assistant' }
    >[];
    expect('undoState' in first!).toBe(false);
    expect(second!.undoState).toBe('undone');
  });

  it('load(): storage.get that throws → empty state + onWarning', () => {
    const warnings: string[] = [];
    const store = new ChatSessionStore({
      storage: {
        get: () => {
          throw new Error('memento exploded');
        },
        update: () => undefined,
      },
      onWarning: (message) => warnings.push(message),
    });
    expect(store.load()).toEqual(emptyPersistedChatState());
    expect(warnings).toHaveLength(1);
  });

  it('load(): a get returning undefined or a string reads as empty', () => {
    const storage = new MemStorage();
    const store = new ChatSessionStore({ storage });
    expect(store.load()).toEqual(emptyPersistedChatState());
    storage.data.set(CHAT_PERSIST_KEY, 'not an object');
    expect(store.load()).toEqual(emptyPersistedChatState());
  });
});

// ---------------------------------------------------------------------------
// Caps on parse
// ---------------------------------------------------------------------------

describe('parsePersistedChatState caps', () => {
  it('keeps the newest 200 of 201 messages', () => {
    const messages = Array.from({ length: CHAT_TRANSCRIPT_MAX_MESSAGES + 1 }, (_, i) =>
      userMessage(`u-${i}`, `m${i}`)
    );
    const parsed = parsePersistedChatState({
      version: 1,
      activeSessionId: null,
      sessions: [session('s-1', 1, messages)],
    });
    const kept = parsed.sessions[0]!.messages;
    expect(kept).toHaveLength(CHAT_TRANSCRIPT_MAX_MESSAGES);
    expect(kept[0]!.id).toBe('u-1'); // oldest dropped
    expect(kept.at(-1)!.id).toBe(`u-${CHAT_TRANSCRIPT_MAX_MESSAGES}`);
  });

  it('keeps the 30 newest-updated of 31 sessions and nulls an evicted activeSessionId', () => {
    const sessions = Array.from({ length: CHAT_SESSIONS_MAX + 1 }, (_, i) => session(`s-${i}`, i));
    const parsed = parsePersistedChatState({
      version: 1,
      activeSessionId: 's-0', // the least-recently-updated — evicted
      sessions,
    });
    expect(parsed.sessions).toHaveLength(CHAT_SESSIONS_MAX);
    expect(parsed.sessions[0]!.id).toBe(`s-${CHAT_SESSIONS_MAX}`); // updatedAt desc
    expect(parsed.sessions.some((s) => s.id === 's-0')).toBe(false);
    expect(parsed.activeSessionId).toBeNull();
  });

  it('clamps titles over 48 chars with an ellipsis', () => {
    const parsed = parsePersistedChatState({
      version: 1,
      activeSessionId: null,
      sessions: [{ ...session('s-1', 1), title: 't'.repeat(CHAT_SESSION_TITLE_MAX_CHARS + 10) }],
    });
    expect(parsed.sessions[0]!.title).toBe(`${'t'.repeat(CHAT_SESSION_TITLE_MAX_CHARS)}…`);
  });

  it('applies the per-field slices to oversized message fields', () => {
    const parsed = parsePersistedChatState({
      version: 1,
      activeSessionId: null,
      sessions: [
        session('s-1', 1, [
          assistantMessage('a-1', {
            text: 'x'.repeat(CHAT_PERSIST_ASSISTANT_TEXT_MAX_CHARS + 100),
            progress: ['p'.repeat(CHAT_PERSIST_PROGRESS_LINE_MAX_CHARS + 100)],
            actions: Array.from({ length: CHAT_PERSIST_ACTIONS_MAX + 5 }, () => ({
              kind: 'add_route',
              summary: 's'.repeat(CHAT_PERSIST_ACTION_SUMMARY_MAX_CHARS + 100),
              serverName: 'S',
            })),
            errorMessage: 'e'.repeat(CHAT_PERSIST_ERROR_MESSAGE_MAX_CHARS + 100),
          }),
        ]),
      ],
    });
    const message = parsed.sessions[0]!.messages[0] as Extract<
      PersistedChatMessage,
      { role: 'assistant' }
    >;
    expect(message.text).toHaveLength(CHAT_PERSIST_ASSISTANT_TEXT_MAX_CHARS);
    expect(message.progress[0]).toHaveLength(CHAT_PERSIST_PROGRESS_LINE_MAX_CHARS);
    expect(message.actions).toHaveLength(CHAT_PERSIST_ACTIONS_MAX);
    expect(message.actions[0]!.summary).toHaveLength(CHAT_PERSIST_ACTION_SUMMARY_MAX_CHARS);
    expect(message.errorMessage).toHaveLength(CHAT_PERSIST_ERROR_MESSAGE_MAX_CHARS);
  });
});

// ---------------------------------------------------------------------------
// Oversize eviction (applyPersistCaps)
// ---------------------------------------------------------------------------

describe('applyPersistCaps', () => {
  it('evicts the non-active least-recently-updated sessions first', () => {
    const big = (id: string, updatedAt: number): PersistedChatSession =>
      session(id, updatedAt, [userMessage(`${id}-m`, 'x'.repeat(300))]);
    const state: PersistedChatState = {
      version: 1,
      activeSessionId: 's-active',
      sessions: [big('s-active', 5), big('s-old', 1), big('s-newer', 3)],
    };
    // Big enough for exactly one big session, so both non-active ones go.
    const capped = applyPersistCaps(state, 600);
    expect(capped.sessions.map((s) => s.id)).toEqual(['s-active']);
    expect(capped.activeSessionId).toBe('s-active');
    // Input untouched (pure — operates on a clone).
    expect(state.sessions).toHaveLength(3);
  });

  it('halves the oldest messages of a single remaining active session', () => {
    const messages = Array.from({ length: 8 }, (_, i) => userMessage(`m-${i}`, 'y'.repeat(200)));
    const state: PersistedChatState = {
      version: 1,
      activeSessionId: 's-1',
      sessions: [session('s-1', 1, messages)],
    };
    const capped = applyPersistCaps(state, 1_200);
    const kept = capped.sessions[0]!.messages;
    expect(kept.length).toBeLessThan(8);
    // Newest survive: the kept slice is a suffix of the original.
    expect(kept.at(-1)!.id).toBe('m-7');
    expect(kept[0]!.id).toBe(`m-${8 - kept.length}`);
  });

  it('degenerates to an empty sessions array when even zero messages is too big', () => {
    const state: PersistedChatState = {
      version: 1,
      activeSessionId: 's-1',
      sessions: [session('s-1', 1, [userMessage('m-1')])],
    };
    expect(applyPersistCaps(state, 10)).toEqual({
      version: 1,
      activeSessionId: 's-1',
      sessions: [],
    });
  });

  it('returns the clone untouched when already under the cap', () => {
    const state = emptyPersistedChatState();
    expect(applyPersistCaps(state, CHAT_PERSIST_MAX_BYTES)).toEqual(state);
  });
});

// ---------------------------------------------------------------------------
// Debounce
// ---------------------------------------------------------------------------

describe('ChatSessionStore debounce', () => {
  it('two saves 100 ms apart → exactly one write of the SECOND state after the window', () => {
    vi.useFakeTimers();
    const storage = new MemStorage();
    const store = new ChatSessionStore({ storage });
    const first: PersistedChatState = { version: 1, activeSessionId: 'a', sessions: [] };
    const second: PersistedChatState = { version: 1, activeSessionId: 'b', sessions: [] };

    store.save(first);
    vi.advanceTimersByTime(100);
    store.save(second);
    expect(storage.writes).toBe(0);

    vi.advanceTimersByTime(750);
    expect(storage.writes).toBe(1);
    expect(storage.data.get(CHAT_PERSIST_KEY)).toEqual(second);
  });

  it('saveImmediate cancels a pending timer (no second write later)', () => {
    vi.useFakeTimers();
    const storage = new MemStorage();
    const store = new ChatSessionStore({ storage });
    store.save({ version: 1, activeSessionId: 'debounced', sessions: [] });
    store.saveImmediate({ version: 1, activeSessionId: 'now', sessions: [] });
    expect(storage.writes).toBe(1);
    expect((storage.data.get(CHAT_PERSIST_KEY) as PersistedChatState).activeSessionId).toBe('now');

    vi.advanceTimersByTime(10_000);
    expect(storage.writes).toBe(1);
  });

  it('dispose flushes a pending write exactly once (idempotent)', () => {
    vi.useFakeTimers();
    const storage = new MemStorage();
    const store = new ChatSessionStore({ storage });
    store.save({ version: 1, activeSessionId: 'pending', sessions: [] });
    expect(storage.writes).toBe(0);

    store.dispose();
    expect(storage.writes).toBe(1);
    expect((storage.data.get(CHAT_PERSIST_KEY) as PersistedChatState).activeSessionId).toBe('pending');

    store.dispose();
    vi.advanceTimersByTime(10_000);
    expect(storage.writes).toBe(1);
  });

  it('a storage.update that throws is swallowed and reported via onWarning', () => {
    const warnings: string[] = [];
    const store = new ChatSessionStore({
      storage: {
        get: () => undefined,
        update: () => {
          throw new Error('quota');
        },
      },
      onWarning: (message) => warnings.push(message),
    });
    expect(() => store.saveImmediate(emptyPersistedChatState())).not.toThrow();
    expect(warnings).toEqual(['Mocklify chat history could not be saved.']);
  });
});

// ---------------------------------------------------------------------------
// Message mapping
// ---------------------------------------------------------------------------

describe('toPersistedMessages / fromPersistedMessages', () => {
  const liveAssistant = (undoState: ChatUndoState): ChatAssistantMessage => ({
    id: 'a-1',
    role: 'assistant',
    status: 'complete',
    progress: ['line'],
    text: 'Done.',
    actions: [{ kind: 'add_route', summary: 'Added', serverName: 'S' }],
    undo: { undoId: 'undo-1', state: undoState, ...(undoState === 'failed' ? { error: 'x' } : {}) },
    createdAt: 5,
  });

  it.each(['available', 'undoing', 'failed', 'expired'] as const)(
    'maps live undo state %s to persisted undoState expired',
    (state) => {
      const [persisted] = toPersistedMessages([liveAssistant(state)]);
      expect((persisted as { undoState?: string }).undoState).toBe('expired');
    }
  );

  it('maps undone to undone and omits undoState when undo is absent', () => {
    const [persisted] = toPersistedMessages([liveAssistant('undone')]);
    expect((persisted as { undoState?: string }).undoState).toBe('undone');

    const noUndo: ChatMessage = { ...liveAssistant('undone') };
    delete (noUndo as { undo?: unknown }).undo;
    const [bare] = toPersistedMessages([noUndo]);
    expect('undoState' in bare!).toBe(false);
  });

  it('clamps an oversized errorMessage on serialize (no single message can blow the blob cap)', () => {
    const failed: ChatMessage = {
      id: 'a-err',
      role: 'assistant',
      status: 'error',
      progress: [],
      text: '',
      errorMessage: 'x'.repeat(CHAT_PERSIST_ERROR_MESSAGE_MAX_CHARS + 5_000),
      actions: [],
      createdAt: 1,
    };
    const [persisted] = toPersistedMessages([failed]);
    expect((persisted as { errorMessage?: string }).errorMessage).toHaveLength(
      CHAT_PERSIST_ERROR_MESSAGE_MAX_CHARS
    );
  });

  it('defensively skips running assistant messages', () => {
    const running: ChatMessage = {
      id: 'a-run',
      role: 'assistant',
      status: 'running',
      progress: [],
      text: '',
      actions: [],
      createdAt: 1,
    };
    expect(toPersistedMessages([running])).toEqual([]);
  });

  it('fromPersistedMessages rehydrates undoState into a synthetic expired- undo', () => {
    const rehydrated = fromPersistedMessages([
      assistantMessage('a-1', { undoState: 'expired' }),
      assistantMessage('a-2', { undoState: 'undone' }),
      assistantMessage('a-3'),
      userMessage('u-1'),
    ]);
    expect((rehydrated[0] as ChatAssistantMessage).undo).toEqual({
      undoId: 'expired-a-1',
      state: 'expired',
    });
    expect((rehydrated[1] as ChatAssistantMessage).undo).toEqual({
      undoId: 'expired-a-2',
      state: 'undone',
    });
    expect('undo' in rehydrated[2]!).toBe(false);
    expect(rehydrated[3]).toEqual({ id: 'u-1', role: 'user', text: 'hello', createdAt: 1 });
  });

  it('round-trips a completed turn through both mappers', () => {
    const live: ChatMessage[] = [
      { id: 'u-1', role: 'user', text: 'add', createdAt: 1 },
      liveAssistant('undone'),
    ];
    const back = fromPersistedMessages(toPersistedMessages(live));
    expect(back[0]).toEqual(live[0]);
    const assistant = back[1] as ChatAssistantMessage;
    expect(assistant.text).toBe('Done.');
    expect(assistant.undo).toEqual({ undoId: 'expired-a-1', state: 'undone' });
  });
});

// ---------------------------------------------------------------------------
// deriveSessionTitle
// ---------------------------------------------------------------------------

describe('deriveSessionTitle', () => {
  it('collapses multiline prompts to one line', () => {
    expect(deriveSessionTitle('add a route\nfor payments')).toBe('add a route for payments');
  });

  it('clamps prompts over 48 chars with an ellipsis', () => {
    expect(deriveSessionTitle('p'.repeat(CHAT_SESSION_TITLE_MAX_CHARS + 30))).toBe(
      `${'p'.repeat(CHAT_SESSION_TITLE_MAX_CHARS)}…`
    );
  });

  it('falls back to the default title for whitespace-only input', () => {
    expect(deriveSessionTitle('   \n\t ')).toBe(CHAT_SESSION_DEFAULT_TITLE);
    expect(deriveSessionTitle('')).toBe(CHAT_SESSION_DEFAULT_TITLE);
  });
});
