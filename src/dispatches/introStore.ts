import { useSyncExternalStore } from 'react';

// Whether Sean has met the Dispatches hub yet. Set once — by the coach
// mark's dismiss/"Show me" buttons or by the hub opening through any door
// (seal, `I`, Hermes Card, palette) — and never unset, so the first-run
// callout appears exactly once.

const KEY = 'seans-week:dispatches:introduced:v1';
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== null;
  } catch {
    return true; // no storage → never nag
  }
}

let introduced = read();

export function isDispatchesIntroduced(): boolean {
  return introduced;
}

export function markDispatchesIntroduced(): void {
  if (introduced) return;
  introduced = true;
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* keep the in-memory flag */
  }
  listeners.forEach((fn) => fn());
}

export function subscribeDispatchesIntroduced(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React hook: true once the hub has been introduced, reactive to the mark. */
export function useDispatchesIntroduced(): boolean {
  return useSyncExternalStore(subscribeDispatchesIntroduced, isDispatchesIntroduced);
}
