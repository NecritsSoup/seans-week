import { useCallback } from 'react';
import { useEventActions } from '../state/EventsContext';
import { deleteTemplate, restoreException, upsertTemplate } from '../state/recurrence';
import { useToast } from '../ui';
import {
  appendLedger,
  markLedgerUndone,
  type LedgerEntry,
  type LedgerUndo,
} from './ledgerStore';

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
        if (undo.kind === 'delete-created') {
          await deleteEvent(undo.eventId);
        } else if (undo.kind === 'restore-times') {
          await updateEvent(undo.eventId, { start: undo.prevStart, end: undo.prevEnd });
        } else if (undo.kind === 'restore-event') {
          await createEvent(undo.event);
        } else if (undo.kind === 'restore-exception') {
          restoreException(undo.templateId, undo.dateKey, undo.prev);
          if (undo.removeEventId) await deleteEvent(undo.removeEventId);
        } else if (undo.kind === 'restore-template') {
          upsertTemplate(undo.template);
        } else {
          deleteTemplate(undo.templateId);
          if (undo.restoreEvent) await createEvent(undo.restoreEvent);
        }
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
