import { addDays, dateAtMinutes, dateKey, startOfDay } from '../lib/time';
import type { CalendarEvent, CategoryId } from './types';

// Weekly recurrence, kept deliberately small: a RecurringTemplate is one
// event on one weekday, repeating every week from sinceISO (until untilISO,
// when the series has ended). The local store expands templates into
// occurrence CalendarEvents at list() time; per-date exceptions carry skips
// and this-day-only overrides. No RRULE — Sean's rhythm is weekly.

const STORAGE_KEY = 'seans-week:recurring:v1';
const OCCURRENCE_PREFIX = 'r:';

/** How far an edit to a recurring occurrence reaches. */
export type RecurrenceScope = 'occurrence' | 'template';

/** A per-date deviation: 'skip' hides the occurrence; an object overrides it. */
export type RecurrenceException =
  | 'skip'
  | { title?: string; startMin?: number; endMin?: number; categoryId?: CategoryId };

export interface RecurringTemplate {
  id: string;
  title: string;
  categoryId: CategoryId;
  /** 0 = Sunday … 6 = Saturday (Date.getDay). */
  weekday: number;
  startMin: number;
  endMin: number;
  /** 'YYYY-MM-DD' local date of the first occurrence. */
  sinceISO: string;
  /** 'YYYY-MM-DD' local date of the last occurrence, once the series ends. */
  untilISO?: string;
  /** dateKey → deviation for that single occurrence. */
  exceptions: Record<string, RecurrenceException>;
}

/** createTemplate input — Phase B's suggestions engine calls this too. */
export interface TemplateInput {
  /** Provide an id to restore a previously deleted template (undo). */
  id?: string;
  title: string;
  categoryId: CategoryId;
  weekday: number;
  startMin: number;
  endMin: number;
  /** Defaults to the next occurrence of `weekday` from today. */
  sinceISO?: string;
  untilISO?: string;
  exceptions?: Record<string, RecurrenceException>;
}

export type TemplatePatch = Partial<Omit<RecurringTemplate, 'id' | 'exceptions'>>;

function load(): RecurringTemplate[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? (parsed as RecurringTemplate[]) : [];
  } catch {
    return [];
  }
}

let templates: RecurringTemplate[] = load();
const listeners = new Set<() => void>();

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
  } catch {
    /* storage full or unavailable — keep the in-memory copy */
  }
  listeners.forEach((fn) => fn());
}

