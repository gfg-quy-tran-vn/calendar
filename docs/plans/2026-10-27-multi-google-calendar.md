# Multi-Google-Calendar Personal Calendar Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A localhost web app that combines several Google accounts' calendars into one FullCalendar view. Events can be viewed, created, edited, dragged and deleted, and their descriptions are shown as cleaned HTML and edited with a rich-text (TipTap) editor.

**Architecture:** One Next.js App Router app. Server route handlers keep each Google account's refresh token in SQLite and call the Google Calendar API through `googleapis`. The browser only ever calls our own `/api/*` routes. Events are fetched live for the visible date range and never stored locally. Design: `docs/plans/2026-10-27-multi-google-calendar-design.md`.

**Tech Stack (checked 2026-10-27):**

| Package | Version | Note |
|---|---|---|
| Node | **24** (`nvm use 24`) | googleapis 188, better-sqlite3 13, vitest 5 and isomorphic-dompurify 4 all need Node 22 or later. Node 20 won't work. |
| next / create-next-app | 16.x | |
| @fullcalendar/* | **6.1.x (pinned)** | v7 is `latest` but has breaking changes and wasn't checked. v6.1 supports React 19. |
| @tiptap/* | 3.x | `StarterKit` includes Link and Underline; `TableKit` comes from `@tiptap/extension-table` |
| isomorphic-dompurify | 4.x | |
| googleapis | 188.x | |
| better-sqlite3 | 13.x | |
| vitest | 5.x | |

These were checked in a scratch install: DOMPurify's output strings, SQLite `INSERT … RETURNING`, the parameters of the Google login URL, the exports of TipTap and FullCalendar, the type of the second argument to `events.patch`, `Intl.DateTimeFormat#formatRange`, and the `create-next-app` flags (it also works when `docs/` already exists).

**Order of work (the riskiest parts are tested first):**
- **Task 0:** Google login works for every account you plan to use. Stop here if it doesn't.
- **Tasks 1–11:** the server side, read-only.
- **Task 12:** read-only screen, then **Checkpoint A** with real accounts.
- **Tasks 13–15:** writing (create, edit, drag, delete) and the rich-text editor.
- **Task 16:** README and the full manual check.

**Conventions:**
- Path alias `@/*` → `src/*`.
- Tests live in `tests/` and run with `npm test`, which sets `TZ=UTC`.
- Route handlers use the standard `Request`/`Response` (no `next/server` imports), so tests can call them directly.
- Commit after every task.

**Kept deliberately small:**
- No automatic retry on rate limits.
- Month, week and day views only (no list view).
- One Google API client per request.
- Recurring events: "This event" or "All events" (text fields only).

---

### Task 0: Google Cloud setup and login check (gate)

This checks the riskiest assumption before any app code is written: every Google account you want, including a company Workspace account, can log in and list its calendars with write access.

**Step 1: Google Cloud setup (manual, about 10 minutes)**

1. https://console.cloud.google.com → create a project (e.g. "Personal Calendar").
2. **APIs & Services → Library** → enable **Google Calendar API**.
3. **Google Auth Platform**:
   - **Branding:** app name and your email.
   - **Audience:** user type **External**. Add every Google account you'll connect under **Test users**.
   - **Data access:** add scopes `openid`, `.../auth/userinfo.email`, `.../auth/calendar`.
   - **Clients → Create client:** type **Web application**. Authorized redirect URI: `http://localhost:3000/api/auth/callback`.
4. Note the client ID and secret.

**Step 2: Write a throwaway check script, outside the repo**

```bash
source ~/.nvm/nvm.sh && nvm use 24
mkdir -p /tmp/oauth-spike && cd /tmp/oauth-spike && npm init -y >/dev/null && npm install googleapis
```

`/tmp/oauth-spike/oauth-check.mjs`:

```js
// Throwaway: proves each Google account can log in and list its calendars.
import http from 'node:http';
import { google } from 'googleapis';

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
const client = () =>
  new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, 'http://localhost:3000/api/auth/callback');
const authUrl = client().generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent select_account',
  scope: ['openid', 'email', 'https://www.googleapis.com/auth/calendar'],
});

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost:3000');
    if (url.pathname !== '/api/auth/callback') {
      res.writeHead(302, { Location: authUrl }).end();
      return;
    }
    try {
      if (url.searchParams.get('error')) throw new Error(url.searchParams.get('error'));
      const c = client();
      const { tokens } = await c.getToken(url.searchParams.get('code'));
      c.setCredentials(tokens);
      const { data: me } = await google.oauth2({ version: 'v2', auth: c }).userinfo.get();
      const { data: list } = await google.calendar({ version: 'v3', auth: c }).calendarList.list();
      const lines = [
        `account: ${me.email}`,
        `refresh token returned: ${Boolean(tokens.refresh_token)}`,
        ...(list.items ?? []).map((i) => `  ${i.accessRole.padEnd(14)} ${i.summaryOverride ?? i.summary}`),
      ];
      console.log(lines.join('\n') + '\n');
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end(`${lines.join('\n')}\n\nOpen http://localhost:3000 again for the next account.`);
    } catch (err) {
      console.error('FAILED:', err.message);
      res.writeHead(500, { 'Content-Type': 'text/plain' }).end(`FAILED: ${err.message}`);
    }
  })
  .listen(3000, 'localhost', () => console.log('Open http://localhost:3000 and sign in with each Google account.'));
```

**Step 3: Run it for every account**

```bash
GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... node /tmp/oauth-spike/oauth-check.mjs
```

Open http://localhost:3000 once for each account.

**Expected for each account:**
- `refresh token returned: true`
- At least one calendar with role `owner` or `writer`.

**Gate:**
- **All accounts pass:** delete `/tmp/oauth-spike` and continue to Task 1.
- **"Access blocked" / `admin_policy_enforced` / "has not approved this app"** on a Workspace account: its admin blocks unverified apps. **Stop.** Either ask the admin to trust this OAuth client ID, or continue with personal accounts only. Record the decision in the design doc's "Known limitations" section.
- **`redirect_uri_mismatch`:** the redirect URI in step 1.4 doesn't exactly match `http://localhost:3000/api/auth/callback`. Fix it and run again.

Nothing to commit.

---

### Task 1: Scaffold the project

**Files:**
- Create: the Next.js scaffold in the repo root, plus `.nvmrc`, `vitest.config.ts`, `env.example`
- Modify: `package.json` (scripts), `next.config.ts`, `.gitignore`, `src/app/page.tsx`
- Delete: `src/app/page.module.css`

**Step 1: Generate the app** (checked: works with `docs/` already in the folder)

```bash
cd /Users/bill/Working/_tools/calendar
source ~/.nvm/nvm.sh && nvm use 24
echo 24 > .nvmrc
npx create-next-app@16 . --ts --app --src-dir --eslint --no-tailwind --no-react-compiler --import-alias "@/*" --use-npm --yes
```

Expected: "Success! Created calendar". This also runs `git init`; if `git status` fails afterwards, run `git init` yourself.

**Step 2: Install dependencies**

```bash
npm install googleapis better-sqlite3 isomorphic-dompurify \
  @fullcalendar/core@6 @fullcalendar/react@6 @fullcalendar/daygrid@6 @fullcalendar/timegrid@6 @fullcalendar/interaction@6 \
  @tiptap/react @tiptap/pm @tiptap/starter-kit @tiptap/extension-table
npm install -D vitest @types/better-sqlite3
```

Expected: `npm ls @fullcalendar/core` shows `6.1.x`.

**Step 3: Configure**

`next.config.ts`:

```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3'],
};

export default nextConfig;
```

`vitest.config.ts`:

```ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
```

In `package.json`, set these scripts (keep the scaffold's `build`, `start` and `lint`):

```json
"dev": "next dev -H localhost",
"test": "TZ=UTC vitest run",
"test:watch": "TZ=UTC vitest"
```

Add to `.gitignore`:

```
# local calendar data (refresh tokens!)
/data/
```

(The scaffold's `.gitignore` already ignores `.env*`; that's why the example file below is named `env.example`.)

`env.example`:

```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
APP_URL=http://localhost:3000
# CALENDAR_DB=data/calendar.db
```

Copy it to `.env.local` and fill in the client ID and secret from Task 0.

Delete `src/app/page.module.css`. Replace `src/app/page.tsx` with a placeholder (the real one comes in Task 12):

```tsx
export default function Page() {
  return <p>Calendar</p>;
}
```

**Step 4: Verify the build**

Run: `npm run build`
Expected: the build succeeds.

**Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app with calendar dependencies"
```

---

### Task 2: Date helpers

**Files:**
- Create: `src/lib/dates.ts`
- Test: `tests/dates.test.ts`

**Step 1: Write the failing test**

```ts
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
```

**Step 2: Run it to verify it fails**

Run: `npm test -- tests/dates.test.ts`
Expected: FAIL, "Failed to resolve import '@/lib/dates'".

**Step 3: Implement**

```ts
const pad = (n: number) => String(n).padStart(2, '0');

/** Add whole days to a `YYYY-MM-DD` (or ISO datetime) string; returns `YYYY-MM-DD`. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** ISO instant → value for `<input type="datetime-local">` in the browser's time zone. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `datetime-local` value (local time) → ISO instant. */
export function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}

