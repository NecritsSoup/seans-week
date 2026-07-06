import { DAY_START_MIN, fmtRange } from '../lib/time';
import type { CategoryId } from '../state/types';
import { categoryById } from '../state/categories';

interface GhostBlockProps {
  startMin: number;
  endMin: number;
  pxPerMin: number;
  categoryId: CategoryId;
  title?: string;
}

/** Translucent snap-to-grid preview shown while dragging. */
export function GhostBlock({ startMin, endMin, pxPerMin, categoryId, title }: GhostBlockProps) {
  const category = categoryById(categoryId);
  return (
    <div
      className={`ghost-block ${category.colorToken}`}
      style={{
        top: (startMin - DAY_START_MIN) * pxPerMin,
        height: Math.max((endMin - startMin) * pxPerMin, 14),
        left: 3,
        right: 3,
      }}
    >
      {title && <div className="ev-title">{title}</div>}
      <div className="ev-time">{fmtRange(startMin, endMin)}</div>
    </div>
  );
}
