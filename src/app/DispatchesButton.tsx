import { useSuggestions } from '../hermes/suggestStore';
import { useScrolls } from '../scrolls/scrollsStore';
import { DispatchesCoachMark } from './DispatchesCoachMark';

/** Sealed-scroll glyph, line-drawn to match the topbar medallion. */
function SealGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7.2 4.6h9.4c1.3 0 2.3 1 2.3 2.3v4.9"
        stroke="var(--gold)"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M7.2 4.6C6 4.6 5 5.6 5 6.9v10.3c0 1.3 1 2.3 2.2 2.3h4.6"
        stroke="var(--gold)"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <circle
        cx="16.4"
        cy="16.6"
        r="4.4"
        fill="var(--accent)"
        stroke="var(--gold)"
        strokeWidth="1.3"
      />
    </svg>
  );
}

/**
 * The always-visible door to Hermes' Dispatches, in the topbar's right
 * cluster: sealed-scroll glyph, a "Dispatches" label where the bar has
 * room, and the authoritative waiting-count badge. The first-run coach
 * mark anchors here too.
 */
export function DispatchesButton() {
  const count = useScrolls().length + useSuggestions().length;
  return (
    <span className="dispatch-entry">
      <button
        className="nav-btn dispatch-btn"
        title="Hermes' Dispatches (I)"
        aria-label={
          count > 0 ? `Hermes' Dispatches (I) — ${count} waiting` : "Hermes' Dispatches (I)"
        }
        onClick={() => window.dispatchEvent(new CustomEvent('hermes:dispatches'))}
      >
        <SealGlyph />
        <span className="dispatch-btn-label">Dispatches</span>
        {count > 0 && (
          <span className="nav-badge tnum" aria-hidden="true">
            {count}
          </span>
        )}
      </button>
      <DispatchesCoachMark />
    </span>
  );
}
