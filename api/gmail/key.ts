import { check, db, handler, requireUser } from '../_lib/server.js';
import { hashKey, newKey } from '../_lib/ingest.js';

/** POST → { key }: a new connection key for the Apps Script. Shown once; replaces any previous key. */
export const POST = handler(async req => {
  const user = await requireUser(req);
  const key = newKey();
  check(await db().from('gmail_connections').upsert({ user_id: user.id, key_hash: hashKey(key), connected_at: new Date().toISOString() }, { onConflict: 'user_id' }));
  return Response.json({ key });
});
