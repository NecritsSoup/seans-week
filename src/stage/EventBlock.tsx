import { DAY_START_MIN, fmtRange } from '../lib/time';
import { categoryById } from '../state/categories';
import type { PositionedEvent } from './layout';

interface EventBlockProps {
  positioned: PositionedEvent;
  pxPerMin: number;
  /** Dimmed while this event is being dragged to a new slot. */
  isDragSource: boolean;
}

export function EventBlock({ positioned, pxPerMin, isDragSource }: EventBlockProps) {
  const { event, startMin, endMin, lane, lanes } = positioned;
  const category = categoryById(event.categoryId);
  const top = (startMin - DAY_START_MIN) * pxPerMin;
  const height = Math.max((endMin - startMin) * pxPerMin, 14);
  const width = 100 / lanes;

  return (
    <div
      className={`event-block ${category.colorToken}${isDragSource ? ' drag-source' : ''}`}
      data-event-id={event.id}
      style={{
        top,
        height,
        left: `calc(${lane * width}% + 3px)`,
        width: `calc(${width}% - 6px)`,
      }}
      role="button"
      aria-label={`${event.title}, ${fmtRange(startMin, endMin)}`}
    >
      <div className="resize-handle top" />
      <div className="ev-title">{event.title}</div>
      {height >= 30 && <div className="ev-time">{fmtRange(startMin, endMin)}</div>}
      <div className="resize-handle bottom" />
    </div>
  );
}
