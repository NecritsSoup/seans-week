import { useRef, useState } from 'react';

// Touch/pen swipe-to-dismiss for dispatch cards. Pointer-events based: a
// horizontal drag translates the card and fades it; released past ~40% of
// its width it flies out and dismisses, released short of that it springs
// back. Mouse users keep the Dismiss button (mouse pointers are ignored),
// and reduced-motion users get an immediate dismissal with no fly-out.

type Phase = 'idle' | 'drag' | 'settle' | 'fly';

interface Gesture {
  id: number;
  x: number;
  y: number;
  width: number;
  /** True once the drag is decidedly horizontal and the card follows it. */
  active: boolean;
}

export interface SwipeDismissHandlers {
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: React.PointerEvent<HTMLElement>) => void;
  onClickCapture: (e: React.MouseEvent<HTMLElement>) => void;
}

export interface SwipeDismiss {
  handlers: SwipeDismissHandlers;
  /** Inline transform/opacity while dragging, flying out or springing back. */
  style: React.CSSProperties;
  dragging: boolean;
}

/** Movement before the gesture commits to horizontal (or yields to scroll). */
const DECIDE_PX = 10;
/** Fraction of the card width that must be crossed to dismiss. */
const THRESHOLD = 0.4;
/** Matches --dur-med, so the fly-out lands before the store removes the card. */
const FLY_MS = 200;

export function useSwipeDismiss(onDismiss: () => void, disabled = false): SwipeDismiss {
  const [phase, setPhase] = useState<Phase>('idle');
  const [dx, setDx] = useState(0);
  const gesture = useRef<Gesture | null>(null);
  const justDragged = useRef(false);

  function settleBack() {
    setPhase('settle');
    setDx(0);
    window.setTimeout(() => setPhase((p) => (p === 'settle' ? 'idle' : p)), 220);
  }

  function endDrag() {
    justDragged.current = true;
    window.setTimeout(() => {
      justDragged.current = false;
    }, 300);
  }

  const handlers: SwipeDismissHandlers = {
    onPointerDown(e) {
      if (disabled || phase === 'fly' || e.pointerType === 'mouse') return;
      gesture.current = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        width: e.currentTarget.offsetWidth || 1,
        active: false,
      };
    },
    onPointerMove(e) {
      const g = gesture.current;
      if (!g || e.pointerId !== g.id) return;
      const moveX = e.clientX - g.x;
      const moveY = e.clientY - g.y;
      if (!g.active) {
        if (Math.abs(moveX) < DECIDE_PX) {
          // A clearly vertical start belongs to the panel's scroll.
          if (Math.abs(moveY) > DECIDE_PX) gesture.current = null;
          return;
        }
        if (Math.abs(moveX) < Math.abs(moveY)) {
          gesture.current = null;
          return;
        }
        g.active = true;
        setPhase('drag');
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* synthetic pointers can't be captured — the drag still works */
        }
      }
      setDx(Math.max(0, moveX));
    },
    onPointerUp(e) {
      const g = gesture.current;
      if (!g || e.pointerId !== g.id) return;
      gesture.current = null;
      if (!g.active) return;
      endDrag();
      const finalDx = Math.max(0, e.clientX - g.x);
      if (finalDx < g.width * THRESHOLD) {
        settleBack();
        return;
      }
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setPhase('idle');
        setDx(0);
        onDismiss();
        return;
      }
      setPhase('fly');
      setDx(g.width);
      window.setTimeout(onDismiss, FLY_MS);
    },
    onPointerCancel() {
      if (gesture.current?.active) {
        endDrag();
        settleBack();
      }
      gesture.current = null;
    },
    onClickCapture(e) {
      // A finished swipe must not also press whatever the finger ended on.
      if (justDragged.current) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
  };

  const width = gesture.current?.width ?? 1;
  const style: React.CSSProperties =
    phase === 'idle'
      ? {}
      : phase === 'drag'
        ? {
            transform: `translateX(${dx}px)`,
            opacity: Math.max(0.15, 1 - (dx / width) * 0.9),
            transition: 'none',
          }
        : {
            transform: phase === 'fly' ? 'translateX(110%)' : 'translateX(0)',
            opacity: phase === 'fly' ? 0 : 1,
            transition:
              'transform var(--dur-med) var(--ease-out), opacity var(--dur-med) var(--ease-out)',
          };

  return { handlers, style, dragging: phase === 'drag' };
}
