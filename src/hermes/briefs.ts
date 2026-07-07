import { dateKey, fmtClock, minutesOfDay } from '../lib/time';
import type { CalendarEvent } from '../state/types';
import { epigramOfDay } from './quotes';
import type { StreakInfo } from './streaks';

// Hermes the Oracle: a morning brief before noon, an evening review after
// 8pm — each at most two sentences, each shown at most once per day.

export type BriefKind = 'morning' | 'evening';

const STAMP_PREFIX = 'seans-week:brief:';

function stampKey(kind: BriefKind, now: Date): string {
  return `${STAMP_PREFIX}${kind}:${dateKey(now)}`;
}

/** Which brief is due right now, or null (stamps + time windows). */
export function dueBrief(now: Date = new Date()): BriefKind | null {
  const hour = now.getHours();
  const kind: BriefKind | null = hour < 12 ? 'morning' : hour >= 20 ? 'evening' : null;
  if (!kind) return null;
  try {
    if (localStorage.getItem(stampKey(kind, now))) return null;
  } catch {
    return null;
  }
  return kind;
}

/** Record that a brief was shown, so it never repeats within the day. */
export function stampBrief(kind: BriefKind, now: Date = new Date()): void {
  try {
    localStorage.setItem(stampKey(kind, now), '1');
  } catch {
    /* storage unavailable */
  }
}

const COUNT_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];

function countWord(n: number): string {
  return n < COUNT_WORDS.length ? COUNT_WORDS[n] : String(n);
}

function hasOverlap(events: CalendarEvent[]): boolean {
  const sorted = [...events].sort((a, b) => a.start.localeCompare(b.start));
  for (let i = 1; i < sorted.length; i++) {
    if (new Date(sorted[i].start) < new Date(sorted[i - 1].end)) return true;
  }
  return false;
}

/** " — three dispatches await", folded into the brief's first sentence. */
function dispatchNote(count: number): string {
  if (count <= 0) return '';
  return count === 1
    ? ' — one dispatch awaits'
    : ` — ${countWord(count).toLowerCase()} dispatches await`;
}

/** "Three events today; first is Gym at 7:00 — two dispatches await. Festina lente." */
export function morningBriefText(
  todaysEvents: CalendarEvent[],
  now: Date = new Date(),
  dispatchCount = 0
): string {
  const epigram = epigramOfDay(now).latin;
  const note = dispatchNote(dispatchCount);
  if (todaysEvents.length === 0) {
    return note
      ? `A clear day, nothing on the calendar yet${note}. ${epigram}.`
      : `A clear day — nothing on the calendar yet. ${epigram}.`;
  }
  const sorted = [...todaysEvents].sort((a, b) => a.start.localeCompare(b.start));
  const first = sorted[0];
  const firstTime = fmtClock(minutesOfDay(new Date(first.start)));
  const overlapNote = hasOverlap(sorted) ? ', two of them overlapping' : '';
  const plural = sorted.length === 1 ? 'event' : 'events';
  return `${countWord(sorted.length)} ${plural} today${overlapNote}; first is ${first.title} at ${firstTime}${note}. ${epigram}.`;
}

/** What happened, streak status, tomorrow's first event — two sentences. */
export function eveningBriefText(
  todaysEvents: CalendarEvent[],
  tomorrowsEvents: CalendarEvent[],
  streaks: StreakInfo[],
  now: Date = new Date()
): string {
  const done = todaysEvents.filter((ev) => new Date(ev.end) <= now).length;
  const best = [...streaks].sort((a, b) => b.count - a.count)[0];
  const streakNote =
    best && best.count > 0
      ? ` and your ${best.label.toLowerCase()} streak stands at ${best.count} day${best.count === 1 ? '' : 's'}`
      : '';
  const donePlural = done === 1 ? 'event' : 'events';
  const firstSentence =
    done > 0
      ? `${countWord(done)} ${donePlural} came and went today${streakNote}.`
      : `A quiet day on the calendar${streakNote}.`;

  const tomorrowSorted = [...tomorrowsEvents].sort((a, b) => a.start.localeCompare(b.start));
  const secondSentence =
    tomorrowSorted.length > 0
      ? `Tomorrow begins with ${tomorrowSorted[0].title} at ${fmtClock(
          minutesOfDay(new Date(tomorrowSorted[0].start))
        )}.`
      : 'Tomorrow is open — rest well.';
  return `${firstSentence} ${secondSentence}`;
}
