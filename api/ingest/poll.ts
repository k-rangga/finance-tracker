import { check, db, handler } from '../_lib/server.js';
import { requireKey } from '../_lib/ingest.js';

const OVERLAP_DAYS = 2;

/**
 * Called by the Apps Script every 10 minutes and before each sync.
 * Body: { email, labels: string[] }. Returns what the script should do.
 */
export const POST = handler(async req => {
  const userId = await requireKey(req);
  const body = (await req.json().catch(() => ({}))) as { email?: string; labels?: unknown };
  const labels = Array.isArray(body.labels) ? body.labels.filter((l): l is string => typeof l === 'string').slice(0, 500) : [];
  const row = check(
    await db()
      .from('gmail_connections')
      .update({ labels, google_email: typeof body.email === 'string' ? body.email.slice(0, 200) : null, script_seen_at: new Date().toISOString() })
      .eq('user_id', userId)
      .select('label_name, last_synced_at, sync_requested')
      .single(),
  ) as { label_name: string | null; last_synced_at: string | null; sync_requested: boolean };
  const since = row.last_synced_at ? new Date(new Date(row.last_synced_at).getTime() - OVERLAP_DAYS * 864e5).toISOString() : null;
  return Response.json({ label: row.label_name, since, syncRequested: row.sync_requested });
});
