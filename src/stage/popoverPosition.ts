export interface AnchorRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const MARGIN = 8;

/**
 * Position a fixed popover beside an anchor rect (viewport coordinates),
 * preferring the right side and clamping to the viewport.
 */
export function popoverPosition(
  anchor: AnchorRect,
  popoverWidth = 264,
  estimatedHeight = 240
): { left: number; top: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = anchor.left + anchor.width + MARGIN;
  if (left + popoverWidth + MARGIN > vw) {
    left = anchor.left - popoverWidth - MARGIN;
  }
  left = Math.min(Math.max(left, MARGIN), Math.max(vw - popoverWidth - MARGIN, MARGIN));

  const top = Math.min(
    Math.max(anchor.top, MARGIN),
    Math.max(vh - estimatedHeight - MARGIN, MARGIN)
  );

  return { left, top };
}
