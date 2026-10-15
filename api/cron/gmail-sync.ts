import { check, db, env, handler, HttpError } from '../_lib/server.js';
import { syncUser } from '../_lib/sync.js';

/** Daily Vercel Cron (see vercel.json): sync every user who has chosen a label. */
export const GET = handler(async req => {
  if (req.headers.get('authorization') !== `Bearer ${env('CRON_SECRET')}`) throw new HttpError(401, 'Unauthorized');
  const users = check(await db().from('gmail_connections').select('user_id').not('label_id', 'is', null)) as { user_id: string }[];
  const results: Record<string, string> = {};
  for (const u of users) {
    try {
      const r = await syncUser(u.user_id);
      results[u.user_id] = `imported ${r.imported}, skipped ${r.skipped}`;
    } catch (e) {
      results[u.user_id] = 'error: ' + (e instanceof Error ? e.message : String(e));
    }
  }
  return Response.json({ users: users.length, results });
});
