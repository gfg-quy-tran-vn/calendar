# Multi-Google-Calendar Personal Calendar — Design

**Date:** 2026-10-27
**Status:** Approved

## Goal

A personal web calendar, run locally, that:

1. Combines several Google accounts and their calendars into one view, where events can be viewed, created, edited, moved and deleted.
2. Shows event descriptions as formatted HTML and edits them in a WYSIWYG (rich-text) editor.

## Alternatives considered

| Option | Why not chosen |
|---|---|
| Thunderbird Calendar | Desktop only, and it can't be customized. Google's description field mixes HTML and plain text, so formatting is inconsistent. |
| Keeper.sh (AGPL) | Built for syncing calendars to avoid double-booking, not as a calendar to edit in. Needs Postgres and Redis. |
| Musubi | Its claims couldn't be verified. |
| Nextcloud, Radicale, Baïkal | These are calendar servers; none connects to Google accounts on its own. |
| FullCalendar's `google-calendar` plugin | Read-only, and only for public calendars accessed with an API key. |

Chosen approach: **build it ourselves**. Next.js 16 (one full-stack app) + FullCalendar 6.1 (only the free MIT plugins; v7 wasn't checked) + TipTap 3 + DOMPurify + `googleapis` + SQLite, on **Node 24** (most of these dependencies need Node 22 or later).

## Architecture

- Runs only on this machine, at `http://localhost:3000` (`next dev -H localhost`).
- **One Google Cloud OAuth client** of type "Web application", with redirect URI `http://localhost:3000/api/auth/callback`. Scopes: `openid email https://www.googleapis.com/auth/calendar`.
- Each Google account goes through the login flow separately. Its **refresh token stays on the server** in SQLite and is never sent to the browser.
- **Events are never stored locally.** Every visible date range is fetched live from Google, so there is no sync logic to get wrong.

### Data (SQLite, `data/calendar.db`, gitignored)

- `accounts(id, email UNIQUE, refresh_token, needs_reauth)`
- `calendars(id, account_id → accounts ON DELETE CASCADE, google_id, name, color, shown, can_write, UNIQUE(account_id, google_id))`

### API

| Method & path | Purpose |
|---|---|
| `GET /api/auth/start[?login_hint=]` | Sends the browser to Google's login, with a `state` value in a cookie |
| `GET /api/auth/callback` | Checks `state`, saves the account, loads its calendar list |
| `GET /api/accounts` | Accounts and their calendars (no tokens) |
| `DELETE /api/accounts/:id` | Removes the account from the app |
| `PATCH /api/calendars/:id` | `{ shown }` |
| `GET /api/events?start&end` | Events from all shown calendars merged, plus `errors[]` for calendars that failed to load |
| `POST /api/calendars/:id/events` | Create |
| `PATCH /api/calendars/:id/events/:eventId` | Update `{ draft, etag? }`, sending `If-Match` to Google |
| `DELETE /api/calendars/:id/events/:eventId` | Delete |

`:id` is the calendar's id in our local database, so Google's long calendar IDs (with `@` and `#`) never appear in URLs.

## Screens

- **Sidebar:** each account's email (red "Reconnect" link if its login expired, ✕ to disconnect) and its calendars, each with a checkbox and color dot. "+ Add Google account" at the bottom.
- **Calendar:** FullCalendar with month, week and day views. Events take their calendar's color. Drag to move and resize only works on calendars you can write to.
- **Event dialog:**
  - **View mode:** cleaned HTML description, location, and a link to the event in Google Calendar.
  - **Edit/create mode:** title, calendar (when creating), all-day toggle, start and end, location, and TipTap description editor (bold, italic, underline, heading, lists, link, table).
  - **Recurring events:** a choice between "This event" and "All events". "All events" changes only the title, location and description.

## HTML handling

- Google's description field can be HTML or plain text, with no marker saying which. If there are no tags, the text is HTML-escaped, web addresses become links, and line breaks become `<br>`.
- Everything displayed goes through DOMPurify with an allow-list of formatting tags plus `a[href]`. All links get `target="_blank" rel="noopener noreferrer"`.
- The description is sent to Google only if it was actually edited. This stops plain-text descriptions being silently converted to HTML.

## Errors

- **`invalid_grant` / 401:** the account is marked `needs_reauth`; its calendars are skipped and the sidebar shows "Reconnect". Other accounts keep working.
- **A calendar fails to load:** the remaining events still show, plus a warning naming the calendar.
- **412 (event changed elsewhere):** returned as 409, and the screen says "changed elsewhere — reload".
- **Drag fails:** `info.revert()` puts the event back, and a message appears.
- **404/410 when deleting:** treated as success, because the event is already gone.

## Security

- The server listens on localhost only.
- OAuth uses a `state` value kept in an HttpOnly cookie.
- Tokens never reach the browser.
- `.env.local` and `data/` are gitignored.
- Displayed HTML is always cleaned first.

## Known limitations and risks

- While the OAuth app is in **Testing** mode, Google refresh tokens expire after **7 days**. To avoid this, publish the app to "In production" without verification and click through the "unverified app" warning once per account.
- **Google Workspace (company) accounts** may block unverified third-party apps by admin policy. If an account is blocked, an admin has to allow-list the OAuth client ID.
- "This and following events" for recurring events is not supported.

## Testing

- **Vitest unit tests:** date helpers, HTML cleaning, database layer, error classification, event conversion, merging events from several calendars, calendar-list sync.
- **Route tests:** Next.js route handlers called directly, with `@/lib/google` mocked.
- **Manual check:** two real Google accounts. Create, edit, drag and delete on each; a recurring event; a reconnect after revoking access; and confirm each change appears in Google Calendar.

## Out of scope (YAGNI)

Offline cache, push notifications, attendees/invites, non-Google providers, hosting beyond localhost, choosing your own calendar colors, automatic retry on rate limits, and a list view.
