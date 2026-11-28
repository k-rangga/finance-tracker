/**
 * Release any email currently held by a deactivated (`inactive` / banned) Auth user
 * so the same person can create a brand-new `user_id` with that email while keeping
 * the archived account & learnings untouched. Always responds `{ ok: true }` to avoid
 * leaking whether an email existed.
 */
import { releaseInactiveEmail } from '../../server/account.js';
import { json } from '../../server/env.js';

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { email?: unknown };
    const email = typeof body.email === 'string' ? body.email : '';
    if (email) await releaseInactiveEmail(email);
  } catch {
    /* keep endpoint idempotent and non-enumerating */
  }
  return json({ ok: true });
}
