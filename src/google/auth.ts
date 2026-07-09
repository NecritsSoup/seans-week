import { useSyncExternalStore } from 'react';
import { appendLedger } from '../hermes/ledgerStore';
import { requestToast } from '../ui/toastBus';

// Google Identity Services token-client flow, ported from the legacy app.
// The access token lives in memory only, but a localStorage hint remembers
// that this browser once connected, so app load attempts one silent token
// (prompt: '') and sync resumes without a click. Tokens expire after ~1h;
// a near-expiry or 401 triggers one silent refresh, and only if that fails
// does the session become 'expired' — a quiet chip state, never a surprise
// popup (popups only ever follow a user gesture). Everything here is
// defensive — a Google failure can never take the local calendar down.

export const GOOGLE_CLIENT_ID =
  '850025069073-0p24u0u6vep9sjvmjtihnsfuimtn3n0p.apps.googleusercontent.com';
export const GOOGLE_SCOPES =
  'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.readonly';

const GSI_SRC = 'https://accounts.google.com/gsi/client';
/** "This browser connected Google before" — safe to try a silent restore. */
const HINT_KEY = 'seans-week:google-connected:v1';
/** Refresh this long before the token's stated expiry. */
const EXPIRY_MARGIN_MS = 2 * 60_000;
/** A silent token attempt that never calls back counts as a failure. */
const SILENT_TIMEOUT_MS = 15_000;

/* ------------------------------------------------- minimal GIS typings ---- */

interface TokenResponse {
  access_token?: string;
  /** Lifetime in seconds (~3600). */
  expires_in?: number;
  error?: string;
}

interface TokenClientError {
  type?: string;
  message?: string;
}

interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void;
}

interface OAuth2Namespace {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    callback: (response: TokenResponse) => void;
    error_callback?: (error: TokenClientError) => void;
  }): TokenClient;
  revoke(token: string, done?: () => void): void;
}

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: OAuth2Namespace } };
  }
}

/* ------------------------------------------------------------ auth state ---- */

export type GoogleAuthStatus = 'signed-out' | 'connecting' | 'signed-in' | 'expired';

export interface GoogleAuthState {
  status: GoogleAuthStatus;
  /** Best-effort account email (from the Gmail profile), for the status chip. */
  email: string | null;
}

let state: GoogleAuthState = { status: 'signed-out', email: null };
let accessToken: string | null = null;
let expiresAt: number | null = null;
let tokenClient: TokenClient | null = null;
let gsiPromise: Promise<void> | null = null;
/** The one in-flight token request; concurrent callers share it. */
let tokenRequest: Promise<boolean> | null = null;
/** Resolves the in-flight request when the GIS callback fires. */
let pendingToken: { settle: (ok: boolean) => void; silent: boolean } | null = null;
let expiryAnnounced = false;

const listeners = new Set<() => void>();

function setState(next: GoogleAuthState): void {
  state = next;
  listeners.forEach((fn) => fn());
}

export function getGoogleAuth(): GoogleAuthState {
  return state;
}

export function isSignedIn(): boolean {
  return state.status === 'signed-in' && accessToken !== null;
}

export function subscribeGoogleAuth(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React hook: the current Google auth state, reactive to sign-in/out. */
export function useGoogleAuth(): GoogleAuthState {
  return useSyncExternalStore(subscribeGoogleAuth, getGoogleAuth);
}

/* --------------------------------------------------------- API error type ---- */

/** A Google API response outside 2xx, with the status the stores route on. */
export class GApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'GApiError';
  }
}

/* ------------------------------------------------------------ GIS script ---- */

/** Lazy-load the Google Identity Services script exactly once. */
function loadGsi(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!gsiPromise) {
    gsiPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = GSI_SRC;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => {
        gsiPromise = null;
        script.remove();
        reject(new Error('The Google sign-in script would not load.'));
      };
      document.head.appendChild(script);
    });
  }
  return gsiPromise;
}

function ensureTokenClient(): TokenClient | null {
  if (tokenClient) return tokenClient;
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) return null;
  tokenClient = oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: GOOGLE_SCOPES,
    callback: (response) => {
      const pending = pendingToken;
      pendingToken = null;
      if (response.access_token) {
        onSignedIn(response.access_token, response.expires_in, pending?.silent ?? false);
        pending?.settle(true);
      } else {
        // Silent attempts fail silently; interactive ones return to signed-out.
        if (!pending?.silent) setState({ status: 'signed-out', email: null });
        pending?.settle(false);
      }
    },
    error_callback: (error) => {
      const pending = pendingToken;
      pendingToken = null;
      if (pending?.silent) {
        pending.settle(false);
        return;
      }
      setState({ status: 'signed-out', email: null });
      // A closed popup is a decision, not an error worth recording.
      if (error.type !== 'popup_closed') {
        appendLedger('error', 'Google sign-in did not complete — you can try again any time.');
      }
      pending?.settle(false);
    },
  });
  return tokenClient;
}

/* ----------------------------------------------------------- token flow ---- */

/**
 * Ask GIS for a token. `silent` uses prompt: '' — the standard returning-user
 * path that resolves without UI when a Google session and prior consent
 * exist. Concurrent callers share one request.
 */
function requestToken(silent: boolean): Promise<boolean> {
  if (tokenRequest) return tokenRequest;
  tokenRequest = new Promise<boolean>((resolve) => {
    let settled = false;
    const settle = (ok: boolean) => {
      if (settled) return;
      settled = true;
      if (pendingToken?.settle === settle) pendingToken = null;
      resolve(ok);
    };
    const client = ensureTokenClient();
    if (!client) {
      settle(false);
      return;
    }
    pendingToken = { settle, silent };
    if (silent) setTimeout(() => settle(false), SILENT_TIMEOUT_MS);
    try {
      client.requestAccessToken(silent ? { prompt: '' } : undefined);
    } catch {
      settle(false);
    }
  });
  void tokenRequest.finally(() => {
    tokenRequest = null;
  });
  return tokenRequest;
}

