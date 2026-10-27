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
