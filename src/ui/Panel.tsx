import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface PanelProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  width?: number;
  children: ReactNode;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Right-side dock/overlay. Slides in over the stage, closes on Escape or
 * backdrop click, and traps focus while open.
 */
export function Panel({ open, onClose, title, width = 380, children }: PanelProps) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
    } else if (mounted) {
      setClosing(true);
      const timer = setTimeout(() => {
        setMounted(false);
        setClosing(false);
      }, 220);
      return () => clearTimeout(timer);
    }
  }, [open, mounted]);

  useEffect(() => {
    if (!open || !mounted) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    if (panel) {
      const first = panel.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? panel).focus();
    }
    return () => restoreFocusRef.current?.focus();
  }, [open, mounted]);

  if (!mounted) return null;

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusable.length === 0) {
      e.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === panel)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <>
      <div
        className={`panel-backdrop${closing ? ' closing' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        className={`panel${closing ? ' closing' : ''}`}
        style={{ '--panel-width': `${width}px` } as React.CSSProperties}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <div className="panel-head">
          {title ? <h2>{title}</h2> : <span />}
          <button className="panel-close" onClick={onClose} aria-label="Close panel">
            ✕
          </button>
        </div>
        <div className="panel-body">{children}</div>
      </div>
    </>,
    document.body
  );
}