function newId(): string {
  return `rt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/* ---------------------------------------------------------------- dates ---- */

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** 'Friday' for 5 — a template weekday or Date.getDay() output. */
export function weekdayName(weekday: number): string {
  return WEEKDAY_NAMES[((weekday % 7) + 7) % 7];
}

/** Inverse of dateKey: 'YYYY-MM-DD' → local midnight Date. */
export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** The next date falling on `weekday`, on or after `from` (today by default). */
export function nextOccurrenceOf(weekday: number, from: Date = new Date()): Date {
  const day = startOfDay(from);
  return addDays(day, (weekday - day.getDay() + 7) % 7);
}

/* ------------------------------------------------------- occurrence ids ---- */

/** 'r:<templateId>:<dateKey>' — stable across expansions. */
export function occurrenceId(templateId: string, dateKeyStr: string): string {
  return `${OCCURRENCE_PREFIX}${templateId}:${dateKeyStr}`;
}

export function isOccurrenceId(id: string): boolean {
  return id.startsWith(OCCURRENCE_PREFIX);
}

/** The parts of an occurrence id, or null for any other id. */
export function parseOccurrenceId(id: string): { templateId: string; dateKey: string } | null {
  if (!isOccurrenceId(id)) return null;
  const rest = id.slice(OCCURRENCE_PREFIX.length);
  const sep = rest.lastIndexOf(':');
  if (sep <= 0) return null;
  return { templateId: rest.slice(0, sep), dateKey: rest.slice(sep + 1) };
}

/* ------------------------------------------------------------ templates ---- */

export function getTemplates(): RecurringTemplate[] {
  return templates;
}

export function getTemplateById(id: string): RecurringTemplate | null {
  return templates.find((t) => t.id === id) ?? null;
}

/** Create (or, with input.id, restore) a weekly template. */
export function createTemplate(input: TemplateInput): RecurringTemplate {
  const template: RecurringTemplate = {
    id: input.id ?? newId(),
    title: input.title,
    categoryId: input.categoryId,
    weekday: input.weekday,
    startMin: input.startMin,
    endMin: input.endMin,
    sinceISO: input.sinceISO ?? dateKey(nextOccurrenceOf(input.weekday)),
    ...(input.untilISO ? { untilISO: input.untilISO } : {}),
    exceptions: input.exceptions ?? {},
  };
  templates = [...templates.filter((t) => t.id !== template.id), template];
  persist();
  return template;
}

export function updateTemplate(id: string, patch: TemplatePatch): RecurringTemplate {
  const existing = getTemplateById(id);
  if (!existing) throw new Error(`Template not found: ${id}`);
  const updated = { ...existing, ...patch };
  if (updated.untilISO === undefined) delete updated.untilISO;
  templates = templates.map((t) => (t.id === id ? updated : t));
  persist();
  return updated;
}

/** Put a full snapshot back — the undo path for template-level changes. */
export function upsertTemplate(template: RecurringTemplate): void {
  templates = [...templates.filter((t) => t.id !== template.id), template];
  persist();
}

export function deleteTemplate(id: string): void {
  templates = templates.filter((t) => t.id !== id);
  persist();
}

/** Drop every template (Settings → reset demo data). */
export function clearAllTemplates(): void {
  templates = [];
  persist();
}

/**
 * "Delete every week": end the series but keep its past. untilISO becomes
 * the last occurrence before today; a series with no past is deleted whole.
 */
export function endTemplate(id: string, now: Date = new Date()): void {
  const template = getTemplateById(id);
  if (!template) return;
  const today = startOfDay(now);
  let back = (today.getDay() - template.weekday + 7) % 7;
  if (back === 0) back = 7; // strictly before today
  let last = addDays(today, -back);
  const until = template.untilISO ? parseDateKey(template.untilISO) : null;
  if (until && until.getTime() < last.getTime()) last = until;
  if (last.getTime() < parseDateKey(template.sinceISO).getTime()) deleteTemplate(id);
  else updateTemplate(id, { untilISO: dateKey(last) });
}

/* ----------------------------------------------------------- exceptions ---- */

export function getException(templateId: string, dateKeyStr: string): RecurrenceException | null {
  return getTemplateById(templateId)?.exceptions[dateKeyStr] ?? null;
}

export function setException(
  templateId: string,
  dateKeyStr: string,
  entry: RecurrenceException
): void {
  const template = getTemplateById(templateId);
  if (!template) return;
  upsertTemplate({ ...template, exceptions: { ...template.exceptions, [dateKeyStr]: entry } });
}

/** Set or clear (null) a date's exception — the undo path for this-day changes. */
export function restoreException(
  templateId: string,
  dateKeyStr: string,
  prev: RecurrenceException | null
): void {
  const template = getTemplateById(templateId);
  if (!template) return;
  const exceptions = { ...template.exceptions };
  if (prev === null) delete exceptions[dateKeyStr];
  else exceptions[dateKeyStr] = prev;
  upsertTemplate({ ...template, exceptions });
}

/** Layer a this-day override on top of whatever exception was there. */
export function mergeOverride(
  prev: RecurrenceException | null,
  patch: { title?: string; startMin?: number; endMin?: number; categoryId?: CategoryId }
): RecurrenceException {
  return prev && prev !== 'skip' ? { ...prev, ...patch } : { ...patch };
}

/* ------------------------------------------------------------ expansion ---- */

/**
 * Expand every template into occurrence CalendarEvents overlapping
 * [rangeStart, rangeEnd), exceptions applied, ids stable.
 */
export function expandTemplates(rangeStart: string, rangeEnd: string): CalendarEvent[] {
  const from = new Date(rangeStart).getTime();
  const to = new Date(rangeEnd).getTime();
  if (!(from < to)) return [];
  const firstDay = startOfDay(new Date(rangeStart));
  const out: CalendarEvent[] = [];
  for (const template of templates) {
    const since = parseDateKey(template.sinceISO);
    const untilMs = template.untilISO
      ? parseDateKey(template.untilISO).getTime()
      : Number.POSITIVE_INFINITY;
    const base = since.getTime() > firstDay.getTime() ? since : firstDay;
    let day = addDays(base, (template.weekday - base.getDay() + 7) % 7);
    for (; day.getTime() < to && day.getTime() <= untilMs; day = addDays(day, 7)) {
      const key = dateKey(day);
      const exception = template.exceptions[key];
      if (exception === 'skip') continue;
      const override = exception ?? null;
      const start = dateAtMinutes(day, override?.startMin ?? template.startMin);
      const end = dateAtMinutes(day, override?.endMin ?? template.endMin);
      if (start.getTime() >= to || end.getTime() <= from) continue;
      out.push({
        id: occurrenceId(template.id, key),
        title: override?.title ?? template.title,
        start: start.toISOString(),
        end: end.toISOString(),
        categoryId: override?.categoryId ?? template.categoryId,
        source: 'local',
        recurring: true,
        templateId: template.id,
      });
    }
  }
  return out;
}

/** Notifies after any template mutation. Returns an unsubscribe function. */
export function subscribeTemplates(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
