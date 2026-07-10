import { describe, it, expect } from 'vitest';
import {
  RescanScheduler,
  SCHEDULED_SCAN_BACKOFF_CAP_MS,
  SCHEDULED_SCAN_MIN_INTERVAL_MS,
  backoffDelayMs,
  clampIntervalMs,
  type RescanSchedulerDeps,
  type RescanSkipReason,
  type RescanTimer,
} from '../src/ai/proactive/rescanScheduler';

/** Fake one-shot timer: records armed delays, fires only when told to. */
class FakeTimer implements RescanTimer {
  pending: { id: number; fn: () => void; ms: number }[] = [];
  private nextId = 1;
  set(fn: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.pending.push({ id, fn, ms });
    return id;
  }
  clear(handle: unknown): void {
    this.pending = this.pending.filter((e) => e.id !== handle);
  }
  /** Fire the (single) pending timer. */
  fire(): void {
    const entry = this.pending.shift();
    if (!entry) {
      throw new Error('no pending timer to fire');
    }
    entry.fn();
  }
  get armedDelays(): number[] {
    return this.pending.map((e) => e.ms);
  }
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

interface Harness {
  timer: FakeTimer;
  scheduler: RescanScheduler;
  runCalls: number[];
  logs: string[];
  cancelCalls: number;
  setInterval(ms: number): void;
  setSkip(reason: RescanSkipReason | null | (() => Promise<RescanSkipReason | null>)): void;
  setRun(fn: () => Promise<void>): void;
}

function makeHarness(intervalMs: number): Harness {
  const timer = new FakeTimer();
  let interval = intervalMs;
  let skip: () => Promise<RescanSkipReason | null> = () => Promise.resolve(null);
  let run: () => Promise<void> = () => Promise.resolve();
  const runCalls: number[] = [];
  const logs: string[] = [];
  const state = { cancelCalls: 0 };
  let runSeq = 0;
  const deps: RescanSchedulerDeps = {
    intervalMs: () => interval,
    shouldSkip: () => skip(),
    run: () => {
      runCalls.push(++runSeq);
      return run();
    },
    cancelRun: () => {
      state.cancelCalls++;
    },
    log: (line) => logs.push(line),
  };
  const scheduler = new RescanScheduler(deps, timer);
  return {
    timer,
    scheduler,
    runCalls,
    logs,
    get cancelCalls() {
      return state.cancelCalls;
    },
    setInterval: (ms) => (interval = ms),
    setSkip: (reason) => {
      skip = typeof reason === 'function' ? reason : () => Promise.resolve(reason);
    },
    setRun: (fn) => (run = fn),
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (e: unknown) => void } {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('clampIntervalMs', () => {
  it('returns 0 for zero, negative, and non-finite values', () => {
    expect(clampIntervalMs(0)).toBe(0);
    expect(clampIntervalMs(-5)).toBe(0);
    expect(clampIntervalMs(Number.NaN)).toBe(0);
    expect(clampIntervalMs(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('clamps sub-minimum positives up to 15 minutes and passes larger through', () => {
    expect(clampIntervalMs(1)).toBe(SCHEDULED_SCAN_MIN_INTERVAL_MS);
    expect(clampIntervalMs(14 * 60_000)).toBe(SCHEDULED_SCAN_MIN_INTERVAL_MS);
    expect(clampIntervalMs(60 * 60_000)).toBe(60 * 60_000);
  });
});

describe('backoffDelayMs', () => {
  const interval = 15 * 60_000;

  it('returns the interval for streak 0 and doubles 2x/4x/8x then caps the exponent', () => {
    expect(backoffDelayMs(interval, 0)).toBe(interval);
    expect(backoffDelayMs(interval, 1)).toBe(interval * 2);
    expect(backoffDelayMs(interval, 2)).toBe(interval * 4);
    expect(backoffDelayMs(interval, 3)).toBe(interval * 8);
    expect(backoffDelayMs(interval, 10)).toBe(interval * 8);
  });

  it('caps at 24 hours', () => {
    expect(backoffDelayMs(12 * 60 * 60_000, 3)).toBe(SCHEDULED_SCAN_BACKOFF_CAP_MS);
  });
});

describe('RescanScheduler', () => {
  const INTERVAL = 20 * 60_000;

  it('never arms when the interval is 0 (disabled)', () => {
    const h = makeHarness(0);
    h.scheduler.start();
    expect(h.timer.pending.length).toBe(0);
  });

  it('clamps a sub-minimum interval to 15 minutes when arming', () => {
    const h = makeHarness(60_000);
    h.scheduler.start();
    expect(h.timer.armedDelays).toEqual([SCHEDULED_SCAN_MIN_INTERVAL_MS]);
  });

  it('start is idempotent (clears the previous pending timer first)', () => {
    const h = makeHarness(INTERVAL);
    h.scheduler.start();
    h.scheduler.start();
    expect(h.timer.pending.length).toBe(1);
  });

  it('tick runs and re-arms at the interval on success', async () => {
    const h = makeHarness(INTERVAL);
    h.scheduler.start();
    h.timer.fire();
    await flush();
    expect(h.runCalls.length).toBe(1);
    expect(h.timer.armedDelays).toEqual([INTERVAL]);
  });

  it('a tick with interval switched to 0 returns disarmed without running', async () => {
    const h = makeHarness(INTERVAL);
    h.scheduler.start();
    h.setInterval(0);
    h.timer.fire();
    await flush();
    expect(h.runCalls.length).toBe(0);
    expect(h.timer.pending.length).toBe(0);
  });

  it.each([
    'no-workspace',
    'scan-running',
    'resume-pending',
    'provider-unavailable',
  ] as const)('skip reason %s logs and re-arms without running or backoff', async (reason) => {
    const h = makeHarness(INTERVAL);
    h.setSkip(reason);
    h.scheduler.start();
    h.timer.fire();
    await flush();
    expect(h.runCalls.length).toBe(0);
    expect(h.logs).toEqual([`Mocklify: scheduled scan skipped (${reason}).`]);
    expect(h.timer.armedDelays).toEqual([INTERVAL]); // normal interval, no backoff
  });

  it('a shouldSkip throw is treated as provider-unavailable', async () => {
    const h = makeHarness(INTERVAL);
    h.setSkip(() => Promise.reject(new Error('no provider')));
    h.scheduler.start();
    h.timer.fire();
    await flush();
    expect(h.runCalls.length).toBe(0);
    expect(h.logs).toEqual(['Mocklify: scheduled scan skipped (provider-unavailable).']);
    expect(h.timer.armedDelays).toEqual([INTERVAL]);
  });

  it('skips do not reset the failure streak', async () => {
    const h = makeHarness(INTERVAL);
    h.setRun(() => Promise.reject(new Error('fail')));
    h.scheduler.start();
    h.timer.fire();
    await flush();
    expect(h.timer.armedDelays).toEqual([INTERVAL * 2]);
    h.setSkip('scan-running');
    h.timer.fire();
    await flush();
    expect(h.timer.armedDelays).toEqual([INTERVAL]); // skip re-arms at plain interval
    h.setSkip(null);
    h.timer.fire();
    await flush();
    expect(h.timer.armedDelays).toEqual([INTERVAL * 4]); // streak survived the skip
  });

  it('overlap is structurally impossible: nothing is armed while a run is pending', async () => {
    const h = makeHarness(INTERVAL);
    const gate = deferred();
    h.setRun(() => gate.promise);
    h.scheduler.start();
    h.timer.fire();
    await flush();
    expect(h.scheduler.runInFlight).toBe(true);
    // Advance "time" three intervals: there is no pending timer to fire at all.
    expect(h.timer.pending.length).toBe(0);
    expect(h.runCalls.length).toBe(1);
    gate.resolve();
    await flush();
    expect(h.scheduler.runInFlight).toBe(false);
    expect(h.runCalls.length).toBe(1); // exactly one run
    expect(h.timer.armedDelays).toEqual([INTERVAL]);
  });

  it('backs off 2x/4x/8x on repeated failures, caps, and resets on success', async () => {
    const h = makeHarness(INTERVAL);
    h.setRun(() => Promise.reject(new Error('scan blew up')));
    h.scheduler.start();
    const delays: number[] = [];
    for (let i = 0; i < 5; i++) {
      h.timer.fire();
      await flush();
      delays.push(h.timer.armedDelays[0]);
    }
    expect(delays).toEqual([
      INTERVAL * 2,
      INTERVAL * 4,
      INTERVAL * 8,
      INTERVAL * 8,
      INTERVAL * 8,
    ]);
    expect(h.logs[0]).toBe(
      'Mocklify: scheduled background scan failed (attempt 1) — retrying later: scan blew up'
    );
    h.setRun(() => Promise.resolve());
    h.timer.fire();
    await flush();
    expect(h.timer.armedDelays).toEqual([INTERVAL]); // streak reset
  });

  it('caps the backoff delay at 24 hours', async () => {
    const h = makeHarness(23 * 60 * 60_000);
    h.setRun(() => Promise.reject(new Error('x')));
    h.scheduler.start();
    h.timer.fire();
    await flush();
    expect(h.timer.armedDelays).toEqual([SCHEDULED_SCAN_BACKOFF_CAP_MS]);
  });

  it('refresh re-arms an idle scheduler immediately with the fresh interval', () => {
    const h = makeHarness(INTERVAL);
    h.scheduler.start();
    h.setInterval(45 * 60_000);
    h.scheduler.refresh();
    expect(h.timer.armedDelays).toEqual([45 * 60_000]);
  });

  it('refresh during a run is a no-op; the post-run re-arm reads the fresh interval', async () => {
    const h = makeHarness(INTERVAL);
    const gate = deferred();
    h.setRun(() => gate.promise);
    h.scheduler.start();
    h.timer.fire();
    await flush();
    h.setInterval(45 * 60_000);
    h.scheduler.refresh();
    expect(h.timer.pending.length).toBe(0); // no-op while running
    gate.resolve();
    await flush();
    expect(h.timer.armedDelays).toEqual([45 * 60_000]);
  });

  it('dispose clears the pending timer and blocks future re-arms', async () => {
    const h = makeHarness(INTERVAL);
    h.scheduler.start();
    expect(h.timer.pending.length).toBe(1);
    h.scheduler.dispose();
    expect(h.timer.pending.length).toBe(0);
    h.scheduler.start();
    h.scheduler.refresh();
    expect(h.timer.pending.length).toBe(0);
    expect(h.cancelCalls).toBe(0); // no run in flight
  });

  it('dispose during an in-flight run cancels it and suppresses the re-arm', async () => {
    const h = makeHarness(INTERVAL);
    const gate = deferred();
    h.setRun(() => gate.promise);
    h.scheduler.start();
    h.timer.fire();
    await flush();
    expect(h.scheduler.runInFlight).toBe(true);
    h.scheduler.dispose();
    expect(h.cancelCalls).toBe(1);
    gate.resolve();
    await flush();
    expect(h.timer.pending.length).toBe(0); // re-arm suppressed
    expect(h.scheduler.runInFlight).toBe(false);
  });

  it('refresh() landing during the async skip-check does not fork the timer chain', async () => {
    const h = makeHarness(20 * 60_000);
    const gate = deferred();
    h.setSkip(async () => {
      await gate.promise;
      return 'provider-unavailable';
    });
    h.scheduler.start();
    h.timer.fire();
    await flush(); // tick is now awaiting shouldSkip; running covers the whole tick
    h.scheduler.refresh(); // config change mid-check: must be a no-op, not a second arm
    expect(h.timer.pending.length).toBe(0);
    gate.resolve();
    await flush();
    // Exactly ONE timer survives the tick — a fork would leave two.
    expect(h.timer.pending.length).toBe(1);
    h.timer.fire();
    await flush();
    expect(h.timer.pending.length).toBe(1);
  });

  it('dispose() landing during the async skip-check prevents the run entirely', async () => {
    const h = makeHarness(20 * 60_000);
    const gate = deferred();
    h.setSkip(async () => {
      await gate.promise;
      return null; // would proceed to run() without the disposed re-check
    });
    h.scheduler.start();
    h.timer.fire();
    await flush();
    h.scheduler.dispose();
    gate.resolve();
    await flush();
    expect(h.runCalls.length).toBe(0); // no scan after disposal
    expect(h.timer.pending.length).toBe(0); // and nothing re-armed
  });
});