export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
```

**Step 4: Run the test**

Run: `npm test -- tests/dates.test.ts`
Expected: PASS (4 tests).

**Step 5: Commit**

```bash
git add src/lib/dates.ts tests/dates.test.ts
git commit -m "feat: add date helpers"
```

---

### Task 3: HTML cleaning

**Files:**
- Create: `src/lib/sanitize.ts`
- Test: `tests/sanitize.test.ts`

The expected strings below were produced by isomorphic-dompurify 4.6 with exactly this configuration. If a test fails, the code is wrong, not the expected string.

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { toDisplayHtml } from '@/lib/sanitize';

describe('toDisplayHtml', () => {
  it('returns empty string for empty input', () => {
    expect(toDisplayHtml('')).toBe('');
    expect(toDisplayHtml(null)).toBe('');
  });

  it('keeps formatting tags', () => {
    expect(toDisplayHtml('<b>bold</b> <ul><li>x</li></ul>')).toBe('<b>bold</b> <ul><li>x</li></ul>');
  });

  it('strips scripts, event handlers and images', () => {
    expect(toDisplayHtml('<p onclick="x()">hi</p><script>alert(1)</script><img src=x onerror=alert(1)>')).toBe('<p>hi</p>');
  });

  it('drops javascript: links and hardens real links', () => {
    expect(toDisplayHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a target="_blank" rel="noopener noreferrer">x</a>');
    expect(toDisplayHtml('<a href="https://example.com">x</a>')).toBe(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer">x</a>',
    );
  });

  it('converts plain text: escapes, links URLs, keeps line breaks', () => {
    expect(toDisplayHtml('a < b\nsee https://meet.google.com/abc')).toBe(
      'a &lt; b<br>see <a href="https://meet.google.com/abc" target="_blank" rel="noopener noreferrer">https://meet.google.com/abc</a>',
    );
  });

  it('keeps the text inside unknown tags such as Google html-blob', () => {
    expect(toDisplayHtml('<html-blob>Join <b>now</b></html-blob>')).toBe('Join <b>now</b>');
  });
});
```

**Step 2: Run it to verify it fails**

Run: `npm test -- tests/sanitize.test.ts`
Expected: FAIL, import not resolved.

**Step 3: Implement**

```ts
import DOMPurify from 'isomorphic-dompurify';

const ALLOWED_TAGS = [
  'a', 'b', 'strong', 'i', 'em', 'u', 's', 'p', 'br', 'hr', 'span', 'div',
  'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'blockquote', 'code', 'pre',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
];
const ALLOWED_ATTR = ['href', 'target', 'rel', 'colspan', 'rowspan'];

const HAS_TAG = /<\/?[a-z][\s\S]*?>/i;
const URL_RE = /(https?:\/\/[^\s<]+)/g;

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR });
}

/** Google descriptions are either HTML or plain text; normalise both to safe HTML. */
export function toDisplayHtml(raw: string | null | undefined): string {
  if (!raw) return '';
  const html = HAS_TAG.test(raw)
    ? raw
    : escapeHtml(raw).replace(URL_RE, '<a href="$1">$1</a>').replace(/\r?\n/g, '<br>');
  return sanitizeHtml(html);
}
```

**Step 4: Run the test**

Run: `npm test -- tests/sanitize.test.ts`
Expected: PASS (6 tests).

**Step 5: Commit**

```bash
git add src/lib/sanitize.ts tests/sanitize.test.ts
git commit -m "feat: add HTML cleaning for event descriptions"
```

---

### Task 4: SQLite storage

**Files:**
- Create: `src/lib/db.ts`
- Test: `tests/db.test.ts`

**Step 1: Write the failing test**

```ts
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
```

**Step 2: Run it to verify it fails**

Run: `npm test -- tests/db.test.ts`
Expected: FAIL, import not resolved.

**Step 3: Implement**

```ts
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
```

**Step 4: Run the test**

Run: `npm test -- tests/db.test.ts`
Expected: PASS (3 tests).

**Step 5: Commit**

```bash
git add src/lib/db.ts tests/db.test.ts
git commit -m "feat: add SQLite storage for accounts and calendars"
```

---

### Task 5: Google error classification

**Files:**
- Create: `src/lib/errors.ts`
- Test: `tests/errors.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { classifyGoogleError } from '@/lib/errors';

const gaxiosError = (status: number, error?: unknown) =>
  Object.assign(new Error('boom'), { response: { status, data: { error } } });

describe('classifyGoogleError', () => {
  it.each([
    [gaxiosError(400, 'invalid_grant'), 'reauth'],
    [gaxiosError(401), 'reauth'],
    [gaxiosError(412), 'conflict'],
    [gaxiosError(404), 'not_found'],
    [gaxiosError(410), 'not_found'],
    [gaxiosError(500), 'other'],
    [new Error('network down'), 'other'],
  ])('%#', (err, kind) => {
    expect(classifyGoogleError(err)).toBe(kind);
  });
});
```

**Step 2: Run it to verify it fails**

Run: `npm test -- tests/errors.test.ts`
Expected: FAIL, import not resolved.

**Step 3: Implement**

```ts
export type GoogleErrorKind = 'reauth' | 'conflict' | 'not_found' | 'other';

type MaybeGaxiosError = { message?: string; response?: { status?: number; data?: { error?: unknown } } };

export function classifyGoogleError(err: unknown): GoogleErrorKind {
  const e = (err ?? {}) as MaybeGaxiosError;
  const status = e.response?.status;
  const tokenError = e.response?.data?.error;
  if (tokenError === 'invalid_grant' || status === 401) return 'reauth';
  if (status === 412) return 'conflict';
  if (status === 404 || status === 410) return 'not_found';
  return 'other';
}
```

**Step 4: Run the test**

Run: `npm test -- tests/errors.test.ts`
Expected: PASS (7 tests).

**Step 5: Commit**

```bash
git add src/lib/errors.ts tests/errors.test.ts
git commit -m "feat: classify Google API errors"
```

---

### Task 6: Converting between Google events and FullCalendar events

**Files:**
- Create: `src/lib/events.ts`
- Test: `tests/events.test.ts`

**Step 1: Write the failing test**

```ts
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
```

**Step 2: Run it to verify it fails**

Run: `npm test -- tests/events.test.ts`
Expected: FAIL, import not resolved.

**Step 3: Implement**

```ts
import type { calendar_v3 } from 'googleapis';
import type { CalendarRow } from './db';

/** Stored in FullCalendar's `extendedProps`; everything the UI needs to call our API. */
export type EventMeta = {
  calendarId: number;
  accountId: number;
  calendarName: string;
  canWrite: boolean;
  googleEventId: string;
  recurringEventId: string | null;
  description: string;
  location: string;
  etag: string;
  htmlLink: string;
};

/** Shape accepted by FullCalendar's `EventInput`. */
export type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end?: string;
  allDay: boolean;
  backgroundColor: string;
  borderColor: string;
  editable: boolean;
  extendedProps: EventMeta;
};

/** What the UI sends. All-day `start`/`end` are `YYYY-MM-DD` with exclusive end (same as Google). */
export type EventDraft = {
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  description?: string;
  location?: string;
  timeZone?: string;
};

export function toCalendarEvent(ev: calendar_v3.Schema$Event, cal: CalendarRow): CalendarEvent {
  const allDay = Boolean(ev.start?.date);
  return {
    id: `${cal.id}:${ev.id}`,
    title: ev.summary || '(No title)',
    start: (allDay ? ev.start?.date : ev.start?.dateTime) ?? '',
    end: (allDay ? ev.end?.date : ev.end?.dateTime) ?? undefined,
    allDay,
    backgroundColor: cal.color,
    borderColor: cal.color,
    editable: cal.canWrite,
    extendedProps: {
      calendarId: cal.id,
      accountId: cal.accountId,
      calendarName: cal.name,
      canWrite: cal.canWrite,
      googleEventId: ev.id ?? '',
      recurringEventId: ev.recurringEventId ?? null,
      description: ev.description ?? '',
      location: ev.location ?? '',
      etag: ev.etag ?? '',
      htmlLink: ev.htmlLink ?? '',
    },
  };
}

function toGoogleTime(value: string, allDay: boolean, timeZone?: string): calendar_v3.Schema$EventDateTime {
  return allDay
    ? { date: value.slice(0, 10), dateTime: null, timeZone: null }
    : { dateTime: value, date: null, timeZone: timeZone ?? null };
}

export function toGooglePatch(d: Partial<EventDraft>): calendar_v3.Schema$Event {
  const body: calendar_v3.Schema$Event = {};
  if (d.title !== undefined) body.summary = d.title;
  if (d.description !== undefined) body.description = d.description;
  if (d.location !== undefined) body.location = d.location;
  if (d.start !== undefined && d.end !== undefined && d.allDay !== undefined) {
    body.start = toGoogleTime(d.start, d.allDay, d.timeZone);
    body.end = toGoogleTime(d.end, d.allDay, d.timeZone);
  }
  return body;
}
```

**Step 4: Run the test**

Run: `npm test -- tests/events.test.ts`
Expected: PASS (6 tests).

**Step 5: Commit**

```bash
git add src/lib/events.ts tests/events.test.ts
git commit -m "feat: convert between Google and FullCalendar events"
```

---

### Task 7: Merging events from several calendars

**Files:**
- Create: `src/lib/aggregate.ts`
- Test: `tests/aggregate.test.ts`

**Step 1: Write the failing test**

