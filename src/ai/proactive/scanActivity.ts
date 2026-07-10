/**
 * Shared 'a codebase scan is running' gate — the never-overlap safety rule.
 * Every codebase-scan entry point (dashboard, command palette, scheduler)
 * wraps its ScanOrchestrator.generate() await in track(); the scheduler
 * consults isActive() in shouldSkip so a tick landing mid-user-scan is
 * skipped, not queued. The reverse direction is event-driven: a USER scan
 * beginning while a background scan is in flight fires onUserScanStart, and
 * the ProactiveController cancels its background run — the two would
 * otherwise interleave on the same checkpoint thread.
 * Pure — zero vscode imports, fully vitest-importable.
 */
export interface ScanActivityOptions {
  /** True for the scheduler's own runs; they never preempt themselves. */
  background?: boolean;
}

export interface ScanActivity {
  isActive(): boolean;
  /** Counter-based: increments before run(), decrements in finally (reject rethrows). */
  track<T>(run: () => Promise<T>, options?: ScanActivityOptions): Promise<T>;
  /**
   * Fires when a NON-background track begins (before its run() starts).
   * Returns the unsubscribe function. Listener throws are swallowed — a
   * proactive hook must never break a user's scan.
   */
  onUserScanStart(listener: () => void): () => void;
}

/** Fresh instance (tests). */
export function createScanActivity(): ScanActivity {
  let active = 0;
  const listeners = new Set<() => void>();
  return {
    isActive: () => active > 0,
    track: async <T>(run: () => Promise<T>, options?: ScanActivityOptions): Promise<T> => {
      if (options?.background !== true) {
        for (const listener of listeners) {
          try {
            listener();
          } catch {
            // A proactive hook must never break a user's scan.
          }
        }
      }
      active++;
      try {
        return await run();
      } finally {
        active--;
      }
    },
    onUserScanStart: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Module singleton shared by WebViewManager, AiCommands, and the scheduler. */
export const sharedScanActivity: ScanActivity = createScanActivity();
