import { describe, expect, it } from 'vitest';
import { addDays, fromLocalInput, monthGrid, toLocalInput } from '@/lib/dates';

describe('addDays', () => {
  it('adds and subtracts across month and year boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('accepts a datetime string and uses only its date part', () => {
    expect(addDays('2026-10-27T10:00:00+07:00', 1)).toBe('2026-10-28');
  });
});

describe('local input conversion', () => {
  it('formats an ISO instant for <input type="datetime-local"> (TZ=UTC in tests)', () => {
    expect(toLocalInput('2026-10-27T10:30:00Z')).toBe('2026-10-27T10:30');
  });

  it('round-trips', () => {
    expect(fromLocalInput(toLocalInput('2026-10-27T10:30:00Z'))).toBe('2026-10-27T10:30:00.000Z');
  });
});

describe('monthGrid', () => {
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  it('returns six Sunday-first weeks starting on the Sunday on or before the 1st', () => {
    const grid = monthGrid(2026, 9); // October 2026; the 1st is a Thursday
    expect(grid).toHaveLength(42);
    expect(ymd(grid[0])).toBe('2026-09-27');
    expect(grid[0].getDay()).toBe(0);
    expect(ymd(grid[41])).toBe('2026-11-07');
    expect(grid.map(ymd)).toContain('2026-10-31');
  });

  it('starts on the 1st when it is a Sunday', () => {
    expect(ymd(monthGrid(2026, 1)[0])).toBe('2026-02-01'); // February 2026 starts on a Sunday
  });

  it('crosses year boundaries and gives local midnights', () => {
    const grid = monthGrid(2026, 11); // December 2026
    expect(ymd(grid[41])).toBe('2027-01-09');
    expect(grid.every((d) => d.getHours() === 0 && d.getMinutes() === 0)).toBe(true);
  });
});
