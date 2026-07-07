import { useSyncExternalStore } from 'react';
import { gFetch, isSignedIn, subscribeGoogleAuth } from '../google/auth';
import { appendLedger } from '../hermes/ledgerStore';

// Scrolls: the emails Hermes carries word of. Ports the legacy loadInbox
// (meeting/report digest) and loadPennScan (Penn email scan) Gmail queries,
// with dismissals persisted under the legacy 'upennScanAdded' key so scrolls
// handled in the old app stay handled here. Only subjects and senders are
// kept — bodies are never fetched, and nothing here writes email content
// anywhere.

const DISMISSED_KEY = 'upennScanAdded';
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const REFRESH_MS = 15 * 60 * 1000; // legacy refreshed every 15 minutes

const MEETING_QUERY = 'newer_than:3d from:e.read.ai';
const PENN_QUERY = 'newer_than:30d from:upenn.edu';
const MEETING_EXCLUDE = /weekly kickoff|report remaining/i;

export type ScrollKind = 'meeting' | 'penn';

export interface Scroll {
  /** Gmail thread id. */
  id: string;
  kind: ScrollKind;
  from: string;
  subject: string;
  /** ISO date of the newest message. */
  date: string;
}

export type ScrollsStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ScrollsState {
  status: ScrollsStatus;
  scrolls: Scroll[];
}

/* ------------------------------------------------------------- dismissed ---- */

function loadDismissed(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]');
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

let dismissed = loadDismissed();

/** Legacy markScanAdded: remember a handled scroll forever. */
export function dismissScroll(id: string): void {
  if (dismissed.includes(id)) return;
  dismissed = [...dismissed, id];
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(dismissed));
  } catch {
    /* keep the in-memory copy */
  }
  publish();
}

/* ----------------------------------------------------------------- state ---- */

let state: ScrollsState = { status: 'idle', scrolls: [] };
let visible: Scroll[] = [];
const listeners = new Set<() => void>();
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let fetchFailureLogged = false;

function publish(): void {
  visible = state.scrolls.filter((s) => !dismissed.includes(s.id));
  listeners.forEach((fn) => fn());
}

function setState(next: ScrollsState): void {
  state = next;
  publish();
}

export function getScrollsStatus(): ScrollsStatus {
  return state.status;
}

/** Scrolls not yet dismissed, meetings first, newest within each kind. */
export function getScrolls(): Scroll[] {
  return visible;
}

export function subscribeScrolls(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React hook: undismissed scrolls, reactive to fetches and dismissals. */
export function useScrolls(): Scroll[] {
  return useSyncExternalStore(subscribeScrolls, getScrolls);
}

/** React hook: the fetch status, for the panel's skeleton/empty states. */
export function useScrollsStatus(): ScrollsStatus {
  return useSyncExternalStore(subscribeScrolls, getScrollsStatus);
}

/* -------------------------------------------------------------- fetching ---- */

interface GmailThreadStub {
  id?: string;
}

interface GmailHeader {
  name?: string;
  value?: string;
}

interface GmailThread {
  messages?: Array<{ payload?: { headers?: GmailHeader[] } }>;
}

function header(headers: GmailHeader[], name: string): string {
  return headers.find((h) => h.name === name)?.value ?? '';
}

/** "Jane Doe <jane@x.edu>" → "Jane Doe"; bare addresses pass through. */
function senderName(from: string): string {
  const name = from.replace(/<[^>]*>/, '').replace(/["']/g, '').trim();
  return name || from.trim() || 'Unknown sender';
}

function cleanSubject(subject: string): string {
  return subject.replace(/^🗓\s*/, '').replace(/⏪\s*/, '').trim() || '(no subject)';
}

async function fetchThreads(query: string, kind: ScrollKind, max: number): Promise<Scroll[]> {
  const params = new URLSearchParams({ q: query, maxResults: String(max) });
  const list = (await gFetch(`${GMAIL_API}/threads?${params.toString()}`)) as {
    threads?: GmailThreadStub[];
  };
  const stubs = (list.threads ?? []).filter((t): t is { id: string } => Boolean(t.id)).slice(0, max);
  const threads = await Promise.all(
    stubs.map(async (stub) => {
      const full = (await gFetch(
        `${GMAIL_API}/threads/${stub.id}?format=metadata` +
          '&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=From'
      )) as GmailThread;
      const headers = full.messages?.[0]?.payload?.headers ?? [];
      const dateHeader = header(headers, 'Date');
      return {
        id: stub.id,
        kind,
        from: senderName(header(headers, 'From')),
        subject: cleanSubject(header(headers, 'Subject')),
        date: dateHeader ? new Date(dateHeader).toISOString() : new Date().toISOString(),
      };
    })
  );
  return threads;
}

let inFlight: Promise<void> | null = null;

/** Fetch both digests. No-op while signed out or while a fetch is running. */
export function refreshScrolls(): Promise<void> {
  if (!isSignedIn()) {
    setState({ status: 'idle', scrolls: [] });
    return Promise.resolve();
  }
  if (inFlight) return inFlight;
  setState({ status: 'loading', scrolls: state.scrolls });
  inFlight = (async () => {
    try {
      const [meetings, penn] = await Promise.all([
        fetchThreads(MEETING_QUERY, 'meeting', 6),
        fetchThreads(PENN_QUERY, 'penn', 6),
      ]);
      const kept = meetings.filter((s) => !MEETING_EXCLUDE.test(s.subject));
      setState({ status: 'ready', scrolls: [...kept, ...penn] });
      fetchFailureLogged = false;
    } catch {
      setState({ status: 'error', scrolls: state.scrolls });
      if (!fetchFailureLogged && isSignedIn()) {
        fetchFailureLogged = true;
        appendLedger('error', 'The scrolls could not be fetched from Gmail — I will try again.');
      }
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

// Follow the account: fetch on sign-in and every 15 minutes after; drop
// everything on sign-out.
subscribeGoogleAuth(() => {
  if (isSignedIn()) {
    if (!refreshTimer) refreshTimer = setInterval(() => void refreshScrolls(), REFRESH_MS);
    void refreshScrolls();
  } else {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
    setState({ status: 'idle', scrolls: [] });
  }
});
