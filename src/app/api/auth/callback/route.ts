import { google } from 'googleapis';
import { getRepo } from '@/lib/db';
import { appUrl, calendarFor, oauthClient, syncCalendars } from '@/lib/google';

const CLEAR_STATE = 'oauth_state=; Path=/api/auth; Max-Age=0';

function redirectHome() {
  return new Response(null, { status: 302, headers: { Location: `${appUrl()}/`, 'Set-Cookie': CLEAR_STATE } });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get('error')) return redirectHome();

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookieState = req.headers.get('cookie')?.match(/(?:^|;\s*)oauth_state=([^;]+)/)?.[1];
  if (!code || !state || state !== cookieState) {
    return new Response('Invalid OAuth state. Start again from the app.', { status: 400 });
  }

  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    return new Response(
      'Google did not return a refresh token. Remove this app at https://myaccount.google.com/permissions and try again.',
      { status: 400 },
    );
  }
  client.setCredentials(tokens);
  const { data } = await google.oauth2({ version: 'v2', auth: client }).userinfo.get();
  if (!data.email) return new Response('Google did not return an email address.', { status: 400 });

  const repo = getRepo();
  const accountId = repo.upsertAccount(data.email, tokens.refresh_token);
  await syncCalendars(repo, accountId, calendarFor(tokens.refresh_token));
  return redirectHome();
}
