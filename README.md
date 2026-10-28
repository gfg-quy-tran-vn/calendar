# Personal Calendar

All your Google calendars, from several accounts, in one place. View, create, edit, drag and delete events, read and write
rich-text (HTML) descriptions, and see and add guests. Runs on your own computer at <http://localhost:1984>.

## Features

- **Several Google accounts at once.** Events from every shown calendar are merged into one view. Show or hide calendars,
  and give each one its own color (kept locally, Google's color is untouched).
- **Week, day and month views**, plus a small month calendar in the sidebar to jump to any date.
- **Create, edit, move and delete.** Drag across the grid to create, drag or resize an event to reschedule it, click it for
  details. Recurring events can be changed for "This event" or "All events".
- **HTML descriptions.** Descriptions from Google (HTML or plain text, links included) are shown sanitized, and edited with a
  rich-text editor (bold, italic, underline, headings, lists, links, tables).
- **Guests.** See who is invited and how they replied. Where you are allowed to invite, add more guests by email, with an
  option to send invitation emails.
- **Reply to invitations.** For events you are invited to, answer **Yes / Maybe / No** with an optional note, and choose
  whether to let the organizer know. Events you declined are faded and struck through on the grid.
- **Search.** Press `/` (or Cmd/Ctrl+K) to search the calendars you have ticked, from a year back to a year ahead. It matches
  titles, descriptions, locations and guests. Upcoming events come first. Pick a result to jump to its date and open it.
- **Video calls.** Events with a Google Meet (or Zoom and similar) link show a **Join** button and a **Copy link** button in
  the details. Only `https` links are ever made clickable. When creating or editing an event, tick **Add Google Meet video conferencing** to attach a new Meet
  call (removing one is not supported).
- **Hover preview** of the full title, location and description. Esc closes dialogs.
- **Day and night themes.** Follows your system setting, and remembers your choice.

## How it works

A Next.js app (App Router) with FullCalendar for the grid, TipTap for the editor, and SQLite for settings.

- Your Google refresh tokens and settings (which calendars are shown, their colors) live in `data/calendar.db` on this machine.
- **Events are never stored locally.** They are fetched live from Google for the visible date range.
- The browser only talks to this app's own `/api/*` routes. The server holds the tokens and calls Google.

> **There is no login screen.** Anyone who can open the app can use your calendars, so it listens on `localhost` only.
> Do not expose it to a network.

## One-time Google setup

1. In the [Google Cloud console](https://console.cloud.google.com), create a project (for example "Personal Calendar").
2. **APIs & Services → Library** → enable the **Google Calendar API**.
3. **Google Auth Platform**:
   - **Branding:** app name and your email.
   - **Audience:** user type **External**. While the app is in *Testing*, add each Google account you will connect under
     **Test users**.
   - **Data access:** add the scopes `openid`, `.../auth/userinfo.email` and `.../auth/calendar`.
   - **Clients → Create client:** type **Web application**, with the authorized redirect URI
     `http://localhost:1984/api/auth/callback`.
4. `cp env.example .env.local` and paste in the client ID and secret.

> **Testing-mode tokens expire after 7 days.** To avoid reconnecting every week, go to **Audience → Publish app**. No
> verification is needed for personal use. Each account then sees an "unverified app" warning once: choose
> *Advanced → Go to … (unsafe)*.
>
> **Google Workspace (company) accounts** may block unverified apps. If yours does, ask an admin to trust this OAuth client ID.
>
> **Internal consent screen:** if the project's user type is **Internal** (a Workspace project), only accounts in that
> organisation can connect, and others fail with `org_internal`. Use an **External** project for those.

Then open the app and use **+ Add Google account** in the sidebar for each account.

## Run it

Requires **Node 26**. With [nvm](https://github.com/nvm-sh/nvm), run `nvm install && nvm use` in the project folder (it reads
`.nvmrc`).

```bash
npm install
npm run dev      # http://localhost:1984
npm test
```

Use `localhost`, not `127.0.0.1`, so the login cookie matches.

`dev`, `build`, `start` and `test` check the Node version first and stop with a clear message if it is too old. The native
SQLite module is built for one Node version, and running under another used to crash the server silently.

### Production mode

Faster, and what you would leave running day to day:

```bash
npm run build    # once, and again after any code change
npm start        # http://localhost:1984, listens on localhost only
```

Stop `npm run dev` first, since both use port 1984. They share the same `.env.local` and `data/calendar.db`.

To use a different port, change `-p 1984` in the `dev` and `start` scripts in `package.json`, register
`http://localhost:<port>/api/auth/callback` as a redirect URI in Google Cloud, and set `APP_URL=http://localhost:<port>`
in `.env.local`.

### Keep it running in the background (macOS)

A launch agent starts the production server when you log in and restarts it if it exits. Run `npm run build` first, then create
`~/Library/LaunchAgents/com.calendar.app.plist`, replacing `/Users/YOU` and the Node version with your own (`which node`
inside the project folder shows the path):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.calendar.app</string>
  <key>WorkingDirectory</key><string>/Users/YOU/path/to/calendar</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/YOU/.nvm/versions/node/v26.12.1/bin/node</string>
    <string>/Users/YOU/path/to/calendar/node_modules/next/dist/bin/next</string>
    <string>start</string><string>-H</string><string>localhost</string><string>-p</string><string>1984</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key><string>production</string>
    <key>PATH</key><string>/Users/YOU/.nvm/versions/node/v26.12.1/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>/Users/YOU/Library/Logs/calendar.log</string>
  <key>StandardErrorPath</key><string>/Users/YOU/Library/Logs/calendar.log</string>
</dict></plist>
```

It runs Node directly by full path, because background services do not load nvm.

| What | Command |
|---|---|
| Start it | `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.calendar.app.plist` |
| Restart it (after a rebuild) | `launchctl kickstart -k gui/$(id -u)/com.calendar.app` |
| Stop it | `launchctl bootout gui/$(id -u)/com.calendar.app` |
| Check it | `launchctl print gui/$(id -u)/com.calendar.app \| head` |
| Read the log | `tail -f ~/Library/Logs/calendar.log` |

- It starts when you log in, not at power-on, and pauses while the Mac sleeps.
- Use `kickstart` or `bootout` to restart or stop it. A plain `kill` can leave the process half stopped, and launchd then
  does not restart it.
- A build replaces the files the running server uses, so run `kickstart` straight after every `npm run build`. Until then
  the page can fail to load some of its scripts.
- If you upgrade Node with nvm, update the Node path in the file.

## Troubleshooting

| Problem | Cause and fix |
|---|---|
| Google says `redirect_uri_mismatch` | The redirect URI in Google Cloud must match exactly: `http://localhost:1984/api/auth/callback`. |
| Sidebar shows **Login expired — Reconnect** | Google revoked or expired the token (always after 7 days in Testing mode). Click Reconnect. |
| `org_internal` error when connecting | The Google Cloud project is **Internal**. Use an **External** project. |
| The page loads, then the server dies silently | The server was started on the wrong Node version. Run `nvm use` (Node 26) and start it again. |
| "Port 1984 is already in use" | The dev server and the background service cannot run together. Stop one of them. |
| A calendar's events do not appear | Check it is ticked in the sidebar, and expand its account group, which is collapsed by default. |

## Development

| Command | What it does |
|---|---|
| `npm run dev` | Development server with hot reload |
| `npm test` | Unit and API tests (vitest) |
| `npm run lint` | ESLint |
| `npx tsc --noEmit` | Type check |
| `npm run build` | Production build |

```
src/app/api/     server routes: Google login, accounts, calendars, events
src/lib/         database, Google client, event mapping, HTML sanitizing, date helpers
src/components/  the calendar screen, sidebar, event dialog, editor
tests/           vitest tests (Google is mocked)
docs/plans/      the original design and implementation plan
```

Settings live in `.env.local` (see `env.example`): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_URL`, and optionally
`CALENDAR_DB` for a different database path. Delete `data/calendar.db` to reset all accounts and settings.
