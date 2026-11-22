/**
 * The hourly job, called by Supabase (pg_cron) with `Authorization: Bearer <CRON_SECRET>`: for each user, the
 * Hyperliquid sync every few hours and the Gmail import at the usual hours (or to finish one that ran out of time).
 */
import { admin, env, json } from '../server/env.js';
import { hourlyForUser } from '../server/run.js';

/** Each user's share of the run; whatever's left of an import continues next hour. */
const PER_USER_MS = 60_000;
const RUN_MS = 270_000;

async function handle(req: Request) {
  if ((req.headers.get('authorization') || '') !== 'Bearer ' + env('CRON_SECRET')) return json({ ok: false }, 401);
  const started = Date.now();
  // Everyone who has used the app (settings saved) or connected Google.
  const [props, tokens] = await Promise.all([
    admin('props?key=eq.settings&select=user_id') as Promise<{ user_id: string }[]>,
    admin('google_tokens?select=user_id') as Promise<{ user_id: string }[]>,
  ]);
  const ids = [...new Set([...props, ...tokens].map(r => r.user_id))];
  const done: Record<string, string> = {};
  for (const id of ids) {
    if (Date.now() - started > RUN_MS - PER_USER_MS) {
      done[id] = 'next hour';
      continue;
    }
    try {
      // The email only labels the Gmail status; the user's Google email is used when connected.
      await hourlyForUser({ id, email: '' }, PER_USER_MS);
      done[id] = 'ok';
    } catch (e) {
      done[id] = 'error: ' + (e instanceof Error ? e.message : String(e)).slice(0, 200);
    }
  }
  return json({ ok: true, users: ids.length, done });
}

export const GET = handle;
export const POST = handle;
