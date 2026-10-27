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
