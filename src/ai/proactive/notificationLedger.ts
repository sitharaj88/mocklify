/**
 * Rate-limiting ledger for proactive notifications: the same fingerprint never
 * re-notifies within its cooldown, and session mutes ('Ignore for this
 * session' / 'Dismiss') silence a fingerprint until reload.
 * Pure — zero vscode imports, injectable clock, fully vitest-importable.
 */

/** Same-fingerprint re-notification cooldowns (Part A / Part B). */
export const DRIFT_COOLDOWN_MS = 30 * 60_000; // 30 minutes
export const RESCAN_COOLDOWN_MS = 6 * 60 * 60_000; // 6 hours
/** Fingerprints remembered before the oldest is evicted. */
export const LEDGER_MAX_ENTRIES = 200;

export interface NotificationLedgerOptions {
  /** Injectable clock; default Date.now. */
  now?: () => number;
  /** Default LEDGER_MAX_ENTRIES. */
  maxEntries?: number;
}

export class NotificationLedger {
  /** Insertion-ordered (refreshed via delete+set) fingerprint → last-notified epoch ms. */
  private readonly lastNotified = new Map<string, number>();
  /** Not capped — bounded by user clicks. */
  private readonly muted = new Set<string>();
  private readonly now: () => number;
  private readonly maxEntries: number;

  constructor(options?: NotificationLedgerOptions) {
    this.now = options?.now ?? Date.now;
    this.maxEntries = options?.maxEntries ?? LEDGER_MAX_ENTRIES;
  }

  /**
   * True iff `fingerprint` is not muted and was not recorded within
   * `cooldownMs`; a true return RECORDS now() atomically (check+record is one
   * call so two racing callers cannot both notify). Recording refreshes
   * insertion order; entries beyond maxEntries evict oldest-first.
   */
  tryNotify(fingerprint: string, cooldownMs: number): boolean {
    if (this.muted.has(fingerprint)) {
      return false;
    }
    const now = this.now();
    const last = this.lastNotified.get(fingerprint);
    if (last !== undefined && now - last < cooldownMs) {
      return false;
    }
    this.record(fingerprint, now);
    return true;
  }

  /**
   * Multi-key variant for EVOLVING sets (one key per drift endpoint): true iff
   * at least one key is neither muted nor within cooldownMs; a true return
   * records now() for EVERY key, so endpoints already notified as part of an
   * earlier (sub/super)set stay cooled and only genuinely new endpoints can
   * re-trigger — a set-level fingerprint would mint a fresh identity on every
   * membership change and notify on each save. Recording never unmutes.
   */
  tryNotifyAny(keys: readonly string[], cooldownMs: number): boolean {
    const now = this.now();
    const fresh = keys.some((key) => {
      if (this.muted.has(key)) {
        return false;
      }
      const last = this.lastNotified.get(key);
      return last === undefined || now - last >= cooldownMs;
    });
    if (!fresh) {
      return false;
    }
    for (const key of keys) {
      this.record(key, now);
    }
    return true;
  }

  /** Record + refresh insertion order (recently notified evict last), then cap. */
  private record(key: string, now: number): void {
    this.lastNotified.delete(key);
    this.lastNotified.set(key, now);
    while (this.lastNotified.size > this.maxEntries) {
      const oldest = this.lastNotified.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.lastNotified.delete(oldest);
    }
  }

  /** 'Ignore for this session' / 'Dismiss': never notify again this session. */
  mute(fingerprint: string): void {
    this.muted.add(fingerprint);
  }

  /** Mute every key of a multi-key notification (see tryNotifyAny). */
  muteAll(keys: readonly string[]): void {
    for (const key of keys) {
      this.muted.add(key);
    }
  }

  /** Test/reset hook: clears timestamps and mutes. */
  reset(): void {
    this.lastNotified.clear();
    this.muted.clear();
  }
}
