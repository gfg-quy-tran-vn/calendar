import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRepo, openDb, setRepoForTests, type Repo } from '@/lib/db';

const g = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('@/lib/google', () => ({ calendarFor: () => ({ events: { list: g.list } }) }));

import { GET } from '@/app/api/events/route';

let repo: Repo;
const idOf = (googleId: string) => repo.listCalendars().find((c) => c.googleId === googleId)!.id;
const ev = (id: string) => ({ id, start: { dateTime: '2026-10-27T09:00:00Z' }, end: { dateTime: '2026-10-27T10:00:00Z' } });
const rangeUrl = 'http://localhost/api/events?start=2026-10-26T00%3A00%3A00%2B07%3A00&end=2026-11-02T00%3A00%3A00%2B07%3A00';

beforeEach(() => {
  g.list.mockReset();
  repo = createRepo(openDb(':memory:'));
  setRepoForTests(repo);
  const a = repo.upsertAccount('a@example.com', 'rt-a');
  repo.upsertCalendar(a, { googleId: 'work', name: 'Work', color: '#111111', canWrite: true });
  repo.upsertCalendar(a, { googleId: 'hidden', name: 'Hidden', color: '#222222', canWrite: true });
  repo.setShown(idOf('hidden'), false);
  const b = repo.upsertAccount('b@example.com', 'rt-b');
  repo.upsertCalendar(b, { googleId: 'b-cal', name: 'B', color: '#333333', canWrite: true });
  repo.markNeedsReauth(b);
});

describe('GET /api/events', () => {
  it('queries only shown calendars of healthy accounts', async () => {
    g.list.mockResolvedValue({ data: { items: [ev('x')] } });
    const body = await (await GET(new Request(rangeUrl))).json();
    expect(g.list).toHaveBeenCalledTimes(1);
    expect(g.list).toHaveBeenCalledWith({
      calendarId: 'work', timeMin: '2026-10-25T17:00:00.000Z', timeMax: '2026-11-01T17:00:00.000Z',
      singleEvents: true, maxResults: 2500, pageToken: undefined,
    });
    expect(body.events.map((e: { id: string }) => e.id)).toEqual([`${idOf('work')}:x`]);
  });

  it('follows pagination', async () => {
    g.list
      .mockResolvedValueOnce({ data: { items: [ev('p1')], nextPageToken: 't2' } })
      .mockResolvedValueOnce({ data: { items: [ev('p2')] } });
    const body = await (await GET(new Request(rangeUrl))).json();
    expect(body.events).toHaveLength(2);
    expect(g.list.mock.calls[1][0]).toMatchObject({ pageToken: 't2' });
  });

  it('marks accounts whose token was revoked', async () => {
    g.list.mockRejectedValue(Object.assign(new Error('invalid_grant'), { response: { status: 400, data: { error: 'invalid_grant' } } }));
    const body = await (await GET(new Request(rangeUrl))).json();
    expect(body.errors).toEqual([{ calendarId: idOf('work'), accountId: expect.any(Number), name: 'Work', kind: 'reauth' }]);
    expect(repo.listAccounts().find((a) => a.email === 'a@example.com')!.needsReauth).toBe(true);
  });

  it('requires start and end', async () => {
    expect((await GET(new Request('http://localhost/api/events'))).status).toBe(400);
  });
});
