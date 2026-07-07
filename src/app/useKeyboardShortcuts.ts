import { useEffect } from 'react';
import type { ViewMode } from '../stage/Stage';

interface ShortcutHandlers {
  onToday: () => void;
  onPrev: () => void;
  onNext: () => void;
  onView: (view: ViewMode) => void;
  /** I — toggle the Dispatches hub. */
  onDispatches?: () => void;
  /** D — toggle the Tasks panel. */
  onTasks?: () => void;
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.matches('input, textarea, select')
  );
}

/** T = today, ArrowLeft/Right = prev/next, 1/2/3 = Day/Week/Month, I = dispatches, D = tasks. */
export function useKeyboardShortcuts({
  onToday,
  onPrev,
  onNext,
  onView,
  onDispatches,
  onTasks,
}: ShortcutHandlers) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      switch (e.key) {
        case 't':
        case 'T':
          onToday();
          break;
        case 'i':
        case 'I':
          if (!onDispatches) return;
          onDispatches();
          break;
        case 'd':
        case 'D':
          if (!onTasks) return;
          onTasks();
          break;
        case 'ArrowLeft':
          onPrev();
          break;
        case 'ArrowRight':
          onNext();
          break;
        case '1':
          onView('day');
          break;
        case '2':
          onView('week');
          break;
        case '3':
          onView('month');
          break;
        default:
          return;
      }
      e.preventDefault();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onToday, onPrev, onNext, onView, onDispatches, onTasks]);
}
