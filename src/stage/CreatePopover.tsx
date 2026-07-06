import { useState } from 'react';
import { fmtRange } from '../lib/time';
import { CATEGORIES } from '../state/categories';
import type { CategoryId } from '../state/types';
import { popoverPosition, type AnchorRect } from './popoverPosition';

interface CreatePopoverProps {
  anchor: AnchorRect;
  day: Date;
  startMin: number;
  endMin: number;
  onSave: (title: string, categoryId: CategoryId) => void;
  onCancel: () => void;
}

/** Inline popover shown after drag-creating a slot: set title + category. */
export function CreatePopover({ anchor, day, startMin, endMin, onSave, onCancel }: CreatePopoverProps) {
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState<CategoryId>('work');
  const { left, top } = popoverPosition(anchor);

  const dayLabel = day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

  function save() {
    onSave(title.trim() || 'New event', categoryId);
  }

  return (
    <>
      <div className="panel-backdrop" style={{ background: 'transparent' }} onClick={onCancel} />
      <div
        className="popover"
        style={{ left, top }}
        role="dialog"
        aria-label="New event"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            save();
          } else if (e.key === 'Escape') {
            e.stopPropagation();
            onCancel();
          }
        }}
      >
        <div className="meander popover-meander" />
        <div className="pop-time tnum">
          {dayLabel} · {fmtRange(startMin, endMin)}
        </div>
        <div className="pop-row">
          <input
            type="text"
            placeholder="Event title…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
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
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn primary" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </>
  );
}
