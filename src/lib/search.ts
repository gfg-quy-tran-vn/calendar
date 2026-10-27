import type { CalendarError } from './aggregate';
import type { CalendarEvent } from './events';

export const MIN_QUERY_LENGTH = 2;
export const MAX_QUERY_LENGTH = 200;
/** How far either side of today a search looks. */
export const SEARCH_WINDOW_DAYS = 365;
/** Per calendar, asked of Google. */
export const SEARCH_FETCH_LIMIT = 250;
/** Shown to the user. */
export const SEARCH_RESULT_LIMIT = 50;

export type SearchResponse = {
  events: CalendarEvent[];
  /** How many events matched before the list was cut to `SEARCH_RESULT_LIMIT`. */
  total: number;
  errors: CalendarError[];
};

/** Today and later first (soonest first), then earlier events (most recent first). Does not modify its input. */
export function orderForSearch(events: CalendarEvent[], now: Date): CalendarEvent[] {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const cutoff = startOfToday.getTime();
  const time = (e: CalendarEvent) => new Date(e.start).getTime();
  const upcoming = events.filter((e) => time(e) >= cutoff).sort((a, b) => time(a) - time(b));
  const past = events.filter((e) => time(e) < cutoff).sort((a, b) => time(b) - time(a));
  return [...upcoming, ...past];
}

export type TextPart = { text: string; match: boolean };

/** Splits `text` so the words of `query` can be highlighted (case-insensitive, special characters taken literally). */
export function highlightParts(text: string, query: string): TextPart[] {
  if (!text) return [];
  const words = query.split(/\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (words.length === 0) return [{ text, match: false }];
  const parts: TextPart[] = [];
  let last = 0;
  for (const m of text.matchAll(new RegExp(words.join('|'), 'gi'))) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index), match: false });
    parts.push({ text: m[0], match: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), match: false });
  return parts;
}
