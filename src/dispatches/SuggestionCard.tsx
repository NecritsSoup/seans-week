import type { Suggestion, SuggestionKind } from '../hermes/suggest';
import { useSwipeDismiss } from './useSwipeDismiss';

const SUGGESTION_ICONS: Record<SuggestionKind, string> = {
  pattern: '↻',
  streak: '❧',
  todo: '✎',
  scroll: '✉',
};

const ACCEPT_LABELS: Record<SuggestionKind, string> = {
  pattern: 'Make it weekly',
  streak: 'Add it',
  todo: 'Schedule',
  scroll: 'Schedule',
};

interface SuggestionCardProps {
  suggestion: Suggestion;
  /** Entrance stagger etc., computed by the panel. */
  entranceStyle: React.CSSProperties;
  leaving: boolean;
  /** Accept flash in progress — the gold rule lands before the card goes. */
  accepted: boolean;
  /** Roving tabindex: 0 on the lane's active card, -1 elsewhere. */
  tabIndex: number;
  registerRef: (el: HTMLElement | null) => void;
  onFocusCard: () => void;
  /** ArrowUp/ArrowDown between cards in the lane. */
  onArrow: (delta: number) => void;
  /** Button/Delete-key dismissal — slides out, then dismisses. */
  onDismiss: () => void;
  /** Swipe dismissal — the swipe already animated the exit. */
  onSwipeDismiss: () => void;
  /** Primary action (Enter). */
  onAccept: () => void;
}

/**
 * One of Hermes's own proposals in the Dispatches hub. Swipeable on touch,
 * arrow-navigable on keyboards; accepting flashes gold before it goes.
 */
export function SuggestionCard({
  suggestion,
  entranceStyle,
  leaving,
  accepted,
  tabIndex,
  registerRef,
  onFocusCard,
  onArrow,
  onDismiss,
  onSwipeDismiss,
  onAccept,
}: SuggestionCardProps) {
  const swipe = useSwipeDismiss(onSwipeDismiss, leaving || accepted);

  function handleKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    if (e.target !== e.currentTarget) return; // let the buttons be buttons
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      onArrow(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      onAccept();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      onDismiss();
    }
  }

  const classes = [
    'dispatch-card',
    leaving ? 'leaving' : '',
    accepted ? 'accepted' : '',
    swipe.dragging ? 'swiping' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <article
      ref={registerRef}
      className={classes}
      style={{ ...entranceStyle, ...swipe.style }}
      tabIndex={tabIndex}
      role="group"
      aria-label={suggestion.title}
      onFocus={(e) => {
        if (e.target === e.currentTarget) onFocusCard();
      }}
      onKeyDown={handleKeyDown}
      {...swipe.handlers}
    >
      <div className="dispatch-card-head">
        <span className="dispatch-icon" aria-hidden="true">
          {SUGGESTION_ICONS[suggestion.kind]}
        </span>
        <span className="dispatch-title">{suggestion.title}</span>
        <span className="dispatch-meta tnum">{suggestion.meta}</span>
      </div>
      <div className="dispatch-because">{suggestion.because}</div>
      <div className="dispatch-actions">
        <button className="btn small" onClick={onDismiss}>
          Dismiss
        </button>
        <button className="btn small primary" onClick={onAccept}>
          {ACCEPT_LABELS[suggestion.kind]}
        </button>
      </div>
    </article>
  );
}
