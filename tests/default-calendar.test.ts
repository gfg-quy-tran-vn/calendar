import { describe, expect, it } from 'vitest';
import { defaultCalendarId } from '@/lib/calendars';

describe('defaultCalendarId', () => {
  it('prefers the first calendar that is shown on the grid', () => {
    expect(defaultCalendarId([{ id: 1, shown: false }, { id: 2, shown: true }, { id: 3, shown: true }])).toBe(2);
  });

  it('falls back to the first calendar when none is shown', () => {
    expect(defaultCalendarId([{ id: 7, shown: false }, { id: 8, shown: false }])).toBe(7);
  });

  it('returns 0 when there are no writable calendars', () => {
    expect(defaultCalendarId([])).toBe(0);
  });
});
