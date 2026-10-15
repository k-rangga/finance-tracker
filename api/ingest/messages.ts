import { check, db, handler, HttpError } from '../_lib/server.js';
import { requireKey } from '../_lib/ingest.js';
import { parseReceipt } from '../_lib/parse.js';

type Msg = { id: string; date: string; subject?: string; from?: string; body?: string };

/**
 * The Apps Script posts receipts in batches. Body: { messages: Msg[], done?: boolean, scanned?: number }.
 * On the final batch (`done`) the sync status is recorded and any pending "Sync now" request is cleared.
 */
export const POST = handler(async req => {
  const userId = await requireKey(req);
  const body = (await req.json().catch(() => ({}))) as { messages?: Msg[]; done?: boolean; scanned?: number; error?: string };
  if (body.error) {
    check(await db().from('gmail_connections').update({ last_sync_status: 'error: ' + String(body.error).slice(0, 200), sync_requested: false }).eq('user_id', userId));
    return Response.json({ ok: true });
  }
  const messages = Array.isArray(body.messages) ? body.messages.slice(0, 100) : [];
  const rows: Record<string, unknown>[] = [];
  let skipped = 0;
  for (const m of messages) {
    if (typeof m?.id !== 'string' || !m.id || Number.isNaN(Date.parse(m.date))) throw new HttpError(400, 'Each message needs an id and date.');
    const subject = String(m.subject ?? '');
    const from = String(m.from ?? '');
    const p = parseReceipt({ subject, from, text: String(m.body ?? '').slice(0, 20000) });
    if (!p) {
      skipped++;
      continue;
    }
    rows.push({
      user_id: userId,
      id: m.id.slice(0, 64),
      occurred_at: new Date(m.date).toISOString(),
      title: p.title,
      category: p.category,
      amount: p.amount,
      currency: p.currency,
      source: p.source,
      sender: from.slice(0, 200),
      subject: subject.slice(0, 300),
    });
  }
  // ignoreDuplicates keeps a message's first parse; the user's category fixes live in transaction_overrides.
  if (rows.length) check(await db().from('transactions').upsert(rows, { onConflict: 'user_id,id', ignoreDuplicates: true }));
  if (body.done) {
    check(
      await db()
        .from('gmail_connections')
        .update({ last_synced_at: new Date().toISOString(), last_sync_status: 'ok', last_sync_count: Number(body.scanned) || 0, sync_requested: false })
        .eq('user_id', userId),
    );
  }
  return Response.json({ imported: rows.length, skipped });
});
