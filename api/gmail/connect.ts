import { randomBytes } from 'node:crypto';
import { consentUrl } from '../_lib/google.js';
import { check, db, handler, requireUser } from '../_lib/server.js';

/** POST → { url }: Google consent screen for read-only Gmail access. */
export const POST = handler(async req => {
  const user = await requireUser(req);
  const state = randomBytes(24).toString('base64url');
  // Drop stale states, then remember this one for the callback.
  check(await db().from('gmail_oauth_states').delete().lt('created_at', new Date(Date.now() - 15 * 60e3).toISOString()));
  check(await db().from('gmail_oauth_states').insert({ state, user_id: user.id }));
  return Response.json({ url: consentUrl(req, state) });
});
