import { useState } from 'react';
import { appendLedger, markLedgerUndone } from '../hermes/ledgerStore';
import {
  isValidMeetingUrl,
  meetingDomain,
  MEETING_JOIN_LABELS,
} from '../lib/meetingLink';
import { fmtRange, minutesOfDay } from '../lib/time';
import { CATEGORIES, categoryById } from '../state/categories';
import { useEventActions } from '../state/EventsContext';
import { weekdayName, type RecurrenceScope } from '../state/recurrence';
import {
  editOccurrenceOnly,
  editWholeTemplate,
  endSeries,
  skipOccurrence,
  type RecurringOpResult,
} from '../state/recurringOps';
import type { CalendarEvent, CategoryId, EventPatch } from '../state/types';
import { CameraGlyph, CopyGlyph, useToast } from '../ui';
import { popoverPosition, type AnchorRect } from './popoverPosition';
import { ScopeChooser } from './ScopeChooser';

interface EventPopoverProps {
  event: CalendarEvent;
  anchor: AnchorRect;
  onClose: () => void;
}

type PopoverMode = 'view' | 'edit' | 'ask-edit' | 'ask-delete';

/** Anchored card for an existing event: details, inline edit, delete + undo. */
export function EventPopover({ event, anchor, onClose }: EventPopoverProps) {
  const { updateEvent, deleteEvent, createEvent } = useEventActions();
  const { showToast } = useToast();
  const [mode, setMode] = useState<PopoverMode>('view');
  const [title, setTitle] = useState(event.title);
  const [categoryId, setCategoryId] = useState<CategoryId>(event.categoryId);
  const [linkText, setLinkText] = useState(event.meetingUrl ?? '');

  // Recurring edits route through the scoped template/series ops, which do
  // not carry meeting links yet — the input stays a one-off affordance.
  const linkEditable = !event.recurring;
  const trimmedLink = linkText.trim();
  const linkInvalid = linkEditable && trimmedLink !== '' && !isValidMeetingUrl(trimmedLink);

  /** The link the edit form would save: unchanged when invalid ("quiet error"). */
  function linkPatch(): Pick<EventPatch, 'meetingUrl'> {
    if (!linkEditable || linkInvalid) return {};
    if (trimmedLink === (event.meetingUrl ?? '')) return {};
    return { meetingUrl: trimmedLink };
  }

  const category = categoryById(event.categoryId);
  const { left, top } = popoverPosition(anchor);
  const start = new Date(event.start);
  const startMin = minutesOfDay(start);
  const endMin = minutesOfDay(new Date(event.end));
  const dayName = weekdayName(start.getDay());
  const dayLabel = start.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  async function saveEdit() {
    const nextTitle = title.trim() || event.title;
    if (event.recurring) {
      if (nextTitle === event.title && categoryId === event.categoryId) {
        onClose();
        return;
      }
      setMode('ask-edit');
      return;
    }
    await updateEvent(event.id, { title: nextTitle, categoryId, ...linkPatch() });
    onClose();
  }

  async function applyRecurringEdit(scope: RecurrenceScope) {
    const patch = { title: title.trim() || event.title, categoryId };
    onClose();
    let result: RecurringOpResult | null;
    try {
      result =
        scope === 'template'
          ? await editWholeTemplate(event, patch)
          : await editOccurrenceOnly(event, patch);
    } catch {
      return; // Google rejected it — the store already rolled back and spoke up
    }
    if (!result) return;
    const scopeText = scope === 'template' ? `every ${dayName}` : `just this ${dayName}`;
    const entry = appendLedger('edit', `Edited “${patch.title}” — ${scopeText}.`, result.undo);
    showToast({
      message: `Saved “${patch.title}” — ${scopeText}.`,
      actionLabel: 'Undo',
      onAction: () => {
        void result.revert();
        markLedgerUndone(entry.id);
      },
    });
  }

  async function applyRecurringDelete(scope: RecurrenceScope) {
    onClose();
    let result: RecurringOpResult | null;
    try {
      result = scope === 'template' ? await endSeries(event) : await skipOccurrence(event);
    } catch {
      return; // Google rejected it — the store already rolled back and spoke up
    }
    if (!result) return;
    const entry =
      scope === 'template'
        ? appendLedger(
            'cancel',
            `“${event.title}” no longer repeats every ${dayName} — past weeks remain.`,
            result.undo
          )
        : appendLedger(
            'cancel',
            `Skipped “${event.title}” for ${dayLabel} — the weekly rhythm continues.`,
            result.undo
          );
    showToast({
      message:
        scope === 'template'
          ? `“${event.title}” no longer repeats.`
          : `Skipped “${event.title}” this ${dayName}.`,
      actionLabel: 'Undo',
      onAction: () => {
        void result.revert();
        markLedgerUndone(entry.id);
      },
    });
  }

  async function remove() {
    if (event.recurring) {
      setMode('ask-delete');
      return;
    }
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
          meetingUrl: snapshot.meetingUrl,
        });
      },
    });
  }

  async function copyMeetingLink() {
    if (!event.meetingUrl) return;
    try {
      await navigator.clipboard.writeText(event.meetingUrl);
      showToast({ message: 'Link copied.' });
    } catch {
      showToast({ message: 'The link could not be copied.' });
    }
  }

  return (
    <>
      <div className="popover-backdrop" onClick={onClose} />
      <div
        className="popover"
        style={{ left, top }}
        role="dialog"
        aria-label={event.title}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            if (mode === 'ask-edit') setMode('edit');
            else if (mode === 'ask-delete') setMode('view');
            else onClose();
          } else if (e.key === 'Enter' && mode === 'edit') {
            e.preventDefault();
            void saveEdit();
          }
        }}
      >
        <div className="meander popover-meander" />
        {mode === 'edit' && (
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
            {linkEditable && (
              <>
                <div className="pop-row">
                  <input
                    type="url"
                    placeholder="Meeting link (https://…)"
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
              </>
            )}
            <div className="pop-actions">
              <button className="btn" onClick={() => setMode('view')}>
                Cancel
              </button>
              <button className="btn primary" onClick={() => void saveEdit()}>
                Save
              </button>
            </div>
          </>
        )}
        {mode === 'ask-edit' && (
          <ScopeChooser
            title="Save changes to this repeating event?"
            dayName={dayName}
            everyNote="Every week takes the new name"
            onChoose={(scope) => void applyRecurringEdit(scope)}
            onCancel={() => setMode('edit')}
          />
        )}
        {mode === 'ask-delete' && (
          <ScopeChooser
            title="Delete this repeating event?"
            dayName={dayName}
            thisNote="Only this date is skipped"
            everyNote="The series ends; past weeks remain"
            onChoose={(scope) => void applyRecurringDelete(scope)}
            onCancel={() => setMode('view')}
          />
        )}
        {mode === 'view' && (
          <>
            <h3>{event.title}</h3>
            <div className="pop-time tnum">
              {dayLabel} · {fmtRange(startMin, endMin)}
            </div>
            <div className={`pop-row ${category.colorToken}`}>
              <span className="cat-dot" />
              <span className="cat-label">{category.label}</span>
            </div>
            {event.recurring && (
              <div className="pop-repeat">
                <span className="pop-repeat-glyph" aria-hidden="true">
                  ↻
                </span>
                <span>Repeats weekly on {dayName}s</span>
                <button
                  className="pop-repeat-stop"
                  onClick={() => void applyRecurringDelete('template')}
                >
                  Stop repeating
                </button>
              </div>
            )}
            {event.meetingUrl && (
              <div className="pop-join">
                <a
                  className="pop-join-link"
                  href={event.meetingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span className="pop-join-glyph" aria-hidden="true">
                    <CameraGlyph size={13} />
                  </span>
                  <span className="pop-join-words">
                    <span className="pop-join-label">
                      {MEETING_JOIN_LABELS[event.meetingProvider ?? 'other']}
                    </span>
                    <span className="pop-join-domain">{meetingDomain(event.meetingUrl)}</span>
                  </span>
                </a>
                <button
                  className="pop-join-copy"
                  onClick={() => void copyMeetingLink()}
                  aria-label="Copy meeting link"
                  title="Copy meeting link"
                >
                  <CopyGlyph />
                </button>
              </div>
            )}
            {event.source === 'google' && (
              <div className="pop-origin">from Google Calendar</div>
            )}
            <div className="pop-actions">
              <button className="btn danger" onClick={() => void remove()}>
                Delete
              </button>
              <button className="btn" onClick={() => setMode('edit')}>
                Edit
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
