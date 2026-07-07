import {
  DAY_END_MIN,
  DAY_START_MIN,
  addDays,
  dateAtMinutes,
  dateKey,
  fmtRange,
  minutesOfDay,
  startOfDay,
  startOfWeek,
} from '../lib/time';
import type { Scroll } from '../scrolls/scrollsStore';
import { weekdayName, type RecurringTemplate } from '../state/recurrence';
import type { Todo } from '../state/todos';
import type { CalendarEvent, CategoryId } from '../state/types';
import { HABITS, HABIT_LABELS, computeStreak, type HabitId, type HabitLog } from './streaks';

// Hermes the Oracle's eyes: deterministic, fully client-side suggestion
// sources. Each scans real state — past events, streaks, stale to-dos,
// unanswered Penn scrolls — and proposes one concrete, reversible action
// with a human "because" line explaining what Hermes noticed. Ids are
// stable composites of source + evidence, so dismissals persist until the
// evidence itself materially changes (see suggestStore).

/** Weekly pattern: how far back to look and what counts as a rhythm. */
const PATTERN_WEEKS = 6;
const PATTERN_MIN_WEEKS = 3;
const PATTERN_WINDOW_MIN = 45;

/** To-dos older than this many days earn a scheduling nudge. */
const TODO_NUDGE_DAYS = 3;

/** Penn scrolls unanswered for this many days earn a follow-up. */
const SCROLL_NUDGE_DAYS = 2;

export type SuggestionKind = 'pattern' | 'streak' | 'todo' | 'scroll';

interface SuggestionBase {
  /** Stable composite of source + evidence — dismissals key off this. */
  id: string;
  kind: SuggestionKind;
  /** Card headline: "Make “Coffee with Dana” weekly". */
  title: string;
  /** The museum-label line: what Hermes noticed. */
  because: string;
  /** The concrete proposal: "Every Tuesday, 9:00 – 10:00". */
  meta: string;
}

export interface PatternSuggestion extends SuggestionBase {
  kind: 'pattern';
  eventTitle: string;
  categoryId: CategoryId;
  /** 0 = Sunday … 6 = Saturday (Date.getDay). */
  weekday: number;
  startMin: number;
  endMin: number;
}

export interface StreakSuggestion extends SuggestionBase {
  kind: 'streak';
  habit: HabitId;
  eventTitle: string;
  categoryId: CategoryId;
  /** 'YYYY-MM-DD' — the proposed day. */
  dayKey: string;
  startMin: number;
  endMin: number;
}

export interface TodoSuggestion extends SuggestionBase {
  kind: 'todo';
  todoId: string;
  text: string;
  categoryId: CategoryId;
  dayKey: string;
  startMin: number;
  endMin: number;
}

export interface ScrollSuggestion extends SuggestionBase {
  kind: 'scroll';
  scrollId: string;
  subject: string;
  categoryId: CategoryId;
  dayKey: string;
  startMin: number;
  endMin: number;
}

export type Suggestion =
  | PatternSuggestion
  | StreakSuggestion
  | TodoSuggestion
  | ScrollSuggestion;

export interface SuggestionInputs {
  /** Events spanning the pattern lookback through the coming two weeks. */
  events: CalendarEvent[];
  templates: RecurringTemplate[];
  todos: Todo[];
  scrolls: Scroll[];
  habitLog: HabitLog;
  now: Date;
}

/* -------------------------------------------------------------- helpers ---- */

const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'];

function countWord(n: number): string {
  return n < COUNT_WORDS.length ? COUNT_WORDS[n] : String(n);
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Middle element of the sorted values — deterministic, outlier-resistant. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}

function roundToFive(min: number): number {
  return Math.round(min / 5) * 5;
}

