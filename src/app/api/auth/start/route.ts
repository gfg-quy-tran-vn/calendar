import { randomBytes } from 'node:crypto';
import { oauthClient, SCOPES } from '@/lib/google';

export function GET(req: Request) {
  const state = randomBytes(16).toString('hex');
  const loginHint = new URL(req.url).searchParams.get('login_hint') ?? undefined;
  const url = oauthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent select_account', // always return a refresh token
    scope: SCOPES,
    state,
    login_hint: loginHint,
  });
  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
      'Set-Cookie': `oauth_state=${state}; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=600`,
    },
  });
}
