import { useEffect } from 'react';
import { signIn, useGoogleAuth } from '../google/auth';
import { categoryFor } from '../hermes/intents/parse';
import { appendLedger } from '../hermes/ledgerStore';
import type { PaletteSeed } from '../hermes/Palette';
import type { PendingAction } from '../hermes/pending';
import { addDays, fmtRange, startOfDay } from '../lib/time';
import { addTodo } from '../state/todos';
import { Panel, useToast } from '../ui';
import {
  dismissScroll,
  refreshScrolls,
  useScrolls,
  useScrollsStatus,
  type Scroll,
} from './scrollsStore';

interface ScrollsPanelProps {
  open: boolean;
  onClose: () => void;
}

const KIND_HEADINGS: Record<Scroll['kind'], string> = {
  meeting: 'Meetings & reports',
  penn: 'From Penn',
};

/** "just now", "5h ago", "3d ago" — ports the legacy relTime. */
function relTime(iso: string): string {
  const hrs = Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (hrs < 1) return 'just now';
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/** Tomorrow, 9:00–10:00 — the suggested slot for a scheduled scroll. */
function suggestedSlot() {
  return { day: addDays(startOfDay(new Date()), 1), startMin: 9 * 60, endMin: 10 * 60 };
}

/**
 * Scrolls: Hermes-the-Messenger's inbox panel. Each email he carries can be
 * dismissed for good, turned into a to-do, or scheduled onto the grid via
 * the palette's confirm step. Subjects only — bodies stay in Gmail.
 */
export function ScrollsPanel({ open, onClose }: ScrollsPanelProps) {
  const auth = useGoogleAuth();
  const scrolls = useScrolls();
  const status = useScrollsStatus();
  const { showToast } = useToast();

  // A fresh look whenever the panel opens on a signed-in account.
  useEffect(() => {
    if (open && auth.status === 'signed-in') void refreshScrolls();
  }, [open, auth.status]);

  function makeTodo(scroll: Scroll) {
    addTodo(scroll.subject);
    dismissScroll(scroll.id);
    appendLedger('scroll', `Turned a scroll into a to-do: “${scroll.subject}”.`);
    showToast({ message: `Noted: “${scroll.subject}”.` });
  }

  function schedule(scroll: Scroll) {
    const { day, startMin, endMin } = suggestedSlot();
    const action: PendingAction = {
      kind: 'create',
      title: scroll.subject,
      categoryId: categoryFor(scroll.subject) ?? (scroll.kind === 'penn' ? 'upenn' : 'work'),
      day,
      startMin,
      endMin,
    };
    const seed: PaletteSeed = {
      action,
      summary: `Schedule “${scroll.subject}” — tomorrow, ${fmtRange(startMin, endMin)}`,
      onCommit: () => {
        dismissScroll(scroll.id);
        appendLedger('scroll', `Scheduled a scroll onto the calendar: “${scroll.subject}”.`);
      },
    };
    onClose();
    window.dispatchEvent(new CustomEvent<PaletteSeed>('hermes:palette', { detail: seed }));
  }

  const kinds: Array<Scroll['kind']> = ['meeting', 'penn'];

  return (
    <Panel open={open} onClose={onClose} title="Scrolls" width={400}>
      {auth.status !== 'signed-in' ? (
        <div className="scrolls-empty">
          <p>
            Hermes carries word from your inbox — meeting notes, reports, and anything new from
            Penn — but he needs the seal broken first.
          </p>
          <button
            className="btn primary"
            onClick={() => void signIn()}
            disabled={auth.status === 'connecting'}
          >
            {auth.status === 'connecting' ? 'Connecting…' : 'Sign in with Google'}
          </button>
        </div>
      ) : (
        <>
          {status === 'loading' && scrolls.length === 0 && (
            <div className="scrolls-loading" aria-label="Checking for scrolls">
              <div className="scroll-skeleton" />
              <div className="scroll-skeleton" />
              <div className="scroll-skeleton" />
            </div>
          )}
          {status === 'error' && (
            <p className="scrolls-note">
              The scrolls could not be fetched just now — Hermes will try again shortly.
            </p>
          )}
          {status === 'ready' && scrolls.length === 0 && (
            <p className="scrolls-note">Nothing new — the messenger&rsquo;s bag is empty.</p>
          )}
          {kinds.map((kind) => {
            const rows = scrolls.filter((s) => s.kind === kind);
            if (rows.length === 0) return null;
            return (
              <section key={kind} className="scrolls-section">
                <h3 className="scrolls-heading">{KIND_HEADINGS[kind]}</h3>
                {rows.map((scroll) => (
                  <article key={scroll.id} className="scroll-row">
                    <div className="scroll-subject">{scroll.subject}</div>
                    <div className="scroll-meta">
                      {scroll.from} · {relTime(scroll.date)}
                    </div>
                    <div className="scroll-actions">
                      <button className="btn small" onClick={() => dismissScroll(scroll.id)}>
                        Dismiss
                      </button>
                      <button className="btn small" onClick={() => makeTodo(scroll)}>
                        Make to-do
                      </button>
                      <button className="btn small primary" onClick={() => schedule(scroll)}>
                        Schedule
                      </button>
                    </div>
                  </article>
                ))}
              </section>
            );
          })}
        </>
      )}
    </Panel>
  );
}
