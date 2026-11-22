/** Where Google sends the user back after the consent screen: keep the connection, then back to the app. */
import { originOf } from '../../server/env.js';
import { connect, userFromState } from '../../server/google.js';

export async function GET(req: Request) {
  const origin = originOf(req);
  const q = new URL(req.url).searchParams;
  const back = (status: string) => Response.redirect(origin + '/?google=' + encodeURIComponent(status), 302);
  if (q.get('error')) return back(q.get('error') === 'access_denied' ? 'cancelled' : 'error');
  const userId = userFromState(q.get('state') || '');
  if (!userId || !q.get('code')) return back('expired');
  try {
    await connect(userId, q.get('code')!, origin);
    return back('connected');
  } catch (e) {
    console.error('google connect failed:', e instanceof Error ? e.message : e);
    return back('error');
  }
}
