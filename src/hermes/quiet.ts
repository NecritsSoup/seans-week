import { useSyncExternalStore } from 'react';
import { dateKey } from '../lib/time';

// "Quiet Hermes for today": per-day flag. When set, no proactive briefs.
const KEY_PREFIX = 'seans-week:quiet:';

const listeners = new Set<() => void>();

export function isQuietToday(now: Date = new Date()): boolean {
  try {
    return localStorage.getItem(KEY_PREFIX + dateKey(now)) === '1';
  } catch {
    return false;
  }
}

export function setQuietToday(quiet: boolean, now: Date = new Date()): void {
  try {
    if (quiet) localStorage.setItem(KEY_PREFIX + dateKey(now), '1');
    else localStorage.removeItem(KEY_PREFIX + dateKey(now));
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((fn) => fn());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): boolean {
  return isQuietToday();
}

/** React hook: whether Hermes is quieted for the current day. */
export function useQuietToday(): boolean {
  return useSyncExternalStore(subscribe, snapshot);
}
