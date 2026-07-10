import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  CHAT_CONFIRM_TIMEOUT_MS,
  ChatConfirmBridge,
  type ChatConfirmBridgeOptions,
} from '../src/ai/chat/confirmBridge';
import { ASK_USER_ANSWER_TIMEOUT_MS } from '../src/ai/agent/askUser';
import {
  CHAT_CONFIRM_DETAIL_MAX_CHARS,
  CHAT_CONFIRM_TITLE_MAX_CHARS,
  type ChatConfirmReason,
  type ChatConfirmRequest,
} from '../src/ai/chat/chatProtocol';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const TIMEOUT_MS = 5_000;

interface Settle {
  id: string;
  approved: boolean;
  reason: ChatConfirmReason;
}

function createBridge(overrides?: Partial<ChatConfirmBridgeOptions>) {
  const asks: ChatConfirmRequest[] = [];
  const settles: Settle[] = [];
  let counter = 0;
  const bridge = new ChatConfirmBridge({
    onAsk: (request) => asks.push(request),
    onSettle: (id, approved, reason) => settles.push({ id, approved, reason }),
    createId: () => `confirm-${++counter}`,
    now: () => 1_000,
    timeoutMs: TIMEOUT_MS,
    ...overrides,
  });
  return { bridge, asks, settles };
}

