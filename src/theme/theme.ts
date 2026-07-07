import { useSyncExternalStore } from 'react';

export const THEMES = ['vase', 'fresco', 'amphora', 'nyx'] as const;
export type ThemeName = (typeof THEMES)[number];

const STORAGE_KEY = 'seans-week:theme';
const listeners = new Set<() => void>();

function readStored(): ThemeName {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && (THEMES as readonly string[]).includes(stored)) return stored as ThemeName;
  } catch {
    /* localStorage unavailable */
  }
  return 'vase';
}

let current: ThemeName = readStored();

/** Apply the persisted theme to <html>. Call once before rendering. */
export function initTheme(): void {
  document.documentElement.dataset.theme = current;
}

export function getTheme(): ThemeName {
  return current;
}

export function setTheme(theme: ThemeName): void {
  if (theme === current) return;
  current = theme;
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* localStorage unavailable */
  }
  listeners.forEach((fn) => fn());
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React hook: the current theme name, reactive to setTheme. */
export function useTheme(): ThemeName {
  return useSyncExternalStore(subscribeTheme, getTheme);
}
