// A window-event bus so non-React modules (the Google auth client, the
// event stores) can raise a toast without holding a React context. The
// ToastBridge component listens and forwards to the real ToastProvider.

const TOAST_EVENT = 'hermes:toast';

export interface ToastRequest {
  message: string;
  /** Optional action button, e.g. "Retry" or "Reconnect". */
  actionLabel?: string;
  onAction?: () => void;
  duration?: number;
}

/** Ask the UI to show a toast; a no-op if nothing is listening. */
export function requestToast(detail: ToastRequest): void {
  window.dispatchEvent(new CustomEvent<ToastRequest>(TOAST_EVENT, { detail }));
}

export function subscribeToastRequests(listener: (request: ToastRequest) => void): () => void {
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<ToastRequest>).detail;
    if (detail?.message) listener(detail);
  };
  window.addEventListener(TOAST_EVENT, handler);
  return () => window.removeEventListener(TOAST_EVENT, handler);
}
