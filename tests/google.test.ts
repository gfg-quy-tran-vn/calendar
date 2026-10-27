import { describe, expect, it } from 'vitest';
import type { calendar_v3 } from 'googleapis';
import { createRepo, openDb } from '@/lib/db';
import { syncCalendars } from '@/lib/google';

describe('syncCalendars', () => {
  it('stores each calendar with name override, color and write access', async () => {
    const repo = createRepo(openDb(':memory:'));
    const accountId = repo.upsertAccount('a@example.com', 'rt');
    const fake = {
      calendarList: {
        list: async () => ({
          data: {
            items: [
              { id: 'primary@x', summary: 'a@example.com', summaryOverride: 'Me', backgroundColor: '#123456', accessRole: 'owner' },
              { id: 'team@x', summary: 'Team', backgroundColor: '#abcdef', accessRole: 'writer' },
              { id: 'holidays@x', summary: 'Holidays', accessRole: 'reader' },
            ],
          },
        }),
      },
    } as unknown as calendar_v3.Calendar;

    await syncCalendars(repo, accountId, fake);

    expect(repo.listCalendars().map(({ googleId, name, color, canWrite }) => ({ googleId, name, color, canWrite }))).toEqual([
      { googleId: 'holidays@x', name: 'Holidays', color: '#3b82f6', canWrite: false },
      { googleId: 'primary@x', name: 'Me', color: '#123456', canWrite: true },
      { googleId: 'team@x', name: 'Team', color: '#abcdef', canWrite: true },
    ]);
  });
});
