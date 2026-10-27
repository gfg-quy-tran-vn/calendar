# Personal Calendar

All my Google calendars in one place: view, create, edit, drag and delete events, with HTML descriptions.
Runs locally at http://localhost:1984.

## One-time Google setup

1. https://console.cloud.google.com → create a project (e.g. "Personal Calendar").
2. **APIs & Services → Library** → enable **Google Calendar API**.
3. **Google Auth Platform**:
   - **Branding:** app name and your email.
   - **Audience:** user type **External**. Add each Google account you'll connect under **Test users**.
   - **Data access:** add scopes `openid`, `.../auth/userinfo.email`, `.../auth/calendar`.
   - **Clients → Create client:** type **Web application**. Authorized redirect URI: `http://localhost:1984/api/auth/callback`.
4. `cp env.example .env.local` and paste the client ID and secret.

> **Testing mode tokens expire after 7 days.** To avoid reconnecting weekly, go to **Audience → Publish app** (no verification needed for personal use).
> Each account will then see an "unverified app" warning once. Choose *Advanced → Go to … (unsafe)*.
>
> **Google Workspace (company) accounts** may block unverified apps. If yours does, ask an admin to trust this OAuth client ID.

> **Internal consent screen:** if the Google Cloud project's user type is **Internal** (a Workspace project), only accounts in that
> Workspace organisation can connect. Other accounts fail at login with `org_internal`. Use an **External** project for those.

## Run

Requires Node 26 (`nvm install && nvm use`, which reads `.nvmrc`).

```bash
npm install
npm run dev     # http://localhost:1984 — use "localhost", not 127.0.0.1, so the OAuth cookie matches
npm test
```

### Production mode

Faster and what you'd leave running day to day:

```bash
npm run build   # once, and again after any code change
npm start       # http://localhost:1984, listens on localhost only
```

Stop `npm run dev` first (both use port 1984). Both read the same `.env.local` and `data/calendar.db`.

To use a different port, change `-p 1984` in the `dev` and `start` scripts in `package.json`, add `http://localhost:<port>/api/auth/callback`
as a redirect URI in Google Cloud, and set `APP_URL=http://localhost:<port>` in `.env.local`.

> The app has no login of its own and stores your Google refresh tokens, so keep it bound to localhost. Don't expose it to a network.

Data (accounts, refresh tokens, visible-calendar settings) lives in `data/calendar.db`. Delete the file to reset.
