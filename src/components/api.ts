import type { CalendarEvent, EventDraft } from '@/lib/events';

const MESSAGES: Record<string, string> = {
  conflict: 'This event was changed elsewhere. Close the dialog and try again.',
  reauth: 'This Google account needs to be reconnected (see the sidebar).',
  read_only: 'This calendar is read-only.',
};

async function call(url: string, init: RequestInit): Promise<Response> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json' } });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new Error(MESSAGES[body.error ?? ''] ?? body.message ?? `Request failed (${res.status})`);
  }
  return res;
}

const eventUrl = (calendarId: number, eventId: string) =>
  `/api/calendars/${calendarId}/events/${encodeURIComponent(eventId)}`;

export async function createEvent(calendarId: number, draft: EventDraft): Promise<CalendarEvent> {
  return (await call(`/api/calendars/${calendarId}/events`, { method: 'POST', body: JSON.stringify(draft) })).json();
}

export async function updateEvent(
  calendarId: number, eventId: string, draft: Partial<EventDraft>, etag?: string,
): Promise<CalendarEvent> {
  return (await call(eventUrl(calendarId, eventId), { method: 'PATCH', body: JSON.stringify({ draft, etag }) })).json();
}

export async function deleteEvent(calendarId: number, eventId: string): Promise<void> {
  await call(eventUrl(calendarId, eventId), { method: 'DELETE' });
}

export async function setCalendarShown(calendarId: number, shown: boolean): Promise<void> {
  await call(`/api/calendars/${calendarId}`, { method: 'PATCH', body: JSON.stringify({ shown }) });
}

export async function setCalendarColor(calendarId: number, color: string | null): Promise<void> {
  await call(`/api/calendars/${calendarId}`, { method: 'PATCH', body: JSON.stringify({ color }) });
}

export async function removeAccount(accountId: number): Promise<void> {
  await call(`/api/accounts/${accountId}`, { method: 'DELETE' });
}
