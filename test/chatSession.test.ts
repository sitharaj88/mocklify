import { describe, it, expect } from 'vitest';
import { ChatSession, type ChatSessionOptions } from '../src/ai/chat/chatSession';
import {
  CHAT_INPUT_MAX_CHARS,
  CHAT_PROGRESS_MAX_LINES,
  type ChatAssistantMessage,
  type ChatConfirmRequest,
  type ChatMessageFromExtension,
  type ChatViewState,
} from '../src/ai/chat/chatProtocol';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function createSession(options?: Partial<ChatSessionOptions> & { detached?: boolean }) {
  let counter = 0;
  const posts: ChatMessageFromExtension[] = [];
  const session = new ChatSession({
    createId: () => `id-${++counter}`,
    now: () => 42,
    ...(options?.maxMessages !== undefined ? { maxMessages: options.maxMessages } : {}),
  });
  if (!options?.detached) {
    session.attach((message) => posts.push(message));
  }
  return { session, posts };
}

function confirmRequest(id = 'confirm-1'): ChatConfirmRequest {
  return { id, title: 'Add route', detail: 'GET /pay → 200', createdAt: 42, timeoutMs: 5_000 };
}

const ACTION = { kind: 'add_route', summary: 'Added 1 route(s): GET /pay', serverName: 'Payments' };

/** Rebuild a ChatViewState by replaying posted messages (the webview algorithm). */
function replay(posts: ChatMessageFromExtension[]): ChatViewState {
  let state: ChatViewState = { messages: [], running: false };
  for (const post of posts) {
    switch (post.type) {
      case 'chatState':
        state = structuredClone(post.state);
        break;
      case 'chatUserMessage':
        state.messages.push(structuredClone(post.message));
        break;
      case 'chatAssistantUpdate': {
        const message = structuredClone(post.message);
        const index = state.messages.findIndex((m) => m.id === message.id);
        if (index === -1) {
          state.messages.push(message);
        } else {
          state.messages[index] = message;
        }
        state.running = message.status === 'running';
        break;
      }
      case 'chatConfirmRequest':
        state.pendingConfirm = structuredClone(post.request);
        break;
      case 'chatConfirmResolved':
        if (state.pendingConfirm?.id === post.id) {
          delete state.pendingConfirm;
        }
        break;
      case 'chatFocus':
        break;
    }
  }
  return state;
}

// ---------------------------------------------------------------------------
// Turn lifecycle
// ---------------------------------------------------------------------------

