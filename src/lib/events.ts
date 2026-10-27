import type { calendar_v3 } from 'googleapis';
import type { CalendarRow } from './db';

/** Stored in FullCalendar's `extendedProps`; everything the UI needs to call our API. */
export type EventMeta = {
  calendarId: number;
  accountId: number;
  calendarName: string;
  canWrite: boolean;
  googleEventId: string;
  recurringEventId: string | null;
  description: string;
  location: string;
  etag: string;
  htmlLink: string;
};

/** Shape accepted by FullCalendar's `EventInput`. */
export type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end?: string;
  allDay: boolean;
  backgroundColor: string;
  borderColor: string;
  editable: boolean;
  extendedProps: EventMeta;
};

/** What the UI sends. All-day `start`/`end` are `YYYY-MM-DD` with exclusive end (same as Google). */
export type EventDraft = {
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  description?: string;
  location?: string;
  timeZone?: string;
};

export function toCalendarEvent(ev: calendar_v3.Schema$Event, cal: CalendarRow): CalendarEvent {
  const allDay = Boolean(ev.start?.date);
  const color = cal.colorOverride ?? cal.color;
  return {
    id: `${cal.id}:${ev.id}`,
    title: ev.summary || '(No title)',
    start: (allDay ? ev.start?.date : ev.start?.dateTime) ?? '',
    end: (allDay ? ev.end?.date : ev.end?.dateTime) ?? undefined,
    allDay,
    backgroundColor: color,
    borderColor: color,
    editable: cal.canWrite,
    extendedProps: {
      calendarId: cal.id,
      accountId: cal.accountId,
      calendarName: cal.name,
      canWrite: cal.canWrite,
      googleEventId: ev.id ?? '',
      recurringEventId: ev.recurringEventId ?? null,
      description: ev.description ?? '',
      location: ev.location ?? '',
      etag: ev.etag ?? '',
      htmlLink: ev.htmlLink ?? '',
    },
  };
}

function toGoogleTime(value: string, allDay: boolean, timeZone?: string): calendar_v3.Schema$EventDateTime {
  return allDay
    ? { date: value.slice(0, 10), dateTime: null, timeZone: null }
    : { dateTime: value, date: null, timeZone: timeZone ?? null };
}

export function toGooglePatch(d: Partial<EventDraft>): calendar_v3.Schema$Event {
  const body: calendar_v3.Schema$Event = {};
  if (d.title !== undefined) body.summary = d.title;
  if (d.description !== undefined) body.description = d.description;
  if (d.location !== undefined) body.location = d.location;
  if (d.start !== undefined && d.end !== undefined && d.allDay !== undefined) {
    body.start = toGoogleTime(d.start, d.allDay, d.timeZone);
    body.end = toGoogleTime(d.end, d.allDay, d.timeZone);
  }
  return body;
}
