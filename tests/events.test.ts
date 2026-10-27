import { describe, expect, it } from 'vitest';
import type { CalendarRow } from '@/lib/db';
import { toCalendarEvent, toGooglePatch } from '@/lib/events';

const cal: CalendarRow = {
  id: 7, accountId: 2, googleId: 'work@example.com', name: 'Work', color: '#ff0000', colorOverride: null, shown: true, canWrite: true,
};

describe('toCalendarEvent', () => {
  it('maps a timed event', () => {
    expect(
      toCalendarEvent(
        {
          id: 'ev1', summary: 'Standup', etag: '"e1"', htmlLink: 'https://g/ev1', location: 'Room 1',
          description: '<b>hi</b>', recurringEventId: 'series1',
          start: { dateTime: '2026-10-27T09:00:00+07:00' }, end: { dateTime: '2026-10-27T09:15:00+07:00' },
        },
        cal,
      ),
    ).toEqual({
      id: '7:ev1', title: 'Standup', start: '2026-10-27T09:00:00+07:00', end: '2026-10-27T09:15:00+07:00',
      allDay: false, backgroundColor: '#ff0000', borderColor: '#ff0000', editable: true,
      extendedProps: {
        calendarId: 7, accountId: 2, calendarName: 'Work', canWrite: true, googleEventId: 'ev1',
        recurringEventId: 'series1', description: '<b>hi</b>', location: 'Room 1', etag: '"e1"', htmlLink: 'https://g/ev1',
        attendees: [], canAddGuests: true, conference: null,
      },
    });
  });

  it('maps an all-day event keeping Google\'s exclusive end date', () => {
    const e = toCalendarEvent({ id: 'a', start: { date: '2026-10-27' }, end: { date: '2026-10-29' } }, { ...cal, canWrite: false });
    expect(e).toMatchObject({ title: '(No title)', start: '2026-10-27', end: '2026-10-29', allDay: true, editable: false });
  });
});

