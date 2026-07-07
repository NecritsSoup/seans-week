import { useSyncExternalStore } from 'react';
import type { CalendarEvent, CategoryId } from '../state/types';

// The preview-then-commit bridge between the Hermes palette and the Stage.
// The palette sets a pending action; the TimeGrid reads it and renders a
// ghost block (create/move) or marks the target event (cancel). Confirming
// or dismissing in the palette clears it.

export type PendingAction =
  | {
      kind: 'create';
      title: string;
      categoryId: CategoryId;
      day: Date;
      startMin: number;
      endMin: number;
    }
  | { kind: 'move'; event: CalendarEvent; day: Date; startMin: number; endMin: number }
  | { kind: 'cancel'; event: CalendarEvent };

let pending: PendingAction | null = null;
const listeners = new Set<() => void>();

export function setPendingAction(action: PendingAction | null): void {
  pending = action;
  listeners.forEach((fn) => fn());
}

export function clearPendingAction(): void {
  setPendingAction(null);
}

export function getPendingAction(): PendingAction | null {
  return pending;
}

export function subscribePending(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React hook: the current pending Hermes action, or null. */
export function usePendingAction(): PendingAction | null {
  return useSyncExternalStore(subscribePending, getPendingAction);
}
