import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRepo, openDb, setRepoForTests, type Repo } from '@/lib/db';

const g = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('@/lib/google', () => ({ calendarFor: () => ({ events: { list: g.list } }) }));

import { GET } from '@/app/api/search/route';

let repo: Repo;
const idOf = (googleId: string) => repo.listCalendars().find((c) => c.googleId === googleId)!.id;
const ev = (id: string, start: string, extra: object = {}) => ({ id, summary: id, start: { dateTime: start }, end: { dateTime: start }, ...extra });
const search = (q: string) => GET(new Request(`http://localhost/api/search?q=${encodeURIComponent(q)}`));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-27T12:00:00Z'));
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

afterEach(() => vi.useRealTimers());

describe('GET /api/search', () => {
  it('asks Google to search only shown calendars of healthy accounts, a year either side of today', async () => {
    g.list.mockResolvedValue({ data: { items: [] } });
    expect((await search('dentist')).status).toBe(200);
    expect(g.list).toHaveBeenCalledTimes(1);
    expect(g.list).toHaveBeenCalledWith({
      calendarId: 'work', q: 'dentist', singleEvents: true, maxResults: 250,
      timeMin: '2025-10-27T12:00:00.000Z', timeMax: '2027-10-27T12:00:00.000Z',
    });
  });

  it('trims the query and rejects ones that are too short', async () => {
    g.list.mockResolvedValue({ data: { items: [] } });
    await search('  dentist  ');
    expect(g.list.mock.calls[0][0].q).toBe('dentist');
    for (const q of ['', ' ', 'a', '  a ']) expect((await search(q)).status).toBe(400);
    expect((await GET(new Request('http://localhost/api/search'))).status).toBe(400);
    expect((await search('x'.repeat(201))).status).toBe(400);
    expect(g.list).toHaveBeenCalledTimes(1);
  });

  it('puts upcoming events first (soonest first), then past ones (most recent first)', async () => {
    g.list.mockResolvedValue({
      data: { items: [ev('past-old', '2026-09-01T09:00:00Z'), ev('later', '2026-12-01T09:00:00Z'), ev('past-new', '2026-10-20T09:00:00Z'), ev('soon', '2026-10-28T09:00:00Z')] },
    });
    const body = await (await search('x1')).json();
    expect(body.events.map((e: { title: string }) => e.title)).toEqual(['soon', 'later', 'past-new', 'past-old']);
    expect(body.total).toBe(4);
  });

  it('caps the list at 50 and reports how many matched', async () => {
    const items = Array.from({ length: 60 }, (_, i) => ev(`e${i}`, `2026-11-${String((i % 28) + 1).padStart(2, '0')}T09:00:00Z`));
    g.list.mockResolvedValue({ data: { items } });
    const body = await (await search('meeting')).json();
    expect(body.events).toHaveLength(50);
    expect(body.total).toBe(60);
  });

  it('leaves out cancelled events', async () => {
    g.list.mockResolvedValue({ data: { items: [ev('kept', '2026-11-01T09:00:00Z'), ev('gone', '2026-11-02T09:00:00Z', { status: 'cancelled' })] } });
    const body = await (await search('x1')).json();
    expect(body.events.map((e: { title: string }) => e.title)).toEqual(['kept']);
  });

  it('marks accounts whose token was revoked and reports the failure', async () => {
    g.list.mockRejectedValue(Object.assign(new Error('invalid_grant'), { response: { status: 400, data: { error: 'invalid_grant' } } }));
    const body = await (await search('dentist')).json();
    expect(body.events).toEqual([]);
    expect(body.errors).toEqual([{ calendarId: idOf('work'), accountId: expect.any(Number), name: 'Work', kind: 'reauth' }]);
    expect(repo.listAccounts().find((a) => a.email === 'a@example.com')!.needsReauth).toBe(true);
  });
});
