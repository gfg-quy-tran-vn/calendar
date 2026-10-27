import type { calendar_v3 } from 'googleapis';
import type { CalendarRow } from './db';
import { classifyGoogleError, type GoogleErrorKind } from './errors';
import { toCalendarEvent, type CalendarEvent } from './events';

export type Range = { timeMin: string; timeMax: string };
export type CalendarError = { calendarId: number; accountId: number; name: string; kind: GoogleErrorKind };
export type EventsResponse = { events: CalendarEvent[]; errors: CalendarError[] };
export type EventLister = (cal: CalendarRow, range: Range) => Promise<calendar_v3.Schema$Event[]>;

export async function fetchRange(calendars: CalendarRow[], range: Range, list: EventLister): Promise<EventsResponse> {
  const settled = await Promise.allSettled(calendars.map((cal) => list(cal, range)));
  const result: EventsResponse = { events: [], errors: [] };
  settled.forEach((outcome, i) => {
    const cal = calendars[i];
    if (outcome.status === 'fulfilled') {
      for (const ev of outcome.value) {
        if (ev.status !== 'cancelled') result.events.push(toCalendarEvent(ev, cal));
      }
    } else {
      result.errors.push({ calendarId: cal.id, accountId: cal.accountId, name: cal.name, kind: classifyGoogleError(outcome.reason) });
    }
  });
  return result;
}
