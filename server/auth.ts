import { serviceKey, supabaseUrl } from './env.js';

export type User = { id: string; email: string };

/** The signed-in user, from the Supabase session token the page sends; null when signed out or expired. */
export async function userFromRequest(req: Request): Promise<User | null> {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const r = await fetch(supabaseUrl() + '/auth/v1/user', { headers: { apikey: serviceKey(), Authorization: 'Bearer ' + token } });
  if (!r.ok) return null;
  const u = (await r.json()) as { id?: string; email?: string };
  if (!u.id) return null;
  // ALLOWED_EMAILS (comma-separated), when set, is who may use the app (and your Gemini key).
  const allowed = (process.env.ALLOWED_EMAILS || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  if (allowed.length && !allowed.includes((u.email || '').toLowerCase())) return null;
  return { id: u.id, email: u.email || '' };
}
