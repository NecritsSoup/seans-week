import { useSyncExternalStore } from 'react';
import type { CategoryId } from '../state/types';

// Hermes's Ledger: a narrative record of everything he did — the legacy
// hermesLog grown up. Fire-and-forget synchronous localStorage writes only,
// so logging can never slow down or break the real actions.

const STORAGE_KEY = 'seans-week:ledger:v1';
const CAP = 200;

export type LedgerType = 'create' | 'move' | 'cancel' | 'todo' | 'brief' | 'error';

export type LedgerUndo =
  | { kind: 'delete-created'; eventId: string }
  | { kind: 'restore-times'; eventId: string; prevStart: string; prevEnd: string }
  | {
      kind: 'restore-event';
      event: {
        id: string;
        title: string;
        start: string;
        end: string;
        categoryId: CategoryId;
        allDay?: boolean;
      };
    };

export interface LedgerEntry {
  id: string;
  /** Epoch milliseconds. */
  t: number;
  type: LedgerType;
  /** Readable prose: "Moved gym to 8:00 at your request." */
  text: string;
  undo?: LedgerUndo;
  undone?: boolean;
}

function load(): LedgerEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? (parsed as LedgerEntry[]) : [];
  } catch {
    return [];
  }
}

let entries: LedgerEntry[] = load();
const listeners = new Set<() => void>();

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* logging must never break the app */
  }
  listeners.forEach((fn) => fn());
}

/** Append a narrative entry (newest first). Returns the stored entry. */
export function appendLedger(type: LedgerType, text: string, undo?: LedgerUndo): LedgerEntry {
  const entry: LedgerEntry = {
    id: `lg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    t: Date.now(),
    type,
    text,
    ...(undo ? { undo } : {}),
  };
  entries = [entry, ...entries].slice(0, CAP);
  persist();
  return entry;
}

/** Mark an entry's undo as spent so the Ledger stops offering it. */
export function markLedgerUndone(id: string): void {
  entries = entries.map((e) => (e.id === id ? { ...e, undone: true } : e));
  persist();
}

export function getLedger(): LedgerEntry[] {
  return entries;
}

export function subscribeLedger(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React hook: all ledger entries, newest first. */
export function useLedger(): LedgerEntry[] {
  return useSyncExternalStore(subscribeLedger, getLedger);
}
