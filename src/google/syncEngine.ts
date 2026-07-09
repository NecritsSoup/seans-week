import { useSyncExternalStore } from 'react';
import { appendLedger } from '../hermes/ledgerStore';
import { GApiError, gFetch, isSignedIn, subscribeGoogleAuth } from './auth';

// Incremental sync against the primary Google Calendar, per the documented
// protocol (developers.google.com/calendar/api/guides/sync): one full
// events.list over a window around today (singleEvents, timeMin/timeMax, no
// orderBy — ordered lists never return a sync token) captures nextSyncToken;
// after that, events.list?syncToken=… fetches only what changed, including
// cancellations. HTTP 410 GONE means the token aged out: discard it and
// resync in full. Polls run every 60s while the tab is visible and the user
// is signed in, pause while hidden, fire immediately on visibility/focus
// regain and after local writes, and back off exponentially on failure.
// Sync is invisible: the Ledger hears only about meaningful moments.

export const EVENTS_API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

/** The synced window: 60 days back, 180 days forward from today. */
const WINDOW_PAST_DAYS = 60;
const WINDOW_FUTURE_DAYS = 180;

const POLL_MS = 60_000;
const MAX_BACKOFF_MS = 10 * 60_000;
/** Window-focus events piggyback on visibility; don't re-sync within this. */
const FOCUS_THROTTLE_MS = 10_000;
/** Consecutive failures before the Ledger hears about it (once). */
const FAILURE_LEDGER_AFTER = 3;
const PAGE_SIZE = '250';

/* ------------------------------------------------------------- API types ---- */

export interface GoogleEventTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

export interface GoogleEvent {
  id?: string;
  summary?: string;
  status?: string;
  eventType?: string;
  start?: GoogleEventTime;
  end?: GoogleEventTime;
}

export interface GoogleEventList {
  items?: GoogleEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

/** Where sync results land — implemented by GoogleCalendarStore. */
export interface SyncConsumer {
  /**
   * Replace everything inside the synced window (initial sync or a full
   * resync after 410). Returns how many grid-visible events resulted.
   */
  onFullSync(items: GoogleEvent[], windowStartMs: number, windowEndMs: number): number;
  /** Apply incremental changes; items with status 'cancelled' are deletions. */
  onChanges(items: GoogleEvent[]): void;
}

/* ------------------------------------------------------------ sync status ---- */

export type SyncPhase = 'idle' | 'syncing' | 'live' | 'error';

export interface SyncStatus {
  phase: SyncPhase;
  /** Epoch ms of the last successful sync, for "last synced Xs ago". */
  lastSyncedAt: number | null;
}

let syncStatus: SyncStatus = { phase: 'idle', lastSyncedAt: null };
const statusListeners = new Set<() => void>();

function setSyncStatus(patch: Partial<SyncStatus>): void {
  syncStatus = { ...syncStatus, ...patch };
  statusListeners.forEach((fn) => fn());
}

export function getSyncStatus(): SyncStatus {
  return syncStatus;
}

export function subscribeSyncStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

/** React hook: sync phase and last-synced time, for Settings. */
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribeSyncStatus, getSyncStatus);
}

/* ---------------------------------------------------------------- engine ---- */

export class GoogleSyncEngine {
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private syncToken: string | null = null;
  private failures = 0;
  private failureAnnounced = false;
  private announcedFirstSync = false;
  private wasSignedIn = false;
  private unsubAuth: (() => void) | null = null;

  constructor(private readonly consumer: SyncConsumer) {}

  private readonly onVisibility = (): void => {
    if (document.hidden) {
      this.clearTimer(); // asleep while the tab is hidden
    } else {
      this.syncSoon(0); // fresh the moment you come back
    }
  };

  private readonly onFocus = (): void => {
    if (document.hidden) return;
    const last = syncStatus.lastSyncedAt ?? 0;
    if (Date.now() - last > FOCUS_THROTTLE_MS) this.syncSoon(0);
  };

