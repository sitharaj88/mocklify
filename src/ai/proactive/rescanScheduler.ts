/**
 * Chained one-shot background-rescan scheduler: tick → skip-check → guarded
 * run → re-arm (with bounded exponential backoff on failure). Overlap is
 * structurally impossible because re-arming only happens after run() settles.
 * Pure — zero vscode imports, injectable timer, fully vitest-importable.
 */

export const SCHEDULED_SCAN_MIN_INTERVAL_MS = 15 * 60_000;
export const SCHEDULED_SCAN_BACKOFF_MAX_EXPONENT = 3; // 8× worst case
export const SCHEDULED_SCAN_BACKOFF_CAP_MS = 24 * 60 * 60_000;

export type RescanSkipReason =
  | 'no-workspace'
  | 'scan-running'
  | 'resume-pending'
  | 'provider-unavailable';

/** Injectable timer seam (fake in vitest; default wraps global setTimeout/clearTimeout). */
export interface RescanTimer {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const defaultTimer: RescanTimer = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface RescanSchedulerDeps {
  /** Raw configured interval in ms; re-read at EVERY (re)arm. <= 0 ⇒ disabled. */
  intervalMs(): number;
  /** Consulted at each tick before run(); non-null ⇒ log + re-arm, no run, no backoff. */
  shouldSkip(): Promise<RescanSkipReason | null>;
  /** One guarded background scan. May throw (⇒ backoff). Must never popup. */
  run(): Promise<void>;
  /** Called by dispose() when a run is in flight (adapter cancels its CTS). */
  cancelRun?(): void;
  /** Default console.log. */
  log?(line: string): void;
}

/** 0 for raw <= 0 / non-finite; otherwise max(raw, SCHEDULED_SCAN_MIN_INTERVAL_MS). */
export function clampIntervalMs(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) {
    return 0;
  }
  return Math.max(raw, SCHEDULED_SCAN_MIN_INTERVAL_MS);
}

/** streak 0 → intervalMs; else min(intervalMs * 2**min(streak, MAX_EXPONENT), CAP). */
export function backoffDelayMs(intervalMs: number, failureStreak: number): number {
  if (failureStreak <= 0) {
    return intervalMs;
  }
  const exponent = Math.min(failureStreak, SCHEDULED_SCAN_BACKOFF_MAX_EXPONENT);
  return Math.min(intervalMs * 2 ** exponent, SCHEDULED_SCAN_BACKOFF_CAP_MS);
}

export class RescanScheduler {
  private readonly deps: RescanSchedulerDeps;
  private readonly timer: RescanTimer;
  private handle: unknown;
  private disposed = false;
  private failureStreak = 0;
  private running = false;

  constructor(deps: RescanSchedulerDeps, timer?: RescanTimer) {
    this.deps = deps;
    this.timer = timer ?? defaultTimer;
  }

  /** Arm from current settings (idempotent; clears any pending timer first). */
  start(): void {
    if (this.disposed) {
      return;
    }
    this.clearPending();
    this.arm(clampIntervalMs(this.deps.intervalMs()));
  }

  /** Settings changed: idle ⇒ re-arm now with the fresh interval; run in
   *  flight ⇒ no-op (the post-run re-arm re-reads intervalMs() anyway). */
  refresh(): void {
    if (this.disposed || this.running) {
      return;
    }
    this.start();
  }

  get runInFlight(): boolean {
    return this.running;
  }

  /** Clear pending timer, block all future re-arms, cancelRun?.() if in flight. */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.clearPending();
    if (this.running) {
      this.deps.cancelRun?.();
    }
  }

  private clearPending(): void {
    if (this.handle !== undefined) {
      this.timer.clear(this.handle);
      this.handle = undefined;
    }
  }

  private log(line: string): void {
    (this.deps.log ?? console.log)(line);
  }

  private arm(delayMs: number): void {
    if (this.disposed || delayMs <= 0) {
      return;
    }
    // A forgotten pending timer must never survive a re-arm — overwriting
    // this.handle without clearing would fork the tick chain permanently.
    this.clearPending();
    this.handle = this.timer.set(() => {
      this.handle = undefined;
      void this.tick();
    }, delayMs);
  }

  /** Never rejects unhandled. */
  private async tick(): Promise<void> {
    // `running` covers the WHOLE tick, not just run(): the skip-check awaits
    // real I/O, and a refresh() landing in that window would otherwise arm a
    // second timer that the re-arm below silently overwrites — forking the
    // schedule. refresh() no-oping while running is fine: the finally re-arm
    // re-reads intervalMs() anyway.
    this.running = true;
    let nextDelay = 0;
    try {
      const interval = clampIntervalMs(this.deps.intervalMs());
      if (interval === 0) {
        // Disabled mid-flight: return disarmed.
        return;
      }

      let skip: RescanSkipReason | null;
      try {
        skip = await this.deps.shouldSkip();
      } catch {
        skip = 'provider-unavailable';
      }
      // dispose() may have landed during the await — never start a run after it.
      if (this.disposed) {
        return;
      }
      if (skip !== null) {
        this.log(`Mocklify: scheduled scan skipped (${skip}).`);
        nextDelay = interval;
        return;
      }

      try {
        await this.deps.run();
        this.failureStreak = 0;
      } catch (e) {
        this.failureStreak++;
        const msg = e instanceof Error ? e.message : String(e);
        this.log(
          `Mocklify: scheduled background scan failed (attempt ${this.failureStreak}) — retrying later: ${msg}`
        );
      }
      nextDelay = backoffDelayMs(clampIntervalMs(this.deps.intervalMs()), this.failureStreak);
    } finally {
      this.running = false;
      if (!this.disposed && nextDelay > 0) {
        this.arm(nextDelay);
      }
    }
  }
}
