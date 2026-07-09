import { categoryFor } from '../hermes/intents/parse';
import { appendLedger } from '../hermes/ledgerStore';
import type { CalendarEvent, EventInput, EventPatch, EventStore } from '../state/types';
import { requestToast } from '../ui/toastBus';
import { GApiError, getGoogleAuth, gFetch, isSignedIn, subscribeGoogleAuth } from './auth';
import {
  EVENTS_API,
  GoogleSyncEngine,
  type GoogleEvent,
  type GoogleEventList,
  type SyncConsumer,
} from './syncEngine';

// Google Calendar API v3 adapter behind the same EventStore interface the
// local store implements. Event ids are prefixed 'g:' so the composite store
// can route mutations without asking; strip the prefix before talking to
// the API. Categories are inferred from title keywords (the palette's map).
//
// Reads are served from a live cache the sync engine keeps current for a
// window around today (ranges outside it fall back to a direct fetch).
// Writes are optimistic: the cache changes immediately, the API call
// reconciles or rolls back — with a plain-language Ledger entry and a Retry
// toast on failure. Deletions leave a short-lived tombstone so a stale poll
// can never resurrect what was just removed.

const GOOGLE_ID_PREFIX = 'g:';
const TEMP_ID_PREFIX = 'g:tmp_';
const LIST_CACHE_MS = 60_000;
const TOMBSTONE_TTL_MS = 5 * 60_000;

export function isGoogleId(id: string): boolean {
  return id.startsWith(GOOGLE_ID_PREFIX);
}

/** Optimistic creations carry a temp id until Google answers with the real one. */
function isTempId(id: string): boolean {
  return id.startsWith(TEMP_ID_PREFIX);
}

function rawId(id: string): string {
  return isGoogleId(id) ? id.slice(GOOGLE_ID_PREFIX.length) : id;
}

