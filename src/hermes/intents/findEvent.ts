import { isSameDay } from '../../lib/time';
import type { CalendarEvent } from '../../state/types';
import { categoryFor } from './parse';

// The legacy findEventByQuery, rebuilt over the local store: score by title
// token overlap (titles only — descriptions once matched "dinner" to a
// Reading block), pin to the queried day when one was named, and prefer
// upcoming occurrences over past ones.

const FILLER = new Set(['the', 'and', 'with', 'for', 'that', 'this', 'one']);

/**
 * Candidate events for a fuzzy query, best first. Returns every event tied
 * for the top score — more than one means the palette should ask which.
 */
export function findEventsByQuery(
  events: CalendarEvent[],
  query: string,
  queryDay: Date | null,
  now: Date = new Date()
): CalendarEvent[] {
  const keywords = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2 && !FILLER.has(w));
  const categoryId = categoryFor(query);
  if (keywords.length === 0 && !categoryId) return [];

  let scored = events
    .map((event) => {
      const title = event.title.toLowerCase();
      let score = 0;
      for (const keyword of keywords) {
        if (title.includes(keyword)) score += 2;
      }
      if (categoryId && event.categoryId === categoryId) score += 1;
      return { event, score };
    })
    .filter((m) => m.score > 0);
  if (scored.length === 0) return [];

  if (queryDay) {
    const onDay = scored.filter((m) => isSameDay(new Date(m.event.start), queryDay));
    if (onDay.length > 0) scored = onDay;
  }

  const nowMs = now.getTime();
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aUpcoming = new Date(a.event.start).getTime() >= nowMs;
    const bUpcoming = new Date(b.event.start).getTime() >= nowMs;
    if (aUpcoming !== bUpcoming) return aUpcoming ? -1 : 1;
    const aMs = new Date(a.event.start).getTime();
    const bMs = new Date(b.event.start).getTime();
    return aUpcoming ? aMs - bMs : bMs - aMs; // upcoming: soonest; past: latest
  });

  const topScore = scored[0].score;
  const top = scored.filter((m) => m.score === topScore);

  // A single clear day+score winner shouldn't drag in every recurrence:
  // when a day was queried, ties are real ambiguity; without one, only
  // same-day ties are (two gyms Friday), otherwise take the soonest.
  if (queryDay) return top.map((m) => m.event);
  const first = top[0].event;
  const sameDayTies = top.filter((m) => isSameDay(new Date(m.event.start), new Date(first.start)));
  return sameDayTies.map((m) => m.event);
}
