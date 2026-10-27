import { beforeEach, describe, expect, it } from 'vitest';
import { createRepo, openDb, setRepoForTests, type Repo } from '@/lib/db';
import { GET } from '@/app/api/accounts/route';
import { DELETE } from '@/app/api/accounts/[id]/route';
import { PATCH } from '@/app/api/calendars/[id]/route';

let repo: Repo;
let accountId: number;
beforeEach(() => {
  repo = createRepo(openDb(':memory:'));
  setRepoForTests(repo);
  accountId = repo.upsertAccount('a@example.com', 'secret-token');
  repo.upsertCalendar(accountId, { googleId: 'primary', name: 'Main', color: '#123456', canWrite: true });
});

describe('accounts API', () => {
  it('lists accounts with calendars and never exposes tokens', async () => {
    const res = await GET();
    const text = await res.text();
    expect(text).not.toContain('secret-token');
    expect(JSON.parse(text)).toEqual([
      {
        id: accountId, email: 'a@example.com', needsReauth: false,
        calendars: [{ id: expect.any(Number), name: 'Main', color: '#123456', colorOverride: null, shown: true, canWrite: true }],
      },
    ]);
  });

  it('deletes an account', async () => {
    const res = await DELETE(new Request('http://localhost/x', { method: 'DELETE' }), { params: Promise.resolve({ id: String(accountId) }) });
    expect(res.status).toBe(204);
    expect(repo.listAccounts()).toEqual([]);
  });

  it('toggles calendar visibility', async () => {
    const calId = repo.listCalendars()[0].id;
    const res = await PATCH(
      new Request('http://localhost/x', { method: 'PATCH', body: JSON.stringify({ shown: false }) }),
      { params: Promise.resolve({ id: String(calId) }) },
    );
    expect(res.status).toBe(204);
    expect(repo.getCalendar(calId)!.shown).toBe(false);
  });

  it('rejects a non-boolean shown value', async () => {
    const calId = repo.listCalendars()[0].id;
    const res = await PATCH(
      new Request('http://localhost/x', { method: 'PATCH', body: JSON.stringify({ shown: 'no' }) }),
      { params: Promise.resolve({ id: String(calId) }) },
    );
    expect(res.status).toBe(400);
  });

  const patch = (calId: number, body: unknown) =>
    PATCH(new Request('http://localhost/x', { method: 'PATCH', body: JSON.stringify(body) }), { params: Promise.resolve({ id: String(calId) }) });

  it('sets and clears a color override', async () => {
    const calId = repo.listCalendars()[0].id;
    expect((await patch(calId, { color: '#abcdef' })).status).toBe(204);
    expect(repo.getCalendar(calId)!.colorOverride).toBe('#abcdef');
    expect((await patch(calId, { color: null })).status).toBe(204);
    expect(repo.getCalendar(calId)!.colorOverride).toBeNull();
  });

  it.each(['red', '#fff', '#abcdeg', 12, ''])('rejects the invalid color %j', async (color) => {
    const calId = repo.listCalendars()[0].id;
    expect((await patch(calId, { color })).status).toBe(400);
    expect(repo.getCalendar(calId)!.colorOverride).toBeNull();
  });

  it('rejects a body with nothing to change', async () => {
    expect((await patch(repo.listCalendars()[0].id, {})).status).toBe(400);
  });
});
