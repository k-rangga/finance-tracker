import { accessToken, gmail, type GmailLabel } from '../_lib/google.js';
import { check, db, handler, HttpError, requireUser } from '../_lib/server.js';

/** GET → { labels }: the user's Gmail labels, user labels first. */
export const GET = handler(async req => {
  const user = await requireUser(req);
  const tok = check(await db().from('gmail_tokens').select('refresh_token').eq('user_id', user.id).maybeSingle()) as { refresh_token: string } | null;
  if (!tok) throw new HttpError(400, 'Connect Gmail first.');
  const { labels = [] } = await gmail<{ labels?: GmailLabel[] }>(await accessToken(tok.refresh_token), 'labels');
  const hidden = /^(CHAT|DRAFT|SPAM|TRASH|SENT|UNREAD|STARRED|IMPORTANT|CATEGORY_FORUMS)$/;
  const list = labels
    .filter(l => !hidden.test(l.id))
    .map(l => ({ id: l.id, name: l.type === 'system' ? l.name.replace(/^CATEGORY_/, '').toLowerCase().replace(/^\w/, c => c.toUpperCase()) : l.name, system: l.type === 'system' }))
    .sort((a, b) => Number(a.system) - Number(b.system) || a.name.localeCompare(b.name));
  return Response.json({ labels: list });
});
