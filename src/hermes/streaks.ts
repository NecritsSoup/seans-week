import { useMemo, useState } from 'react';
import { addDays, dateKey, startOfDay } from '../lib/time';
import { useEvents } from '../state/EventsContext';
import type { CalendarEvent } from '../state/types';

// Habit streaks, kept in the legacy 'habitLog' localStorage shape:
// { 'YYYY-MM-DD': { gym: true, reading: true, walk: true } }.
// A day counts for a habit if an event of that category existed that day —
// derived from the event store, no manual check-in required.

export type HabitId = 'gym' | 'reading' | 'walk';

export const HABITS: HabitId[] = ['gym', 'reading', 'walk'];

export const HABIT_LABELS: Record<HabitId, string> = {
  gym: 'Gym',
  reading: 'Reading',
  walk: 'Walk',
};

export type HabitLog = Record<string, Partial<Record<HabitId, boolean>>>;

const STORAGE_KEY = 'habitLog'; // legacy key — old streaks carry over

export function getHabitLog(): HabitLog {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? (parsed as HabitLog) : {};
  } catch {
    return {};
  }
}

function saveHabitLog(log: HabitLog): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
  } catch {
    /* storage unavailable */
  }
}

/** Mark habit days from calendar events. Returns the merged log. */
export function recordHabits(events: CalendarEvent[]): HabitLog {
  const log = getHabitLog();
  let changed = false;
  for (const ev of events) {
    const habit = ev.categoryId as HabitId;
    if (!HABITS.includes(habit)) continue;
    const key = dateKey(new Date(ev.start));
    const day = log[key] ?? {};
    if (!day[habit]) {
      log[key] = { ...day, [habit]: true };
      changed = true;
    }
  }
  if (changed) saveHabitLog(log);
  return log;
}

/**
 * Consecutive days a habit was kept, walking back from today (legacy
 * computeStreak) — with one kindness: a not-yet-done today doesn't break
 * the chain, it just doesn't count.
 */
export function computeStreak(log: HabitLog, habit: HabitId, now: Date = new Date()): number {
  let d = startOfDay(now);
  if (!log[dateKey(d)]?.[habit]) d = addDays(d, -1); // grace: today still ahead
  let streak = 0;
  while (log[dateKey(d)]?.[habit]) {
    streak += 1;
    d = addDays(d, -1);
  }
  return streak;
}

export interface StreakInfo {
  habit: HabitId;
  label: string;
  /** Consecutive days, counting today when already kept. */
  count: number;
  /** True if the habit is already kept today. */
  keptToday: boolean;
  /** Streak is 0 but the habit appeared within the last week — a wilted leaf. */
  wilted: boolean;
}

/** Live streaks for the tracked habits, derived from the last month of events. */
export function useStreaks(): StreakInfo[] {
  const [rangeStart] = useState(() => addDays(startOfDay(new Date()), -31));
  const [rangeEnd] = useState(() => addDays(startOfDay(new Date()), 1));
  const events = useEvents(rangeStart, rangeEnd);

  return useMemo(() => {
    const log = recordHabits(events);
    const now = new Date();
    const todayKey = dateKey(now);
    return HABITS.map((habit) => {
      const count = computeStreak(log, habit, now);
      const keptToday = Boolean(log[todayKey]?.[habit]);
      let wilted = false;
      if (count === 0) {
        for (let i = 1; i <= 7 && !wilted; i++) {
          if (log[dateKey(addDays(now, -i))]?.[habit]) wilted = true;
        }
      }
      return { habit, label: HABIT_LABELS[habit], count, keptToday, wilted };
    });
  }, [events]);
}
