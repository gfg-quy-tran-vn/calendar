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
