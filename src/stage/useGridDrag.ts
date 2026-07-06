import { useCallback, useRef, useState, type RefObject } from 'react';
import {
  DAY_END_MIN,
  DAY_START_MIN,
  SNAP_MIN,
  clampToDayBounds,
  isSameDay,
  minutesOfDay,
  snapMinutes,
} from '../lib/time';
import type { CalendarEvent } from '../state/types';
import type { AnchorRect } from './popoverPosition';

export type GridDrag =
  | { kind: 'create'; dayIndex: number; startMin: number; endMin: number }
  | { kind: 'move'; event: CalendarEvent; dayIndex: number; startMin: number; endMin: number }
  | { kind: 'resize'; event: CalendarEvent; edge: 'top' | 'bottom'; dayIndex: number; startMin: number; endMin: number };

interface DragInternals {
  drag: GridDrag;
  pointerId: number;
  originClientX: number;
  originClientY: number;
  /** For 'create': the fixed edge of the selection. For 'move': grab offset. */
  anchorMin: number;
  exceededSlop: boolean;
}

export interface UseGridDragOptions {
  bodyRef: RefObject<HTMLDivElement | null>;
  days: Date[];
  pxPerMin: number;
  eventsById: Map<string, CalendarEvent>;
  onCreate: (dayIndex: number, startMin: number, endMin: number, anchor: AnchorRect) => void;
  onMove: (event: CalendarEvent, dayIndex: number, startMin: number, endMin: number) => void;
  onResize: (event: CalendarEvent, startMin: number, endMin: number) => void;
  onEventClick: (event: CalendarEvent, anchor: AnchorRect) => void;
}

interface GridPoint {
  dayIndex: number;
  minute: number;
}

const CLICK_SLOP_PX = 5;

/**
 * Pointer-driven grid interactions: drag empty space to create, drag a block
 * to move (across columns), drag its edges to resize. All positions snap to
 * 15-minute increments within the 6:00–23:30 day bounds.
 */