const ACTION = { title: 'Add 1 route(s) to "Payments"', detail: 'GET /api/pay → 200' };

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChatConfirmBridge', () => {
  it('mirrors the ask_user timeout constant', () => {
    expect(CHAT_CONFIRM_TIMEOUT_MS).toBe(ASK_USER_ANSWER_TIMEOUT_MS);
    expect(CHAT_CONFIRM_TIMEOUT_MS).toBe(120_000);
  });

  it('mints a sanitized request and shows it through onAsk', async () => {
    const { bridge, asks } = createBridge();
    const promise = bridge.ask({
      title: `  ${'t'.repeat(300)}\nline `,
      detail: `line1\nline2${'d'.repeat(CHAT_CONFIRM_DETAIL_MAX_CHARS)}`,
    });
    expect(asks).toHaveLength(1);
    expect(asks[0]).toMatchObject({ id: 'confirm-1', createdAt: 1_000, timeoutMs: TIMEOUT_MS });
    expect(asks[0]!.title).toBe(`${'t'.repeat(CHAT_CONFIRM_TITLE_MAX_CHARS)}…`);
    expect(asks[0]!.detail.startsWith('line1\nline2')).toBe(true);
    expect(asks[0]!.detail.endsWith('…')).toBe(true);
    expect(bridge.pending()).toBe(asks[0]);

    bridge.resolve('confirm-1', true);
    await expect(promise).resolves.toBe(true);
  });

  it('resolve(id, true) settles true with reason user, exactly once', async () => {
    const { bridge, asks, settles } = createBridge();
    const promise = bridge.ask(ACTION);
    expect(bridge.resolve(asks[0]!.id, true)).toBe(true);
    await expect(promise).resolves.toBe(true);
    expect(settles).toEqual([{ id: 'confirm-1', approved: true, reason: 'user' }]);
    expect(bridge.pending()).toBeUndefined();
  });

  it('resolve(id, false) settles false with reason user', async () => {
    const { bridge, asks, settles } = createBridge();
    const promise = bridge.ask(ACTION);
    expect(bridge.resolve(asks[0]!.id, false)).toBe(true);
    await expect(promise).resolves.toBe(false);
    expect(settles).toEqual([{ id: 'confirm-1', approved: false, reason: 'user' }]);
  });

  it('resolve returns false for unknown ids and settles nothing', async () => {
    const { bridge, asks, settles } = createBridge();
    const promise = bridge.ask(ACTION);
    expect(bridge.resolve('nonsense', true)).toBe(false);
    expect(settles).toHaveLength(0);
    bridge.resolve(asks[0]!.id, true);
    await promise;
  });

  it('times out to false with reason timeout; a later resolve is a dead letter', async () => {
    const { bridge, asks, settles } = createBridge();
    const promise = bridge.ask(ACTION);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    await expect(promise).resolves.toBe(false);
    expect(settles).toEqual([{ id: 'confirm-1', approved: false, reason: 'timeout' }]);

    expect(bridge.resolve(asks[0]!.id, true)).toBe(false);
    expect(settles).toHaveLength(1); // exactly-once
  });

  it('an aborting signal settles false with reason cancelled', async () => {
    const { bridge, settles } = createBridge();
    const controller = new AbortController();
    const promise = bridge.ask(ACTION, controller.signal);
    controller.abort();
    await expect(promise).resolves.toBe(false);
    expect(settles).toEqual([{ id: 'confirm-1', approved: false, reason: 'cancelled' }]);
  });

  it('a pre-aborted signal resolves false immediately — no onAsk, no onSettle', async () => {
    const { bridge, asks, settles } = createBridge();
    const controller = new AbortController();
    controller.abort();
    await expect(bridge.ask(ACTION, controller.signal)).resolves.toBe(false);
    expect(asks).toHaveLength(0);
    expect(settles).toHaveLength(0);
    expect(bridge.pending()).toBeUndefined();
  });

  it('denyAll settles the pending ask with its reason; idle denyAll is a no-op', async () => {
    const { bridge, settles } = createBridge();
    bridge.denyAll('disposed'); // nothing pending
    expect(settles).toHaveLength(0);

    const promise = bridge.ask(ACTION);
    bridge.denyAll('disposed');
    await expect(promise).resolves.toBe(false);
    expect(settles).toEqual([{ id: 'confirm-1', approved: false, reason: 'disposed' }]);

    bridge.denyAll('cancelled'); // idle again — still a no-op
    expect(settles).toHaveLength(1);
  });

  it('a second ask denies the previous one (cancelled) before showing the new card', async () => {
    const { bridge, asks, settles } = createBridge();
    const first = bridge.ask(ACTION);
    const second = bridge.ask({ title: 'Second', detail: 'd2' });

    await expect(first).resolves.toBe(false);
    expect(settles[0]).toEqual({ id: 'confirm-1', approved: false, reason: 'cancelled' });
    expect(asks.map((a) => a.id)).toEqual(['confirm-1', 'confirm-2']);
    expect(bridge.pending()?.id).toBe('confirm-2');

    bridge.resolve('confirm-2', true);
    await expect(second).resolves.toBe(true);
    expect(settles[1]).toEqual({ id: 'confirm-2', approved: true, reason: 'user' });
  });

  it('cleans up its timer and abort listener on settle', async () => {
    const { bridge, asks, settles } = createBridge();
    const controller = new AbortController();
    const promise = bridge.ask(ACTION, controller.signal);
    bridge.resolve(asks[0]!.id, true);
    await promise;

    expect(vi.getTimerCount()).toBe(0); // timeout cleared
    controller.abort(); // listener removed — no late settle
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS * 2);
    expect(settles).toHaveLength(1);
  });

  it('a throwing onSettle still resolves the promise and never rejects', async () => {
    const asks: ChatConfirmRequest[] = [];
    const bridge = new ChatConfirmBridge({
      onAsk: (request) => asks.push(request),
      // The production sink can throw once the panel is disposed — the ask
      // must still settle, and denyAll's caller must not see the throw.
      onSettle: () => {
        throw new Error('Webview is disposed');
      },
      timeoutMs: TIMEOUT_MS,
    });
    const promise = bridge.ask(ACTION);
    expect(() => bridge.denyAll('disposed')).not.toThrow();
    await expect(promise).resolves.toBe(false);
    expect(bridge.pending()).toBeUndefined();
    expect(bridge.resolve(asks[0]!.id, true)).toBe(false); // exactly-once holds
    expect(vi.getTimerCount()).toBe(0); // timer cleaned up despite the throw
  });

  it('spreads a sanitized change into the request and omits the key when absent', async () => {
    const { bridge, asks } = createBridge();
    const withChange = bridge.ask({
      ...ACTION,
      change: {
        kind: 'add_route',
        serverName: `Payments ${'n'.repeat(200)}`,
        routes: [
          {
            method: 'GET',
            path: '/api/pay',
            statusCode: 200,
            responseType: 'static',
            headersCount: 0,
            disclosures: [],
          },
        ],
      },
    });
    expect(asks[0]!.change).toBeDefined();
    expect(asks[0]!.change!.kind).toBe('add_route');
    // Sanitized on the way through — the belt name is re-clamped for the wire.
    expect(asks[0]!.change!.serverName).toBe(`Payments ${'n'.repeat(51)}…`);
    expect(asks[0]!.change!.routes).toEqual([
      {
        method: 'GET',
        path: '/api/pay',
        statusCode: 200,
        responseType: 'static',
        headersCount: 0,
        disclosures: [],
      },
    ]);
    bridge.resolve(asks[0]!.id, true);
    await withChange;

    const withoutChange = bridge.ask(ACTION);
    expect('change' in asks[1]!).toBe(false);
    bridge.resolve(asks[1]!.id, false);
    await withoutChange;
  });

  it('uses the default timeout when none is injected', async () => {
    const asks: ChatConfirmRequest[] = [];
    const bridge = new ChatConfirmBridge({
      onAsk: (request) => asks.push(request),
      onSettle: () => undefined,
    });
    const promise = bridge.ask(ACTION);
    expect(asks[0]!.timeoutMs).toBe(CHAT_CONFIRM_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(CHAT_CONFIRM_TIMEOUT_MS);
    await expect(promise).resolves.toBe(false);
  });
});
