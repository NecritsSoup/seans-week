import { useMemo } from 'react';
import { dateKey, isSameDay } from '../lib/time';
import { Panel } from '../ui';
import { useLedger, type LedgerEntry } from './ledgerStore';
import { useLedgerUndo } from './useLedgerUndo';

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
  const performUndo = useLedgerUndo();

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