```ts
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
```

**Step 2: Run it to verify it fails**

Run: `npm test -- tests/aggregate.test.ts`
Expected: FAIL, import not resolved.

**Step 3: Implement**

```ts
import type { calendar_v3 } from 'googleapis';
import type { CalendarRow } from './db';
import { classifyGoogleError, type GoogleErrorKind } from './errors';
import { toCalendarEvent, type CalendarEvent } from './events';

export type Range = { timeMin: string; timeMax: string };
export type CalendarError = { calendarId: number; accountId: number; name: string; kind: GoogleErrorKind };
export type EventsResponse = { events: CalendarEvent[]; errors: CalendarError[] };
export type EventLister = (cal: CalendarRow, range: Range) => Promise<calendar_v3.Schema$Event[]>;

export async function fetchRange(calendars: CalendarRow[], range: Range, list: EventLister): Promise<EventsResponse> {
  const settled = await Promise.allSettled(calendars.map((cal) => list(cal, range)));
  const result: EventsResponse = { events: [], errors: [] };
  settled.forEach((outcome, i) => {
    const cal = calendars[i];
    if (outcome.status === 'fulfilled') {
      for (const ev of outcome.value) {
        if (ev.status !== 'cancelled') result.events.push(toCalendarEvent(ev, cal));
      }
    } else {
      result.errors.push({ calendarId: cal.id, accountId: cal.accountId, name: cal.name, kind: classifyGoogleError(outcome.reason) });
    }
  });
  return result;
}
```

**Step 4: Run the test**

Run: `npm test -- tests/aggregate.test.ts`
Expected: PASS (3 tests).

**Step 5: Commit**

```bash
git add src/lib/aggregate.ts tests/aggregate.test.ts
git commit -m "feat: merge events from many calendars, tolerating partial failure"
```

---

### Task 8: Google client and calendar-list sync

**Files:**
- Create: `src/lib/google.ts`
- Test: `tests/google.test.ts`

**Step 1: Write the failing test**

```ts
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
```

**Step 2: Run it to verify it fails**

Run: `npm test -- tests/google.test.ts`
Expected: FAIL, import not resolved.

**Step 3: Implement**

```ts
import { google, type calendar_v3 } from 'googleapis';
import type { Repo } from './db';

export const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar'];

export function appUrl(): string {
  return process.env.APP_URL ?? 'http://localhost:3000';
}

export function oauthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${appUrl()}/api/auth/callback`,
  );
}

/** A Calendar API client that refreshes its access token automatically from the stored refresh token. */
export function calendarFor(refreshToken: string): calendar_v3.Calendar {
  const auth = oauthClient();
  auth.setCredentials({ refresh_token: refreshToken });
  return google.calendar({ version: 'v3', auth });
}

export async function syncCalendars(repo: Repo, accountId: number, client: calendar_v3.Calendar): Promise<void> {
  const res = await client.calendarList.list({ maxResults: 250 });
  for (const item of res.data.items ?? []) {
    if (!item.id) continue;
    repo.upsertCalendar(accountId, {
      googleId: item.id,
      name: item.summaryOverride ?? item.summary ?? item.id,
      color: item.backgroundColor ?? '#3b82f6',
      canWrite: item.accessRole === 'owner' || item.accessRole === 'writer',
    });
  }
}
```

**Step 4: Run the test**

Run: `npm test -- tests/google.test.ts`
Expected: PASS (1 test).

**Step 5: Commit**

```bash
git add src/lib/google.ts tests/google.test.ts
git commit -m "feat: add Google OAuth client and calendar-list sync"
```

---

### Task 9: Google login routes

**Files:**
- Create: `src/app/api/auth/start/route.ts`
- Create: `src/app/api/auth/callback/route.ts`
- Test: `tests/api/auth.test.ts`

**Step 1: Write the failing test**

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { GET as start } from '@/app/api/auth/start/route';
import { GET as callback } from '@/app/api/auth/callback/route';

beforeAll(() => {
  process.env.GOOGLE_CLIENT_ID = 'cid';
  process.env.GOOGLE_CLIENT_SECRET = 'secret';
  process.env.APP_URL = 'http://localhost:3000';
});

describe('auth start', () => {
  it('redirects to Google with offline access and a state cookie', () => {
    const res = start(new Request('http://localhost:3000/api/auth/start?login_hint=a%40example.com'));
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get('location')!);
    expect(loc.hostname).toBe('accounts.google.com');
    expect(loc.searchParams.get('access_type')).toBe('offline');
    expect(loc.searchParams.get('prompt')).toBe('consent select_account');
    expect(loc.searchParams.get('login_hint')).toBe('a@example.com');
    expect(loc.searchParams.get('redirect_uri')).toBe('http://localhost:3000/api/auth/callback');
    const state = loc.searchParams.get('state');
    expect(state).toMatch(/^[0-9a-f]{32}$/);
    expect(res.headers.get('set-cookie')).toContain(`oauth_state=${state}`);
    expect(res.headers.get('set-cookie')).toContain('HttpOnly');
  });
});

describe('auth callback', () => {
  it('rejects a mismatched state without calling Google', async () => {
    const res = await callback(
      new Request('http://localhost:3000/api/auth/callback?code=c&state=evil', { headers: { cookie: 'oauth_state=good' } }),
    );
    expect(res.status).toBe(400);
  });

  it('redirects home when the user cancels at Google', async () => {
    const res = await callback(new Request('http://localhost:3000/api/auth/callback?error=access_denied'));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('http://localhost:3000/');
  });
});
```

**Step 2: Run it to verify it fails**

Run: `npm test -- tests/api/auth.test.ts`
Expected: FAIL, modules not found.

**Step 3: Implement**

`src/app/api/auth/start/route.ts`:

```ts
import { randomBytes } from 'node:crypto';
import { oauthClient, SCOPES } from '@/lib/google';

export function GET(req: Request) {
  const state = randomBytes(16).toString('hex');
  const loginHint = new URL(req.url).searchParams.get('login_hint') ?? undefined;
  const url = oauthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent select_account', // always return a refresh token
    scope: SCOPES,
    state,
    login_hint: loginHint,
  });
  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
      'Set-Cookie': `oauth_state=${state}; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=600`,
    },
  });
}
```

`src/app/api/auth/callback/route.ts`:

```ts
import { google } from 'googleapis';
import { getRepo } from '@/lib/db';
import { appUrl, calendarFor, oauthClient, syncCalendars } from '@/lib/google';

const CLEAR_STATE = 'oauth_state=; Path=/api/auth; Max-Age=0';

function redirectHome() {
  return new Response(null, { status: 302, headers: { Location: `${appUrl()}/`, 'Set-Cookie': CLEAR_STATE } });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get('error')) return redirectHome();

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookieState = req.headers.get('cookie')?.match(/(?:^|;\s*)oauth_state=([^;]+)/)?.[1];
  if (!code || !state || state !== cookieState) {
    return new Response('Invalid OAuth state. Start again from the app.', { status: 400 });
  }

  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    return new Response(
      'Google did not return a refresh token. Remove this app at https://myaccount.google.com/permissions and try again.',
      { status: 400 },
    );
  }
  client.setCredentials(tokens);
  const { data } = await google.oauth2({ version: 'v2', auth: client }).userinfo.get();
  if (!data.email) return new Response('Google did not return an email address.', { status: 400 });

  const repo = getRepo();
  const accountId = repo.upsertAccount(data.email, tokens.refresh_token);
  await syncCalendars(repo, accountId, calendarFor(tokens.refresh_token));
  return redirectHome();
}
```

**Step 4: Run the test**

Run: `npm test -- tests/api/auth.test.ts`
Expected: PASS (3 tests).

**Step 5: Commit**

```bash
git add src/app/api/auth tests/api/auth.test.ts
git commit -m "feat: add Google OAuth connect flow"
```

---

### Task 10: Account and calendar routes

**Files:**
- Create: `src/app/api/accounts/route.ts`
- Create: `src/app/api/accounts/[id]/route.ts`
- Create: `src/app/api/calendars/[id]/route.ts`
- Test: `tests/api/accounts.test.ts`

**Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { createRepo, openDb, setRepoForTests, type Repo } from '@/lib/db';
import { GET } from '@/app/api/accounts/route';
import { DELETE } from '@/app/api/accounts/[id]/route';
import { PATCH } from '@/app/api/calendars/[id]/route';

let repo: Repo;
let accountId: number;
beforeEach(() => {
  repo = createRepo(openDb(':memory:'));
  setRepoForTests(repo);
  accountId = repo.upsertAccount('a@example.com', 'secret-token');
  repo.upsertCalendar(accountId, { googleId: 'primary', name: 'Main', color: '#123456', canWrite: true });
});

