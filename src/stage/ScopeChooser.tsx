import type { RecurrenceScope } from '../state/recurrence';

interface ScopeChooserProps {
  /** The question, e.g. "Move this repeating event?" */
  title: string;
  /** Weekday name of the occurrence, e.g. "Friday". */
  dayName: string;
  /** Fine print under "Just this …". */
  thisNote?: string;
  /** Fine print under "Every week". */
  everyNote?: string;
  onChoose: (scope: RecurrenceScope) => void;
  onCancel: () => void;
}

/**
 * Two-way scope question for edits to a recurring occurrence: apply to just
 * this date (an exception) or to the whole weekly template. Content-only —
 * hosts render it inside a popover of their own.
 */
export function ScopeChooser({
  title,
  dayName,
  thisNote = 'Other weeks keep their place',
  everyNote = 'The whole weekly rhythm changes',
  onChoose,
  onCancel,
}: ScopeChooserProps) {
  return (
    <div className="scope-chooser" role="group" aria-label={title}>
      <div className="scope-title">{title}</div>
      <button className="scope-option" autoFocus onClick={() => onChoose('occurrence')}>
        <span className="scope-option-label">Just this {dayName}</span>
        <span className="scope-option-note">{thisNote}</span>
      </button>
      <button className="scope-option" onClick={() => onChoose('template')}>
        <span className="scope-option-label">
          Every week{' '}
          <span className="scope-repeat" aria-hidden="true">
            ↻
          </span>
        </span>
        <span className="scope-option-note">{everyNote}</span>
      </button>
      <div className="pop-actions">
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
