import { randomUUID } from 'node:crypto';
import type { calendar_v3 } from 'googleapis';
import type { CalendarRow } from './db';

/** An event guest (Google calls them attendees). `self` and `organizer` are read-only facts from Google. */
export type Guest = {
  email: string;
  displayName?: string;
  responseStatus?: string; // needsAction | accepted | declined | tentative
  organizer?: boolean;
  self?: boolean;
  optional?: boolean;
  resource?: boolean; // a room or other resource
};

/** A video call attached to an event (Google Meet, Zoom, ...). */
export type Conference = { url: string; name: string };

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
  attendees: Guest[];
  /** Whether the user may add guests here (the server still has the last word). */
  canAddGuests: boolean;
  conference: Conference | null;
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
  /** The complete guest list; Google replaces the existing list with it. */
  attendees?: Guest[];
  /** Ask Google to attach a new Meet call. (Removing one is not supported here.) */
  addMeet?: boolean;
};

function toGuest(a: calendar_v3.Schema$EventAttendee): Guest | null {
  if (!a.email) return null;
  return {
    email: a.email,
    ...(a.displayName ? { displayName: a.displayName } : {}),
    ...(a.responseStatus ? { responseStatus: a.responseStatus } : {}),
    ...(a.organizer ? { organizer: true } : {}),
    ...(a.self ? { self: true } : {}),
    ...(a.optional ? { optional: true } : {}),
    ...(a.resource ? { resource: true } : {}),
  };
}

const isHttps = (value: string) => {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};

/** The video call, from the video entry point or Meet's `hangoutLink`. Only https links are kept, since they become clickable. */
function toConference(ev: calendar_v3.Schema$Event): Conference | null {
  const video = ev.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video' && p.uri);
  const url = video?.uri ?? ev.hangoutLink;
  if (!url || !isHttps(url)) return null;
  const isMeet = new URL(url).hostname === 'meet.google.com';
  return { url, name: isMeet ? 'Google Meet' : ev.conferenceData?.conferenceSolution?.name || 'Video call' };
}

/** Organizers can always add guests; guests only if the organizer allows inviting or modifying (inviting is on by default). */
function canAddGuests(ev: calendar_v3.Schema$Event, cal: CalendarRow): boolean {
  if (!cal.canWrite || ev.status === 'cancelled') return false;
  if (ev.eventType != null && ev.eventType !== 'default') return false; // birthdays, out of office, focus time, ...
  return ev.organizer?.self === true || ev.guestsCanModify === true || ev.guestsCanInviteOthers !== false;
}

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
      attendees: (ev.attendees ?? []).flatMap((a) => toGuest(a) ?? []),
      canAddGuests: canAddGuests(ev, cal),
      conference: toConference(ev),
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
  if (d.addMeet) {
    // Google creates the call asynchronously; each request needs its own id. The request must also carry conferenceDataVersion=1.
    body.conferenceData = { createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } };
  }
  if (d.attendees !== undefined) {
    // Only what Google lets us write; `self` and `organizer` are its own bookkeeping.
    body.attendees = d.attendees.map(({ email, displayName, responseStatus, optional, resource }) => ({
      email,
      ...(displayName ? { displayName } : {}),
      ...(responseStatus ? { responseStatus } : {}),
      ...(optional ? { optional } : {}),
      ...(resource ? { resource } : {}),
    }));
  }
  return body;
}
