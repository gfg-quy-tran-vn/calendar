import { describe, expect, it } from 'vitest';
import type { CalendarRow } from '@/lib/db';
import { fetchRange } from '@/lib/aggregate';

const cal = (id: number, accountId: number, name: string): CalendarRow => ({
  id, accountId, googleId: `g${id}`, name, color: '#000', shown: true, canWrite: true,
});
const range = { timeMin: '2026-10-26T00:00:00Z', timeMax: '2026-11-02T00:00:00Z' };
const timed = (id: string, status = 'confirmed') => ({
  id, status, start: { dateTime: '2026-10-27T09:00:00Z' }, end: { dateTime: '2026-10-27T10:00:00Z' },
});

describe('fetchRange', () => {
  it('merges events from all calendars and drops cancelled ones', async () => {
    const result = await fetchRange([cal(1, 1, 'A'), cal(2, 2, 'B')], range, async (c) =>
      c.id === 1 ? [timed('x'), timed('gone', 'cancelled')] : [timed('y')],
    );
    expect(result.events.map((e) => e.id)).toEqual(['1:x', '2:y']);
    expect(result.errors).toEqual([]);
  });

  it('reports failed calendars without losing the others', async () => {
    const result = await fetchRange([cal(1, 1, 'A'), cal(2, 5, 'B')], range, async (c) => {
      if (c.id === 2) throw Object.assign(new Error('x'), { response: { status: 400, data: { error: 'invalid_grant' } } });
      return [timed('x')];
    });
    expect(result.events).toHaveLength(1);
    expect(result.errors).toEqual([{ calendarId: 2, accountId: 5, name: 'B', kind: 'reauth' }]);
  });

  it('passes the range through to the lister', async () => {
    let seen: unknown;
    await fetchRange([cal(1, 1, 'A')], range, async (_c, r) => {
      seen = r;
      return [];
    });
    expect(seen).toEqual(range);
  });
});
