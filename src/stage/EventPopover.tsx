import { useState } from 'react';
import { fmtRange, minutesOfDay } from '../lib/time';
import { CATEGORIES, categoryById } from '../state/categories';
import { useEventActions } from '../state/EventsContext';
import type { CalendarEvent, CategoryId } from '../state/types';
import { useToast } from '../ui';
import { popoverPosition, type AnchorRect } from './popoverPosition';

interface EventPopoverProps {
  event: CalendarEvent;
  anchor: AnchorRect;
  onClose: () => void;
}

/** Anchored card for an existing event: details, inline edit, delete + undo. */
export function EventPopover({ event, anchor, onClose }: EventPopoverProps) {
  const { updateEvent, deleteEvent, createEvent } = useEventActions();
  const { showToast } = useToast();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(event.title);
  const [categoryId, setCategoryId] = useState<CategoryId>(event.categoryId);

  const category = categoryById(event.categoryId);
  const { left, top } = popoverPosition(anchor);
  const start = new Date(event.start);
  const startMin = minutesOfDay(start);
  const endMin = minutesOfDay(new Date(event.end));
  const dayLabel = start.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  async function saveEdit() {
    await updateEvent(event.id, { title: title.trim() || event.title, categoryId });
    onClose();
  }

  async function remove() {
    const snapshot = event;
    await deleteEvent(event.id);
    onClose();
    showToast({
      message: `Deleted “${snapshot.title}”`,
      actionLabel: 'Undo',
      onAction: () => {
        void createEvent({
          id: snapshot.id,
          title: snapshot.title,
          start: snapshot.start,
          end: snapshot.end,
          categoryId: snapshot.categoryId,
          allDay: snapshot.allDay,
        });
      },
    });
  }

  return (
    <>
      <div className="panel-backdrop" style={{ background: 'transparent' }} onClick={onClose} />
      <div
        className="popover"
        style={{ left, top }}
        role="dialog"
        aria-label={event.title}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          } else if (e.key === 'Enter' && editing) {
            e.preventDefault();
            void saveEdit();
          }
        }}
      >
        <div className="meander popover-meander" />
        {editing ? (
          <>
            <div className="pop-row">
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
                aria-label="Event title"
              />
            </div>
            <div className="pop-row">
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value as CategoryId)}
                aria-label="Category"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="pop-actions">
              <button className="btn" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button className="btn primary" onClick={() => void saveEdit()}>
                Save
              </button>
            </div>
          </>
        ) : (
          <>
            <h3>{event.title}</h3>
            <div className="pop-time tnum">
              {dayLabel} · {fmtRange(startMin, endMin)}
            </div>
            <div className={`pop-row ${category.colorToken}`}>
              <span className="cat-dot" />
              <span className="cat-label">{category.label}</span>
            </div>
            <div className="pop-actions">
              <button className="btn danger" onClick={() => void remove()}>
                Delete
              </button>
              <button className="btn" onClick={() => setEditing(true)}>
                Edit
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