function onSignedIn(token: string, expiresInSeconds: number | undefined, silent: boolean): void {
  accessToken = token;
  expiresAt = Date.now() + (expiresInSeconds ?? 3600) * 1000;
  expiryAnnounced = false;
  setState({ status: 'signed-in', email: state.email });
  try {
    localStorage.setItem(HINT_KEY, '1');
  } catch {
    /* the hint is a convenience, not a requirement */
  }
  // A silent restore is routine; only a deliberate sign-in is worth a line.
  if (!silent) {
    appendLedger('sync', 'Signed in with Google — the live calendar and scrolls are flowing.');
  }
  // Best-effort account label; the gmail.readonly scope covers the profile.
  void gFetch('https://gmail.googleapis.com/gmail/v1/users/me/profile')
    .then((profile) => {
      const email = (profile as { emailAddress?: string }).emailAddress;
      if (email && isSignedIn()) setState({ status: 'signed-in', email });
    })
    .catch(() => {
      /* the chip simply shows "Signed in" */
    });
}

/** The token is gone and a quiet refresh did not bring one back. */
function markSessionExpired(): void {
  accessToken = null;
  expiresAt = null;
  if (state.status !== 'signed-in') return;
  setState({ status: 'expired', email: state.email });
  if (!expiryAnnounced) {
    expiryAnnounced = true;
    appendLedger('sync', 'The Google session expired — reconnect when you want the live calendar.');
    requestToast({
      message: 'The Google session expired.',
      actionLabel: 'Reconnect',
      onAction: () => void signIn(),
    });
  }
}

/**
 * A usable token, refreshed silently when missing or near expiry. Throws
 * when signed out, or when a session existed but could not be renewed.
 */
async function ensureFreshToken(): Promise<string> {
  if (accessToken && expiresAt && Date.now() < expiresAt - EXPIRY_MARGIN_MS) return accessToken;
  if (state.status === 'signed-in' || state.status === 'expired') {
    const ok = await requestToken(true);
    if (ok && accessToken) return accessToken;
    markSessionExpired();
    throw new GApiError(401, 'Google sign-in expired.');
  }
  throw new Error('Not signed in with Google.');
}

/* --------------------------------------------------------------- actions ---- */

/**
 * Called once at app start: if this browser connected Google before, try one
 * silent token (no UI). Success restores sync without a click; failure
 * leaves the app quietly signed out. A no-op for never-connected browsers —
 * they load nothing Google at all.
 */
export function initGoogleAuth(): void {
  if (state.status !== 'signed-out') return;
  let hint = false;
  try {
    hint = localStorage.getItem(HINT_KEY) === '1';
  } catch {
    /* no storage, no hint */
  }
  if (!hint) return;
  void (async () => {
    try {
      await loadGsi();
      await requestToken(true);
    } catch {
      /* stay signed out quietly */
    }
  })();
}

/** Start the sign-in flow (opens the Google consent/account popup). */
export async function signIn(): Promise<void> {
  if (state.status === 'connecting' || isSignedIn()) return;
  setState({ status: 'connecting', email: state.email });
  try {
    await loadGsi();
    const ok = await requestToken(false);
    // The GIS callbacks already handled state; this is only a backstop.
    if (!ok && getGoogleAuth().status === 'connecting') {
      setState({ status: 'signed-out', email: null });
    }
  } catch {
    setState({ status: 'signed-out', email: null });
    appendLedger('error', 'Google sign-in could not start — the sign-in script would not load.');
  }
}

/** Drop the token (revoking it best-effort) and return to local-only mode. */
export function signOut(): void {
  const token = accessToken;
  accessToken = null;
  expiresAt = null;
  expiryAnnounced = false;
  try {
    localStorage.removeItem(HINT_KEY);
  } catch {
    /* best effort */
  }
  setState({ status: 'signed-out', email: null });
  appendLedger('sync', 'Signed out of Google — the calendar is this device only again.');
  if (token) {
    try {
      window.google?.accounts?.oauth2?.revoke(token, () => {});
    } catch {
      /* revocation is best-effort */
    }
  }
}

/* ----------------------------------------------------------- API helper ---- */

function authorizedFetch(url: string, opts: RequestInit, token: string): Promise<Response> {
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string> | undefined),
  };
  return fetch(url, { ...opts, headers });
}

/**
 * Authorized fetch against Google APIs. Refreshes a stale token before the
 * request, and answers a 401 with one silent refresh and one retry before
 * declaring the session expired. Non-2xx responses throw GApiError.
 */
export async function gFetch(url: string, opts: RequestInit = {}): Promise<unknown> {
  const token = await ensureFreshToken();
  let res = await authorizedFetch(url, opts, token);
  if (res.status === 401) {
    accessToken = null;
    const ok = await requestToken(true);
    if (!ok || !accessToken) {
      markSessionExpired();
      throw new GApiError(401, 'Google sign-in expired.');
    }
    res = await authorizedFetch(url, opts, accessToken);
    if (res.status === 401) {
      markSessionExpired();
      throw new GApiError(401, 'Google sign-in expired.');
    }
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new GApiError(res.status, `Google API ${res.status}: ${text.slice(0, 150)}`);
  }
  if (res.status === 204) return {};
  return res.json();
}