describe('ChatSession turn lifecycle', () => {
  it('beginTurn appends user + running assistant and posts both in order', () => {
    const { session, posts } = createSession();
    const handles = session.beginTurn('  add a route  ');

    expect(handles).toEqual({ userId: 'id-1', assistantId: 'id-2' });
    expect(session.running).toBe(true);
    expect(posts.map((p) => p.type)).toEqual(['chatUserMessage', 'chatAssistantUpdate']);
    expect(posts[0]).toEqual({
      type: 'chatUserMessage',
      message: { id: 'id-1', role: 'user', text: 'add a route', createdAt: 42 },
    });
    expect(posts[1]).toEqual({
      type: 'chatAssistantUpdate',
      message: {
        id: 'id-2',
        role: 'assistant',
        status: 'running',
        progress: [],
        text: '',
        actions: [],
        createdAt: 42,
      },
    });
  });

  it('beginTurn slices oversized text to CHAT_INPUT_MAX_CHARS', () => {
    const { session } = createSession();
    session.beginTurn('x'.repeat(CHAT_INPUT_MAX_CHARS + 100));
    const user = session.state().messages[0]!;
    expect(user.role).toBe('user');
    expect((user as { text: string }).text).toHaveLength(CHAT_INPUT_MAX_CHARS);
  });

  it('beginTurn refuses empty text and running turns without posting', () => {
    const { session, posts } = createSession();
    expect(session.beginTurn('   ')).toBeUndefined();
    expect(posts).toHaveLength(0);

    session.beginTurn('first');
    posts.length = 0;
    expect(session.beginTurn('second')).toBeUndefined();
    expect(posts).toHaveLength(0);
    expect(session.state().messages).toHaveLength(2);
  });

  it('appendProgress appends lines, caps at CHAT_PROGRESS_MAX_LINES, posts full messages', () => {
    const { session, posts } = createSession();
    session.beginTurn('go');
    posts.length = 0;

    for (let i = 0; i < CHAT_PROGRESS_MAX_LINES + 5; i += 1) {
      session.appendProgress(`line ${i}`);
    }

    expect(posts).toHaveLength(CHAT_PROGRESS_MAX_LINES + 5);
    const last = posts.at(-1)!;
    expect(last.type).toBe('chatAssistantUpdate');
    const message = (last as { message: ChatAssistantMessage }).message;
    expect(message.progress).toHaveLength(CHAT_PROGRESS_MAX_LINES);
    expect(message.progress[0]).toBe('line 5'); // oldest dropped
    expect(message.progress.at(-1)).toBe(`line ${CHAT_PROGRESS_MAX_LINES + 4}`);
    expect(message.status).toBe('running');
  });

  it('appendProgress is a no-op when no turn is running', () => {
    const { session, posts } = createSession();
    session.appendProgress('orphan');
    expect(posts).toHaveLength(0);
  });

  it('posted assistant messages do not alias later mutations', () => {
    const { session, posts } = createSession();
    session.beginTurn('go');
    session.appendProgress('one');
    session.appendProgress('two');
    const first = posts[2] as { message: ChatAssistantMessage };
    expect(first.message.progress).toEqual(['one']);
  });

  it('completeTurn finishes with status/text/actions/undo and clears running', () => {
    const { session, posts } = createSession();
    session.beginTurn('go');
    posts.length = 0;

    session.completeTurn({ status: 'complete', text: 'Done.', actions: [ACTION], undoId: 'undo-1' });

    expect(session.running).toBe(false);
    const message = (posts[0] as { message: ChatAssistantMessage }).message;
    expect(message.status).toBe('complete');
    expect(message.text).toBe('Done.');
    expect(message.actions).toEqual([ACTION]);
    expect(message.undo).toEqual({ undoId: 'undo-1', state: 'available' });
    expect(message.errorMessage).toBeUndefined();
  });

  it('completeTurn without an undoId leaves undo absent', () => {
    const { session } = createSession();
    session.beginTurn('go');
    session.completeTurn({ status: 'cancelled', text: 'Stopped.', actions: [] });
    const assistant = session.state().messages[1] as ChatAssistantMessage;
    expect(assistant.status).toBe('cancelled');
    expect(assistant.undo).toBeUndefined();
    expect('undo' in assistant).toBe(false);
  });

  it('failTurn sets error status + message, keeps partial actions and undo', () => {
    const { session, posts } = createSession();
    session.beginTurn('go');
    posts.length = 0;

    session.failTurn('model exploded', [ACTION], 'undo-1');

    expect(session.running).toBe(false);
    const message = (posts[0] as { message: ChatAssistantMessage }).message;
    expect(message.status).toBe('error');
    expect(message.errorMessage).toBe('model exploded');
    expect(message.text).toBe('');
    expect(message.actions).toEqual([ACTION]);
    expect(message.undo).toEqual({ undoId: 'undo-1', state: 'available' });
  });

  it('completeTurn / failTurn are no-ops when idle', () => {
    const { session, posts } = createSession();
    session.completeTurn({ status: 'complete', text: 'x', actions: [] });
    session.failTurn('x', []);
    expect(posts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Sink attach/detach + sync
// ---------------------------------------------------------------------------

describe('ChatSession sink and sync', () => {
  it('mutates silently while detached and replays via sync after attach', () => {
    const { session } = createSession({ detached: true });
    session.beginTurn('offline turn');
    session.completeTurn({ status: 'complete', text: 'Done offline.', actions: [] });

    const posts: ChatMessageFromExtension[] = [];
    session.attach((message) => posts.push(message));
    expect(posts).toHaveLength(0); // attach does not auto-post
    session.sync();
    expect(posts).toEqual([{ type: 'chatState', state: session.state() }]);
    expect((posts[0] as { state: ChatViewState }).state.messages).toHaveLength(2);
  });

  it('detach stops posting', () => {
    const { session, posts } = createSession();
    session.detach();
    session.beginTurn('quiet');
    session.sync();
    expect(posts).toHaveLength(0);
  });

  it('state() is a deep clone', () => {
    const { session } = createSession();
    session.beginTurn('go');
    const snapshot = session.state();
    (snapshot.messages[0] as { text: string }).text = 'tampered';
    expect((session.state().messages[0] as { text: string }).text).toBe('go');
  });
});

// ---------------------------------------------------------------------------
// Confirm mirroring
// ---------------------------------------------------------------------------

describe('ChatSession confirm mirroring', () => {
  it('requestConfirm sets pendingConfirm and posts chatConfirmRequest', () => {
    const { session, posts } = createSession();
    const request = confirmRequest();
    session.requestConfirm(request);
    expect(session.state().pendingConfirm).toEqual(request);
    expect(posts).toEqual([{ type: 'chatConfirmRequest', request }]);
  });

  it('resolveConfirm clears a matching pending request and posts chatConfirmResolved', () => {
    const { session, posts } = createSession();
    session.requestConfirm(confirmRequest());
    posts.length = 0;

    session.resolveConfirm('confirm-1', true, 'user');
    expect(session.state().pendingConfirm).toBeUndefined();
    expect(posts).toEqual([
      { type: 'chatConfirmResolved', id: 'confirm-1', approved: true, reason: 'user' },
    ]);
  });

  it('resolveConfirm for a non-matching id posts but keeps the pending request', () => {
    const { session, posts } = createSession();
    session.requestConfirm(confirmRequest('confirm-2'));
    posts.length = 0;

    session.resolveConfirm('confirm-1', false, 'timeout');
    expect(session.state().pendingConfirm?.id).toBe('confirm-2');
    expect(posts).toEqual([
      { type: 'chatConfirmResolved', id: 'confirm-1', approved: false, reason: 'timeout' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Undo state
// ---------------------------------------------------------------------------

describe('ChatSession.setUndoState', () => {
  function finishedTurn(session: ChatSession, text: string, undoId: string): void {
    session.beginTurn(text);
    session.completeTurn({ status: 'complete', text: `${text} done`, actions: [ACTION], undoId });
  }

  it('mutates exactly the message owning the undoId and posts it', () => {
    const { session, posts } = createSession();
    finishedTurn(session, 'first', 'undo-1');
    finishedTurn(session, 'second', 'undo-2');
    posts.length = 0;

    session.setUndoState('undo-1', 'undoing');
    expect(posts).toHaveLength(1);
    const message = (posts[0] as { message: ChatAssistantMessage }).message;
    expect(message.undo).toEqual({ undoId: 'undo-1', state: 'undoing' });

    const state = session.state();
    const second = state.messages[3] as ChatAssistantMessage;
    expect(second.undo).toEqual({ undoId: 'undo-2', state: 'available' });
  });

  it('keeps error only for the failed state', () => {
    const { session } = createSession();
    finishedTurn(session, 'first', 'undo-1');

    session.setUndoState('undo-1', 'failed', 'boom');
    let assistant = session.state().messages[1] as ChatAssistantMessage;
    expect(assistant.undo).toEqual({ undoId: 'undo-1', state: 'failed', error: 'boom' });

    session.setUndoState('undo-1', 'undone', 'ignored');
    assistant = session.state().messages[1] as ChatAssistantMessage;
    expect(assistant.undo).toEqual({ undoId: 'undo-1', state: 'undone' });
    expect(assistant.undo).not.toHaveProperty('error');
  });

  it('is a no-op for unknown undoIds', () => {
    const { session, posts } = createSession();
    session.setUndoState('ghost', 'failed', 'x');
    expect(posts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

describe('ChatSession.history', () => {
  it('returns prior completed turns oldest first', () => {
    const { session } = createSession();
    session.beginTurn('list servers');
    session.completeTurn({ status: 'complete', text: 'You have 2 servers.', actions: [] });
    session.beginTurn('add a route');
    session.completeTurn({ status: 'complete', text: 'Added it.', actions: [ACTION] });

    expect(session.history()).toEqual([
      { role: 'user', content: 'list servers' },
      { role: 'assistant', content: 'You have 2 servers.' },
      { role: 'user', content: 'add a route' },
      { role: 'assistant', content: 'Added it.' },
    ]);
  });

  it('skips running assistant turns and error turns with empty text', () => {
    const { session } = createSession();
    session.beginTurn('first');
    session.failTurn('exploded', []); // error turn — empty text, skipped
    session.beginTurn('second');

    expect(session.history()).toEqual([
      { role: 'user', content: 'first' },
      { role: 'user', content: 'second' }, // running assistant skipped
    ]);
  });
});

// ---------------------------------------------------------------------------
// Clear + message cap
// ---------------------------------------------------------------------------

describe('ChatSession.clear and message cap', () => {
  it('refuses to clear while running', () => {
    const { session, posts } = createSession();
    session.beginTurn('busy');
    posts.length = 0;
    expect(session.clear()).toBeNull();
    expect(posts).toHaveLength(0);
    expect(session.state().messages).toHaveLength(2);
  });

  it('clears when idle: wipes messages, posts chatState, returns dropped undoIds', () => {
    const { session, posts } = createSession();
    session.beginTurn('first');
    session.completeTurn({ status: 'complete', text: 'ok', actions: [ACTION], undoId: 'undo-1' });
    session.beginTurn('second');
    session.completeTurn({ status: 'complete', text: 'ok', actions: [] }); // no undo
    posts.length = 0;

    expect(session.clear()).toEqual(['undo-1']);
    expect(session.state().messages).toHaveLength(0);
    expect(posts).toEqual([{ type: 'chatState', state: { messages: [], running: false } }]);
  });

  it('evicts oldest messages beyond maxMessages and reports their undoIds', () => {
    const { session, posts } = createSession({ maxMessages: 4 });
    const evictions: string[][] = [];
    session.onEvictUndo = (undoIds) => evictions.push(undoIds);

    session.beginTurn('turn 1');
    session.completeTurn({ status: 'complete', text: 'one', actions: [], undoId: 'undo-1' });
    session.beginTurn('turn 2');
    session.completeTurn({ status: 'complete', text: 'two', actions: [], undoId: 'undo-2' });
    expect(evictions).toHaveLength(0); // exactly at the cap

    posts.length = 0;
    session.beginTurn('turn 3'); // pushes 2 → evicts turn 1's pair
    expect(evictions).toEqual([['undo-1']]);
    const state = session.state();
    expect(state.messages).toHaveLength(4);
    expect((state.messages[0] as { text: string }).text).toBe('turn 2');

    // Eviction is mirrored to the webview as ONE full chatState (its store
    // only ever appends/upserts — increments would leave the evicted
    // messages, and their dead Undo buttons, rendered forever).
    expect(posts.map((post) => post.type)).toEqual(['chatState']);
    expect(replay(posts)).toEqual(state);
  });

  it('does not invoke onEvictUndo when evicted messages carry no undo', () => {
    const { session } = createSession({ maxMessages: 2 });
    const evictions: string[][] = [];
    session.onEvictUndo = (undoIds) => evictions.push(undoIds);

    session.beginTurn('turn 1');
    session.completeTurn({ status: 'complete', text: 'one', actions: [] });
    session.beginTurn('turn 2');
    expect(session.state().messages).toHaveLength(2);
    expect(evictions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// State/post coherence
// ---------------------------------------------------------------------------

describe('ChatSession state matches replayed posts', () => {
  it('replaying every post reconstructs state() exactly', () => {
    const { session, posts } = createSession();
    session.sync();
    session.beginTurn('add a payments route');
    session.appendProgress('Server agent: listing mock servers (call 1/20)…');
    session.requestConfirm(confirmRequest());
    session.resolveConfirm('confirm-1', true, 'user');
    session.appendProgress('Server agent: adding 1 route(s) to "Payments" (call 2/20)…');
    session.completeTurn({ status: 'complete', text: 'Added.', actions: [ACTION], undoId: 'undo-1' });
    session.setUndoState('undo-1', 'undoing');
    session.setUndoState('undo-1', 'undone');

    expect(replay(posts)).toEqual(session.state());
  });
});