  /** Attach listeners and begin polling (idempotent). */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.wasSignedIn = isSignedIn();
    this.unsubAuth = subscribeGoogleAuth(() => this.onAuthChange());
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('focus', this.onFocus);
    if (this.wasSignedIn) this.syncSoon(0);
  }

  /** Detach every listener and stop the poll timer (idempotent). */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.unsubAuth?.();
    this.unsubAuth = null;
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('focus', this.onFocus);
    this.clearTimer();
  }

  /** A local write just landed on Google — pick up its delta promptly. */
  nudge(): void {
    if (this.running && isSignedIn()) this.syncSoon(0);
  }

  private onAuthChange(): void {
    const signedIn = isSignedIn();
    if (signedIn && !this.wasSignedIn) {
      // A fresh session (or a different account): start from a clean slate.
      this.syncToken = null;
      this.failures = 0;
      this.failureAnnounced = false;
      this.announcedFirstSync = false;
      this.syncSoon(0);
    } else if (!signedIn && this.wasSignedIn) {
      this.clearTimer();
      this.syncToken = null;
      setSyncStatus({ phase: 'idle' });
    }
    this.wasSignedIn = signedIn;
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private syncSoon(delayMs: number): void {
    if (!this.running || !isSignedIn()) return;
    this.clearTimer();
    this.timer = setTimeout(() => void this.tick(), delayMs);
  }

  private async tick(): Promise<void> {
    if (!this.running || !isSignedIn() || document.hidden) return;
    if (!this.inFlight) {
      this.inFlight = this.sync().finally(() => {
        this.inFlight = null;
      });
    }
    await this.inFlight;
    if (!this.running || !isSignedIn() || document.hidden) return;
    const delay =
      this.failures === 0
        ? POLL_MS
        : Math.min(POLL_MS * 2 ** Math.min(this.failures, 8), MAX_BACKOFF_MS);
    this.syncSoon(delay);
  }

  private async sync(): Promise<void> {
    setSyncStatus({ phase: 'syncing' });
    try {
      if (this.syncToken) {
        await this.deltaSync();
      } else {
        await this.fullSync();
      }
      this.recordSuccess();
    } catch (err) {
      if (err instanceof GApiError && err.status === 410) {
        // The token aged out — Google's documented cue to resync in full.
        this.syncToken = null;
        try {
          await this.fullSync();
          this.recordSuccess();
          appendLedger('sync', 'Google Calendar was resynced from the top — the week is current.');
          return;
        } catch {
          /* fall through to failure accounting */
        }
      }
      this.failures += 1;
      setSyncStatus({ phase: 'error' });
      if (this.failures >= FAILURE_LEDGER_AFTER && !this.failureAnnounced) {
        this.failureAnnounced = true;
        appendLedger(
          'error',
          'Google Calendar has not answered for a while — still trying quietly.'
        );
      }
    }
  }

  private recordSuccess(): void {
    this.failures = 0;
    this.failureAnnounced = false;
    setSyncStatus({ phase: 'live', lastSyncedAt: Date.now() });
  }

  /** Initial full list over the window; captures nextSyncToken at the end. */
  private async fullSync(): Promise<void> {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - WINDOW_PAST_DAYS);
    const end = new Date(start);
    end.setDate(end.getDate() + WINDOW_PAST_DAYS + WINDOW_FUTURE_DAYS);

    const items: GoogleEvent[] = [];
    let pageToken: string | undefined;
    let nextSyncToken: string | null = null;
    do {
      const params = new URLSearchParams({
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        singleEvents: 'true',
        maxResults: PAGE_SIZE,
      });
      if (pageToken) params.set('pageToken', pageToken);
      const data = (await gFetch(`${EVENTS_API}?${params.toString()}`)) as GoogleEventList;
      items.push(...(data.items ?? []));
      pageToken = data.nextPageToken;
      if (data.nextSyncToken) nextSyncToken = data.nextSyncToken;
    } while (pageToken);

    this.syncToken = nextSyncToken;
    const count = this.consumer.onFullSync(items, start.getTime(), end.getTime());
    if (!this.announcedFirstSync) {
      this.announcedFirstSync = true;
      appendLedger(
        'sync',
        `Google Calendar is in sync — ${count} event${count === 1 ? '' : 's'} on the horizon.`
      );
    }
  }

  /** Fetch only what changed since the last token, cancellations included. */
  private async deltaSync(): Promise<void> {
    const token = this.syncToken;
    if (!token) return this.fullSync();
    const changed: GoogleEvent[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({ syncToken: token, maxResults: PAGE_SIZE });
      if (pageToken) params.set('pageToken', pageToken);
      const data = (await gFetch(`${EVENTS_API}?${params.toString()}`)) as GoogleEventList;
      changed.push(...(data.items ?? []));
      pageToken = data.nextPageToken;
      if (data.nextSyncToken) this.syncToken = data.nextSyncToken;
    } while (pageToken);
    if (changed.length > 0) this.consumer.onChanges(changed);
  }
}
