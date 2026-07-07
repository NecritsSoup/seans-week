import { useMemo } from 'react';
import { dateKey, isSameDay } from '../lib/time';
import { useEventActions } from '../state/EventsContext';
import { deleteTemplate, restoreException, upsertTemplate } from '../state/recurrence';
import { Panel, useToast } from '../ui';
import {
  appendLedger,
  markLedgerUndone,
  useLedger,
  type LedgerEntry,
  type LedgerUndo,
} from './ledgerStore';

interface LedgerProps {
  open: boolean;
  onClose: () => void;
}

function dayHeading(t: number): string {
  const date = new Date(t);
  const now = new Date();
  if (isSameDay(date, now)) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameDay(date, yesterday)) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

function entryTime(t: number): string {
  return new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** Hermes's Ledger: the narrative record of what he did, grouped by day. */
export function Ledger({ open, onClose }: LedgerProps) {
  const entries = useLedger();
  const { createEvent, updateEvent, deleteEvent } = useEventActions();
  const { showToast } = useToast();

  const groups = useMemo(() => {
    const byDay = new Map<string, LedgerEntry[]>();
    for (const entry of entries) {
      const key = dateKey(new Date(entry.t));
      const list = byDay.get(key);
      if (list) list.push(entry);
      else byDay.set(key, [entry]);
    }
    return Array.from(byDay.values());
  }, [entries]);

  async function performUndo(entry: LedgerEntry) {
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
  }

  return (
    <Panel open={open} onClose={onClose} title="Hermes’s Ledger">
      {entries.length === 0 && (
        <p className="ledger-empty">
          Nothing recorded yet. Ask Hermes to add, move or cancel something and it will be
          written here.
        </p>
      )}
      {groups.map((group) => (
        <section key={dateKey(new Date(group[0].t))} className="ledger-day">
          <h3 className="ledger-day-head">{dayHeading(group[0].t)}</h3>
          {group.map((entry) => (
            <div key={entry.id} className={`ledger-entry${entry.type === 'error' ? ' error' : ''}`}>
              <span className="ledger-time tnum">{entryTime(entry.t)}</span>
              <span className="ledger-text">
                {entry.text}
                {entry.undone && <em className="ledger-undone"> (undone)</em>}
              </span>
              {entry.undo && !entry.undone && (
                <button className="ledger-undo" onClick={() => void performUndo(entry)}>
                  Undo
                </button>
              )}
            </div>
          ))}
        </section>
      ))}
    </Panel>
  );
}
