import { useSyncExternalStore } from 'react';
import type { CalendarEvent, CategoryId } from '../state/types';

// The preview-then-commit bridge between the Hermes palette and the Stage.
// The palette sets one or more pending actions; the TimeGrid reads them and
// renders ghost blocks (create/move) or marks the target events (cancel).
// Confirming or dismissing in the palette clears them. Single-action
// callers keep the old set/get/use API — it wraps the array.

export type PendingAction =
  | {
      kind: 'create';
      title: string;
      categoryId: CategoryId;
      day: Date;
      startMin: number;
      endMin: number;
      /** Create a weekly RecurringTemplate instead of a one-off. */
      repeatWeekly?: boolean;
      /** Conference URL carried in from the source (a scheduled scroll). */
      meetingUrl?: string;
    }
  | { kind: 'move'; event: CalendarEvent; day: Date; startMin: number; endMin: number }
  | { kind: 'cancel'; event: CalendarEvent }
  /** Convert a one-off into a weekly template ("make friday's gym weekly"). */
  | { kind: 'recur'; event: CalendarEvent };

const EMPTY: PendingAction[] = [];
let pending: PendingAction[] = EMPTY;
const listeners = new Set<() => void>();

/** Stage several actions at once — every one previews on the grid. */
export function setPendingActions(actions: PendingAction[]): void {
  pending = actions.length === 0 ? EMPTY : actions;
  listeners.forEach((fn) => fn());
}

export function setPendingAction(action: PendingAction | null): void {
  setPendingActions(action ? [action] : []);
}

export function clearPendingAction(): void {
  setPendingActions([]);
}

export function getPendingActions(): PendingAction[] {
  return pending;
}

export function getPendingAction(): PendingAction | null {
  return pending[0] ?? null;
}

export function subscribePending(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React hook: every pending Hermes action (empty array when none). */
export function usePendingActions(): PendingAction[] {
  return useSyncExternalStore(subscribePending, getPendingActions);
}

/** React hook: the first pending Hermes action, or null. */
export function usePendingAction(): PendingAction | null {
  return useSyncExternalStore(subscribePending, getPendingAction);
}
