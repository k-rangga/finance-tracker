import { check, db, handler, HttpError, requireUser } from '../_lib/server.js';

/** POST → ask the Apps Script to sync on its next check (within ~10 minutes). */
export const POST = handler(async req => {
  const user = await requireUser(req);
  const updated = check(await db().from('gmail_connections').update({ sync_requested: true }).eq('user_id', user.id).select('user_id')) as unknown[];
  if (!updated.length) throw new HttpError(400, 'Link your Apps Script first.');
  return Response.json({ ok: true });
});
