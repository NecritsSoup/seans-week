import {
  DAY_END_MIN,
  DAY_START_MIN,
  addDays,
  addMonths,
  clampToDayBounds,
  startOfDay,
} from '../../lib/time';
import { categoryById } from '../../state/categories';
import type { CategoryId } from '../../state/types';
import type {
  CancelIntent,
  CreateIntent,
  MoveIntent,
  NavigateIntent,
  ParsedIntent,
  RecurIntent,
  TimeMatch,
} from './types';

// Deterministic, fully client-side parser — the legacy app's AI prompt
// rebuilt as rules. One lowercase pass extracts verb, date, time, category
// and title; am/pm inference ports the legacy inferAmPm behavior.

/* ------------------------------------------------------------ category ---- */

const CATEGORY_KEYWORDS: Array<[RegExp, CategoryId]> = [
  [/\b(gym|workout|work[- ]?out|lift|lifting|training|exercise)\b/, 'gym'],
  [/\b(read|reads|reading|book|books)\b/, 'reading'],
  [/\b(dinner|supper|family|mom|dad|parents)\b/, 'dinner'],
  [/\b(walk|walking|water|watering|garden|plants)\b/, 'walk'],
  [/\b(penn|upenn|class|seminar|lecture|campus|nso|tap)\b/, 'upenn'],
  [/\b(meeting|meet|work|call|standup|stand[- ]?up|sync|review|1:1)\b/, 'work'],
];

/** Keyword → category, mirroring the legacy colorFor mapping. */
export function categoryFor(text: string): CategoryId | null {
  const lower = text.toLowerCase();
  for (const [pattern, id] of CATEGORY_KEYWORDS) {
    if (pattern.test(lower)) return id;
  }
  return null;
}

/* ---------------------------------------------------------------- dates ---- */

