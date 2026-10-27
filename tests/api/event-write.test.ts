import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRepo, openDb, setRepoForTests, type Repo } from '@/lib/db';

const g = vi.hoisted(() => ({ insert: vi.fn(), patch: vi.fn(), del: vi.fn() }));
vi.mock('@/lib/google', () => ({ calendarFor: () => ({ events: { insert: g.insert, patch: g.patch, delete: g.del } }) }));

import { POST } from '@/app/api/calendars/[id]/events/route';
import { DELETE, PATCH } from '@/app/api/calendars/[id]/events/[eventId]/route';

let repo: Repo;
let calId: number;
let readOnlyId: number;
const timed = { start: { dateTime: '2026-10-27T10:00:00Z' }, end: { dateTime: '2026-10-27T11:00:00Z' } };

beforeEach(() => {
  g.insert.mockReset();
  g.patch.mockReset();
  g.del.mockReset();
  repo = createRepo(openDb(':memory:'));
  setRepoForTests(repo);
  const accountId = repo.upsertAccount('a@example.com', 'rt');
  repo.upsertCalendar(accountId, { googleId: 'primary', name: 'Main', color: '#123456', canWrite: true });
  repo.upsertCalendar(accountId, { googleId: 'holidays', name: 'Holidays', color: '#000000', canWrite: false });
  calId = repo.listCalendars().find((c) => c.googleId === 'primary')!.id;
  readOnlyId = repo.listCalendars().find((c) => c.googleId === 'holidays')!.id;
});

const itemCtx = (id = calId, eventId = 'ev1') => ({ params: Promise.resolve({ id: String(id), eventId }) });
const jsonReq = (method: string, body: unknown) => new Request('http://localhost/x', { method, body: JSON.stringify(body) });

describe('POST /api/calendars/:id/events', () => {
  it('inserts into the chosen calendar', async () => {
    g.insert.mockResolvedValue({ data: { id: 'new', summary: 'Lunch', ...timed } });
    const draft = { title: 'Lunch', start: '2026-10-27T10:00:00.000Z', end: '2026-10-27T11:00:00.000Z', allDay: false, description: '<p>hi</p>' };
    const res = await POST(jsonReq('POST', draft), { params: Promise.resolve({ id: String(calId) }) });
    expect(res.status).toBe(201);
    expect(g.insert).toHaveBeenCalledWith({
      calendarId: 'primary',
      requestBody: {
        summary: 'Lunch', description: '<p>hi</p>',
        start: { dateTime: '2026-10-27T10:00:00.000Z', date: null, timeZone: null },
        end: { dateTime: '2026-10-27T11:00:00.000Z', date: null, timeZone: null },
      },
    });
    expect(await res.json()).toMatchObject({ id: `${calId}:new`, title: 'Lunch' });
  });
});

describe('PATCH /api/calendars/:id/events/:eventId', () => {
  it('patches with If-Match and returns the updated event', async () => {
    g.patch.mockResolvedValue({ data: { id: 'ev1', summary: 'New', etag: '"2"', ...timed } });
    const res = await PATCH(jsonReq('PATCH', { draft: { title: 'New' }, etag: '"1"' }), itemCtx());
    expect(res.status).toBe(200);
    expect(g.patch).toHaveBeenCalledWith(
      { calendarId: 'primary', eventId: 'ev1', requestBody: { summary: 'New' } },
      { headers: { 'If-Match': '"1"' } },
    );
    expect(await res.json()).toMatchObject({ id: `${calId}:ev1`, title: 'New', extendedProps: { etag: '"2"' } });
  });

  it('passes sendUpdates through, and only valid values', async () => {
    g.patch.mockResolvedValue({ data: { id: 'ev1', ...timed } });
    const patch = (qs: string) =>
      PATCH(new Request(`http://localhost/x${qs}`, { method: 'PATCH', body: JSON.stringify({ draft: { attendees: [{ email: 'a@example.com' }] } }) }), itemCtx());
    expect((await patch('?sendUpdates=all')).status).toBe(200);
    expect(g.patch.mock.calls[0][0]).toEqual({
      calendarId: 'primary', eventId: 'ev1', sendUpdates: 'all', requestBody: { attendees: [{ email: 'a@example.com' }] },
    });
    expect((await patch('?sendUpdates=none')).status).toBe(200);
    expect(g.patch.mock.calls[1][0].sendUpdates).toBe('none');
    expect((await patch('?sendUpdates=everyone')).status).toBe(400);
    expect(g.patch).toHaveBeenCalledTimes(2);
  });

  it('omits If-Match when no etag is given (series edits)', async () => {
    g.patch.mockResolvedValue({ data: { id: 'ev1', ...timed } });
    await PATCH(jsonReq('PATCH', { draft: { title: 'x' } }), itemCtx());
    expect(g.patch.mock.calls[0][1]).toBeUndefined();
  });

  it('maps 412 to 409 conflict', async () => {
    g.patch.mockRejectedValue(Object.assign(new Error('Precondition Failed'), { response: { status: 412 } }));
    const res = await PATCH(jsonReq('PATCH', { draft: { title: 'x' }, etag: '"1"' }), itemCtx());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'conflict', message: 'Precondition Failed' });
  });

  it('marks the account for reconnect on invalid_grant', async () => {
    g.patch.mockRejectedValue(Object.assign(new Error('invalid_grant'), { response: { status: 400, data: { error: 'invalid_grant' } } }));
    const res = await PATCH(jsonReq('PATCH', { draft: { title: 'x' } }), itemCtx());
    expect(res.status).toBe(401);
    expect(repo.listAccounts()[0].needsReauth).toBe(true);
  });

  it('refuses writes to read-only calendars', async () => {
    const res = await PATCH(jsonReq('PATCH', { draft: { title: 'x' } }), itemCtx(readOnlyId));
    expect(res.status).toBe(403);
    expect(g.patch).not.toHaveBeenCalled();
  });

  it('returns 404 for unknown calendars', async () => {
    expect((await PATCH(jsonReq('PATCH', { draft: { title: 'x' } }), itemCtx(999))).status).toBe(404);
  });
});

describe('DELETE /api/calendars/:id/events/:eventId', () => {
  it('deletes and returns 204', async () => {
    g.del.mockResolvedValue({});
    const res = await DELETE(new Request('http://localhost/x', { method: 'DELETE' }), itemCtx());
    expect(res.status).toBe(204);
    expect(g.del).toHaveBeenCalledWith({ calendarId: 'primary', eventId: 'ev1' });
  });

  it('treats an already-deleted event as success', async () => {
    g.del.mockRejectedValue(Object.assign(new Error('Gone'), { response: { status: 410 } }));
    const res = await DELETE(new Request('http://localhost/x', { method: 'DELETE' }), itemCtx());
    expect(res.status).toBe(204);
  });
});
