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

> **Internal consent screen:** if the Google Cloud project's user type is **Internal** (a Workspace project), only accounts in that
> Workspace organisation can connect. Other accounts fail at login with `org_internal`. Use an **External** project for those.

## Run

Requires Node 24 (`nvm use`).

```bash
npm install
npm run dev     # http://localhost:3000 — use "localhost", not 127.0.0.1, so the OAuth cookie matches
npm test
```

Data (accounts, refresh tokens, visible-calendar settings) lives in `data/calendar.db`. Delete the file to reset.
