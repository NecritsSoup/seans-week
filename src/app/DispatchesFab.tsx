import { useEffect, useRef, useState } from 'react';
import { useSuggestions } from '../hermes/suggestStore';
import { useScrolls } from '../scrolls/scrollsStore';

/**
 * The wax-seal button above the medallion: the floating door to Hermes'
 * Dispatches. Gives one soft pulse when fresh items arrive; the numeric
 * count lives on the topbar's Dispatches button (see DispatchesButton),
 * and the medallion stays clean for Card summoning.
 */
export function DispatchesFab() {
  const count = useScrolls().length + useSuggestions().length;
  const prevCount = useRef(count);
  const [pulsing, setPulsing] = useState(false);

  // Fresh items arriving — count rising, not merely changing — earn one pulse.
  useEffect(() => {
    if (count > prevCount.current) setPulsing(true);
    prevCount.current = count;
  }, [count]);

  return (
    <button
      className={`dispatch-fab${pulsing ? ' pulsing' : ''}`}
      title="Hermes' Dispatches (I)"
      aria-label={
        count > 0 ? `Hermes' Dispatches (I) — ${count} waiting` : "Hermes' Dispatches (I)"
      }
      onClick={() => window.dispatchEvent(new CustomEvent('hermes:dispatches'))}
      onAnimationEnd={(e) => {
        if (e.animationName === 'seal-pulse') setPulsing(false);
      }}
    >
      {/* Rolled scroll under a wax seal — gold line-work, terracotta wax. */}
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M7.2 4.6h9.4c1.3 0 2.3 1 2.3 2.3v4.9"
          stroke="var(--gold)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <path
          d="M7.2 4.6C6 4.6 5 5.6 5 6.9v10.3c0 1.3 1 2.3 2.2 2.3h4.6"
          stroke="var(--gold)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <path
          d="M8.6 9.2h6.8M8.6 12.2h4.6"
          stroke="var(--gold)"
          strokeWidth="1.2"
          strokeLinecap="round"
          opacity="0.65"
        />
        <circle
          cx="16.4"
          cy="16.6"
          r="4.4"
          fill="var(--accent)"
          stroke="var(--gold)"
          strokeWidth="1.2"
        />
        <path
          d="M16.4 14.5v4.2M14.6 15.55l3.6 2.1M18.2 15.55l-3.6 2.1"
          stroke="var(--accent-contrast)"
          strokeWidth="1.05"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}
