import type { CalendarEvent } from '../state/types';
import type { HermesPose } from './art';
import type { StreakInfo } from './streaks';

/**
 * Which Hermes shows up — the legacy pickHermesPose, rethought for streaks:
 * cheering when every laurel is intact, thinking before a busy stretch,
 * resting in the evening, greeting in the morning, walking otherwise.
 */
export function pickHermesPose(
  todaysEvents: CalendarEvent[],
  streaks: StreakInfo[],
  now: Date = new Date()
): HermesPose {
  const allIntact = streaks.length > 0 && streaks.every((s) => s.count > 0);
  if (allIntact) return 'cheering';
  const remaining = todaysEvents.filter((ev) => new Date(ev.end) > now).length;
  if (remaining >= 4) return 'thinking';
  const hour = now.getHours();
  if (hour >= 20) return 'resting';
  if (hour < 12) return 'greeting';
  return 'walking';
}
