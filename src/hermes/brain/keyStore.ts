import { useSyncExternalStore } from 'react';

// Bring-your-own-key store for Hermes's mind (the LLM fallback). The key
// lives ONLY in this browser's localStorage — it is never logged, never put
// in a URL, and sent nowhere but api.anthropic.com (in the x-api-key header).

const STORAGE_KEY = 'seans-week:anthropic-key:v1';

function readStorage(): string | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  } catch {
    return null;
  }
}

let cached: string | null = readStorage();
const listeners = new Set<() => void>();

/** The stored key, or null. Only interpret() should read the value itself. */
export function getApiKey(): string | null {
  return cached;
}

export function hasApiKey(): boolean {
  return cached !== null;
}

/** Store (or, with an empty string, clear) the key. */
export function setApiKey(key: string): void {
  const trimmed = key.trim();
  cached = trimmed ? trimmed : null;
  try {
    if (cached) localStorage.setItem(STORAGE_KEY, cached);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable — keep the in-memory copy for this session */
  }
  listeners.forEach((fn) => fn());
}

export function clearApiKey(): void {
  setApiKey('');
}

export function subscribeApiKey(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React hook: whether a key is stored — never exposes the key itself. */
export function useHasApiKey(): boolean {
  return useSyncExternalStore(subscribeApiKey, hasApiKey);
}
