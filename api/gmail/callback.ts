import { exchangeCode, GMAIL_SCOPE } from '../_lib/google.js';
import { check, db } from '../_lib/server.js';

/** Google redirects here after consent. Stores the refresh token and returns to the app. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (q: string) => Response.redirect(url.origin + '/?gmail=' + q, 302);
  try {
    if (url.searchParams.get('error')) return back('denied');
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || !state) return back('error');

    const rows = check(await db().from('gmail_oauth_states').delete().eq('state', state).select('user_id, created_at')) as { user_id: string; created_at: string }[];
    const st = rows[0];
    if (!st || Date.now() - new Date(st.created_at).getTime() > 15 * 60e3) return back('expired');

    const t = await exchangeCode(req, code);
    if (!t.scope.includes(GMAIL_SCOPE)) return back('scope');
    if (!t.refreshToken) return back('error');

    check(await db().from('gmail_tokens').upsert({ user_id: st.user_id, refresh_token: t.refreshToken, updated_at: new Date().toISOString() }));
    check(await db().from('gmail_connections').upsert({ user_id: st.user_id, google_email: t.email, connected_at: new Date().toISOString() }, { onConflict: 'user_id' }));
    return back('connected');
  } catch (e) {
    console.error(e);
    return back('error');
  }
}
