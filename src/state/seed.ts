import { addDays, dateAtMinutes, dateKey, startOfWeek } from '../lib/time';
import type { LocalEventStore } from './localStore';
import { clearAllTemplates, createTemplate, getTemplates } from './recurrence';
import type { CategoryId } from './types';

const SEED_FLAG_V1 = 'seans-week:seeded:v1';
const SEED_FLAG_V2 = 'seans-week:seeded:v2';

/** Seeded templates begin this many weeks back, so past weeks have history. */
const HISTORY_WEEKS = 12;

const H = 60;

interface TemplateSpec {
  /** 0 = Sunday … 6 = Saturday (Date.getDay). */
  weekday: number;
  startMin: number;
  endMin: number;
  title: string;
  categoryId: CategoryId;
}

/** Sean's weekly rhythm — recurring across every week, past and future. */
const WEEKLY_RHYTHM: TemplateSpec[] = [
  // Gym mornings: push / pull / legs
  { weekday: 1, startMin: 7 * H, endMin: 8 * H, title: 'Gym — push day', categoryId: 'gym' },
  { weekday: 3, startMin: 7 * H, endMin: 8 * H, title: 'Gym — pull day', categoryId: 'gym' },
  { weekday: 5, startMin: 7 * H, endMin: 8 * H, title: 'Gym — legs day', categoryId: 'gym' },
  // Reading blocks
  { weekday: 2, startMin: 20 * H, endMin: 21 * H, title: 'Reading — Meditations', categoryId: 'reading' },
  { weekday: 4, startMin: 20 * H, endMin: 21 * H, title: 'Reading — Meditations', categoryId: 'reading' },
  { weekday: 0, startMin: 14 * H, endMin: 16 * H, title: 'Sunday reading', categoryId: 'reading' },
  // Family dinner
  { weekday: 0, startMin: 18 * H, endMin: 19 * H + 30, title: 'Family dinner', categoryId: 'dinner' },
  // Walk / watering
  { weekday: 2, startMin: 18 * H + 30, endMin: 19 * H + 15, title: 'Evening walk + watering', categoryId: 'walk' },
  // UPenn
  { weekday: 5, startMin: 13 * H, endMin: 15 * H, title: 'UPenn — seminar block', categoryId: 'upenn' },
];

/** The one v2 event that stays a one-off, laid in the current week (Tuesday). */
const ONE_OFF = {
  day: 1, // 0 = Monday … 6 = Sunday, relative to the current week
  startMin: 14 * H,
  endMin: 15 * H + 30,
  title: 'Quarterly review prep',
  categoryId: 'work' as CategoryId,
};

/** Every title the v1 one-week seed used — the migration sweeps these. */
const V1_TITLES = new Set([
  'Gym — push day',
  'Gym — pull day',
  'Gym — legs',
  'Team standup + planning',
  'Quarterly review prep',
  '1:1 with Dana',
  'Reading — Meditations',
  'Reading',
  'Sunday reading',
  'Evening walk + watering',
  'Walk / water the garden',
  'UPenn — seminar block',
  'Family dinner',
]);

function hasFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

function clearFlag(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** The spec's weekday within the current (Monday-start) week. */
function weekdayThisWeek(weekday: number, now: Date): Date {
  return addDays(startOfWeek(now), (weekday - 1 + 7) % 7);
}

function installTemplates(now: Date): void {
  for (const spec of WEEKLY_RHYTHM) {
    createTemplate({
      title: spec.title,
      categoryId: spec.categoryId,
      weekday: spec.weekday,
      startMin: spec.startMin,
      endMin: spec.endMin,
      sinceISO: dateKey(addDays(weekdayThisWeek(spec.weekday, now), -7 * HISTORY_WEEKS)),
    });
  }
}

async function installOneOffs(store: LocalEventStore, now: Date): Promise<void> {
  const day = addDays(startOfWeek(now), ONE_OFF.day);
  await store.create({
    title: ONE_OFF.title,
    start: dateAtMinutes(day, ONE_OFF.startMin).toISOString(),
    end: dateAtMinutes(day, ONE_OFF.endMin).toISOString(),
    categoryId: ONE_OFF.categoryId,
  });
}

/**
 * Seed v2: the weekly rhythm as RecurringTemplates plus one one-off. Fresh
 * installs get the templates directly; a device seeded with the v1 demo
 * week first has those one-offs swept (best effort, by their known titles).
 * Runs at most once.
 */
export async function seedIfNeeded(store: LocalEventStore): Promise<void> {
  try {
    if (localStorage.getItem(SEED_FLAG_V2)) return;
    // Claim the flag before any await: StrictMode double-runs the mount
    // effect, and two overlapping seeds would install every template twice.
    localStorage.setItem(SEED_FLAG_V2, '1');
  } catch {
    return;
  }
  const now = new Date();
  if (hasFlag(SEED_FLAG_V1)) {
    await store.removeWhere((ev) => V1_TITLES.has(ev.title));
    installTemplates(now);
    await installOneOffs(store, now);
  } else if (store.isEmpty() && getTemplates().length === 0) {
    installTemplates(now);
    await installOneOffs(store, now);
  }
}

/** Clear local events + templates and lay the v2 seed down fresh (Settings). */
export async function resetDemoData(store: LocalEventStore): Promise<void> {
  await store.clearAll();
  clearAllTemplates();
  clearFlag(SEED_FLAG_V1);
  clearFlag(SEED_FLAG_V2);
  await seedIfNeeded(store);
}
