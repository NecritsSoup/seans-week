export type EventSource = 'local' | 'google';

export type CategoryId = 'work' | 'gym' | 'reading' | 'dinner' | 'walk' | 'upenn';

export interface Category {
  id: CategoryId;
  label: string;
  /** CSS class carrying the category custom properties (see tokens.css). */
  colorToken: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  /** ISO 8601 local datetime strings. */
  start: string;
  end: string;
  categoryId: CategoryId;
  source: EventSource;
  allDay?: boolean;
  /** Set on expanded occurrences of a weekly RecurringTemplate and on Google
   *  recurring-event instances alike — the grid and popover treat both the same. */
  recurring?: boolean;
  /** The RecurringTemplate an occurrence was expanded from (local recurrence). */
  templateId?: string;
  /** The parent Google recurring event ('g:'-prefixed), for instances of a series. */
  googleSeriesId?: string;
}

export interface EventInput {
  /** Provide an id to restore a previously deleted event (undo). */
  id?: string;
  title: string;
  start: string;
  end: string;
  categoryId: CategoryId;
  allDay?: boolean;
}

export interface EventPatch {
  title?: string;
  start?: string;
  end?: string;
  categoryId?: CategoryId;
  allDay?: boolean;
}

/**
 * A source of calendar events. LocalEventStore implements this over
 * localStorage; a Google Calendar adapter can implement it in Phase 3.
 */
export interface EventStore {
  readonly source: EventSource;
  /** Events overlapping [rangeStart, rangeEnd), as ISO strings. */
  list(rangeStart: string, rangeEnd: string): Promise<CalendarEvent[]>;
  create(input: EventInput): Promise<CalendarEvent>;
  update(id: string, patch: EventPatch): Promise<CalendarEvent>;
  remove(id: string): Promise<void>;
  /** Notifies after any mutation. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
}
