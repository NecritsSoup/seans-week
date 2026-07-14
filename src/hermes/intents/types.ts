import type { ViewMode } from '../../stage/Stage';
import type { CategoryId } from '../../state/types';

/** A time expression pulled from the input, before am/pm resolution. */
export interface TimeMatch {
  /** Raw minutes since midnight as typed (no am/pm inference applied). */
  startMin: number;
  /** Raw end minutes when a range was given ("2-4pm"), else null. */
  endMin: number | null;
  /** True when the start hour carried an explicit am/pm. */
  startExplicit: boolean;
  /** True when the end hour carried an explicit am/pm. */
  endExplicit: boolean;
  /** The matched substring, for stripping out of titles. */
  text: string;
}

export interface CreateIntent {
  kind: 'create';
  title: string;
  categoryId: CategoryId;
  day: Date;
  startMin: number;
  endMin: number;
  /** "every friday" / "weekly": create a RecurringTemplate, not a one-off. */
  repeatWeekly: boolean;
}

export interface MoveIntent {
  kind: 'move';
  /** Fuzzy description of the event to move ("gym", "reading"). */
  query: string;
  /** The day the event currently sits on, when the user named one. */
  queryDay: Date | null;
  /** Destination day, when given ("push reading to sunday"). */
  targetDay: Date | null;
  /** Destination time, when given — resolved against the found event. */
  targetTime: TimeMatch | null;
  /** Original input, for am/pm word inference. */
  raw: string;
  /** Batch-only: preferred recurrence scope for recurring targets. */
  scopeHint?: 'occurrence' | 'template';
  /** Batch-only: "all/every gym" — expand to every match, not just one. */
  matchAll?: boolean;
}

export interface CancelIntent {
  kind: 'cancel';
  query: string;
  queryDay: Date | null;
  /** Batch-only: preferred recurrence scope for recurring targets. */
  scopeHint?: 'occurrence' | 'template';
  /** Batch-only: "cancel all reading" — expand to every match. */
  matchAll?: boolean;
}

/** "make friday's gym weekly": convert a found one-off into a template. */
export interface RecurIntent {
  kind: 'recur';
  query: string;
  queryDay: Date | null;
}

export interface NavigateIntent {
  kind: 'navigate';
  day: Date | null;
  view: ViewMode | null;
  /** A summonable surface instead of a stage move ("go to dispatches"). */
  surface?: 'dispatches';
  label: string;
}

export interface TodoIntent {
  kind: 'todo';
  text: string;
}

export interface SearchIntent {
  kind: 'search';
  query: string;
}

/** The operations a batch can carry — the existing single-target intents. */
export type SingleIntent = CreateIntent | MoveIntent | CancelIntent;

/**
 * Several operations parsed from one utterance ("make pull day, legs day and
 * push day all be at 5:30"). The palette resolves each op against the
 * calendar and presents a reviewable batch; a batch of one op behaves
 * exactly like the single intent would.
 */
export interface BatchIntent {
  kind: 'batch';
  ops: SingleIntent[];
}

export type ParsedIntent =
  | CreateIntent
  | MoveIntent
  | CancelIntent
  | RecurIntent
  | NavigateIntent
  | TodoIntent
  | SearchIntent
  | BatchIntent;
