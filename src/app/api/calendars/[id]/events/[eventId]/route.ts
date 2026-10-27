import { classifyGoogleError } from '@/lib/errors';
import { toCalendarEvent, toGooglePatch, type EventDraft } from '@/lib/events';
import { googleErrorResponse, loadWritableCalendar } from '@/lib/route-helpers';

type Ctx = { params: Promise<{ id: string; eventId: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const { id, eventId } = await params;
  const loaded = loadWritableCalendar(id);
  if ('error' in loaded) return loaded.error;
  const { repo, cal, client } = loaded;
  const { draft, etag } = (await req.json()) as { draft: Partial<EventDraft>; etag?: string };

  try {
    const res = await client.events.patch(
      { calendarId: cal.googleId, eventId, requestBody: toGooglePatch(draft) },
      etag ? { headers: { 'If-Match': etag } } : undefined,
    );
    return Response.json(toCalendarEvent(res.data, cal));
  } catch (err) {
    return googleErrorResponse(err, repo, cal.accountId);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id, eventId } = await params;
  const loaded = loadWritableCalendar(id);
  if ('error' in loaded) return loaded.error;
  const { repo, cal, client } = loaded;

  try {
    await client.events.delete({ calendarId: cal.googleId, eventId });
  } catch (err) {
    if (classifyGoogleError(err) !== 'not_found') return googleErrorResponse(err, repo, cal.accountId);
  }
  return new Response(null, { status: 204 });
}