describe('video calls', () => {
  const timed = { start: { dateTime: '2026-10-27T10:00:00Z' }, end: { dateTime: '2026-10-27T11:00:00Z' } };
  const conf = (ev: object) => toCalendarEvent({ id: 'v', ...timed, ...ev }, cal).extendedProps.conference;

  it('has no conference when the event has none', () => {
    expect(conf({})).toBeNull();
  });

  it('uses the Google Meet link from hangoutLink', () => {
    expect(conf({ hangoutLink: 'https://meet.google.com/abc-defg-hij' })).toEqual({ url: 'https://meet.google.com/abc-defg-hij', name: 'Google Meet' });
  });

  it('prefers the video entry point and names the provider', () => {
    const e = conf({
      hangoutLink: 'https://meet.google.com/abc-defg-hij',
      conferenceData: {
        conferenceSolution: { name: 'Zoom Meeting' },
        entryPoints: [
          { entryPointType: 'phone', uri: 'tel:+15551234567' },
          { entryPointType: 'video', uri: 'https://zoom.example.com/j/123' },
        ],
      },
    });
    expect(e).toEqual({ url: 'https://zoom.example.com/j/123', name: 'Zoom Meeting' });
  });

  it('calls a Meet entry point "Google Meet" and an unnamed other one "Video call"', () => {
    expect(conf({ conferenceData: { entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/xyz-abcd-efg' }] } })?.name).toBe('Google Meet');
    expect(conf({ conferenceData: { entryPoints: [{ entryPointType: 'video', uri: 'https://calls.example.com/r/1' }] } })?.name).toBe('Video call');
  });

  it('never exposes a link that is not https', () => {
    expect(conf({ hangoutLink: 'javascript:alert(1)' })).toBeNull();
    expect(conf({ hangoutLink: 'http://meet.example.com/x' })).toBeNull();
    expect(conf({ hangoutLink: 'not a url' })).toBeNull();
    expect(conf({ conferenceData: { entryPoints: [{ entryPointType: 'video', uri: 'data:text/html,hi' }] } })).toBeNull();
  });
});

describe('guests', () => {
  const timed = { start: { dateTime: '2026-10-27T10:00:00Z' }, end: { dateTime: '2026-10-27T11:00:00Z' } };

  it('maps attendees, keeping only the fields the UI uses', () => {
    const e = toCalendarEvent(
      {
        id: 'g', ...timed,
        attendees: [
          { email: 'a@example.com', displayName: 'Alex', responseStatus: 'accepted', organizer: true, self: true },
          { email: 'room@example.com', resource: true, responseStatus: 'accepted' },
          { email: 'b@example.com', optional: true, responseStatus: 'needsAction', comment: 'ignored' },
          { displayName: 'no email' },
        ],
      },
      cal,
    );
    expect(e.extendedProps.attendees).toEqual([
      { email: 'a@example.com', displayName: 'Alex', responseStatus: 'accepted', organizer: true, self: true },
      { email: 'room@example.com', resource: true, responseStatus: 'accepted' },
      { email: 'b@example.com', optional: true, responseStatus: 'needsAction' },
    ]);
  });

  const can = (ev: object, c = cal) => toCalendarEvent({ id: 'g', ...timed, ...ev }, c).extendedProps.canAddGuests;

  it('lets the organizer add guests', () => {
    expect(can({ organizer: { self: true }, guestsCanInviteOthers: false })).toBe(true);
  });

  it('lets guests add guests unless the organizer turned that off (it is on by default)', () => {
    expect(can({ organizer: { email: 'x@example.com' } })).toBe(true);
    expect(can({ organizer: { email: 'x@example.com' }, guestsCanInviteOthers: false })).toBe(false);
    expect(can({ organizer: { email: 'x@example.com' }, guestsCanInviteOthers: false, guestsCanModify: true })).toBe(true);
  });

  it('never allows it on read-only calendars, cancelled events or special event types', () => {
    expect(can({ organizer: { self: true } }, { ...cal, canWrite: false })).toBe(false);
    expect(can({ organizer: { self: true }, status: 'cancelled' })).toBe(false);
    expect(can({ organizer: { self: true }, eventType: 'birthday' })).toBe(false);
    expect(can({ organizer: { self: true }, eventType: 'default' })).toBe(true);
  });
});

describe('calendar color', () => {
  it('uses the user override instead of Google\'s color', () => {
    const e = toCalendarEvent({ id: 'a', start: { date: '2026-10-27' }, end: { date: '2026-10-28' } }, { ...cal, colorOverride: '#00ff00' });
    expect(e).toMatchObject({ backgroundColor: '#00ff00', borderColor: '#00ff00' });
  });
});

describe('toGooglePatch attendees', () => {
  it('sends only the writable attendee fields, and only when given', () => {
    expect(toGooglePatch({ title: 'x' })).not.toHaveProperty('attendees');
    expect(
      toGooglePatch({
        attendees: [{ email: 'a@example.com', displayName: 'Alex', responseStatus: 'accepted', self: true, organizer: true }, { email: 'b@example.com' }],
      }),
    ).toEqual({
      attendees: [{ email: 'a@example.com', displayName: 'Alex', responseStatus: 'accepted' }, { email: 'b@example.com' }],
    });
  });
});

describe('toGooglePatch', () => {
  it('sends only fields that are present', () => {
    expect(toGooglePatch({ title: 'New' })).toEqual({ summary: 'New' });
  });

  it('ignores incomplete time fields', () => {
    expect(toGooglePatch({ start: '2026-10-27T09:00:00Z' })).toEqual({});
  });

  it('maps timed values and clears date', () => {
    expect(
      toGooglePatch({ start: '2026-10-27T09:00:00Z', end: '2026-10-27T10:00:00Z', allDay: false, timeZone: 'Asia/Ho_Chi_Minh' }),
    ).toEqual({
      start: { dateTime: '2026-10-27T09:00:00Z', date: null, timeZone: 'Asia/Ho_Chi_Minh' },
      end: { dateTime: '2026-10-27T10:00:00Z', date: null, timeZone: 'Asia/Ho_Chi_Minh' },
    });
  });

  it('maps all-day values and clears dateTime', () => {
    expect(toGooglePatch({ start: '2026-10-27', end: '2026-10-28', allDay: true, description: '<p>x</p>' })).toEqual({
      description: '<p>x</p>',
      start: { date: '2026-10-27', dateTime: null, timeZone: null },
      end: { date: '2026-10-28', dateTime: null, timeZone: null },
    });
  });
});
