import { classifyGoogleError } from '@/lib/errors';
import { toCalendarEvent, toGooglePatch, type EventDraft } from '@/lib/events';
import { googleErrorResponse, loadWritableCalendar } from '@/lib/route-helpers';

type Ctx = { params: Promise<{ id: string; eventId: string }> };

const SEND_UPDATES = ['all', 'externalOnly', 'none'] as const;
type SendUpdates = (typeof SEND_UPDATES)[number];

export async function PATCH(req: Request, { params }: Ctx) {
  const { id, eventId } = await params;
  const loaded = loadWritableCalendar(id);
  if ('error' in loaded) return loaded.error;
  const { repo, cal, client } = loaded;
  const sendUpdates = new URL(req.url).searchParams.get('sendUpdates');
  if (sendUpdates !== null && !SEND_UPDATES.includes(sendUpdates as SendUpdates)) {
    return Response.json({ error: 'sendUpdates must be all, externalOnly or none' }, { status: 400 });
  }
  const { draft, etag } = (await req.json()) as { draft: Partial<EventDraft>; etag?: string };

  try {
    const res = await client.events.patch(
      {
        calendarId: cal.googleId, eventId, requestBody: toGooglePatch(draft),
        ...(sendUpdates ? { sendUpdates: sendUpdates as SendUpdates } : {}),
      },
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
