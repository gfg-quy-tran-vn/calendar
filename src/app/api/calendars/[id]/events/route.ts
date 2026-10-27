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
