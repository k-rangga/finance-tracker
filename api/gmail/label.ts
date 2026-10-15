import { check, db, handler, HttpError, requireUser } from '../_lib/server.js';

/** POST { name } → choose the label to import from; the script picks it up within ~10 minutes and imports. */
export const POST = handler(async req => {
  const user = await requireUser(req);
  const { name } = (await req.json().catch(() => ({}))) as { name?: string };
  if (!name) throw new HttpError(400, 'Choose a label.');
  const updated = check(
    await db().from('gmail_connections').update({ label_name: name, last_synced_at: null, sync_requested: true }).eq('user_id', user.id).select('user_id'),
  ) as unknown[];
  if (!updated.length) throw new HttpError(400, 'Link your Apps Script first.');
  return Response.json({ ok: true });
});
