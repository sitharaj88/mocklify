import { describe, it, expect } from 'vitest';
import {
  createScanActivity,
  sharedScanActivity,
} from '../src/ai/proactive/scanActivity';

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('ScanActivity', () => {
  it('is active during track and inactive after resolve', async () => {
    const activity = createScanActivity();
    expect(activity.isActive()).toBe(false);
    const d = deferred<string>();
    const tracked = activity.track(() => d.promise);
    expect(activity.isActive()).toBe(true);
    d.resolve('done');
    await expect(tracked).resolves.toBe('done');
    expect(activity.isActive()).toBe(false);
  });

  it('is inactive after reject and rethrows the error', async () => {
    const activity = createScanActivity();
    const boom = new Error('boom');
    await expect(activity.track(() => Promise.reject(boom))).rejects.toBe(boom);
    expect(activity.isActive()).toBe(false);
  });

  it('stays active until the last of parallel tracks settles', async () => {
    const activity = createScanActivity();
    const a = deferred<void>();
    const b = deferred<void>();
    const ta = activity.track(() => a.promise);
    const tb = activity.track(() => b.promise);
    expect(activity.isActive()).toBe(true);
    a.resolve();
    await ta;
    expect(activity.isActive()).toBe(true);
    b.resolve();
    await tb;
    expect(activity.isActive()).toBe(false);
  });

  it('stays active across nested tracks until the outer settles', async () => {
    const activity = createScanActivity();
    let insideNested = false;
    await activity.track(async () => {
      await activity.track(async () => {
        insideNested = activity.isActive();
      });
      expect(activity.isActive()).toBe(true);
    });
    expect(insideNested).toBe(true);
    expect(activity.isActive()).toBe(false);
  });

  it('exports a shared singleton instance', async () => {
    expect(sharedScanActivity.isActive()).toBe(false);
    await sharedScanActivity.track(async () => {
      expect(sharedScanActivity.isActive()).toBe(true);
    });
    expect(sharedScanActivity.isActive()).toBe(false);
  });

  it('onUserScanStart fires for user tracks, not background ones, and unsubscribes', async () => {
    const activity = createScanActivity();
    let fired = 0;
    const unsub = activity.onUserScanStart(() => fired++);

    await activity.track(async () => undefined, { background: true });
    expect(fired).toBe(0); // the scheduler's own run never preempts itself

    await activity.track(async () => undefined);
    expect(fired).toBe(1);
    await activity.track(async () => undefined, {});
    expect(fired).toBe(2);

    unsub();
    await activity.track(async () => undefined);
    expect(fired).toBe(2);
  });

  it('a throwing listener never breaks the tracked user scan', async () => {
    const activity = createScanActivity();
    activity.onUserScanStart(() => {
      throw new Error('listener boom');
    });
    await expect(activity.track(async () => 'ok')).resolves.toBe('ok');
    expect(activity.isActive()).toBe(false);
  });
});