export interface DateMatch {
  day: Date;
  /** Matched substring, for stripping out of titles. */
  text: string;
  index: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tues: 2, tue: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thurs: 4, thur: 4, thu: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

const WEEKDAY_ALT =
  'sunday|monday|tuesday|wednesday|thursday|friday|saturday|thurs|tues|thur|sun|mon|tue|wed|thu|fri|sat';

const MONTH_INDEX: Record<string, number> = {
  january: 0, jan: 0,
  february: 1, feb: 1,
  march: 2, mar: 2,
  april: 3, apr: 3,
  may: 4,
  june: 5, jun: 5,
  july: 6, jul: 6,
  august: 7, aug: 7,
  september: 8, sept: 8, sep: 8,
  october: 9, oct: 9,
  november: 10, nov: 10,
  december: 11, dec: 11,
};

const MONTH_ALT =
  'january|february|march|april|august|september|october|november|december|june|july|sept|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';

/** If a month/day already passed by more than a day, mean next year. */
function adjustYear(candidate: Date, base: Date): Date {
  if (candidate.getTime() < startOfDay(base).getTime() - 24 * 3600 * 1000) {
    const bumped = new Date(candidate);
    bumped.setFullYear(bumped.getFullYear() + 1);
    return bumped;
  }
  return candidate;
}

/** The earliest date expression in `text`, or null. */
export function extractDate(text: string, base: Date = new Date()): DateMatch | null {
  const today = startOfDay(base);
  const candidates: DateMatch[] = [];

  const relative: Array<[RegExp, number]> = [
    [/\btoday\b/, 0],
    [/\btomorrow\b/, 1],
    [/\byesterday\b/, -1],
  ];
  for (const [pattern, offset] of relative) {
    const m = pattern.exec(text);
    if (m) candidates.push({ day: addDays(today, offset), text: m[0], index: m.index });
  }

  const weekdayRe = new RegExp(`\\b(next\\s+|this\\s+)?(${WEEKDAY_ALT})(?:'s)?\\b`, 'g');
  const wm = weekdayRe.exec(text);
  if (wm) {
    const target = WEEKDAY_INDEX[wm[2]];
    let offset = (target - today.getDay() + 7) % 7;
    if (wm[1]?.trim() === 'next') offset += 7;
    candidates.push({ day: addDays(today, offset), text: wm[0], index: wm.index });
  }

  const iso = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(text);
  if (iso) {
    const day = startOfDay(new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
    candidates.push({ day, text: iso[0], index: iso.index });
  }

  const monthDay = new RegExp(`\\b(${MONTH_ALT})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`).exec(text);
  if (monthDay) {
    const day = startOfDay(new Date(today.getFullYear(), MONTH_INDEX[monthDay[1]], Number(monthDay[2])));
    candidates.push({ day: adjustYear(day, base), text: monthDay[0], index: monthDay.index });
  }

  const dayMonth = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_ALT})\\b`).exec(text);
  if (dayMonth) {
    const day = startOfDay(new Date(today.getFullYear(), MONTH_INDEX[dayMonth[2]], Number(dayMonth[1])));
    candidates.push({ day: adjustYear(day, base), text: dayMonth[0], index: dayMonth.index });
  }

  const slash = /\b(\d{1,2})\/(\d{1,2})\b/.exec(text);
  if (slash) {
    const day = startOfDay(new Date(today.getFullYear(), Number(slash[1]) - 1, Number(slash[2])));
    candidates.push({ day: adjustYear(day, base), text: slash[0], index: slash.index });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.index - b.index || b.text.length - a.text.length);
  return candidates[0];
}

/* ---------------------------------------------------------------- times ---- */

function rawMinutes(hourStr: string, minStr: string | undefined, meridiem: string | undefined): {
  min: number;
  explicit: boolean;
} | null {
  const h = Number(hourStr);
  const m = minStr ? Number(minStr) : 0;
  if (m > 59) return null;
  if (meridiem) {
    if (h < 1 || h > 12) return null;
    const base = (h % 12) * 60 + m;
    return { min: meridiem === 'pm' ? base + 12 * 60 : base, explicit: true };
  }
  if (h > 23) return null;
  return { min: h * 60 + m, explicit: false };
}

interface IndexedTimeMatch extends TimeMatch {
  index: number;
}

/** The earliest time expression in `text` (extract dates first!), or null. */
export function extractTime(text: string): TimeMatch | null {
  const candidates: IndexedTimeMatch[] = [];

  const range =
    /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|—|to|until|till)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/.exec(
      text
    );
  if (range && (range[2] || range[3] || range[5] || range[6])) {
    const start = rawMinutes(range[1], range[2], range[3]);
    const end = rawMinutes(range[4], range[5], range[6]);
    if (start && end) {
      candidates.push({
        startMin: start.min,
        endMin: end.min,
        startExplicit: start.explicit,
        endExplicit: end.explicit,
        text: range[0],
        index: range.index,
      });
    }
  }

  const singles: RegExp[] = [
    /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/, // 8am, 8:30pm
    /\bat\s+(\d{1,2})(?::(\d{2}))?\b/, // at 8
    /\b(\d{1,2}):(\d{2})\b/, // 14:00
  ];
  for (const pattern of singles) {
    const m = pattern.exec(text);
    if (!m) continue;
    const parsed = rawMinutes(m[1], m[2], m[3]);
    if (!parsed) continue;
    candidates.push({
      startMin: parsed.min,
      endMin: null,
      startExplicit: parsed.explicit,
      endExplicit: false,
      text: m[0],
      index: m.index,
    });
  }

  const noon = /\bnoon\b/.exec(text);
  if (noon) {
    candidates.push({
      startMin: 12 * 60,
      endMin: null,
      startExplicit: true,
      endExplicit: false,
      text: noon[0],
      index: noon.index,
    });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.index - b.index || b.text.length - a.text.length);
  const { startMin, endMin, startExplicit, endExplicit, text: matched } = candidates[0];
  return { startMin, endMin, startExplicit, endExplicit, text: matched };
}

function saysAm(raw: string): boolean {
  return /\bam\b/.test(raw) || /\bmorning\b/.test(raw);
}

function saysPm(raw: string): boolean {
  return /\bpm\b/.test(raw) || /\b(evening|night|tonight|afternoon)\b/.test(raw);
}

/** Shift a bare 1–11 o'clock into the afternoon. */
function toPm(min: number): number {
  const h = Math.floor(min / 60);
  return h >= 1 && h <= 11 ? min + 12 * 60 : min;
}

/**
 * Resolve a create-time with no explicit am/pm: morning/evening words win;
 * otherwise a bare 1–6 means afternoon (nobody quick-adds a 3am block).
 */
function resolveCreateStart(min: number, explicit: boolean, raw: string): number {
  if (explicit) return min;
  if (saysAm(raw)) return min;
  if (saysPm(raw)) return toPm(min);
  const h = Math.floor(min / 60);
  return h >= 1 && h <= 6 ? min + 12 * 60 : min;
}

export function resolveCreateTimes(
  time: TimeMatch | null,
  raw: string
): { startMin: number; endMin: number } {
  if (!time) return { startMin: 9 * 60, endMin: 10 * 60 }; // legacy default
  let startMin = resolveCreateStart(time.startMin, time.startExplicit, raw);
  let endMin: number;
  if (time.endMin !== null) {
    endMin = time.endExplicit ? time.endMin : resolveCreateStart(time.endMin, false, raw);
    // "2-4pm": pull an unresolved start onto the same side as the end.
    if (!time.startExplicit && time.endExplicit && toPm(time.startMin) < endMin) {
      startMin = Math.max(startMin, toPm(time.startMin));
    }
    if (endMin <= startMin) endMin = Math.min(endMin + 12 * 60, 24 * 60);
    if (endMin <= startMin) endMin = startMin + 60;
  } else {
    endMin = startMin + 60;
  }
  startMin = clampToDayBounds(startMin);
  endMin = Math.min(Math.max(endMin, startMin + 15), DAY_END_MIN);
  return { startMin, endMin };
}

/**
 * Port of the legacy inferAmPm: a bare hour keeps the found event's side of
 * the clock — an evening walk moved "to 9" stays 9pm, not 9am.
 */
export function resolveMoveTimes(
  time: TimeMatch | null,
  origStartMin: number,
  origEndMin: number,
  raw: string
): { startMin: number; endMin: number } {
  const origDur = Math.max(origEndMin - origStartMin, 15);
  if (!time) return { startMin: origStartMin, endMin: origStartMin + origDur };

  const origHour = Math.floor(origStartMin / 60);
  const infer = (min: number, explicit: boolean): number => {
    if (explicit) return min;
    if (saysAm(raw)) return min;
    if (saysPm(raw)) return toPm(min);
    if (origHour >= 17) return toPm(min);
    return min;
  };

  let startMin = clampToDayBounds(infer(time.startMin, time.startExplicit));
  let endMin: number;
  if (time.endMin !== null) {
    endMin = infer(time.endMin, time.endExplicit);
    if (endMin <= startMin) endMin = Math.min(endMin + 12 * 60, 24 * 60);
    if (endMin <= startMin) endMin = startMin + origDur;
  } else {
    endMin = startMin + origDur; // only the start moved — keep the duration
  }
  endMin = Math.min(Math.max(endMin, startMin + 15), DAY_END_MIN);
  if (startMin >= endMin) startMin = Math.max(endMin - origDur, DAY_START_MIN);
  return { startMin, endMin };
}

/* ----------------------------------------------------------- recurrence ---- */

const WEEKLY_DAY_RE = new RegExp(`\\b(?:every|each)\\s+(${WEEKDAY_ALT})s?\\b`);
const WEEKLY_WORD_RE = /\b(?:weekly|every\s+week|each\s+week)\b/;

/**
 * Pull "every friday" / "weekly" out of a create body. The weekday itself
 * is left behind so extractDate still anchors the first occurrence.
 */
function extractWeekly(body: string): { body: string; repeatWeekly: boolean } {
  const day = WEEKLY_DAY_RE.exec(body);
  if (day) return { body: body.replace(day[0], ` ${day[1]} `), repeatWeekly: true };
  const word = WEEKLY_WORD_RE.exec(body);
  if (word) return { body: body.replace(word[0], ' '), repeatWeekly: true };
  return { body, repeatWeekly: false };
}

/* ---------------------------------------------------------------- verbs ---- */

const CREATE_VERB = /^(add|new|schedule|book|create|plan|put)\b/;
const MOVE_VERB = /^(move|push|reschedule|shift|bump|slide)\b/;
const CANCEL_VERB = /^(cancel|delete|remove|drop|scratch|skip)\b/;
const SEARCH_PREFIX = /^(find|search(?:\s+for)?|look\s+for|where(?:'s|\s+is))\s+/;
const RECUR_RE =
  /^make\s+(.+?)\s+(?:weekly|recurring|repeat(?:ing)?(?:\s+(?:weekly|every\s+week))?)[.!?]*$/;

/* ---------------------------------------------------------- title/query ---- */

function tidy(text: string): string {
  return text
    .replace(/(^|\s)'s\b/g, ' ')
    .replace(/\b(at|on|from|until|till|for|the|an?|my|this|next)\b\s*$/g, '')
    .replace(/^\s*\b(at|on|from|until|till|for|the|an?|my)\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,.-]+|[\s,.-]+$/g, '');
}

function cleanQuery(text: string): string {
  return tidy(
    text.replace(/\b(event|events|appointment|block|session)\b/g, ' ')
  );
}

function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/* ----------------------------------------------------------- navigation ---- */

function parseNavigation(lower: string, now: Date): NavigateIntent | null {
  let t = lower.replace(/[.!?]+$/, '').trim();
  t = t.replace(/^(go\s+to|goto|show|open|jump\s+to)\s+/, '');
  const today = startOfDay(now);

  const fixed: Record<string, { day: Date | null; label: string }> = {
    today: { day: today, label: 'today' },
    tomorrow: { day: addDays(today, 1), label: 'tomorrow' },
    yesterday: { day: addDays(today, -1), label: 'yesterday' },
    'next week': { day: addDays(today, 7), label: 'next week' },
    'last week': { day: addDays(today, -7), label: 'last week' },
    'previous week': { day: addDays(today, -7), label: 'last week' },
    'this week': { day: today, label: 'this week' },
    'next month': { day: addMonths(today, 1), label: 'next month' },
    'last month': { day: addMonths(today, -1), label: 'last month' },
  };
  if (t in fixed) {
    const target = fixed[t];
    return { kind: 'navigate', day: target.day, view: null, label: target.label };
  }

  const viewMatch = /^(day|week|month)(\s+view)?$/.exec(t);
  if (viewMatch) {
    const view = viewMatch[1] as NavigateIntent['view'];
    return { kind: 'navigate', day: null, view, label: `${viewMatch[1]} view` };
  }

  // A bare date expression ("friday", "june 3", "2026-08-01") navigates.
  const dm = extractDate(t, now);
  if (dm && dm.index === 0 && dm.text.length === t.length) {
    const label = dm.day.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    return { kind: 'navigate', day: dm.day, view: null, label };
  }
  return null;
}

/* --------------------------------------------------------------- intents ---- */

function stripMatch(text: string, match: { text: string } | null): string {
  return match ? text.replace(match.text, ' ') : text;
}

function parseCreate(body: string, raw: string, now: Date): CreateIntent {
  const weekly = extractWeekly(body);
  const dateMatch = extractDate(weekly.body, now);
  const afterDate = stripMatch(weekly.body, dateMatch);
  const timeMatch = extractTime(afterDate);
  const { startMin, endMin } = resolveCreateTimes(timeMatch, raw.toLowerCase());
  const categoryId = categoryFor(weekly.body) ?? 'work';
  const title = capitalize(tidy(stripMatch(afterDate, timeMatch)));
  return {
    kind: 'create',
    title: title || categoryById(categoryId).label,
    categoryId,
    day: dateMatch?.day ?? startOfDay(now),
    startMin,
    endMin,
    repeatWeekly: weekly.repeatWeekly,
  };
}

function parseRecur(body: string, now: Date): RecurIntent {
  const dateMatch = extractDate(body, now);
  return {
    kind: 'recur',
    query: cleanQuery(stripMatch(body, dateMatch)),
    queryDay: dateMatch?.day ?? null,
  };
}

function parseMove(body: string, raw: string, now: Date): MoveIntent {
  const splitAt = body.lastIndexOf(' to ');
  if (splitAt !== -1) {
    const head = body.slice(0, splitAt);
    const tail = body.slice(splitAt + 4);
    const targetDate = extractDate(tail, now);
    let targetTime = extractTime(stripMatch(tail, targetDate));
    if (!targetTime && !targetDate) {
      // "move gym to 8": a bare hour is still a destination time.
      const bare = /^\s*(\d{1,2})(?::(\d{2}))?\s*$/.exec(tail);
      if (bare) {
        const parsed = rawMinutes(bare[1], bare[2], undefined);
        if (parsed) {
          targetTime = {
            startMin: parsed.min,
            endMin: null,
            startExplicit: false,
            endExplicit: false,
            text: bare[0],
          };
        }
      }
    }
    const queryDate = extractDate(head, now);
    return {
      kind: 'move',
      query: cleanQuery(stripMatch(head, queryDate)),
      queryDay: queryDate?.day ?? null,
      targetDay: targetDate?.day ?? null,
      targetTime,
      raw,
    };
  }
  const dateMatch = extractDate(body, now);
  const afterDate = stripMatch(body, dateMatch);
  const timeMatch = extractTime(afterDate);
  return {
    kind: 'move',
    query: cleanQuery(stripMatch(afterDate, timeMatch)),
    queryDay: null,
    targetDay: dateMatch?.day ?? null,
    targetTime: timeMatch,
    raw,
  };
}

function parseCancel(body: string, now: Date): CancelIntent {
  const dateMatch = extractDate(body, now);
  return {
    kind: 'cancel',
    query: cleanQuery(stripMatch(body, dateMatch)),
    queryDay: dateMatch?.day ?? null,
  };
}

/**
 * The whole pipeline: one string in, one intent out.
 * Never throws; unrecognized input falls through to a search.
 */
export function parseCommand(rawInput: string, now: Date = new Date()): ParsedIntent | null {
  const raw = rawInput.trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();

  const todoMatch = /^todo:\s*(.*)$/i.exec(raw);
  if (todoMatch) {
    const text = todoMatch[1].trim();
    return text ? { kind: 'todo', text } : null;
  }

  const nav = parseNavigation(lower, now);
  if (nav) return nav;

  const recur = RECUR_RE.exec(lower);
  if (recur) return parseRecur(recur[1].trim(), now);

  if (MOVE_VERB.test(lower)) return parseMove(lower.replace(MOVE_VERB, '').trim(), raw, now);
  if (CANCEL_VERB.test(lower)) return parseCancel(lower.replace(CANCEL_VERB, '').trim(), now);
  if (CREATE_VERB.test(lower)) return parseCreate(lower.replace(CREATE_VERB, '').trim(), raw, now);

  if (SEARCH_PREFIX.test(lower)) {
    return { kind: 'search', query: raw.replace(SEARCH_PREFIX, '').trim() };
  }

  // No verb: a date or time makes it a create ("reading sunday 2-4pm");
  // anything else searches.
  const dateMatch = extractDate(lower, now);
  if (dateMatch || extractTime(lower)) return parseCreate(lower, raw, now);
  return { kind: 'search', query: raw };
}
