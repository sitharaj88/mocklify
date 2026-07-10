/** Time formatting helpers for chat timestamps and day dividers. */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** 'just now' / 'Nm ago' / 'Nh ago' / 'Yesterday' / 'Nd ago' / locale date. */
export function formatRelativeTime(epochMs: number, now: number): string {
  const elapsed = now - epochMs;
  if (elapsed < MINUTE_MS) {
    return 'just now';
  }
  if (elapsed < HOUR_MS) {
    return `${Math.floor(elapsed / MINUTE_MS)}m ago`;
  }
  if (elapsed < DAY_MS) {
    return `${Math.floor(elapsed / HOUR_MS)}h ago`;
  }
  if (dayKey(epochMs) === dayKey(now - DAY_MS)) {
    return 'Yesterday';
  }
  if (elapsed < 7 * DAY_MS) {
    return `${Math.floor(elapsed / DAY_MS)}d ago`;
  }
  return new Date(epochMs).toLocaleDateString();
}

export function formatAbsoluteTime(epochMs: number): string {
  return new Date(epochMs).toLocaleString();
}

/** Calendar-day bucket key for divider grouping. */
export function dayKey(epochMs: number): string {
  return new Date(epochMs).toDateString();
}

/** 'Today' | 'Yesterday' | locale date — for day dividers. */
export function formatDayLabel(epochMs: number, now: number): string {
  const key = dayKey(epochMs);
  if (key === dayKey(now)) {
    return 'Today';
  }
  if (key === dayKey(now - DAY_MS)) {
    return 'Yesterday';
  }
  return new Date(epochMs).toLocaleDateString();
}
