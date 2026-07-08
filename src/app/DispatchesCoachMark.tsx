import { useEffect, useState } from 'react';
import {
  markDispatchesIntroduced,
  useDispatchesIntroduced,
} from '../dispatches/introStore';

const APPEAR_DELAY_MS = 1800;

/**
 * The once-ever coach mark beside the Dispatches seal. Appears a moment
 * after first load, speaks two sentences in Hermes's voice, and never
 * returns after dismissal or after the hub opens through any door (the
 * panel marks the introduction made — see introStore).
 */
export function DispatchesCoachMark() {
  const introduced = useDispatchesIntroduced();
  const [ripe, setRipe] = useState(false);

  useEffect(() => {
    if (introduced) return;
    const timer = window.setTimeout(() => setRipe(true), APPEAR_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [introduced]);

  if (introduced || !ripe) return null;

  return (
    <div className="coach-mark" role="status" aria-label="About Hermes' Dispatches">
      <button
        className="coach-dismiss"
        aria-label="Dismiss"
        onClick={() => markDispatchesIntroduced()}
      >
        ✕
      </button>
      <p className="coach-text">
        I keep word from your inbox, my suggestions, and Penn matters here — off your stage until
        you want them.
      </p>
      <button
        className="btn small primary"
        onClick={() => {
          markDispatchesIntroduced();
          window.dispatchEvent(new CustomEvent('hermes:dispatches'));
        }}
      >
        Show me
      </button>
    </div>
  );
}