describe('accounts API', () => {
  it('lists accounts with calendars and never exposes tokens', async () => {
    const res = await GET();
    const text = await res.text();
    expect(text).not.toContain('secret-token');
    expect(JSON.parse(text)).toEqual([
      {
        id: accountId, email: 'a@example.com', needsReauth: false,
        calendars: [{ id: expect.any(Number), name: 'Main', color: '#123456', shown: true, canWrite: true }],
      },
    ]);
  });

  it('deletes an account', async () => {
    const res = await DELETE(new Request('http://localhost/x', { method: 'DELETE' }), { params: Promise.resolve({ id: String(accountId) }) });
    expect(res.status).toBe(204);
    expect(repo.listAccounts()).toEqual([]);
  });

  it('toggles calendar visibility', async () => {
    const calId = repo.listCalendars()[0].id;
    const res = await PATCH(
      new Request('http://localhost/x', { method: 'PATCH', body: JSON.stringify({ shown: false }) }),
      { params: Promise.resolve({ id: String(calId) }) },
    );
    expect(res.status).toBe(204);
    expect(repo.getCalendar(calId)!.shown).toBe(false);
  });

  it('rejects a non-boolean shown value', async () => {
    const calId = repo.listCalendars()[0].id;
    const res = await PATCH(
      new Request('http://localhost/x', { method: 'PATCH', body: JSON.stringify({ shown: 'no' }) }),
      { params: Promise.resolve({ id: String(calId) }) },
    );
    expect(res.status).toBe(400);
  });
});
```

**Step 2: Run it to verify it fails**

Run: `npm test -- tests/api/accounts.test.ts`
Expected: FAIL, modules not found.

**Step 3: Implement**

`src/app/api/accounts/route.ts`:

```ts
import { getRepo } from '@/lib/db';

export const dynamic = 'force-dynamic';

export function GET() {
  const repo = getRepo();
  const calendars = repo.listCalendars();
  return Response.json(
    repo.listAccounts().map((a) => ({
      id: a.id,
      email: a.email,
      needsReauth: a.needsReauth,
      calendars: calendars
        .filter((c) => c.accountId === a.id)
        .map(({ id, name, color, shown, canWrite }) => ({ id, name, color, shown, canWrite })),
    })),
  );
}
```

`src/app/api/accounts/[id]/route.ts`:

```ts
import { getRepo } from '@/lib/db';

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  getRepo().deleteAccount(Number(id));
  return new Response(null, { status: 204 });
}
```

`src/app/api/calendars/[id]/route.ts`:

```ts
import { getRepo } from '@/lib/db';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { shown } = (await req.json()) as { shown?: unknown };
  if (typeof shown !== 'boolean') return Response.json({ error: 'shown must be a boolean' }, { status: 400 });
  getRepo().setShown(Number(id), shown);
  return new Response(null, { status: 204 });
}
```

**Step 4: Run the test**

Run: `npm test -- tests/api/accounts.test.ts`
Expected: PASS (4 tests).

**Step 5: Commit**

```bash
git add src/app/api/accounts "src/app/api/calendars/[id]/route.ts" tests/api/accounts.test.ts
git commit -m "feat: add account and calendar visibility API"
```

---

### Task 11: Listing events by date range

**Files:**
- Create: `src/app/api/events/route.ts`
- Test: `tests/api/events-range.test.ts`

**Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRepo, openDb, setRepoForTests, type Repo } from '@/lib/db';

const g = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('@/lib/google', () => ({ calendarFor: () => ({ events: { list: g.list } }) }));

import { GET } from '@/app/api/events/route';

let repo: Repo;
const idOf = (googleId: string) => repo.listCalendars().find((c) => c.googleId === googleId)!.id;
const ev = (id: string) => ({ id, start: { dateTime: '2026-10-27T09:00:00Z' }, end: { dateTime: '2026-10-27T10:00:00Z' } });
const rangeUrl = 'http://localhost/api/events?start=2026-10-26T00%3A00%3A00%2B07%3A00&end=2026-11-02T00%3A00%3A00%2B07%3A00';

beforeEach(() => {
  g.list.mockReset();
  repo = createRepo(openDb(':memory:'));
  setRepoForTests(repo);
  const a = repo.upsertAccount('a@example.com', 'rt-a');
  repo.upsertCalendar(a, { googleId: 'work', name: 'Work', color: '#111111', canWrite: true });
  repo.upsertCalendar(a, { googleId: 'hidden', name: 'Hidden', color: '#222222', canWrite: true });
  repo.setShown(idOf('hidden'), false);
  const b = repo.upsertAccount('b@example.com', 'rt-b');
  repo.upsertCalendar(b, { googleId: 'b-cal', name: 'B', color: '#333333', canWrite: true });
  repo.markNeedsReauth(b);
});

describe('GET /api/events', () => {
  it('queries only shown calendars of healthy accounts', async () => {
    g.list.mockResolvedValue({ data: { items: [ev('x')] } });
    const body = await (await GET(new Request(rangeUrl))).json();
    expect(g.list).toHaveBeenCalledTimes(1);
    expect(g.list).toHaveBeenCalledWith({
      calendarId: 'work', timeMin: '2026-10-25T17:00:00.000Z', timeMax: '2026-11-01T17:00:00.000Z',
      singleEvents: true, maxResults: 2500, pageToken: undefined,
    });
    expect(body.events.map((e: { id: string }) => e.id)).toEqual([`${idOf('work')}:x`]);
  });

  it('follows pagination', async () => {
    g.list
      .mockResolvedValueOnce({ data: { items: [ev('p1')], nextPageToken: 't2' } })
      .mockResolvedValueOnce({ data: { items: [ev('p2')] } });
    const body = await (await GET(new Request(rangeUrl))).json();
    expect(body.events).toHaveLength(2);
    expect(g.list.mock.calls[1][0]).toMatchObject({ pageToken: 't2' });
  });

  it('marks accounts whose token was revoked', async () => {
    g.list.mockRejectedValue(Object.assign(new Error('invalid_grant'), { response: { status: 400, data: { error: 'invalid_grant' } } }));
    const body = await (await GET(new Request(rangeUrl))).json();
    expect(body.errors).toEqual([{ calendarId: idOf('work'), accountId: expect.any(Number), name: 'Work', kind: 'reauth' }]);
    expect(repo.listAccounts().find((a) => a.email === 'a@example.com')!.needsReauth).toBe(true);
  });

  it('requires start and end', async () => {
    expect((await GET(new Request('http://localhost/api/events'))).status).toBe(400);
  });
});
```

**Step 2: Run it to verify it fails**

Run: `npm test -- tests/api/events-range.test.ts`
Expected: FAIL, route module not found.

**Step 3: Implement**

```ts
import type { calendar_v3 } from 'googleapis';
import { fetchRange } from '@/lib/aggregate';
import { getRepo } from '@/lib/db';
import { calendarFor } from '@/lib/google';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');
  if (!start || !end) return Response.json({ error: 'start and end are required' }, { status: 400 });

  const repo = getRepo();
  const tokens = new Map(repo.listAccounts().filter((a) => !a.needsReauth).map((a) => [a.id, a.refreshToken]));
  const calendars = repo.listCalendars().filter((c) => c.shown && tokens.has(c.accountId));
  const range = { timeMin: new Date(start).toISOString(), timeMax: new Date(end).toISOString() };

  const result = await fetchRange(calendars, range, async (cal, r) => {
    const client = calendarFor(tokens.get(cal.accountId)!);
    const items: calendar_v3.Schema$Event[] = [];
    let pageToken: string | undefined;
    do {
      const res = await client.events.list({ calendarId: cal.googleId, ...r, singleEvents: true, maxResults: 2500, pageToken });
      items.push(...(res.data.items ?? []));
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
    return items;
  });

  for (const e of result.errors) if (e.kind === 'reauth') repo.markNeedsReauth(e.accountId);
  return Response.json(result);
}
```

**Step 4: Run the full suite and the type check**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass and there are no type errors.

**Step 5: Commit**

```bash
git add src/app/api/events tests/api/events-range.test.ts
git commit -m "feat: add list-events-by-range API"
```

---

### Task 12: Read-only screen, then Checkpoint A

**Files:**
- Create: `src/components/api.ts`, `src/components/Sidebar.tsx`, `src/components/CalendarApp.tsx`
- Modify: `src/app/page.tsx`, `src/app/layout.tsx`, `src/app/globals.css` (replace their contents)

**Step 1: `src/components/api.ts`** (written in full now; the event functions get used in Task 15)

```ts
import type { CalendarEvent, EventDraft } from '@/lib/events';

const MESSAGES: Record<string, string> = {
  conflict: 'This event was changed elsewhere. Close the dialog and try again.',
  reauth: 'This Google account needs to be reconnected (see the sidebar).',
  read_only: 'This calendar is read-only.',
};

async function call(url: string, init: RequestInit): Promise<Response> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json' } });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new Error(MESSAGES[body.error ?? ''] ?? body.message ?? `Request failed (${res.status})`);
  }
  return res;
}

const eventUrl = (calendarId: number, eventId: string) =>
  `/api/calendars/${calendarId}/events/${encodeURIComponent(eventId)}`;

export async function createEvent(calendarId: number, draft: EventDraft): Promise<CalendarEvent> {
  return (await call(`/api/calendars/${calendarId}/events`, { method: 'POST', body: JSON.stringify(draft) })).json();
}

export async function updateEvent(
  calendarId: number, eventId: string, draft: Partial<EventDraft>, etag?: string,
): Promise<CalendarEvent> {
  return (await call(eventUrl(calendarId, eventId), { method: 'PATCH', body: JSON.stringify({ draft, etag }) })).json();
}

export async function deleteEvent(calendarId: number, eventId: string): Promise<void> {
  await call(eventUrl(calendarId, eventId), { method: 'DELETE' });
}

export async function setCalendarShown(calendarId: number, shown: boolean): Promise<void> {
  await call(`/api/calendars/${calendarId}`, { method: 'PATCH', body: JSON.stringify({ shown }) });
}

export async function removeAccount(accountId: number): Promise<void> {
  await call(`/api/accounts/${accountId}`, { method: 'DELETE' });
}
```

