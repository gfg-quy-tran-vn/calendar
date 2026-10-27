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
