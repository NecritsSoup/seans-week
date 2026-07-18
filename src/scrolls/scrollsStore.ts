import { useSyncExternalStore } from 'react';
import { gFetch, isSignedIn, subscribeGoogleAuth } from '../google/auth';
import { appendLedger } from '../hermes/ledgerStore';
import { findMeetingLinkInText, type MeetingLink } from '../lib/meetingLink';

// Scrolls: the emails Hermes carries word of. Ports the legacy loadInbox
// (meeting/report digest) and loadPennScan (Penn email scan) Gmail queries,
// with dismissals persisted under the legacy 'upennScanAdded' key so scrolls
// handled in the old app stay handled here. Only subjects and senders are
// kept — bodies are never fetched for listing, and nothing here writes email
// content anywhere. The one exception: when a scroll is *scheduled*, that
// single thread's body is fetched once to carry its meeting link onto the
// calendar (see fetchScrollMeetingLink).

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
/** Epoch ms of the last successful fetch — 0 until one lands. */
let refreshedAt = 0;
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

/** When the scrolls were last fetched successfully (epoch ms; 0 = never). */
export function getScrollsRefreshedAt(): number {
  return refreshedAt;
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

/* ------------------------------------------------- meeting-link fetch ---- */

interface GmailBodyPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailBodyPart[];
}

export interface GmailFullThread {
  messages?: Array<{ payload?: GmailBodyPart }>;
}

/** Gmail's base64url body data → text (best effort; '' on bad data). */
function decodeBodyData(data: string): string {
  try {
    const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return '';
  }
}

/** The handful of entities that hide inside invite URLs and prose. */
function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/gi, ' ');
}

/**
 * HTML body → scannable text: hrefs are lifted out first (stripping tags
 * would otherwise swallow the very URLs invites put behind "Join" buttons),
 * then tags go and entities resolve.
 */
function htmlToScannableText(html: string): string {
  const hrefs = [...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
  const stripped = html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities([...hrefs, stripped].join('\n'));
}

/** Every text/plain and text/html body in a payload tree, in order. */
function collectBodyTexts(part: GmailBodyPart | undefined, out: string[]): void {
  if (!part) return;
  const data = part.body?.data;
  if (data && part.mimeType?.startsWith('text/')) {
    const text = decodeBodyData(data);
    if (text) out.push(part.mimeType === 'text/html' ? htmlToScannableText(text) : text);
  }
  for (const child of part.parts ?? []) collectBodyTexts(child, out);
}

/** The first recognized meeting link anywhere in a full thread's bodies. */
export function meetingLinkFromThread(thread: GmailFullThread): MeetingLink | null {
  const texts: string[] = [];
  for (const message of thread.messages ?? []) collectBodyTexts(message.payload, texts);
  for (const text of texts) {
    const link = findMeetingLinkInText(text);
    if (link) return link;
  }
  return null;
}

/**
 * Fetch one scroll's full thread (the only time a body is read — on the
 * Schedule action, never for listing) and pull the first recognized meeting
 * link from its text. Null when there is none; null with a quiet Ledger
 * note when Gmail would not answer — the schedule flow proceeds either way.
 */
export async function fetchScrollMeetingLink(threadId: string): Promise<MeetingLink | null> {
  if (!isSignedIn()) return null;
  let thread: GmailFullThread;
  try {
    thread = (await gFetch(`${GMAIL_API}/threads/${threadId}?format=full`)) as GmailFullThread;
  } catch {
    appendLedger(
      'error',
      'The scroll’s letter could not be opened for its meeting link — scheduling it without one.'
    );
    return null;
  }
  return meetingLinkFromThread(thread);
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
      refreshedAt = Date.now();
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
