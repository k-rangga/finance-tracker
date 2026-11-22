/**
 * The app's one endpoint: POST { action, payload } with the user's Supabase session, answered by the same
 * actions as Apps Script's `api(action, payload)`. Replies { ok: true, result } or { ok: false, error }.
 */
import { userFromRequest } from '../server/auth.js';
import { json, originOf } from '../server/env.js';
import { authUrl, disconnect } from '../server/google.js';
import { quotes } from '../server/quotes.js';
import { runForUser } from '../server/run.js';

export async function POST(req: Request) {
  try {
    const user = await userFromRequest(req);
    if (!user) return json({ ok: false, error: 'signed_out' }, 401);
    const { action, payload } = (await req.json()) as { action: string; payload?: Record<string, unknown> };
    if (!action || typeof action !== 'string') return json({ ok: false, error: 'No action.' }, 400);

    // Answered here instead of by the Apps Script code.
    if (action === 'quotes') return json({ ok: true, result: await quotes((payload?.items as { tk: string; mk: string }[]) || []) });
    if (action === 'googleConnectUrl') return json({ ok: true, result: { url: authUrl(user.id, originOf(req)) } });
    if (action === 'googleDisconnect') {
      await disconnect(user.id);
      return json({ ok: true, result: true });
    }

    return json({ ok: true, result: await runForUser(user, action, payload) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('rpc failed:', msg);
    return json({ ok: false, error: msg }, 500);
  }
}
