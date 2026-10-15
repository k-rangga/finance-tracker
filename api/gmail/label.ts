import { check, db, handler, HttpError, requireUser } from '../_lib/server.js';
import { syncUser } from '../_lib/sync.js';

/** POST { id, name } → choose the label to import from, then run a first sync. */
export const POST = handler(async req => {
  const user = await requireUser(req);
  const body = (await req.json().catch(() => ({}))) as { id?: string; name?: string };
  if (!body.id || !body.name) throw new HttpError(400, 'Choose a label.');
  const updated = check(
    await db().from('gmail_connections').update({ label_id: body.id, label_name: body.name, last_synced_at: null }).eq('user_id', user.id).select('user_id'),
  ) as unknown[];
  if (!updated.length) throw new HttpError(400, 'Connect Gmail first.');
  return Response.json(await syncUser(user.id));
});
