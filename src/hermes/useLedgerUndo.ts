import { useCallback } from 'react';
import { removeGoogleSeries, restoreGoogleParent } from '../google/googleSeriesOps';
import { useEventActions } from '../state/EventsContext';
import { deleteTemplate, restoreException, upsertTemplate } from '../state/recurrence';
import type { EventInput, EventPatch } from '../state/types';
import { useToast } from '../ui';
import {
  appendLedger,
  markLedgerUndone,
  type LedgerEntry,
  type LedgerUndo,
} from './ledgerStore';

/** The event actions performLedgerUndo needs (from useEventActions). */
interface UndoActions {
  createEvent: (input: EventInput) => Promise<unknown>;
  updateEvent: (id: string, patch: EventPatch) => Promise<unknown>;
  deleteEvent: (id: string) => Promise<void>;
}

/**
 * Perform one stored undo shape. A 'batch' undo runs its children in
 * reverse — the last change comes back first, exactly as it went out.
 */
export async function performLedgerUndo(undo: LedgerUndo, actions: UndoActions): Promise<void> {
  const { createEvent, updateEvent, deleteEvent } = actions;
  if (undo.kind === 'batch') {
    for (let i = undo.children.length - 1; i >= 0; i--) {
      await performLedgerUndo(undo.children[i], actions);
    }
  } else if (undo.kind === 'delete-created') {
    await deleteEvent(undo.eventId);
  } else if (undo.kind === 'restore-times') {
    await updateEvent(undo.eventId, { start: undo.prevStart, end: undo.prevEnd });
  } else if (undo.kind === 'restore-event') {
    await createEvent(undo.event);
  } else if (undo.kind === 'restore-patch') {
    await updateEvent(undo.eventId, undo.patch);
  } else if (undo.kind === 'restore-exception') {
    restoreException(undo.templateId, undo.dateKey, undo.prev);
    if (undo.removeEventId) await deleteEvent(undo.removeEventId);
  } else if (undo.kind === 'restore-template') {
    upsertTemplate(undo.template);
  } else if (undo.kind === 'g-restore-parent') {
    await restoreGoogleParent(undo.seriesId, undo.body);
  } else if (undo.kind === 'g-remove-series') {
    await removeGoogleSeries(undo.seriesId, undo.title);
    if (undo.restoreEvent) await createEvent(undo.restoreEvent);
    if (undo.restoreTemplate) upsertTemplate(undo.restoreTemplate);
  } else {
    deleteTemplate(undo.templateId);
    if (undo.restoreEvent) await createEvent(undo.restoreEvent);
  }
}

/**
 * The Ledger's undo executor, shared between the Ledger panel and the
 * Dispatches hub's "Recently handled" list. Performs the entry's stored
 * undo, marks it spent and confirms with a toast.
 */
export function useLedgerUndo(): (entry: LedgerEntry) => Promise<void> {
  const { createEvent, updateEvent, deleteEvent } = useEventActions();
  const { showToast } = useToast();

  return useCallback(
    async (entry: LedgerEntry) => {
      const undo = entry.undo as LedgerUndo;
      try {
        await performLedgerUndo(undo, { createEvent, updateEvent, deleteEvent });
        markLedgerUndone(entry.id);
        showToast({ message: 'Undone — the calendar is as it was.' });
      } catch {
        appendLedger('error', 'An undo could not be completed — the event is no longer there.');
        showToast({ message: 'That change is no longer there to undo.' });
      }
    },
    [createEvent, updateEvent, deleteEvent, showToast]
  );
}
