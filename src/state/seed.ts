import { addDays, dateAtMinutes, startOfWeek } from '../lib/time';
import type { LocalEventStore } from './localStore';
import type { CategoryId } from './types';

const SEED_FLAG = 'seans-week:seeded:v1';

interface SeedSpec {
  /** 0 = Monday … 6 = Sunday, relative to the current week. */
  day: number;
  startMin: number;
  endMin: number;
  title: string;
  categoryId: CategoryId;
}

const H = 60;

const DEMO_WEEK: SeedSpec[] = [
  // Gym mornings
  { day: 0, startMin: 7 * H, endMin: 8 * H, title: 'Gym — push day', categoryId: 'gym' },
  { day: 2, startMin: 7 * H, endMin: 8 * H, title: 'Gym — pull day', categoryId: 'gym' },
  { day: 4, startMin: 7 * H, endMin: 8 * H, title: 'Gym — legs', categoryId: 'gym' },
  // Meetings / work
  { day: 0, startMin: 10 * H, endMin: 11 * H, title: 'Team standup + planning', categoryId: 'work' },
  { day: 1, startMin: 14 * H, endMin: 15 * H + 30, title: 'Quarterly review prep', categoryId: 'work' },
  { day: 3, startMin: 9 * H + 30, endMin: 10 * H + 15, title: '1:1 with Dana', categoryId: 'work' },
  // Reading blocks
  { day: 1, startMin: 20 * H, endMin: 21 * H, title: 'Reading — Meditations', categoryId: 'reading' },
  { day: 3, startMin: 20 * H, endMin: 21 * H, title: 'Reading', categoryId: 'reading' },
  { day: 6, startMin: 14 * H, endMin: 16 * H, title: 'Sunday reading', categoryId: 'reading' },
  // Walk / watering
  { day: 1, startMin: 18 * H + 30, endMin: 19 * H + 15, title: 'Evening walk + watering', categoryId: 'walk' },
  { day: 5, startMin: 9 * H, endMin: 9 * H + 45, title: 'Walk / water the garden', categoryId: 'walk' },
  // UPenn
  { day: 4, startMin: 13 * H, endMin: 15 * H, title: 'UPenn — seminar block', categoryId: 'upenn' },
  // Family dinner
  { day: 6, startMin: 18 * H, endMin: 19 * H + 30, title: 'Family dinner', categoryId: 'dinner' },
];

/** Populate a believable demo week on first run. Runs at most once. */
export async function seedIfNeeded(store: LocalEventStore): Promise<void> {
  try {
    if (localStorage.getItem(SEED_FLAG)) return;
  } catch {
    return;
  }
  if (store.isEmpty()) {
    const monday = startOfWeek(new Date());
    for (const spec of DEMO_WEEK) {
      const day = addDays(monday, spec.day);
      await store.create({
        title: spec.title,
        start: dateAtMinutes(day, spec.startMin).toISOString(),
        end: dateAtMinutes(day, spec.endMin).toISOString(),
        categoryId: spec.categoryId,
      });
    }
  }
  try {
    localStorage.setItem(SEED_FLAG, '1');
  } catch {
    /* ignore */
  }
}

/** Clear all local events and lay the demo week down fresh (Settings). */
export async function resetDemoData(store: LocalEventStore): Promise<void> {
  await store.clearAll();
  try {
    localStorage.removeItem(SEED_FLAG);
  } catch {
    /* ignore */
  }
  await seedIfNeeded(store);
}