function newTempId(): string {
  return `${TEMP_ID_PREFIX}${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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

function eventBody(input: { title: string; start: string; end: string }): Record<string, unknown> {
  const timeZone = localTimeZone();
  return {
    summary: input.title,
    start: { dateTime: input.start, timeZone },
    end: { dateTime: input.end, timeZone },
  };
}

/** EventStore over the primary Google Calendar. Empty when signed out. */
export class GoogleCalendarStore implements EventStore, SyncConsumer {
  readonly source = 'google' as const;

  private listeners = new Set<() => void>();
  /** Grid-visible events inside the sync window, by prefixed id. */
  private synced = new Map<string, CalendarEvent>();
  private syncedWindow: { startMs: number; endMs: number } | null = null;
  /** Fallback per-range cache for views outside the sync window. */
  private rangeCache = new Map<string, { at: number; promise: Promise<CalendarEvent[]> }>();
  private listFailureLogged = false;
  /** Recently deleted here or on Google — never resurrected by a stale poll. */
  private tombstones = new Map<string, number>();
  /** In-flight guards: double-submits collapse into the same API call. */
  private pendingCreates = new Map<string, Promise<CalendarEvent>>();
  private pendingRemoves = new Map<string, Promise<void>>();
  private readonly engine = new GoogleSyncEngine(this);

  constructor() {
    subscribeGoogleAuth(() => {
      // An expired session keeps showing what we last knew; a real sign-out
      // (or account switch) drops Google truth from view entirely.
      if (getGoogleAuth().status === 'signed-out') {
        this.synced.clear();
        this.syncedWindow = null;
        this.tombstones.clear();
      }
      this.rangeCache.clear();
      this.listFailureLogged = false;
    });
  }

  /** Begin background sync (EventsProvider mount). Idempotent. */
  startSync(): void {
    this.engine.start();
  }

  /** Stop background sync and detach its listeners (unmount). Idempotent. */
  stopSync(): void {
    this.engine.stop();
  }

  /* ------------------------------------------------------------- reads ---- */

  async list(rangeStart: string, rangeEnd: string): Promise<CalendarEvent[]> {
    if (getGoogleAuth().status === 'signed-out') return [];
    const fromMs = new Date(rangeStart).getTime();
    const toMs = new Date(rangeEnd).getTime();
    const window = this.syncedWindow;
    if (window && fromMs >= window.startMs && toMs <= window.endMs) {
      return this.fromSynced(fromMs, toMs);
    }
    // Expired or reconnecting: no network, but the last-known picture shows.
    if (!isSignedIn()) return this.fromSynced(fromMs, toMs);
    // Outside the synced window (far navigation): fetch that range directly.
    const key = `${rangeStart}|${rangeEnd}`;
    const cached = this.rangeCache.get(key);
    if (cached && Date.now() - cached.at < LIST_CACHE_MS) return cached.promise;
    const promise = this.fetchRange(rangeStart, rangeEnd);
    this.rangeCache.set(key, { at: Date.now(), promise });
    return promise;
  }

  private fromSynced(fromMs: number, toMs: number): CalendarEvent[] {
    const out: CalendarEvent[] = [];
    this.synced.forEach((ev) => {
      if (new Date(ev.start).getTime() < toMs && new Date(ev.end).getTime() > fromMs) {
        out.push(ev);
      }
    });
    return out.sort((a, b) => a.start.localeCompare(b.start));
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
      const data = (await gFetch(`${EVENTS_API}?${params.toString()}`)) as GoogleEventList;
      const events = (data.items ?? [])
        .map(toCalendarEvent)
        .filter((ev): ev is CalendarEvent => ev !== null && !this.tombstones.has(ev.id));
      this.listFailureLogged = false;
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

  /* ----------------------------------------------------- sync consumer ---- */

  onFullSync(items: GoogleEvent[], windowStartMs: number, windowEndMs: number): number {
    this.purgeTombstones();
    const next = new Map<string, CalendarEvent>();
    for (const item of items) {
      const ev = toCalendarEvent(item);
      if (ev && !this.tombstones.has(ev.id)) next.set(ev.id, ev);
    }
    // Optimistic creations still awaiting their real id survive the swap.
    this.synced.forEach((ev, id) => {
      if (isTempId(id)) next.set(id, ev);
    });
    this.synced = next;
    this.syncedWindow = { startMs: windowStartMs, endMs: windowEndMs };
    this.rangeCache.clear();
    this.notify();
    return next.size;
  }

  onChanges(items: GoogleEvent[]): void {
    this.purgeTombstones();
    let changed = false;
    for (const item of items) {
      if (!item.id) continue;
      const id = `${GOOGLE_ID_PREFIX}${item.id}`;
      if (item.status === 'cancelled') {
        // Deleted on Google: it goes, even mid-edit — never resurrected.
        if (this.synced.delete(id)) changed = true;
        this.tombstones.set(id, Date.now());
        continue;
      }
      const ev = toCalendarEvent(item);
      if (!ev) {
        // Became a shape the grid skips (all-day, working location).
        if (this.synced.delete(id)) changed = true;
        continue;
      }
      if (this.tombstones.has(id)) continue; // deleted here; poll raced the DELETE
      this.synced.set(id, ev);
      changed = true;
    }
    if (changed) {
      this.rangeCache.clear();
      this.notify();
    }
  }

  private purgeTombstones(): void {
    const cutoff = Date.now() - TOMBSTONE_TTL_MS;
    this.tombstones.forEach((at, id) => {
      if (at < cutoff) this.tombstones.delete(id);
    });
  }

  /* ------------------------------------------------------------ writes ---- */

  async create(input: EventInput): Promise<CalendarEvent> {
    // Restoring a deleted Google event (undo): Google soft-deletes, so a
    // PATCH back to confirmed resurrects it with the same id.
    if (input.id && isGoogleId(input.id)) return this.revive(input);

    const dupeKey = `${input.title}|${input.start}|${input.end}`;
    const pending = this.pendingCreates.get(dupeKey);
    if (pending) return pending;

    const tempId = newTempId();
    const optimistic: CalendarEvent = {
      id: tempId,
      title: input.title,
      start: input.start,
      end: input.end,
      categoryId: input.categoryId,
      source: 'google',
    };
    this.synced.set(tempId, optimistic);
    this.notify();

    const promise = (async () => {
      try {
        const created = (await gFetch(EVENTS_API, {
          method: 'POST',
          body: JSON.stringify(eventBody(input)),
        })) as GoogleEvent;
        const mapped = toCalendarEvent(created);
        const result: CalendarEvent = mapped
          ? { ...mapped, categoryId: input.categoryId }
          : { ...optimistic, id: `${GOOGLE_ID_PREFIX}${created.id ?? ''}` };
        this.synced.delete(tempId);
        this.synced.set(result.id, result);
        this.rangeCache.clear();
        this.notify();
        this.engine.nudge();
        return result;
      } catch (err) {
        this.synced.delete(tempId);
        this.rangeCache.clear();
        this.notify();
        appendLedger(
          'error',
          `Google Calendar would not save “${input.title}” — nothing was written.`
        );
        requestToast({
          message: `“${input.title}” did not reach Google Calendar.`,
          actionLabel: 'Retry',
          onAction: () => void this.create(input).catch(() => {}),
        });
        throw err;
      } finally {
        this.pendingCreates.delete(dupeKey);
      }
    })();
    this.pendingCreates.set(dupeKey, promise);
    return promise;
  }

  private async revive(input: EventInput): Promise<CalendarEvent> {
    const id = input.id as string;
    const optimistic: CalendarEvent = {
      id,
      title: input.title,
      start: input.start,
      end: input.end,
      categoryId: input.categoryId,
      source: 'google',
    };
    this.tombstones.delete(id);
    this.synced.set(id, optimistic);
    this.rangeCache.clear();
    this.notify();
    try {
      const revived = (await gFetch(`${EVENTS_API}/${encodeURIComponent(rawId(id))}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...eventBody(input), status: 'confirmed' }),
      })) as GoogleEvent;
      const mapped = toCalendarEvent(revived);
      const result = mapped ? { ...mapped, categoryId: input.categoryId } : optimistic;
      this.synced.set(result.id, result);
      this.rangeCache.clear();
      this.notify();
      this.engine.nudge();
      return result;
    } catch {
      // The old id is beyond reviving — fall back to a fresh insert.
      this.synced.delete(id);
      this.notify();
      return this.create({ ...input, id: undefined });
    }
  }

  async update(id: string, patch: EventPatch): Promise<CalendarEvent> {
    const timeZone = localTimeZone();
    const body: Record<string, unknown> = {};
    if (patch.title !== undefined) body.summary = patch.title;
    if (patch.start) body.start = { dateTime: patch.start, timeZone };
    if (patch.end) body.end = { dateTime: patch.end, timeZone };

    const prev = this.synced.get(id) ?? null;
    if (prev) {
      this.synced.set(id, { ...prev, ...patch });
      this.rangeCache.clear();
      this.notify();
    }
    try {
      const data = (await gFetch(`${EVENTS_API}/${encodeURIComponent(rawId(id))}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      })) as GoogleEvent;
      const mapped = toCalendarEvent(data);
      if (!mapped) throw new Error('Google returned an event the grid cannot show.');
      // Category is a local notion: honor an explicit choice for this render.
      const result = patch.categoryId ? { ...mapped, categoryId: patch.categoryId } : mapped;
      if (this.synced.has(id)) {
        // Still present — a poll may have cancelled it while we were writing.
        this.synced.set(id, result);
        this.rangeCache.clear();
        this.notify();
      }
      this.engine.nudge();
      return result;
    } catch (err) {
      if (err instanceof GApiError && (err.status === 404 || err.status === 410)) {
        // Deleted on Google while we were editing: the deletion wins.
        this.synced.delete(id);
        this.tombstones.set(id, Date.now());
        this.rangeCache.clear();
        this.notify();
        const title = prev?.title ?? patch.title ?? 'That event';
        appendLedger('sync', `“${title}” was deleted on Google Calendar — the change had nowhere to land.`);
        requestToast({ message: `“${title}” was deleted on Google Calendar.` });
        throw err;
      }
      if (prev && !this.tombstones.has(id)) {
        this.synced.set(id, prev); // roll the optimistic change back
        this.rangeCache.clear();
        this.notify();
      }
      appendLedger('error', 'Google Calendar would not accept that change — it stands as before.');
      requestToast({
        message: 'Google Calendar did not accept that change.',
        actionLabel: 'Retry',
        onAction: () => void this.update(id, patch).catch(() => {}),
      });
      throw err;
    }
  }

  async remove(id: string): Promise<void> {
    const pending = this.pendingRemoves.get(id);
    if (pending) return pending;

    const prev = this.synced.get(id) ?? null;
    this.synced.delete(id);
    this.tombstones.set(id, Date.now());
    this.rangeCache.clear();
    this.notify();

    const promise = (async () => {
      try {
        await gFetch(`${EVENTS_API}/${encodeURIComponent(rawId(id))}`, { method: 'DELETE' });
        this.engine.nudge();
      } catch (err) {
        if (err instanceof GApiError && (err.status === 404 || err.status === 410)) {
          return; // already gone on Google — which is what we wanted
        }
        this.tombstones.delete(id);
        if (prev) this.synced.set(id, prev); // roll the optimistic delete back
        this.rangeCache.clear();
        this.notify();
        appendLedger(
          'error',
          `Google Calendar would not delete ${prev ? `“${prev.title}”` : 'that event'} — it is still there.`
        );
        requestToast({
          message: 'Google Calendar would not delete that event.',
          actionLabel: 'Retry',
          onAction: () => void this.remove(id).catch(() => {}),
        });
        throw err;
      } finally {
        this.pendingRemoves.delete(id);
      }
    })();
    this.pendingRemoves.set(id, promise);
    return promise;
  }

  /* ------------------------------------------------------------- wiring ---- */

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((fn) => fn());
  }
}
