/**
 * The Vercel version's sign-in (Supabase, by email link). Only set up when the build has the project's URL and
 * publishable key (Vercel's environment variables); the Apps Script build has neither and signs in through Google.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

/** True on Vercel: data goes through /api/rpc, and you sign in by email. */
export const onVercel = !!(url && key);

export const supabase: SupabaseClient | null = onVercel ? createClient(url!, key!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;

/** The current session's token for /api/rpc, or null when signed out. */
export async function accessToken() {
  const { data } = await supabase!.auth.getSession();
  return data.session?.access_token ?? null;
}

/** Call an action on the Vercel server (same actions as Apps Script's `api`). */
export async function rpc<T>(action: string, payload: unknown): Promise<T> {
  const token = await accessToken();
  if (!token) throw new Error('signed_out');
  const r = await fetch('/api/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ action, payload }),
  });
  const out = (await r.json().catch(() => ({ ok: false, error: `Server error ${r.status}` }))) as { ok: boolean; result?: T; error?: string };
  if (r.status === 401) {
    await supabase!.auth.signOut();
    location.reload();
  }
  if (!out.ok) throw new Error(out.error || 'Something went wrong.');
  return out.result as T;
}
