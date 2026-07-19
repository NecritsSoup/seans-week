import { useEffect, useState } from 'react';
import { DAY_START_MIN, fmtRange } from '../lib/time';
import { categoryById } from '../state/categories';
import type { CalendarEvent } from '../state/types';
import { CameraGlyph } from '../ui';
import type { PositionedEvent } from './layout';

interface EventBlockProps {
  positioned: PositionedEvent;
  pxPerMin: number;
  /** Dimmed while this event is being dragged to a new slot. */
  isDragSource: boolean;
  /** Visual mark from a pending Hermes action: cancel target or move source. */
  hermesMark?: 'cancel' | 'source' | null;
}

/** Starting within 10 minutes, or already underway. */
const IMMINENT_MS = 10 * 60_000;
/** How often a linked block rechecks whether its meeting is imminent. */
const IMMINENT_POLL_MS = 30_000;

function isImminent(event: CalendarEvent): boolean {
  const now = Date.now();
  const startMs = new Date(event.start).getTime();
  const endMs = new Date(event.end).getTime();
  return now >= startMs - IMMINENT_MS && now < endMs;
}

/** True while a linked event is about to start (or running) — polled. */
function useImminentJoin(event: CalendarEvent): boolean {
  const linked = Boolean(event.meetingUrl);
  const [imminent, setImminent] = useState(() => linked && isImminent(event));
  useEffect(() => {
    if (!linked) return;
    const check = () => setImminent(isImminent(event));
    check();
    const timer = window.setInterval(check, IMMINENT_POLL_MS);
    return () => window.clearInterval(timer);
  }, [linked, event]);
  return linked && imminent;
}

export function EventBlock({ positioned, pxPerMin, isDragSource, hermesMark }: EventBlockProps) {
  const { event, startMin, endMin, lane, lanes } = positioned;
  const category = categoryById(event.categoryId);
  const showJoinNow = useImminentJoin(event);
  const top = (startMin - DAY_START_MIN) * pxPerMin;
  const height = Math.max((endMin - startMin) * pxPerMin, 14);
  const width = 100 / lanes;
  const markClass =
    hermesMark === 'cancel' ? ' pending-cancel' : hermesMark === 'source' ? ' drag-source' : '';
  const recurringClass = event.recurring ? ' recurring' : '';
  const linkedClass = event.meetingUrl ? ' linked' : '';

  function openMeeting(e: React.MouseEvent) {
    // The pill acts alone: no popover, no drag.
    e.stopPropagation();
    if (event.meetingUrl) window.open(event.meetingUrl, '_blank', 'noopener,noreferrer');
  }

  return (
    <div
      className={`event-block ${category.colorToken}${recurringClass}${linkedClass}${isDragSource ? ' drag-source' : ''}${markClass}`}
      data-event-id={event.id}
      style={{
        top,
        height,
        left: `calc(${lane * width}% + 3px)`,
        width: `calc(${width}% - 6px)`,
      }}
      role="button"
      aria-label={`${event.title}, ${fmtRange(startMin, endMin)}${event.recurring ? ', repeats weekly' : ''}${event.meetingUrl ? ', has a meeting link' : ''}`}
    >
      <div className="resize-handle top" />
      <div className="ev-title">{event.title}</div>
      {height >= 30 && <div className="ev-time">{fmtRange(startMin, endMin)}</div>}
      {event.recurring && (
        <span className="ev-repeat" aria-hidden="true">
          ↻
        </span>
      )}
      {event.meetingUrl && !showJoinNow && (
        <span className="ev-link" aria-hidden="true">
          <CameraGlyph />
        </span>
      )}
      {showJoinNow && (
        <button
          className="ev-join"
          onClick={openMeeting}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          aria-label={`Join the meeting for ${event.title}`}
        >
          Join
        </button>
      )}
      <div className="resize-handle bottom" />
    </div>
  );
}
