import { describe, it, expect } from 'vitest';
import {
  DRIFT_COOLDOWN_MS,
  LEDGER_MAX_ENTRIES,
  NotificationLedger,
  RESCAN_COOLDOWN_MS,
} from '../src/ai/proactive/notificationLedger';

function makeLedger(options?: { maxEntries?: number }): {
  ledger: NotificationLedger;
  advance: (ms: number) => void;
} {
  let now = 1_000_000;
  const ledger = new NotificationLedger({
    now: () => now,
    ...(options?.maxEntries !== undefined ? { maxEntries: options.maxEntries } : {}),
  });
  return { ledger, advance: (ms) => (now += ms) };
}

describe('NotificationLedger', () => {
  it('exports the spec cooldowns', () => {
    expect(DRIFT_COOLDOWN_MS).toBe(30 * 60_000);
    expect(RESCAN_COOLDOWN_MS).toBe(6 * 60 * 60_000);
    expect(LEDGER_MAX_ENTRIES).toBe(200);
  });

  it('allows the first notify, blocks within cooldown, allows after', () => {
    const { ledger, advance } = makeLedger();
    expect(ledger.tryNotify('fp', 1000)).toBe(true);
    expect(ledger.tryNotify('fp', 1000)).toBe(false);
    advance(999);
    expect(ledger.tryNotify('fp', 1000)).toBe(false);
    advance(1);
    expect(ledger.tryNotify('fp', 1000)).toBe(true);
  });

  it('records atomically on a true return (racing callers cannot both notify)', () => {
    const { ledger } = makeLedger();
    const results = [ledger.tryNotify('fp', 1000), ledger.tryNotify('fp', 1000)];
    expect(results).toEqual([true, false]);
  });

  it('treats independent fingerprints independently', () => {
    const { ledger } = makeLedger();
    expect(ledger.tryNotify('a', 1000)).toBe(true);
    expect(ledger.tryNotify('b', 1000)).toBe(true);
    expect(ledger.tryNotify('a', 1000)).toBe(false);
  });

  it('mute is permanent for the session', () => {
    const { ledger, advance } = makeLedger();
    ledger.mute('fp');
    expect(ledger.tryNotify('fp', 1000)).toBe(false);
    advance(1_000_000_000);
    expect(ledger.tryNotify('fp', 1000)).toBe(false);
  });

  it('evicts oldest beyond maxEntries so a forgotten fingerprint may notify again', () => {
    const { ledger } = makeLedger({ maxEntries: 2 });
    expect(ledger.tryNotify('a', 60_000)).toBe(true);
    expect(ledger.tryNotify('b', 60_000)).toBe(true);
    expect(ledger.tryNotify('c', 60_000)).toBe(true); // evicts 'a'
    expect(ledger.tryNotify('a', 60_000)).toBe(true); // forgotten → notifies again
    expect(ledger.tryNotify('c', 60_000)).toBe(false); // 'c' still remembered
  });

  it('tryNotify refreshes insertion order (recently notified evict last)', () => {
    let now = 0;
    const ledger = new NotificationLedger({ now: () => now, maxEntries: 2 });
    expect(ledger.tryNotify('a', 10)).toBe(true);
    now += 20;
    expect(ledger.tryNotify('b', 10)).toBe(true);
    now += 20;
    expect(ledger.tryNotify('a', 10)).toBe(true); // refreshes 'a' to newest
    now += 20;
    expect(ledger.tryNotify('c', 10)).toBe(true); // evicts 'b', not 'a'
    expect(ledger.tryNotify('a', 60_000)).toBe(false);
    expect(ledger.tryNotify('b', 60_000)).toBe(true);
  });

  it('reset clears timestamps and mutes', () => {
    const { ledger } = makeLedger();
    ledger.mute('m');
    expect(ledger.tryNotify('fp', 60_000)).toBe(true);
    ledger.reset();
    expect(ledger.tryNotify('fp', 60_000)).toBe(true);
    expect(ledger.tryNotify('m', 60_000)).toBe(true);
  });

  it('tryNotifyAny notifies only when a genuinely new key appears and records every key', () => {
    const { ledger } = makeLedger();
    expect(ledger.tryNotifyAny(['drift:/a'], 60_000)).toBe(true);
    // Same set within cooldown — silent (the autosave-churn spam case).
    expect(ledger.tryNotifyAny(['drift:/a'], 60_000)).toBe(false);
    // Superset with one new endpoint — notifies, and records BOTH keys.
    expect(ledger.tryNotifyAny(['drift:/a', 'drift:/b'], 60_000)).toBe(true);
    expect(ledger.tryNotifyAny(['drift:/a', 'drift:/b'], 60_000)).toBe(false);
    // Subset of already-notified keys — silent.
    expect(ledger.tryNotifyAny(['drift:/b'], 60_000)).toBe(false);
  });

  it('tryNotifyAny honors cooldown expiry per key and muteAll silences whole sets', () => {
    const { ledger, advance } = makeLedger();
    expect(ledger.tryNotifyAny(['drift:/a', 'drift:/b'], 60_000)).toBe(true);
    advance(60_001);
    expect(ledger.tryNotifyAny(['drift:/a'], 60_000)).toBe(true); // cooled down

    ledger.muteAll(['drift:/a', 'drift:/b']);
    advance(60_001);
    expect(ledger.tryNotifyAny(['drift:/a', 'drift:/b'], 60_000)).toBe(false); // muted beats cooldown
    // A new endpoint alongside muted ones still gets through; mutes survive recording.
    expect(ledger.tryNotifyAny(['drift:/a', 'drift:/c'], 60_000)).toBe(true);
    advance(60_001);
    expect(ledger.tryNotifyAny(['drift:/a'], 60_000)).toBe(false);
  });
});