**Step 2: `src/components/Sidebar.tsx`**

```tsx
'use client';

import { removeAccount, setCalendarShown } from './api';

export type CalendarView = { id: number; name: string; color: string; shown: boolean; canWrite: boolean };
export type AccountView = { id: number; email: string; needsReauth: boolean; calendars: CalendarView[] };

type Props = { accounts: AccountView[]; onChange: () => void };

export function Sidebar({ accounts, onChange }: Props) {
  async function toggle(c: CalendarView) {
    await setCalendarShown(c.id, !c.shown);
    onChange();
  }

  async function disconnect(a: AccountView) {
    if (!window.confirm(`Disconnect ${a.email}? Its events stay in Google; this only removes it from this app.`)) return;
    await removeAccount(a.id);
    onChange();
  }

  return (
    <aside className="sidebar">
      <h1>Calendars</h1>
      {accounts.map((a) => (
        <section key={a.id} className="account">
          <div className="account-head">
            <span title={a.email}>{a.email}</span>
            <button className="icon" title="Disconnect account" onClick={() => disconnect(a)}>✕</button>
          </div>
          {a.needsReauth && (
            <a className="reconnect" href={`/api/auth/start?login_hint=${encodeURIComponent(a.email)}`}>
              Login expired — Reconnect
            </a>
          )}
          <ul>
            {a.calendars.map((c) => (
              <li key={c.id}>
                <label>
                  <input type="checkbox" checked={c.shown} onChange={() => toggle(c)} />
                  <span className="swatch" style={{ background: c.color }} />
                  <span>{c.name}</span>
                  {!c.canWrite && <span className="muted"> · read-only</span>}
                </label>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <a className="add-account" href="/api/auth/start">+ Add Google account</a>
    </aside>
  );
}
```

**Step 3: `src/components/CalendarApp.tsx`** (read-only version; Task 15 replaces it with the final version)

```tsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import type { EventInput, EventSourceFuncArg } from '@fullcalendar/core';
import type { CalendarError, EventsResponse } from '@/lib/aggregate';
import { Sidebar, type AccountView } from './Sidebar';

export function CalendarApp() {
  const calendarRef = useRef<FullCalendar>(null);
  const [accounts, setAccounts] = useState<AccountView[]>([]);
  const [warnings, setWarnings] = useState<CalendarError[]>([]);

  const loadAccounts = useCallback(async () => {
    const res = await fetch('/api/accounts');
    setAccounts(await res.json());
  }, []);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  const refetch = useCallback(() => calendarRef.current?.getApi().refetchEvents(), []);

  const fetchEvents = useCallback(
    (info: EventSourceFuncArg, success: (events: EventInput[]) => void, failure: (error: Error) => void) => {
      const qs = new URLSearchParams({ start: info.startStr, end: info.endStr });
      fetch(`/api/events?${qs}`)
        .then(async (res) => {
          if (!res.ok) throw new Error(`Failed to load events (${res.status})`);
          const data = (await res.json()) as EventsResponse;
          setWarnings(data.errors);
          if (data.errors.some((e) => e.kind === 'reauth')) void loadAccounts();
          success(data.events);
        })
        .catch(failure);
    },
    [loadAccounts],
  );

  return (
    <div className="app">
      <Sidebar
        accounts={accounts}
        onChange={() => {
          void loadAccounts();
          refetch();
        }}
      />
      <main className="main">
        {warnings.length > 0 && <div className="warning">Could not load: {warnings.map((w) => w.name).join(', ')}</div>}
        {accounts.length === 0 && <p className="muted">No accounts yet — use “+ Add Google account” to connect one.</p>}
        <div className="calendar">
          <FullCalendar
            ref={calendarRef}
            plugins={[dayGridPlugin, timeGridPlugin]}
            initialView="timeGridWeek"
            headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' }}
            height="100%"
            nowIndicator
            events={fetchEvents}
          />
        </div>
      </main>
    </div>
  );
}
```

**Step 4: `src/app/page.tsx`**

FullCalendar and TipTap only run in the browser, so the app is loaded without server-side rendering.

```tsx
'use client';

import dynamic from 'next/dynamic';

const CalendarApp = dynamic(() => import('@/components/CalendarApp').then((m) => m.CalendarApp), { ssr: false });

export default function Page() {
  return <CalendarApp />;
}
```

**Step 5: `src/app/layout.tsx`**

```tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'Calendar' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

**Step 6: `src/app/globals.css`** (all styles, including the dialog and editor used in later tasks)

```css
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; font-family: system-ui, -apple-system, sans-serif; color: #1f2937; background: #fff; }
button { font: inherit; cursor: pointer; padding: 6px 12px; border: 1px solid #d1d5db; border-radius: 6px; background: #fff; }
button:disabled { opacity: 0.6; cursor: default; }
button.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
button.danger { color: #b91c1c; border-color: #fca5a5; }
button.icon { border: none; padding: 0 4px; color: #6b7280; }

.app { display: grid; grid-template-columns: 280px 1fr; height: 100vh; }
.sidebar { border-right: 1px solid #e5e7eb; padding: 16px; overflow-y: auto; }
.sidebar h1 { font-size: 18px; margin: 0 0 16px; }
.account { margin-bottom: 16px; }
.account-head { display: flex; justify-content: space-between; align-items: center; font-weight: 600; font-size: 13px; }
.account-head span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.account ul { list-style: none; padding: 0; margin: 6px 0; }
.account li label { display: flex; gap: 8px; align-items: center; font-size: 14px; padding: 3px 0; cursor: pointer; }
.swatch { width: 10px; height: 10px; border-radius: 50%; flex: none; }
.reconnect { display: block; margin: 4px 0; color: #b91c1c; font-size: 13px; }
.add-account { display: inline-block; margin-top: 8px; color: #2563eb; }

.main { padding: 16px; display: flex; flex-direction: column; gap: 8px; min-width: 0; height: 100vh; }
.calendar { flex: 1; min-height: 0; }
.warning { background: #fef3c7; border: 1px solid #f59e0b; padding: 8px 12px; border-radius: 6px; font-size: 14px; }

.overlay { position: fixed; inset: 0; background: rgb(0 0 0 / 0.35); display: grid; place-items: center; z-index: 50; }
.dialog { background: #fff; border-radius: 10px; width: min(680px, 94vw); max-height: 90vh; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 12px; }
.dialog h2 { margin: 0; }
.dialog label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
.dialog label.inline { flex-direction: row; align-items: center; gap: 6px; }
.dialog input[type='text'], .dialog input[type='date'], .dialog input[type='datetime-local'], .dialog select { padding: 6px 8px; font: inherit; border: 1px solid #d1d5db; border-radius: 6px; }
.title-input { font-size: 18px !important; }
.field-label { font-size: 13px; margin-bottom: 4px; }
.row { display: flex; gap: 12px; align-items: end; flex-wrap: wrap; }
.scope { border: none; padding: 0; margin: 0; }
.actions { display: flex; gap: 8px; align-items: center; }
.spacer { flex: 1; }
.error { color: #b91c1c; font-size: 14px; margin: 0; }
.muted { color: #6b7280; }

.html-view { font-size: 14px; line-height: 1.5; overflow-wrap: anywhere; }
.html-view table, .rte-content table { border-collapse: collapse; }
.html-view td, .html-view th, .rte-content td, .rte-content th { border: 1px solid #d1d5db; padding: 4px 8px; }
.rte { border: 1px solid #d1d5db; border-radius: 6px; }
.rte-toolbar { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px; border-bottom: 1px solid #e5e7eb; }
.rte-toolbar button { padding: 2px 8px; font-size: 13px; }
.rte-content .tiptap { min-height: 160px; padding: 8px 12px; outline: none; }
```

**Step 7: Build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: no errors and the build succeeds. Fix any lint errors without turning rules off.

**Step 8: Commit**

```bash
git add src
git commit -m "feat: add read-only calendar UI with account sidebar"
```

**Step 9: Checkpoint A (manual, with real accounts; don't start Task 13 until every item passes)**

Run `npm run dev` and open http://localhost:3000. Use `localhost`, not 127.0.0.1, so the OAuth cookie matches.

1. "+ Add Google account" → connect account A, then account B. Both appear in the sidebar with their calendars.
2. Events from both accounts show in week view, in their calendars' colors. Month and day views also work, as do prev/next.
3. Untick a calendar: its events disappear. Reload: it stays hidden.
4. An all-day event and a multi-day event display on the correct days, without being one day off.
5. Revoke account B at https://myaccount.google.com/permissions, then click "next week". B shows "Reconnect" and A still loads. Click Reconnect: B works again.
6. ✕ on an account removes it from the sidebar, and its events disappear.

If something fails, write a failing test for it in the matching `tests/` file, fix it, and commit before moving on.

---

### Task 13: Write routes (create, update, delete)

**Files:**
- Create: `src/lib/route-helpers.ts`
- Create: `src/app/api/calendars/[id]/events/route.ts`
- Create: `src/app/api/calendars/[id]/events/[eventId]/route.ts`
- Test: `tests/api/event-write.test.ts`

**Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRepo, openDb, setRepoForTests, type Repo } from '@/lib/db';

const g = vi.hoisted(() => ({ insert: vi.fn(), patch: vi.fn(), del: vi.fn() }));
vi.mock('@/lib/google', () => ({ calendarFor: () => ({ events: { insert: g.insert, patch: g.patch, delete: g.del } }) }));

import { POST } from '@/app/api/calendars/[id]/events/route';
import { DELETE, PATCH } from '@/app/api/calendars/[id]/events/[eventId]/route';

let repo: Repo;
let calId: number;
let readOnlyId: number;
const timed = { start: { dateTime: '2026-10-27T10:00:00Z' }, end: { dateTime: '2026-10-27T11:00:00Z' } };

beforeEach(() => {
  g.insert.mockReset();
  g.patch.mockReset();
  g.del.mockReset();
  repo = createRepo(openDb(':memory:'));
  setRepoForTests(repo);
  const accountId = repo.upsertAccount('a@example.com', 'rt');
  repo.upsertCalendar(accountId, { googleId: 'primary', name: 'Main', color: '#123456', canWrite: true });
  repo.upsertCalendar(accountId, { googleId: 'holidays', name: 'Holidays', color: '#000000', canWrite: false });
  calId = repo.listCalendars().find((c) => c.googleId === 'primary')!.id;
  readOnlyId = repo.listCalendars().find((c) => c.googleId === 'holidays')!.id;
});

const itemCtx = (id = calId, eventId = 'ev1') => ({ params: Promise.resolve({ id: String(id), eventId }) });
const jsonReq = (method: string, body: unknown) => new Request('http://localhost/x', { method, body: JSON.stringify(body) });

describe('POST /api/calendars/:id/events', () => {
  it('inserts into the chosen calendar', async () => {
    g.insert.mockResolvedValue({ data: { id: 'new', summary: 'Lunch', ...timed } });
    const draft = { title: 'Lunch', start: '2026-10-27T10:00:00.000Z', end: '2026-10-27T11:00:00.000Z', allDay: false, description: '<p>hi</p>' };
    const res = await POST(jsonReq('POST', draft), { params: Promise.resolve({ id: String(calId) }) });
    expect(res.status).toBe(201);
    expect(g.insert).toHaveBeenCalledWith({
      calendarId: 'primary',
      requestBody: {
        summary: 'Lunch', description: '<p>hi</p>',
        start: { dateTime: '2026-10-27T10:00:00.000Z', date: null, timeZone: null },
        end: { dateTime: '2026-10-27T11:00:00.000Z', date: null, timeZone: null },
      },
    });
    expect(await res.json()).toMatchObject({ id: `${calId}:new`, title: 'Lunch' });
  });
});

describe('PATCH /api/calendars/:id/events/:eventId', () => {
  it('patches with If-Match and returns the updated event', async () => {
    g.patch.mockResolvedValue({ data: { id: 'ev1', summary: 'New', etag: '"2"', ...timed } });
    const res = await PATCH(jsonReq('PATCH', { draft: { title: 'New' }, etag: '"1"' }), itemCtx());
    expect(res.status).toBe(200);
    expect(g.patch).toHaveBeenCalledWith(
      { calendarId: 'primary', eventId: 'ev1', requestBody: { summary: 'New' } },
      { headers: { 'If-Match': '"1"' } },
    );
    expect(await res.json()).toMatchObject({ id: `${calId}:ev1`, title: 'New', extendedProps: { etag: '"2"' } });
  });

  it('omits If-Match when no etag is given (series edits)', async () => {
    g.patch.mockResolvedValue({ data: { id: 'ev1', ...timed } });
    await PATCH(jsonReq('PATCH', { draft: { title: 'x' } }), itemCtx());
    expect(g.patch.mock.calls[0][1]).toBeUndefined();
  });

  it('maps 412 to 409 conflict', async () => {
    g.patch.mockRejectedValue(Object.assign(new Error('Precondition Failed'), { response: { status: 412 } }));
    const res = await PATCH(jsonReq('PATCH', { draft: { title: 'x' }, etag: '"1"' }), itemCtx());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'conflict', message: 'Precondition Failed' });
  });

  it('marks the account for reconnect on invalid_grant', async () => {
    g.patch.mockRejectedValue(Object.assign(new Error('invalid_grant'), { response: { status: 400, data: { error: 'invalid_grant' } } }));
    const res = await PATCH(jsonReq('PATCH', { draft: { title: 'x' } }), itemCtx());
    expect(res.status).toBe(401);
    expect(repo.listAccounts()[0].needsReauth).toBe(true);
  });

  it('refuses writes to read-only calendars', async () => {
    const res = await PATCH(jsonReq('PATCH', { draft: { title: 'x' } }), itemCtx(readOnlyId));
    expect(res.status).toBe(403);
    expect(g.patch).not.toHaveBeenCalled();
  });

  it('returns 404 for unknown calendars', async () => {
    expect((await PATCH(jsonReq('PATCH', { draft: { title: 'x' } }), itemCtx(999))).status).toBe(404);
  });
});

describe('DELETE /api/calendars/:id/events/:eventId', () => {
  it('deletes and returns 204', async () => {
    g.del.mockResolvedValue({});
    const res = await DELETE(new Request('http://localhost/x', { method: 'DELETE' }), itemCtx());
    expect(res.status).toBe(204);
    expect(g.del).toHaveBeenCalledWith({ calendarId: 'primary', eventId: 'ev1' });
  });

  it('treats an already-deleted event as success', async () => {
    g.del.mockRejectedValue(Object.assign(new Error('Gone'), { response: { status: 410 } }));
    const res = await DELETE(new Request('http://localhost/x', { method: 'DELETE' }), itemCtx());
    expect(res.status).toBe(204);
  });
});
```

**Step 2: Run it to verify it fails**

Run: `npm test -- tests/api/event-write.test.ts`
Expected: FAIL, route modules not found.

**Step 3: Implement**

`src/lib/route-helpers.ts`:

```ts
import type { calendar_v3 } from 'googleapis';
import { getRepo, type CalendarRow, type Repo } from './db';
import { classifyGoogleError, type GoogleErrorKind } from './errors';
import { calendarFor } from './google';

type Loaded = { repo: Repo; cal: CalendarRow; client: calendar_v3.Calendar };

/** Resolve `:id` to a calendar the user can write to, or an error Response. */
export function loadWritableCalendar(idParam: string): Loaded | { error: Response } {
  const repo = getRepo();
  const cal = repo.getCalendar(Number(idParam));
  if (!cal) return { error: Response.json({ error: 'not_found' }, { status: 404 }) };
  if (!cal.canWrite) return { error: Response.json({ error: 'read_only' }, { status: 403 }) };
  const account = repo.getAccount(cal.accountId);
  if (!account || account.needsReauth) return { error: Response.json({ error: 'reauth' }, { status: 401 }) };
  return { repo, cal, client: calendarFor(account.refreshToken) };
}

const STATUS: Record<GoogleErrorKind, number> = { reauth: 401, conflict: 409, not_found: 404, other: 502 };

export function googleErrorResponse(err: unknown, repo: Repo, accountId: number): Response {
  const kind = classifyGoogleError(err);
  if (kind === 'reauth') repo.markNeedsReauth(accountId);
  const message = err instanceof Error ? err.message : String(err);
  return Response.json({ error: kind, message }, { status: STATUS[kind] });
}
```

`src/app/api/calendars/[id]/events/route.ts`:

```ts
import { toCalendarEvent, toGooglePatch, type EventDraft } from '@/lib/events';
import { googleErrorResponse, loadWritableCalendar } from '@/lib/route-helpers';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = loadWritableCalendar(id);
  if ('error' in loaded) return loaded.error;
  const { repo, cal, client } = loaded;
  const draft = (await req.json()) as EventDraft;

  try {
    const res = await client.events.insert({ calendarId: cal.googleId, requestBody: toGooglePatch(draft) });
    return Response.json(toCalendarEvent(res.data, cal), { status: 201 });
  } catch (err) {
    return googleErrorResponse(err, repo, cal.accountId);
  }
}
```

`src/app/api/calendars/[id]/events/[eventId]/route.ts`:

```ts
import { classifyGoogleError } from '@/lib/errors';
import { toCalendarEvent, toGooglePatch, type EventDraft } from '@/lib/events';
import { googleErrorResponse, loadWritableCalendar } from '@/lib/route-helpers';

type Ctx = { params: Promise<{ id: string; eventId: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const { id, eventId } = await params;
  const loaded = loadWritableCalendar(id);
  if ('error' in loaded) return loaded.error;
  const { repo, cal, client } = loaded;
  const { draft, etag } = (await req.json()) as { draft: Partial<EventDraft>; etag?: string };

  try {
    const res = await client.events.patch(
      { calendarId: cal.googleId, eventId, requestBody: toGooglePatch(draft) },
      etag ? { headers: { 'If-Match': etag } } : undefined,
    );
    return Response.json(toCalendarEvent(res.data, cal));
  } catch (err) {
    return googleErrorResponse(err, repo, cal.accountId);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id, eventId } = await params;
  const loaded = loadWritableCalendar(id);
  if ('error' in loaded) return loaded.error;
  const { repo, cal, client } = loaded;

  try {
    await client.events.delete({ calendarId: cal.googleId, eventId });
  } catch (err) {
    if (classifyGoogleError(err) !== 'not_found') return googleErrorResponse(err, repo, cal.accountId);
  }
  return new Response(null, { status: 204 });
}
```

**Step 4: Run the test**

Run: `npm test -- tests/api/event-write.test.ts`
Expected: PASS (9 tests).

**Step 5: Commit**

```bash
git add src/lib/route-helpers.ts "src/app/api/calendars/[id]/events" tests/api/event-write.test.ts
git commit -m "feat: add create, update and delete event API"
```

---

### Task 14: HTML view and rich-text editor

No unit tests: these are thin UI wrappers, checked by the type check here and by hand in Task 16.

**Files:**
- Create: `src/components/HtmlView.tsx`
- Create: `src/components/RichTextEditor.tsx`

**Step 1: `src/components/HtmlView.tsx`**

```tsx
'use client';

import { useMemo } from 'react';
import { toDisplayHtml } from '@/lib/sanitize';

export function HtmlView({ html }: { html: string }) {
  const clean = useMemo(() => toDisplayHtml(html), [html]);
  if (!clean) return <p className="muted">No description</p>;
  return <div className="html-view" dangerouslySetInnerHTML={{ __html: clean }} />;
}
```

**Step 2: `src/components/RichTextEditor.tsx`**

`value` is only the starting content; the dialog owns the state from there.

```tsx
'use client';

import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';

type Props = { value: string; onChange: (html: string) => void };

function setLink(editor: Editor) {
  const url = window.prompt('Link URL (empty to remove)', editor.getAttributes('link').href ?? 'https://');
  if (url === null) return;
  const chain = editor.chain().focus().extendMarkRange('link');
  if (url === '') chain.unsetLink().run();
  else chain.setLink({ href: url }).run();
}

export function RichTextEditor({ value, onChange }: Props) {
  const editor = useEditor({
    extensions: [StarterKit.configure({ link: { openOnClick: false } }), TableKit],
    content: value,
    immediatelyRender: false,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });
  if (!editor) return null;

  const tools: [string, () => void][] = [
    ['B', () => editor.chain().focus().toggleBold().run()],
    ['I', () => editor.chain().focus().toggleItalic().run()],
    ['U', () => editor.chain().focus().toggleUnderline().run()],
    ['H', () => editor.chain().focus().toggleHeading({ level: 3 }).run()],
    ['• List', () => editor.chain().focus().toggleBulletList().run()],
    ['1. List', () => editor.chain().focus().toggleOrderedList().run()],
    ['Link', () => setLink(editor)],
    ['Table', () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()],
  ];

  return (
    <div className="rte">
      <div className="rte-toolbar">
        {tools.map(([label, action]) => (
          <button key={label} type="button" onMouseDown={(e) => { e.preventDefault(); action(); }}>
            {label}
          </button>
        ))}
      </div>
      <EditorContent editor={editor} className="rte-content" />
    </div>
  );
}
```

**Step 3: Type check**

Run: `npx tsc --noEmit`
Expected: no errors.

**Step 4: Commit**

```bash
git add src/components/HtmlView.tsx src/components/RichTextEditor.tsx
git commit -m "feat: add HTML view and rich-text editor"
```

---

### Task 15: Event dialog, and adding create/drag/edit to the calendar

**Files:**
- Create: `src/components/EventDialog.tsx`
- Modify: `src/components/CalendarApp.tsx` (replace with the full version below)

**Step 1: `src/components/EventDialog.tsx`**

```tsx
'use client';

import { useState } from 'react';
import type { EventApi } from '@fullcalendar/core';
import { addDays, fromLocalInput, localTimeZone, toLocalInput } from '@/lib/dates';
import type { EventDraft, EventMeta } from '@/lib/events';
import { toDisplayHtml } from '@/lib/sanitize';
import { createEvent, deleteEvent, updateEvent } from './api';
import { HtmlView } from './HtmlView';
import { RichTextEditor } from './RichTextEditor';

export type WritableCalendar = { id: number; label: string };
export type DialogState =
  | { mode: 'create'; start: string; end: string; allDay: boolean }
  | { mode: 'view'; event: EventApi };

type Props = { state: DialogState; calendars: WritableCalendar[]; onClose: () => void; onChanged: () => void };

type Form = {
  calendarId: number;
  title: string;
  allDay: boolean;
  start: string; // `YYYY-MM-DD` (all-day, inclusive) or `YYYY-MM-DDTHH:mm` (local)
  end: string;
  location: string;
  description: string;
  descriptionDirty: boolean;
  scope: 'instance' | 'series';
};

const HOUR = 3_600_000;
const DAY = 86_400_000;

function toInputs(start: string, end: string | null, allDay: boolean): Pick<Form, 'start' | 'end'> {
  if (allDay) {
    const s = start.slice(0, 10);
    return { start: s, end: end ? addDays(end, -1) : s }; // exclusive → inclusive end
  }
  const e = end ?? new Date(new Date(start).getTime() + HOUR).toISOString();
  return { start: toLocalInput(start), end: toLocalInput(e) };
}

function initialForm(state: DialogState, calendars: WritableCalendar[]): Form {
  const base = { location: '', description: '', descriptionDirty: false, scope: 'instance' as const };
  if (state.mode === 'create') {
    return { ...base, calendarId: calendars[0]?.id ?? 0, title: '', allDay: state.allDay, ...toInputs(state.start, state.end, state.allDay) };
  }
  const e = state.event;
  const meta = e.extendedProps as EventMeta;
  return {
    ...base,
    calendarId: meta.calendarId,
    title: e.title,
    allDay: e.allDay,
    ...toInputs(e.startStr, e.endStr || null, e.allDay),
    location: meta.location,
    description: toDisplayHtml(meta.description),
  };
}

function toDraft(f: Form, includeDescription: boolean): EventDraft {
  const times = f.allDay
    ? { start: f.start, end: addDays(f.end, 1) }
    : { start: fromLocalInput(f.start), end: fromLocalInput(f.end) };
  return {
    title: f.title.trim() || '(No title)',
    allDay: f.allDay,
    ...times,
    timeZone: localTimeZone(),
    location: f.location,
    ...(includeDescription ? { description: f.description } : {}),
  };
}

function validate(f: Form): string | null {
  if (!f.start || !f.end) return 'Start and end are required.';
  if (f.end < f.start) return 'End must not be before start.';
  return null;
}

function formatWhen(e: EventApi): string {
  const fmt = new Intl.DateTimeFormat(undefined, e.allDay ? { dateStyle: 'medium' } : { dateStyle: 'medium', timeStyle: 'short' });
  const start = e.start!;
  const end = e.end && e.allDay ? new Date(e.end.getTime() - DAY) : e.end;
  return end ? fmt.formatRange(start, end) : fmt.format(start);
}

export function EventDialog({ state, calendars, onClose, onChanged }: Props) {
  const [editing, setEditing] = useState(state.mode === 'create');
  const [form, setForm] = useState(() => initialForm(state, calendars));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const meta = state.mode === 'view' ? (state.event.extendedProps as EventMeta) : null;
  const recurring = Boolean(meta?.recurringEventId);
  const series = recurring && form.scope === 'series';
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  function toggleAllDay(allDay: boolean) {
    setForm((f) => ({
      ...f,
      allDay,
      ...(allDay
        ? { start: f.start.slice(0, 10), end: f.end.slice(0, 10) }
        : { start: `${f.start}T09:00`, end: `${f.end}T10:00` }),
    }));
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function save() {
    const invalid = validate(form);
    if (invalid) {
      setError(invalid);
      return;
    }
    void run(async () => {
      if (!meta) return createEvent(form.calendarId, toDraft(form, true));
      const draft = toDraft(form, form.descriptionDirty);
      if (series) {
        // Moving a whole series needs the master's own times, so only text fields apply to "All events".
        const { title, location, description } = draft;
        return updateEvent(meta.calendarId, meta.recurringEventId!, { title, location, ...(description !== undefined ? { description } : {}) });
      }
      return updateEvent(meta.calendarId, meta.googleEventId, draft, meta.etag);
    });
  }

  function remove() {
    if (!meta) return;
    if (!window.confirm(`Delete "${form.title}"${series ? ' and all its occurrences' : ''}?`)) return;
    void run(() => deleteEvent(meta.calendarId, series ? meta.recurringEventId! : meta.googleEventId));
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true">
        {editing ? (
          <>
            <input className="title-input" type="text" placeholder="Title" value={form.title} autoFocus
              onChange={(e) => set('title', e.target.value)} />
            {state.mode === 'create' && (
              <label>
                Calendar
                <select value={form.calendarId} onChange={(e) => set('calendarId', Number(e.target.value))}>
                  {calendars.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </label>
            )}
            <div className="row">
              <label className="inline">
                <input type="checkbox" checked={form.allDay} disabled={series} onChange={(e) => toggleAllDay(e.target.checked)} /> All day
              </label>
              <label>
                Start
                <input type={form.allDay ? 'date' : 'datetime-local'} value={form.start} disabled={series}
                  onChange={(e) => set('start', e.target.value)} />
              </label>
              <label>
                End
                <input type={form.allDay ? 'date' : 'datetime-local'} value={form.end} disabled={series}
                  onChange={(e) => set('end', e.target.value)} />
              </label>
            </div>
            <label>
              Location
              <input type="text" value={form.location} onChange={(e) => set('location', e.target.value)} />
            </label>
            <div>
              <div className="field-label">Description</div>
              <RichTextEditor value={form.description}
                onChange={(html) => setForm((f) => ({ ...f, description: html === '<p></p>' ? '' : html, descriptionDirty: true }))} />
            </div>
          </>
        ) : (
          state.mode === 'view' && meta && (
            <>
              <h2>{state.event.title}</h2>
              <p className="muted">{formatWhen(state.event)} · {meta.calendarName}</p>
              {meta.location && <p>📍 {meta.location}</p>}
              <HtmlView html={meta.description} />
              {meta.htmlLink && <a href={meta.htmlLink} target="_blank" rel="noopener noreferrer">Open in Google Calendar</a>}
            </>
          )
        )}

        {recurring && meta?.canWrite && (
          <fieldset className="row scope">
            <label className="inline">
              <input type="radio" checked={form.scope === 'instance'} onChange={() => set('scope', 'instance')} /> This event
            </label>
            <label className="inline">
              <input type="radio" checked={form.scope === 'series'} onChange={() => set('scope', 'series')} /> All events
              {editing && <span className="muted"> (title, location, description only)</span>}
            </label>
          </fieldset>
        )}

        {error && <p className="error">{error}</p>}

        <div className="actions">
          {meta?.canWrite && <button className="danger" onClick={remove} disabled={busy}>Delete</button>}
          <span className="spacer" />
          <button onClick={onClose} disabled={busy}>{editing ? 'Cancel' : 'Close'}</button>
          {editing ? (
            <button className="primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          ) : (
            meta?.canWrite && <button className="primary" onClick={() => setEditing(true)}>Edit</button>
          )}
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Replace `src/components/CalendarApp.tsx`**

Compared with Task 12, this adds the interaction plugin, selecting a time range to create, clicking an event to open the dialog, and drag/resize.

```tsx
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin, { type EventResizeDoneArg } from '@fullcalendar/interaction';
import type { DateSelectArg, EventApi, EventClickArg, EventDropArg, EventInput, EventSourceFuncArg } from '@fullcalendar/core';
import type { CalendarError, EventsResponse } from '@/lib/aggregate';
import { addDays, localTimeZone } from '@/lib/dates';
import type { EventDraft, EventMeta } from '@/lib/events';
import { updateEvent } from './api';
import { EventDialog, type DialogState, type WritableCalendar } from './EventDialog';
import { Sidebar, type AccountView } from './Sidebar';

const HOUR = 3_600_000;

function timesOf(e: EventApi): Pick<EventDraft, 'start' | 'end' | 'allDay' | 'timeZone'> {
  const end = e.endStr || (e.allDay ? addDays(e.startStr, 1) : new Date(e.start!.getTime() + HOUR).toISOString());
  return { start: e.allDay ? e.startStr.slice(0, 10) : e.startStr, end, allDay: e.allDay, timeZone: localTimeZone() };
}

export function CalendarApp() {
  const calendarRef = useRef<FullCalendar>(null);
  const [accounts, setAccounts] = useState<AccountView[]>([]);
  const [warnings, setWarnings] = useState<CalendarError[]>([]);
  const [dialog, setDialog] = useState<DialogState | null>(null);

  const loadAccounts = useCallback(async () => {
    const res = await fetch('/api/accounts');
    setAccounts(await res.json());
  }, []);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  const refetch = useCallback(() => calendarRef.current?.getApi().refetchEvents(), []);

  const fetchEvents = useCallback(
    (info: EventSourceFuncArg, success: (events: EventInput[]) => void, failure: (error: Error) => void) => {
      const qs = new URLSearchParams({ start: info.startStr, end: info.endStr });
      fetch(`/api/events?${qs}`)
        .then(async (res) => {
          if (!res.ok) throw new Error(`Failed to load events (${res.status})`);
          const data = (await res.json()) as EventsResponse;
          setWarnings(data.errors);
          if (data.errors.some((e) => e.kind === 'reauth')) void loadAccounts();
          success(data.events);
        })
        .catch(failure);
    },
    [loadAccounts],
  );

  const writable: WritableCalendar[] = useMemo(
    () =>
      accounts.flatMap((a) =>
        a.needsReauth ? [] : a.calendars.filter((c) => c.canWrite).map((c) => ({ id: c.id, label: `${c.name} — ${a.email}` })),
      ),
    [accounts],
  );

  async function onTimeChange(info: EventDropArg | EventResizeDoneArg) {
    const meta = info.event.extendedProps as EventMeta;
    try {
      const updated = await updateEvent(meta.calendarId, meta.googleEventId, timesOf(info.event), meta.etag);
      info.event.setExtendedProp('etag', updated.extendedProps.etag);
    } catch (err) {
      info.revert();
      window.alert(err instanceof Error ? err.message : String(err));
    }
  }

  function onSelect(info: DateSelectArg) {
    info.view.calendar.unselect();
    if (writable.length === 0) {
      window.alert('Connect a Google account with a writable calendar first.');
      return;
    }
    setDialog({ mode: 'create', start: info.startStr, end: info.endStr, allDay: info.allDay });
  }

  function onEventClick(info: EventClickArg) {
    info.jsEvent.preventDefault();
    setDialog({ mode: 'view', event: info.event });
  }

  return (
    <div className="app">
      <Sidebar
        accounts={accounts}
        onChange={() => {
          void loadAccounts();
          refetch();
        }}
      />
      <main className="main">
        {warnings.length > 0 && <div className="warning">Could not load: {warnings.map((w) => w.name).join(', ')}</div>}
        {accounts.length === 0 && <p className="muted">No accounts yet — use “+ Add Google account” to connect one.</p>}
        <div className="calendar">
          <FullCalendar
            ref={calendarRef}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView="timeGridWeek"
            headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' }}
            height="100%"
            nowIndicator
            selectable
            selectMirror
            events={fetchEvents}
            select={onSelect}
            eventClick={onEventClick}
            eventDrop={onTimeChange}
            eventResize={onTimeChange}
          />
        </div>
      </main>
      {dialog && <EventDialog state={dialog} calendars={writable} onClose={() => setDialog(null)} onChanged={refetch} />}
    </div>
  );
}
```

**Step 3: Full verification**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build`
Expected: all of them pass.

**Step 4: Commit**

```bash
git add src/components
git commit -m "feat: add event dialog with rich-text editing, create and drag/resize"
```

---

### Task 16: README and full manual check

**Files:**
- Create: `README.md` (replace the scaffold's version)

**Step 1: Write `README.md`**

````markdown
# Personal Calendar

All my Google calendars in one place: view, create, edit, drag and delete events, with HTML descriptions.
Runs locally at http://localhost:3000.

## One-time Google setup

1. https://console.cloud.google.com → create a project (e.g. "Personal Calendar").
2. **APIs & Services → Library** → enable **Google Calendar API**.
3. **Google Auth Platform**:
   - **Branding:** app name and your email.
   - **Audience:** user type **External**. Add each Google account you'll connect under **Test users**.
   - **Data access:** add scopes `openid`, `.../auth/userinfo.email`, `.../auth/calendar`.
   - **Clients → Create client:** type **Web application**. Authorized redirect URI: `http://localhost:3000/api/auth/callback`.
4. `cp env.example .env.local` and paste the client ID and secret.

> **Testing mode tokens expire after 7 days.** To avoid reconnecting weekly, go to **Audience → Publish app** (no verification needed for personal use).
> Each account will then see an "unverified app" warning once. Choose *Advanced → Go to … (unsafe)*.
>
> **Google Workspace (company) accounts** may block unverified apps. If yours does, ask an admin to trust this OAuth client ID.

## Run

Requires Node 24 (`nvm use`).

```bash
npm install
npm run dev     # http://localhost:3000 — use "localhost", not 127.0.0.1, so the OAuth cookie matches
npm test
```

Data (accounts, refresh tokens, visible-calendar settings) lives in `data/calendar.db`. Delete the file to reset.
````

**Step 2: Manual check of the write features** (Checkpoint A already covered reading)

Run `npm run dev`, open http://localhost:3000, then confirm each step:

1. Click and drag on an empty slot, pick account B's calendar, enter a description with **bold**, a list, a link and a table, and save. The event appears; open it in Google Calendar and check the formatting.
2. Drag that event to another day and resize it. Reload: the change persisted, both here and in Google Calendar.
3. Open an event whose description is plain text with a Meet link. The link can be clicked. Edit only the title and save. In Google, the description is still plain text.
4. Edit the same event in Google Calendar, then (without reloading here) drag it. You see the "changed elsewhere" message and the event snaps back.
5. Recurring event: edit "This event" (change the time), which only moves that occurrence. Then edit "All events" (change the title), which renames every occurrence.
6. Delete an event: confirm, it disappears here and in Google. Delete one occurrence of a recurring event with "This event"; the others stay.
7. Read-only calendar (e.g. Holidays): its events can't be dragged, and the dialog has no Edit or Delete.
8. Send yourself an invite whose description contains `<img src=x onerror=alert(1)>`. Opening it shows no alert.

If something fails, write a failing test for it where possible, fix it, and commit.

**Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add setup and run instructions"
```

---

## Done when

- Task 0's gate passed for every account you plan to use.
- `npm test`, `npx tsc --noEmit`, `npm run lint` and `npm run build` all pass.
- Checkpoint A (Task 12) and the Task 16 manual check all pass with two real Google accounts.
