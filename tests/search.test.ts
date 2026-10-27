import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '@/lib/events';
import { highlightParts, orderForSearch } from '@/lib/search';

const ev = (id: string, start: string): CalendarEvent => ({
  id, title: id, start, allDay: false, backgroundColor: '#000', borderColor: '#000', editable: true,
  extendedProps: {} as CalendarEvent['extendedProps'],
});

describe('orderForSearch', () => {
  const now = new Date('2026-10-27T12:00:00Z'); // tests run with TZ=UTC

  it('lists today and later first, soonest first, then past events, most recent first', () => {
    const events = [
      ev('past-old', '2026-10-01T09:00:00Z'),
      ev('later', '2026-11-05T09:00:00Z'),
      ev('past-recent', '2026-10-20T09:00:00Z'),
      ev('soon', '2026-10-28T09:00:00Z'),
      ev('earlier-today', '2026-10-27T08:00:00Z'),
    ];
    expect(orderForSearch(events, now).map((e) => e.id)).toEqual(['earlier-today', 'soon', 'later', 'past-recent', 'past-old']);
  });

  it('treats an all-day event today as upcoming', () => {
    const events = [ev('yesterday', '2026-10-26'), ev('today', '2026-10-27')];
    expect(orderForSearch(events, now).map((e) => e.id)).toEqual(['today', 'yesterday']);
  });

  it('does not change the list it is given', () => {
    const events = [ev('b', '2026-10-01T09:00:00Z'), ev('a', '2026-11-01T09:00:00Z')];
    orderForSearch(events, now);
    expect(events.map((e) => e.id)).toEqual(['b', 'a']);
  });
});

describe('highlightParts', () => {
  it('marks the parts that match, ignoring case', () => {
    expect(highlightParts('Team Standup', 'stand')).toEqual([
      { text: 'Team ', match: false }, { text: 'Stand', match: true }, { text: 'up', match: false },
    ]);
  });

  it('marks every word of the query, wherever it appears', () => {
    expect(highlightParts('Dentist visit at the dentist', 'visit dentist')).toEqual([
      { text: 'Dentist', match: true }, { text: ' ', match: false }, { text: 'visit', match: true },
      { text: ' at the ', match: false }, { text: 'dentist', match: true },
    ]);
  });

  it('treats special characters literally', () => {
    expect(highlightParts('Plan (v2) review', '(v2)')).toEqual([
      { text: 'Plan ', match: false }, { text: '(v2)', match: true }, { text: ' review', match: false },
    ]);
  });

  it('returns the text unmarked when nothing matches or the query is empty', () => {
    expect(highlightParts('Lunch', 'zzz')).toEqual([{ text: 'Lunch', match: false }]);
    expect(highlightParts('Lunch', '  ')).toEqual([{ text: 'Lunch', match: false }]);
    expect(highlightParts('', 'x')).toEqual([]);
  });
});
