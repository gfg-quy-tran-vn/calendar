import { beforeEach, describe, expect, it } from 'vitest';
import { createRepo, openDb, type Repo } from '@/lib/db';

let repo: Repo;
beforeEach(() => {
  repo = createRepo(openDb(':memory:'));
});

describe('accounts', () => {
  it('reconnecting the same email keeps the id, replaces the token, clears needsReauth', () => {
    const id = repo.upsertAccount('a@example.com', 'rt1');
    repo.markNeedsReauth(id);
    expect(repo.upsertAccount('a@example.com', 'rt2')).toBe(id);
    expect(repo.getAccount(id)).toEqual({ id, email: 'a@example.com', refreshToken: 'rt2', needsReauth: false });
  });

  it('deleting an account deletes its calendars', () => {
    const id = repo.upsertAccount('a@example.com', 'rt');
    repo.upsertCalendar(id, { googleId: 'primary', name: 'A', color: '#000000', canWrite: true });
    repo.deleteAccount(id);
    expect(repo.listCalendars()).toEqual([]);
  });
});

describe('calendars', () => {
  it('re-syncing updates name/color/canWrite but keeps the user-chosen shown flag', () => {
    const accountId = repo.upsertAccount('a@example.com', 'rt');
    repo.upsertCalendar(accountId, { googleId: 'work', name: 'Work', color: '#111111', canWrite: true });
    const [cal] = repo.listCalendars();
    repo.setShown(cal.id, false);
    repo.upsertCalendar(accountId, { googleId: 'work', name: 'Work (renamed)', color: '#222222', canWrite: false });
    expect(repo.getCalendar(cal.id)).toEqual({
      id: cal.id, accountId, googleId: 'work', name: 'Work (renamed)', color: '#222222', shown: false, canWrite: false,
    });
  });
});
