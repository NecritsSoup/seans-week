import { relTime } from '../lib/time';
import type { Scroll } from '../scrolls/scrollsStore';
import { useSwipeDismiss } from './useSwipeDismiss';

interface ScrollCardProps {
  scroll: Scroll;
  /** Entrance stagger etc., computed by the panel. */
  entranceStyle: React.CSSProperties;
  leaving: boolean;
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
  onMakeTodo: () => void;
  /** Primary action (Enter). */
  onSchedule: () => void;
}

/**
 * One scroll in the Dispatches hub: a carried email with dismiss / to-do /
 * schedule actions. Swipeable on touch, arrow-navigable on keyboards.
 */
export function ScrollCard({
  scroll,
  entranceStyle,
  leaving,
  tabIndex,
  registerRef,
  onFocusCard,
  onArrow,
  onDismiss,
  onSwipeDismiss,
  onMakeTodo,
  onSchedule,
}: ScrollCardProps) {
  const swipe = useSwipeDismiss(onSwipeDismiss, leaving);

  function handleKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    if (e.target !== e.currentTarget) return; // let the buttons be buttons
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      onArrow(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      onSchedule();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      onDismiss();
    }
  }

  const classes = [
    'dispatch-card',
    leaving ? 'leaving' : '',
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
      aria-label={scroll.subject}
      onFocus={(e) => {
        if (e.target === e.currentTarget) onFocusCard();
      }}
      onKeyDown={handleKeyDown}
      {...swipe.handlers}
    >
      <div className="dispatch-card-head">
        <span className="dispatch-icon" aria-hidden="true">
          ✉
        </span>
        <span className="dispatch-title">{scroll.subject}</span>
        <span className="dispatch-meta tnum">{relTime(new Date(scroll.date).getTime())}</span>
      </div>
      <div className="dispatch-because">{scroll.from}</div>
      <div className="dispatch-actions">
        <button className="btn small" onClick={onDismiss}>
          Dismiss
        </button>
        <button className="btn small" onClick={onMakeTodo}>
          Make to-do
        </button>
        <button className="btn small primary" onClick={onSchedule}>
          Schedule
        </button>
      </div>
    </article>
  );
}
