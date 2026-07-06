import { categoryFor } from '../hermes/intents/parse';
import { appendLedger } from '../hermes/ledgerStore';
import type { CalendarEvent, EventInput, EventPatch, EventStore } from '../state/types';
import { gFetch, isSignedIn, subscribeGoogleAuth } from './auth';

// Google Calendar API v3 adapter behind the same EventStore interface the
// local store implements. Event ids are prefixed 'g:' so the composite store
// can route mutations without asking; strip the prefix before talking to
// the API. Categories are inferred from title keywords (the palette's map).

const API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const GOOGLE_ID_PREFIX = 'g:';
const LIST_CACHE_MS = 60_000;

export function isGoogleId(id: string): boolean {
  return id.startsWith(GOOGLE_ID_PREFIX);
}

function rawId(id: string): string {
  return isGoogleId(id) ? id.slice(GOOGLE_ID_PREFIX.length) : id;
}

interface GoogleEventTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

interface GoogleEvent {
  id?: string;
  summary?: string;
  status?: string;
  eventType?: string;
  start?: GoogleEventTime;
  end?: GoogleEventTime;
}

interface GoogleEventList {
  items?: GoogleEvent[];
}

function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'America/New_York';
  }
}

/** Map an API event to a CalendarEvent; null for the shapes the grid skips. */
function toCalendarEvent(item: GoogleEvent): CalendarEvent | null {
  if (!item.id || item.status === 'cancelled') return null;
  // Legacy skipped working-location blocks and date-only (all-day) events.
  if (item.eventType && /working[_-]?location/i.test(item.eventType)) return null;
  if (!item.start?.dateTime || !item.end?.dateTime) return null;
  const title = item.summary || '(no title)';
  return {
    id: `${GOOGLE_ID_PREFIX}${item.id}`,
    title,
    start: item.start.dateTime,
    end: item.end.dateTime,
    categoryId: categoryFor(title) ?? 'work',
    source: 'google',
  };
}

/** EventStore over the primary Google Calendar. Empty when signed out. */
export class GoogleCalendarStore implements EventStore {
  readonly source = 'google' as const;

  private listeners = new Set<() => void>();
  private listCache = new Map<string, { at: number; promise: Promise<CalendarEvent[]> }>();
  private listFailureLogged = false;
  private announceNextFetch = false;

  constructor() {
    subscribeGoogleAuth(() => {
      this.listCache.clear();
      this.listFailureLogged = false;
      if (isSignedIn()) this.announceNextFetch = true;
    });
  }

  async list(rangeStart: string, rangeEnd: string): Promise<CalendarEvent[]> {
    if (!isSignedIn()) return [];
    const key = `${rangeStart}|${rangeEnd}`;
    const cached = this.listCache.get(key);
    if (cached && Date.now() - cached.at < LIST_CACHE_MS) return cached.promise;
    const promise = this.fetchRange(rangeStart, rangeEnd);
    this.listCache.set(key, { at: Date.now(), promise });
    return promise;
  }

  private async fetchRange(rangeStart: string, rangeEnd: string): Promise<CalendarEvent[]> {
    try {
      const params = new URLSearchParams({
        timeMin: rangeStart,
        timeMax: rangeEnd,
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '250',
      });
      const data = (await gFetch(`${API}?${params.toString()}`)) as GoogleEventList;
      const events = (data.items ?? [])
        .map(toCalendarEvent)
        .filter((ev): ev is CalendarEvent => ev !== null);
      this.listFailureLogged = false;
      if (this.announceNextFetch) {
        this.announceNextFetch = false;
        appendLedger(
          'sync',
          `Google Calendar is connected — ${events.length} event${events.length === 1 ? '' : 's'} in view.`
        );
      }
      return events;
    } catch {
      if (!this.listFailureLogged) {
        this.listFailureLogged = true;
        appendLedger(
          'error',
          'Google Calendar could not be reached — showing what lives on this device.'
        );
      }
      return [];
    }
  }

  async create(input: EventInput): Promise<CalendarEvent> {
    const timeZone = localTimeZone();
    const body = {
      summary: input.title,
      start: { dateTime: input.start, timeZone },
      end: { dateTime: input.end, timeZone },
    };
    try {
      // Restoring a deleted Google event (undo): Google soft-deletes, so a
      // PATCH back to confirmed resurrects it with the same id.
      if (input.id && isGoogleId(input.id)) {
        try {
          const revived = (await gFetch(`${API}/${encodeURIComponent(rawId(input.id))}`, {
            method: 'PATCH',
            body: JSON.stringify({ ...body, status: 'confirmed' }),
          })) as GoogleEvent;
          const mapped = toCalendarEvent(revived);
          if (mapped) {
            this.invalidate();
            return mapped;
          }
        } catch {
          /* fall through to a fresh insert */
        }
      }
      const created = (await gFetch(API, {
        method: 'POST',
        body: JSON.stringify(body),
      })) as GoogleEvent;
      this.invalidate();
      return (
        toCalendarEvent(created) ?? {
          id: `${GOOGLE_ID_PREFIX}${created.id ?? ''}`,
          title: input.title,
          start: input.start,
          end: input.end,
          categoryId: input.categoryId,
          source: 'google',
        }
      );
    } catch (err) {
      appendLedger(
        'error',
        `Google Calendar would not save “${input.title}” — nothing was written.`
      );
      throw err;
    }
  }

  async update(id: string, patch: EventPatch): Promise<CalendarEvent> {
    const timeZone = localTimeZone();
    const body: Record<string, unknown> = {};
    if (patch.title !== undefined) body.summary = patch.title;
    if (patch.start) body.start = { dateTime: patch.start, timeZone };
    if (patch.end) body.end = { dateTime: patch.end, timeZone };
    try {
      const data = (await gFetch(`${API}/${encodeURIComponent(rawId(id))}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      })) as GoogleEvent;
      this.invalidate();
      const mapped = toCalendarEvent(data);
      if (!mapped) throw new Error('Google returned an event the grid cannot show.');
      // Category is a local notion: honor an explicit choice for this render.
      return patch.categoryId ? { ...mapped, categoryId: patch.categoryId } : mapped;
    } catch (err) {
      appendLedger('error', 'Google Calendar would not accept that change — it stands as before.');
      throw err;
    }
  }

  async remove(id: string): Promise<void> {
    try {
      await gFetch(`${API}/${encodeURIComponent(rawId(id))}`, { method: 'DELETE' });
      this.invalidate();
    } catch (err) {
      appendLedger('error', 'Google Calendar would not delete that event — it is still there.');
      throw err;
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private invalidate(): void {
    this.listCache.clear();
    this.listeners.forEach((fn) => fn());
  }
}
