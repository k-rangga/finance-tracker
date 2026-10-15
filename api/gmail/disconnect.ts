import { check, db, handler, requireUser } from '../_lib/server.js';

/** POST → invalidate the connection key. Imported transactions are kept. */
export const POST = handler(async req => {
  const user = await requireUser(req);
  check(await db().from('gmail_connections').delete().eq('user_id', user.id));
  return Response.json({ ok: true });
});
