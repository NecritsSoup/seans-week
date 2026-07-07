import { useEffect } from 'react';
import { isTypingTarget } from '../app/useKeyboardShortcuts';

interface HermesShortcutHandlers {
  onPalette: () => void;
  onLedger: () => void;
}

/** Cmd/Ctrl+K or `/` = palette, L = ledger (never while typing). */
export function useHermesShortcuts({ onPalette, onLedger }: HermesShortcutHandlers) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented) return;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onPalette();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (e.key === '/') {
        e.preventDefault();
        onPalette();
      } else if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        onLedger();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onPalette, onLedger]);
}
