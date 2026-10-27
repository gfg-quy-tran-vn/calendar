import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export type Account = { id: number; email: string; refreshToken: string; needsReauth: boolean };
export type CalendarRow = {
  id: number; accountId: number; googleId: string; name: string; color: string; shown: boolean; canWrite: boolean;
};
export type CalendarInput = Pick<CalendarRow, 'googleId' | 'name' | 'color' | 'canWrite'>;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  refresh_token TEXT NOT NULL,
  needs_reauth INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS calendars (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  google_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  shown INTEGER NOT NULL DEFAULT 1,
  can_write INTEGER NOT NULL DEFAULT 0,
  UNIQUE(account_id, google_id)
);
`;

type AccountRecord = { id: number; email: string; refresh_token: string; needs_reauth: number };
type CalendarRecord = {
  id: number; account_id: number; google_id: string; name: string; color: string; shown: number; can_write: number;
};

const toAccount = (r: AccountRecord): Account => ({
  id: r.id, email: r.email, refreshToken: r.refresh_token, needsReauth: r.needs_reauth === 1,
});
const toCalendar = (r: CalendarRecord): CalendarRow => ({
  id: r.id, accountId: r.account_id, googleId: r.google_id, name: r.name, color: r.color,
  shown: r.shown === 1, canWrite: r.can_write === 1,
});

export function openDb(file: string): Database.Database {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

export function createRepo(db: Database.Database) {
  return {
    upsertAccount(email: string, refreshToken: string): number {
      const row = db
        .prepare(
          `INSERT INTO accounts (email, refresh_token) VALUES (?, ?)
           ON CONFLICT(email) DO UPDATE SET refresh_token = excluded.refresh_token, needs_reauth = 0
           RETURNING id`,
        )
        .get(email, refreshToken) as { id: number };
      return row.id;
    },
    getAccount(id: number): Account | undefined {
      const r = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as AccountRecord | undefined;
      return r && toAccount(r);
    },
    listAccounts(): Account[] {
      return (db.prepare('SELECT * FROM accounts ORDER BY email').all() as AccountRecord[]).map(toAccount);
    },
    markNeedsReauth(id: number): void {
      db.prepare('UPDATE accounts SET needs_reauth = 1 WHERE id = ?').run(id);
    },
    deleteAccount(id: number): void {
      db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
    },
    upsertCalendar(accountId: number, c: CalendarInput): void {
      db.prepare(
        `INSERT INTO calendars (account_id, google_id, name, color, can_write) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(account_id, google_id)
         DO UPDATE SET name = excluded.name, color = excluded.color, can_write = excluded.can_write`,
      ).run(accountId, c.googleId, c.name, c.color, c.canWrite ? 1 : 0);
    },
    getCalendar(id: number): CalendarRow | undefined {
      const r = db.prepare('SELECT * FROM calendars WHERE id = ?').get(id) as CalendarRecord | undefined;
      return r && toCalendar(r);
    },
    listCalendars(): CalendarRow[] {
      return (db.prepare('SELECT * FROM calendars ORDER BY account_id, name').all() as CalendarRecord[]).map(toCalendar);
    },
    setShown(id: number, shown: boolean): void {
      db.prepare('UPDATE calendars SET shown = ? WHERE id = ?').run(shown ? 1 : 0, id);
    },
  };
}

export type Repo = ReturnType<typeof createRepo>;

// Cached on globalThis so Next.js dev hot-reload doesn't open a new connection on every edit.
const globalForRepo = globalThis as unknown as { calendarRepo?: Repo };

export function getRepo(): Repo {
  globalForRepo.calendarRepo ??= createRepo(openDb(process.env.CALENDAR_DB ?? 'data/calendar.db'));
  return globalForRepo.calendarRepo;
}

export function setRepoForTests(repo: Repo | undefined): void {
  globalForRepo.calendarRepo = repo;
}
