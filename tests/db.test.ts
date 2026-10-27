import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
      id: cal.id, accountId, googleId: 'work', name: 'Work (renamed)', color: '#222222', colorOverride: null, shown: false, canWrite: false,
    });
  });

  it('keeps a user-chosen color override across re-syncs, and clears it with null', () => {
    const accountId = repo.upsertAccount('a@example.com', 'rt');
    repo.upsertCalendar(accountId, { googleId: 'work', name: 'Work', color: '#111111', canWrite: true });
    const [cal] = repo.listCalendars();
    repo.setColorOverride(cal.id, '#abcdef');
    repo.upsertCalendar(accountId, { googleId: 'work', name: 'Work', color: '#222222', canWrite: true });
    expect(repo.getCalendar(cal.id)).toMatchObject({ color: '#222222', colorOverride: '#abcdef' });
    repo.setColorOverride(cal.id, null);
    expect(repo.getCalendar(cal.id)!.colorOverride).toBeNull();
  });
});

describe('openDb migration', () => {
  it('adds color_override to a database created before the column existed', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cal-')), 'old.db');
    const old = new Database(file);
    old.exec(`CREATE TABLE accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, refresh_token TEXT NOT NULL, needs_reauth INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE calendars (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, google_id TEXT NOT NULL, name TEXT NOT NULL, color TEXT NOT NULL, shown INTEGER NOT NULL DEFAULT 1, can_write INTEGER NOT NULL DEFAULT 0, UNIQUE(account_id, google_id));
      INSERT INTO accounts (email, refresh_token) VALUES ('a@example.com', 'rt');
      INSERT INTO calendars (account_id, google_id, name, color) VALUES (1, 'work', 'Work', '#111111');`);
    old.close();
    const migrated = createRepo(openDb(file));
    expect(migrated.listCalendars()[0]).toMatchObject({ name: 'Work', colorOverride: null });
    migrated.setColorOverride(1, '#abcdef');
    expect(createRepo(openDb(file)).getCalendar(1)!.colorOverride).toBe('#abcdef'); // reopening is a no-op
  });
});
