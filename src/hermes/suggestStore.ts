import { useSyncExternalStore } from 'react';
import { getScrolls } from '../scrolls/scrollsStore';
import { getTemplates } from '../state/recurrence';
import { getTodos } from '../state/todos';
import type { CalendarEvent } from '../state/types';
import { recordHabits } from './streaks';
import { computeSuggestions, type Suggestion } from './suggest';

// The suggestion store: computed lazily by the Dispatches hub (which stays
// mounted, so the FAB badge sees counts too), cached behind a short TTL,
// with dismissals persisted so a passed-over suggestion stays passed over —
// across close/reopen and reload — until its evidence materially changes
// (the evidence is baked into each suggestion's stable id).

const DISMISSED_KEY = 'seans-week:suggest:dismissed:v1';
const TTL_MS = 30_000;
const DISMISSED_CAP = 200;

/* ------------------------------------------------------------- dismissed ---- */

function loadDismissed(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]');
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

let dismissed = loadDismissed();

/** Remember a dismissal for good (newest kept when the cap trims). */
export function dismissSuggestion(id: string): void {
  if (dismissed.includes(id)) return;
  dismissed = [...dismissed, id].slice(-DISMISSED_CAP);
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(dismissed));
  } catch {
    /* keep the in-memory copy */
  }
  publish();
}

/* ----------------------------------------------------------------- state ---- */

let all: Suggestion[] = [];
let visible: Suggestion[] = [];
/** Accepted this session: gone immediately, without persisting a dismissal. */
const handled = new Set<string>();
let computedAt = 0;
const listeners = new Set<() => void>();

function publish(): void {
  visible = all.filter((s) => !dismissed.includes(s.id) && !handled.has(s.id));
  listeners.forEach((fn) => fn());
}

/**
 * Recompute from live state. TTL-gated unless forced — the hub forces when
 * its inputs (events, todos, scrolls) actually change and leans on the TTL
 * for plain open/close cycles.
 */
export function refreshSuggestions(
  events: CalendarEvent[],
  opts: { force?: boolean } = {}
): void {
  const nowMs = Date.now();
  if (!opts.force && nowMs - computedAt < TTL_MS) return;
  computedAt = nowMs;
  const now = new Date(nowMs);
  all = computeSuggestions({
    events,
    templates: getTemplates(),
    todos: getTodos(),
    scrolls: getScrolls(),
    habitLog: recordHabits(events),
    now,
  });
  publish();
}

/** Drop an accepted suggestion right away; a later recompute settles the rest. */
export function markSuggestionHandled(id: string): void {
  handled.add(id);
  publish();
}

/** Fresh suggestions: computed, not dismissed, not yet acted on. */
export function getSuggestions(): Suggestion[] {
  return visible;
}

/** When the last suggestion pass ran (epoch ms; 0 = never). */
export function getSuggestionsComputedAt(): number {
  return computedAt;
}

export function subscribeSuggestions(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React hook: the fresh suggestions, reactive to recomputes and dismissals. */
export function useSuggestions(): Suggestion[] {
  return useSyncExternalStore(subscribeSuggestions, getSuggestions);
}
