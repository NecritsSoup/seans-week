import { useState } from 'react';
import { isValidMeetingUrl } from '../lib/meetingLink';
import { fmtRange } from '../lib/time';
import { CATEGORIES } from '../state/categories';
import type { CategoryId } from '../state/types';
import { popoverPosition, type AnchorRect } from './popoverPosition';

interface CreatePopoverProps {
  anchor: AnchorRect;
  day: Date;
  startMin: number;
  endMin: number;
  /** Prefill (e.g. a to-do dropped onto the grid). */
  initialTitle?: string;
  initialCategoryId?: CategoryId;
  /** Prefill from a source that carried a conference URL (a scroll). */
  initialMeetingUrl?: string;
  onSave: (title: string, categoryId: CategoryId, meetingUrl?: string) => void;
  onCancel: () => void;
}

/** Inline popover shown after drag-creating a slot: set title + category. */
export function CreatePopover({
  anchor,
  day,
  startMin,
  endMin,
  initialTitle,
  initialCategoryId,
  initialMeetingUrl,
  onSave,
  onCancel,
}: CreatePopoverProps) {
  const [title, setTitle] = useState(initialTitle ?? '');
  const [categoryId, setCategoryId] = useState<CategoryId>(initialCategoryId ?? 'work');
  const [linkText, setLinkText] = useState(initialMeetingUrl ?? '');
  const { left, top } = popoverPosition(anchor);

  const trimmedLink = linkText.trim();
  const linkInvalid = trimmedLink !== '' && !isValidMeetingUrl(trimmedLink);

  const dayLabel = day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

  function save() {
    // An invalid link never blocks the event — it just stays behind.
    const meetingUrl = !linkInvalid && trimmedLink !== '' ? trimmedLink : undefined;
    onSave(title.trim() || 'New event', categoryId, meetingUrl);
  }

  return (
    <>
      <div className="popover-backdrop" onClick={onCancel} />
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
        <div className="pop-row">
          <input
            type="url"
            placeholder="Meeting link (optional)"
            value={linkText}
            onChange={(e) => setLinkText(e.target.value)}
            aria-label="Meeting link"
            aria-invalid={linkInvalid || undefined}
          />
        </div>
        {linkInvalid && (
          <p className="pop-field-note" role="status">
            Meeting links must begin with https:// — this one will not be saved.
          </p>
        )}
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
