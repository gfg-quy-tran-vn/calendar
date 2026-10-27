import { describe, expect, it } from 'vitest';
import { addDays, fromLocalInput, toLocalInput } from '@/lib/dates';

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
