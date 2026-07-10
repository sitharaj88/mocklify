import { useEffect, useState } from 'react';

/**
 * One shared 60 s ticker for all relative timestamps: a single module-level
 * interval fans out to every subscribed component, so N timestamps cost one
 * timer (started with the first subscriber, cleared with the last).
 */
const TICK_MS = 60_000;

const subscribers = new Set<() => void>();
let intervalId: ReturnType<typeof setInterval> | undefined;

function subscribe(callback: () => void): () => void {
  subscribers.add(callback);
  if (intervalId === undefined) {
    intervalId = setInterval(() => {
      for (const notify of subscribers) {
        notify();
      }
    }, TICK_MS);
  }
  return () => {
    subscribers.delete(callback);
    if (subscribers.size === 0 && intervalId !== undefined) {
      clearInterval(intervalId);
      intervalId = undefined;
    }
  };
}

/** Current epoch ms, refreshed on each shared 60 s tick. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => subscribe(() => setNow(Date.now())), []);
  return now;
}