export function useGridDrag(options: UseGridDragOptions) {
  const { bodyRef, days, pxPerMin, eventsById, onCreate, onMove, onResize, onEventClick } =
    options;
  const [drag, setDrag] = useState<GridDrag | null>(null);
  const internals = useRef<DragInternals | null>(null);

  const pointAt = useCallback(
    (clientX: number, clientY: number): GridPoint | null => {
      const body = bodyRef.current;
      if (!body) return null;
      const cols = Array.from(body.querySelectorAll<HTMLElement>('[data-day-index]'));
      if (cols.length === 0) return null;
      let dayIndex = 0;
      let colRect = cols[0].getBoundingClientRect();
      for (let i = 0; i < cols.length; i += 1) {
        const rect = cols[i].getBoundingClientRect();
        if (clientX >= rect.left || i === 0) {
          dayIndex = i;
          colRect = rect;
        }
      }
      const minute = clampToDayBounds(
        DAY_START_MIN + (clientY - colRect.top) / pxPerMin
      );
      return { dayIndex, minute };
    },
    [bodyRef, pxPerMin]
  );

  const columnAnchor = useCallback(
    (dayIndex: number, startMin: number, endMin: number): AnchorRect => {
      const body = bodyRef.current;
      const col = body?.querySelectorAll<HTMLElement>('[data-day-index]')[dayIndex];
      if (!col) return { left: 0, top: 0, width: 0, height: 0 };
      const rect = col.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top + (startMin - DAY_START_MIN) * pxPerMin,
        width: rect.width,
        height: (endMin - startMin) * pxPerMin,
      };
    },
    [bodyRef, pxPerMin]
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 || internals.current) return;
      const target = e.target as HTMLElement;
      const point = pointAt(e.clientX, e.clientY);
      if (!point) return;

      const eventEl = target.closest<HTMLElement>('[data-event-id]');
      let next: DragInternals | null = null;

      if (eventEl) {
        const event = eventsById.get(eventEl.dataset.eventId ?? '');
        if (!event) return;
        const startMin = minutesOfDay(new Date(event.start));
        const endMin = Math.max(minutesOfDay(new Date(event.end)), startMin + SNAP_MIN);
        const eventDay = new Date(event.start);
        const dayIndex = Math.max(
          days.findIndex((d) => isSameDay(d, eventDay)),
          0
        );
        const handle = target.closest<HTMLElement>('.resize-handle');
        if (handle) {
          next = {
            drag: {
              kind: 'resize',
              event,
              edge: handle.classList.contains('top') ? 'top' : 'bottom',
              dayIndex,
              startMin,
              endMin,
            },
            pointerId: e.pointerId,
            originClientX: e.clientX,
            originClientY: e.clientY,
            anchorMin: 0,
            exceededSlop: false,
          };
        } else {
          next = {
            drag: { kind: 'move', event, dayIndex, startMin, endMin },
            pointerId: e.pointerId,
            originClientX: e.clientX,
            originClientY: e.clientY,
            anchorMin: point.minute - startMin,
            exceededSlop: false,
          };
        }
      } else if (target.closest('[data-day-index]')) {
        const anchor = snapMinutes(point.minute);
        next = {
          drag: { kind: 'create', dayIndex: point.dayIndex, startMin: anchor, endMin: anchor },
          pointerId: e.pointerId,
          originClientX: e.clientX,
          originClientY: e.clientY,
          anchorMin: anchor,
          exceededSlop: false,
        };
      }

      if (!next) return;
      internals.current = next;
      e.currentTarget.setPointerCapture(e.pointerId);
      if (next.drag.kind !== 'move') setDrag(next.drag);
    },
    [days, eventsById, pointAt]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const state = internals.current;
      if (!state || e.pointerId !== state.pointerId) return;
      if (!state.exceededSlop) {
        const dist = Math.hypot(e.clientX - state.originClientX, e.clientY - state.originClientY);
        if (dist < CLICK_SLOP_PX) return;
        state.exceededSlop = true;
      }
      const point = pointAt(e.clientX, e.clientY);
      if (!point) return;

      const current = state.drag;
      let next: GridDrag;
      if (current.kind === 'create') {
        const snapped = snapMinutes(point.minute);
        next = {
          ...current,
          dayIndex: point.dayIndex,
          startMin: Math.min(state.anchorMin, snapped),
          endMin: Math.max(state.anchorMin, snapped),
        };
      } else if (current.kind === 'move') {
        const duration = current.endMin - current.startMin;
        let startMin = snapMinutes(point.minute - state.anchorMin);
        startMin = Math.min(Math.max(startMin, DAY_START_MIN), DAY_END_MIN - duration);
        next = { ...current, dayIndex: point.dayIndex, startMin, endMin: startMin + duration };
      } else {
        const snapped = snapMinutes(point.minute);
        next =
          current.edge === 'top'
            ? { ...current, startMin: Math.min(clampToDayBounds(snapped), current.endMin - SNAP_MIN) }
            : { ...current, endMin: Math.max(clampToDayBounds(snapped), current.startMin + SNAP_MIN) };
      }
      state.drag = next;
      setDrag(next);
    },
    [pointAt]
  );

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
      const state = internals.current;
      if (!state || e.pointerId !== state.pointerId) return;
      internals.current = null;
      setDrag(null);
      const { drag: finalDrag, exceededSlop } = state;

      if (cancelled) return;

      if (finalDrag.kind === 'create') {
        if (!exceededSlop) return; // plain click on empty space
        let { startMin, endMin } = finalDrag;
        if (endMin - startMin < SNAP_MIN) endMin = Math.min(startMin + SNAP_MIN * 2, DAY_END_MIN);
        onCreate(
          finalDrag.dayIndex,
          startMin,
          endMin,
          columnAnchor(finalDrag.dayIndex, startMin, endMin)
        );
        return;
      }

      if (finalDrag.kind === 'move') {
        if (!exceededSlop) {
          const el = bodyRef.current?.querySelector<HTMLElement>(
            `[data-event-id="${finalDrag.event.id}"]`
          );
          const rect = el?.getBoundingClientRect();
          onEventClick(
            finalDrag.event,
            rect
              ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
              : columnAnchor(finalDrag.dayIndex, finalDrag.startMin, finalDrag.endMin)
          );
          return;
        }
        onMove(finalDrag.event, finalDrag.dayIndex, finalDrag.startMin, finalDrag.endMin);
        return;
      }

      if (exceededSlop) onResize(finalDrag.event, finalDrag.startMin, finalDrag.endMin);
    },
    [bodyRef, columnAnchor, onCreate, onEventClick, onMove, onResize]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => endDrag(e, false),
    [endDrag]
  );
  const onPointerCancel = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => endDrag(e, true),
    [endDrag]
  );

  return { drag, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel } };
}
