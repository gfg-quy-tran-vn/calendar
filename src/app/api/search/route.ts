import type { calendar_v3 } from 'googleapis';
import { fetchRange } from '@/lib/aggregate';
import { getRepo } from '@/lib/db';
import { calendarFor } from '@/lib/google';
import {
  MAX_QUERY_LENGTH, MIN_QUERY_LENGTH, SEARCH_FETCH_LIMIT, SEARCH_RESULT_LIMIT, SEARCH_WINDOW_DAYS, orderForSearch,
  type SearchResponse,
} from '@/lib/search';

export const dynamic = 'force-dynamic';

const DAY_MS = 86_400_000;

/** Free-text search over the shown calendars. Google matches title, description, location and guests. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get('q')?.trim() ?? '';
  if (q.length < MIN_QUERY_LENGTH || q.length > MAX_QUERY_LENGTH) {
    return Response.json({ error: `q must be ${MIN_QUERY_LENGTH}–${MAX_QUERY_LENGTH} characters` }, { status: 400 });
  }

  const repo = getRepo();
  const tokens = new Map(repo.listAccounts().filter((a) => !a.needsReauth).map((a) => [a.id, a.refreshToken]));
  const calendars = repo.listCalendars().filter((c) => c.shown && tokens.has(c.accountId));
  const now = new Date();
  const range = {
    timeMin: new Date(now.getTime() - SEARCH_WINDOW_DAYS * DAY_MS).toISOString(),
    timeMax: new Date(now.getTime() + SEARCH_WINDOW_DAYS * DAY_MS).toISOString(),
  };

  const result = await fetchRange(calendars, range, async (cal, r) => {
    const res = await calendarFor(tokens.get(cal.accountId)!).events.list({
      calendarId: cal.googleId, q, ...r, singleEvents: true, maxResults: SEARCH_FETCH_LIMIT,
    });
    return (res.data.items ?? []) as calendar_v3.Schema$Event[];
  });

  for (const e of result.errors) if (e.kind === 'reauth') repo.markNeedsReauth(e.accountId);
  const ordered = orderForSearch(result.events, now);
  const body: SearchResponse = { events: ordered.slice(0, SEARCH_RESULT_LIMIT), total: ordered.length, errors: result.errors };
  return Response.json(body);
}
