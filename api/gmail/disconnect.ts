import { revoke } from '../_lib/google.js';
import { check, db, handler, requireUser } from '../_lib/server.js';

/** POST → revoke Gmail access and forget the token. Imported transactions are kept. */
export const POST = handler(async req => {
  const user = await requireUser(req);
  const tok = check(await db().from('gmail_tokens').select('refresh_token').eq('user_id', user.id).maybeSingle()) as { refresh_token: string } | null;
  if (tok) await revoke(tok.refresh_token);
  check(await db().from('gmail_tokens').delete().eq('user_id', user.id));
  check(await db().from('gmail_connections').delete().eq('user_id', user.id));
  return Response.json({ ok: true });
});
