import { describe, expect, it } from 'vitest';
import type { CalendarRow } from '@/lib/db';
import { toCalendarEvent, toGooglePatch } from '@/lib/events';

const cal: CalendarRow = {
  id: 7, accountId: 2, googleId: 'work@example.com', name: 'Work', color: '#ff0000', shown: true, canWrite: true,
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
      },
    });
  });

  it('maps an all-day event keeping Google\'s exclusive end date', () => {
    const e = toCalendarEvent({ id: 'a', start: { date: '2026-10-27' }, end: { date: '2026-10-29' } }, { ...cal, canWrite: false });
    expect(e).toMatchObject({ title: '(No title)', start: '2026-10-27', end: '2026-10-29', allDay: true, editable: false });
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
