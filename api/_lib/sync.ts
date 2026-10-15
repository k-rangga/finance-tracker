import { accessToken, gmail, header, messageText, type GmailMessage } from './google.js';
import { parseReceipt } from './parse.js';
import { check, db, HttpError } from './server.js';

const MAX_MESSAGES = 400;
const FIRST_SYNC_DAYS = 62; // covers this pay cycle and the previous one
const OVERLAP_DAYS = 2;

export type SyncResult = { imported: number; skipped: number; scanned: number };

/** Import receipts under the user's chosen label since the last sync. */
export async function syncUser(userId: string): Promise<SyncResult> {
  const conn = check(await db().from('gmail_connections').select('label_id, label_name, last_synced_at').eq('user_id', userId).maybeSingle()) as {
    label_id: string | null;
    last_synced_at: string | null;
  } | null;
  if (!conn) throw new HttpError(400, 'Connect Gmail first.');
  if (!conn.label_id) throw new HttpError(400, 'Choose a Gmail label to sync.');
  const tok = check(await db().from('gmail_tokens').select('refresh_token').eq('user_id', userId).maybeSingle()) as { refresh_token: string } | null;
  if (!tok) throw new HttpError(400, 'Connect Gmail again.');

  const status = async (s: string, count: number | null, synced: boolean) =>
    check(
      await db()
        .from('gmail_connections')
        .update({ last_sync_status: s, last_sync_count: count, ...(synced ? { last_synced_at: new Date().toISOString() } : {}) })
        .eq('user_id', userId),
    );

  try {
    const token = await accessToken(tok.refresh_token);
    const since = conn.last_synced_at ? new Date(conn.last_synced_at).getTime() - OVERLAP_DAYS * 864e5 : Date.now() - FIRST_SYNC_DAYS * 864e5;

    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const page = await gmail<{ messages?: { id: string }[]; nextPageToken?: string }>(token, 'messages', {
        labelIds: conn.label_id,
        q: `after:${Math.floor(since / 1000)}`,
        maxResults: 100,
        pageToken,
      });
      ids.push(...(page.messages ?? []).map(m => m.id));
      pageToken = page.nextPageToken;
    } while (pageToken && ids.length < MAX_MESSAGES);

    const rows: Record<string, unknown>[] = [];
    let skipped = 0;
    for (let i = 0; i < Math.min(ids.length, MAX_MESSAGES); i += 10) {
      const batch = await Promise.all(ids.slice(i, i + 10).map(id => gmail<GmailMessage>(token, 'messages/' + id, { format: 'full' })));
      for (const m of batch) {
        const subject = header(m, 'Subject');
        const from = header(m, 'From');
        const p = parseReceipt({ subject, from, text: messageText(m) || m.snippet || '' });
        if (!p) {
          skipped++;
          continue;
        }
        rows.push({
          user_id: userId,
          id: m.id,
          occurred_at: new Date(Number(m.internalDate)).toISOString(),
          title: p.title,
          category: p.category,
          amount: p.amount,
          currency: p.currency,
          source: p.source,
          sender: from.slice(0, 200),
          subject: subject.slice(0, 300),
        });
      }
    }
    // ignoreDuplicates keeps a message's first parse; the user's category fixes live in transaction_overrides.
    if (rows.length) check(await db().from('transactions').upsert(rows, { onConflict: 'user_id,id', ignoreDuplicates: true }));
    const result = { imported: rows.length, skipped, scanned: ids.length };
    await status('ok', rows.length, true);
    return result;
  } catch (e) {
    await status('error: ' + (e instanceof Error ? e.message : String(e)).slice(0, 200), null, false);
    throw e;
  }
}
