import { beforeAll, describe, expect, it } from 'vitest';
import { GET as start } from '@/app/api/auth/start/route';
import { GET as callback } from '@/app/api/auth/callback/route';

beforeAll(() => {
  process.env.GOOGLE_CLIENT_ID = 'cid';
  process.env.GOOGLE_CLIENT_SECRET = 'secret';
  process.env.APP_URL = 'http://localhost:1984';
});

describe('auth start', () => {
  it('redirects to Google with offline access and a state cookie', () => {
    const res = start(new Request('http://localhost:1984/api/auth/start?login_hint=a%40example.com'));
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get('location')!);
    expect(loc.hostname).toBe('accounts.google.com');
    expect(loc.searchParams.get('access_type')).toBe('offline');
    expect(loc.searchParams.get('prompt')).toBe('consent select_account');
    expect(loc.searchParams.get('login_hint')).toBe('a@example.com');
    expect(loc.searchParams.get('redirect_uri')).toBe('http://localhost:1984/api/auth/callback');
    const state = loc.searchParams.get('state');
    expect(state).toMatch(/^[0-9a-f]{32}$/);
    expect(res.headers.get('set-cookie')).toContain(`oauth_state=${state}`);
    expect(res.headers.get('set-cookie')).toContain('HttpOnly');
  });
});

describe('auth callback', () => {
  it('rejects a mismatched state without calling Google', async () => {
    const res = await callback(
      new Request('http://localhost:1984/api/auth/callback?code=c&state=evil', { headers: { cookie: 'oauth_state=good' } }),
    );
    expect(res.status).toBe(400);
  });

  it('redirects home when the user cancels at Google', async () => {
    const res = await callback(new Request('http://localhost:1984/api/auth/callback?error=access_denied'));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('http://localhost:1984/');
  });
});