function fmtDay(day: Date): string {
  return day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function durationOf(ev: CalendarEvent): number {
  return Math.max(
    15,
    Math.round((new Date(ev.end).getTime() - new Date(ev.start).getTime()) / 60_000)
  );
}

function overlapsAny(events: CalendarEvent[], day: Date, startMin: number, endMin: number): boolean {
  const start = dateAtMinutes(day, startMin).getTime();
  const end = dateAtMinutes(day, endMin).getTime();
  return events.some(
    (ev) => !ev.allDay && new Date(ev.start).getTime() < end && new Date(ev.end).getTime() > start
  );
}

interface Slot {
  day: Date;
  dayKey: string;
  startMin: number;
  endMin: number;
}

/**
 * The next free 9–12 morning hour within two weeks, skipping slots already
 * claimed by an earlier suggestion in this same pass.
 */
function nextFreeMorningSlot(
  events: CalendarEvent[],
  now: Date,
  taken: Set<string>
): Slot | null {
  const today = startOfDay(now);
  for (let d = 0; d < 14; d++) {
    const day = addDays(today, d);
    for (const hour of [9, 10, 11]) {
      const startMin = hour * 60;
      if (d === 0 && startMin <= minutesOfDay(now)) continue;
      const key = `${dateKey(day)}:${startMin}`;
      if (taken.has(key)) continue;
      if (overlapsAny(events, day, startMin, startMin + 60)) continue;
      taken.add(key);
      return { day, dayKey: dateKey(day), startMin, endMin: startMin + 60 };
    }
  }
  return null;
}

/* ------------------------------------------------------- weekly pattern ---- */

/**
 * Title/category clusters recurring on the same weekday within ±45 minutes
 * across >= 3 distinct weeks of one-offs, not already covered by a weekly
 * template → "Make it weekly".
 */
function patternSuggestions(
  events: CalendarEvent[],
  templates: RecurringTemplate[],
  now: Date
): PatternSuggestion[] {
  const horizonMs = addDays(startOfDay(now), -7 * PATTERN_WEEKS).getTime();
  const nowMs = now.getTime();
  const clusters = new Map<string, CalendarEvent[]>();
  for (const ev of events) {
    if (ev.recurring || ev.allDay) continue;
    const startMs = new Date(ev.start).getTime();
    if (startMs < horizonMs || startMs >= nowMs) continue;
    const key = `${normalizeTitle(ev.title)}|${ev.categoryId}|${new Date(ev.start).getDay()}`;
    const group = clusters.get(key);
    if (group) group.push(ev);
    else clusters.set(key, [ev]);
  }

  const out: PatternSuggestion[] = [];
  for (const group of clusters.values()) {
    if (group.length < PATTERN_MIN_WEEKS) continue;
    // Keep the occurrences within ±45min of the group's median start.
    const med = median(group.map((ev) => minutesOfDay(new Date(ev.start))));
    const cluster = group.filter(
      (ev) => Math.abs(minutesOfDay(new Date(ev.start)) - med) <= PATTERN_WINDOW_MIN
    );
    const weeks = new Set(cluster.map((ev) => dateKey(startOfWeek(new Date(ev.start)))));
    if (weeks.size < PATTERN_MIN_WEEKS) continue;

    const latest = [...cluster].sort((a, b) => b.start.localeCompare(a.start))[0];
    const weekday = new Date(latest.start).getDay();
    const covered = templates.some(
      (t) => t.weekday === weekday && normalizeTitle(t.title) === normalizeTitle(latest.title)
    );
    if (covered) continue;

    const startMin = roundToFive(median(cluster.map((ev) => minutesOfDay(new Date(ev.start)))));
    const endMin = Math.min(startMin + median(cluster.map(durationOf)), DAY_END_MIN);
    if (startMin < DAY_START_MIN || endMin <= startMin) continue;
    const dayName = weekdayName(weekday);
    out.push({
      id: `pattern:${normalizeTitle(latest.title)}:w${weekday}:h${Math.round(startMin / 60)}`,
      kind: 'pattern',
      title: `Make “${latest.title}” weekly`,
      because: `You've had “${latest.title}” on ${dayName}s ${countWord(weeks.size)} weeks running.`,
      meta: `Every ${dayName}, ${fmtRange(startMin, endMin)}`,
      eventTitle: latest.title,
      categoryId: latest.categoryId,
      weekday,
      startMin,
      endMin,
    });
  }
  return out;
}

/* -------------------------------------------------------- streak rescue ---- */

/**
 * A habit with a live streak but nothing of its category on the calendar
 * for the rest of this week → offer a block at its usual day and hour.
 */
function streakSuggestions(
  events: CalendarEvent[],
  habitLog: HabitLog,
  now: Date
): StreakSuggestion[] {
  const today = startOfDay(now);
  const weekStart = startOfWeek(now);
  const weekEndMs = addDays(weekStart, 7).getTime();
  const horizonMs = addDays(today, -7 * PATTERN_WEEKS).getTime();
  const nowMinutes = minutesOfDay(now);

  const out: StreakSuggestion[] = [];
  for (const habit of HABITS) {
    const aheadThisWeek = events.some((ev) => {
      const startMs = new Date(ev.start).getTime();
      return ev.categoryId === habit && startMs >= today.getTime() && startMs < weekEndMs;
    });
    if (aheadThisWeek) continue;

    const streak = computeStreak(habitLog, habit, now);
    if (streak < 1) continue;

    const history = events.filter((ev) => {
      const startMs = new Date(ev.start).getTime();
      return ev.categoryId === habit && startMs >= horizonMs && startMs < now.getTime();
    });
    if (history.length === 0) continue;

    // The hour this habit usually occupies — skip anything outside day bounds.
    const startMin = roundToFive(median(history.map((ev) => minutesOfDay(new Date(ev.start)))));
    const endMin = Math.min(startMin + median(history.map(durationOf)), DAY_END_MIN);
    if (startMin < DAY_START_MIN || startMin >= DAY_END_MIN || endMin <= startMin) continue;

    // Its usual weekday first, then the rest of the week, soonest first.
    const freq = new Map<number, number>();
    for (const ev of history) {
      const wd = new Date(ev.start).getDay();
      freq.set(wd, (freq.get(wd) ?? 0) + 1);
    }
    const candidates: Date[] = [];
    for (let day = today; day.getTime() < weekEndMs; day = addDays(day, 1)) candidates.push(day);
    candidates.sort(
      (a, b) =>
        (freq.get(b.getDay()) ?? 0) - (freq.get(a.getDay()) ?? 0) || a.getTime() - b.getTime()
    );
    const day = candidates.find(
      (d) => d.getTime() > today.getTime() || startMin > nowMinutes
    );
    if (!day) continue;

    const label = HABIT_LABELS[habit].toLowerCase();
    const latest = [...history].sort((a, b) => b.start.localeCompare(a.start))[0];
    out.push({
      id: `streak:${habit}:${dateKey(weekStart)}`,
      kind: 'streak',
      title: `Keep the ${label} streak`,
      because: `Your ${label} streak is ${streak} day${streak === 1 ? '' : 's'} — nothing on the calendar this week yet.`,
      meta: `${fmtDay(day)}, ${fmtRange(startMin, endMin)}`,
      habit,
      eventTitle: latest.title,
      categoryId: habit,
      dayKey: dateKey(day),
      startMin,
      endMin,
    });
  }
  return out;
}

/* ------------------------------------------------------------ todo nudge ---- */

/** Age in whole days of a to-do, read from its `t<epoch-ms>` id. */
function todoAgeDays(todo: Todo, now: Date): number | null {
  const match = /^t(\d+)$/.exec(todo.id);
  if (!match) return null;
  const created = Number(match[1]);
  if (!Number.isFinite(created) || created > now.getTime()) return null;
  return Math.floor((now.getTime() - created) / 86_400_000);
}

/** Pending to-dos older than three days → offer the next free morning hour. */
function todoSuggestions(
  events: CalendarEvent[],
  todos: Todo[],
  now: Date,
  taken: Set<string>
): TodoSuggestion[] {
  const out: TodoSuggestion[] = [];
  for (const todo of todos) {
    if (todo.done) continue;
    const age = todoAgeDays(todo, now);
    if (age === null || age < TODO_NUDGE_DAYS) continue;
    const slot = nextFreeMorningSlot(events, now, taken);
    if (!slot) continue;
    out.push({
      id: `todo:${todo.id}`,
      kind: 'todo',
      title: `Schedule “${todo.text}”?`,
      because: `It has waited ${countWord(age)} days on the list.`,
      meta: `${fmtDay(slot.day)}, ${fmtRange(slot.startMin, slot.endMin)}`,
      todoId: todo.id,
      text: todo.text,
      categoryId: 'upenn',
      dayKey: slot.dayKey,
      startMin: slot.startMin,
      endMin: slot.endMin,
    });
  }
  return out;
}

/* -------------------------------------------------------- scroll follow-up ---- */

/** Penn scrolls sitting unanswered past two days → a gentle nudge. */
function scrollSuggestions(
  events: CalendarEvent[],
  scrolls: Scroll[],
  now: Date,
  taken: Set<string>
): ScrollSuggestion[] {
  const out: ScrollSuggestion[] = [];
  for (const scroll of scrolls) {
    if (scroll.kind !== 'penn') continue;
    const age = Math.floor((now.getTime() - new Date(scroll.date).getTime()) / 86_400_000);
    if (age < SCROLL_NUDGE_DAYS) continue;
    const slot = nextFreeMorningSlot(events, now, taken);
    if (!slot) continue;
    out.push({
      id: `scrollnudge:${scroll.id}`,
      kind: 'scroll',
      title: `Answer “${scroll.subject}”?`,
      because: `From ${scroll.from}, ${countWord(age)} days in the bag.`,
      meta: `${fmtDay(slot.day)}, ${fmtRange(slot.startMin, slot.endMin)}`,
      scrollId: scroll.id,
      subject: scroll.subject,
      categoryId: 'upenn',
      dayKey: slot.dayKey,
      startMin: slot.startMin,
      endMin: slot.endMin,
    });
  }
  return out;
}

/* ------------------------------------------------------------- the pass ---- */

/** Every suggestion the evidence supports, ordered by conviction. */
export function computeSuggestions(inputs: SuggestionInputs): Suggestion[] {
  const { events, templates, todos, scrolls, habitLog, now } = inputs;
  const taken = new Set<string>();
  return [
    ...patternSuggestions(events, templates, now),
    ...streakSuggestions(events, habitLog, now),
    ...todoSuggestions(events, todos, now, taken),
    ...scrollSuggestions(events, scrolls, now, taken),
  ];
}
