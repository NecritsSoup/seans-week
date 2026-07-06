import { useSyncExternalStore } from 'react';
import { appendLedger } from '../hermes/ledgerStore';

// Google Identity Services token-client flow, ported from the legacy app.
// The access token lives in memory only (like legacy): a page reload means
// signing in again with one click. Everything here is defensive — a Google
// failure can never take the local calendar down with it.

export const GOOGLE_CLIENT_ID =
  '850025069073-0p24u0u6vep9sjvmjtihnsfuimtn3n0p.apps.googleusercontent.com';
export const GOOGLE_SCOPES =
  'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.readonly';

const GSI_SRC = 'https://accounts.google.com/gsi/client';

/* ------------------------------------------------- minimal GIS typings ---- */

interface TokenResponse {
  access_token?: string;
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

export type GoogleAuthStatus = 'signed-out' | 'connecting' | 'signed-in';

export interface GoogleAuthState {
  status: GoogleAuthStatus;
  /** Best-effort account email (from the Gmail profile), for the status chip. */
  email: string | null;
}

let state: GoogleAuthState = { status: 'signed-out', email: null };
let accessToken: string | null = null;
let tokenClient: TokenClient | null = null;
let gsiPromise: Promise<void> | null = null;

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
      if (response.access_token) {
        onSignedIn(response.access_token);
      } else {
        setState({ status: 'signed-out', email: null });
      }
    },
    error_callback: (error) => {
      setState({ status: 'signed-out', email: null });
      // A closed popup is a decision, not an error worth recording.
      if (error.type !== 'popup_closed') {
        appendLedger('error', 'Google sign-in did not complete — you can try again any time.');
      }
    },
  });
  return tokenClient;
}

/* --------------------------------------------------------------- actions ---- */

function onSignedIn(token: string): void {
  accessToken = token;
  setState({ status: 'signed-in', email: state.email });
  appendLedger('sync', 'Signed in with Google — the live calendar and scrolls are flowing.');
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

/** Start the sign-in flow (opens the Google consent/account popup). */
export async function signIn(): Promise<void> {
  if (state.status === 'connecting' || isSignedIn()) return;
  setState({ status: 'connecting', email: null });
  try {
    await loadGsi();
    const client = ensureTokenClient();
    if (!client) throw new Error('Google sign-in is unavailable.');
    client.requestAccessToken();
  } catch {
    setState({ status: 'signed-out', email: null });
    appendLedger('error', 'Google sign-in could not start — the sign-in script would not load.');
  }
}

/** Drop the token (revoking it best-effort) and return to local-only mode. */
export function signOut(): void {
  const token = accessToken;
  accessToken = null;
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

/** Authorized fetch against Google APIs; ports the legacy gFetch. */
export async function gFetch(url: string, opts: RequestInit = {}): Promise<unknown> {
  if (!accessToken) throw new Error('Not signed in with Google.');
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string> | undefined),
  };
  const res = await fetch(url, { ...opts, headers });
  if (res.status === 401) {
    accessToken = null;
    setState({ status: 'signed-out', email: null });
    appendLedger('sync', 'The Google session expired — sign in again when you need it.');
    throw new Error('Google sign-in expired.');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Google API ${res.status}: ${text.slice(0, 150)}`);
  }
  if (res.status === 204) return {};
  return res.json();
}
