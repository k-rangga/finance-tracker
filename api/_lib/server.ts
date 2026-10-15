import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Read a server env var, trimming whitespace and stray quotes that pasting can add. */
export function env(name: string): string {
  const v = process.env[name]?.trim().replace(/^["']|["']$/g, '').trim();
  if (!v) throw new HttpError(500, `Server is missing ${name}.`);
  return v;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

let admin: SupabaseClient | null = null;
/** Service-role client: bypasses row-level security, server only. */
export function db(): SupabaseClient {
  admin ??= createClient(env('SUPABASE_URL'), process.env.SUPABASE_SERVICE_ROLE_KEY || env('SUPABASE_SECRET_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}

/** Resolve the signed-in user from the `Authorization: Bearer <supabase access token>` header. */
export async function requireUser(req: Request): Promise<{ id: string; email: string | null }> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'Sign in first.');
  const { data, error } = await db().auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'Your session has expired. Sign in again.');
  return { id: data.user.id, email: data.user.email ?? null };
}

/** Wrap a handler: JSON errors, no caching. */
export function handler(fn: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    try {
      const res = await fn(req);
      res.headers.set('cache-control', 'no-store');
      return res;
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      const message = e instanceof Error ? e.message : 'Unexpected error.';
      if (status >= 500) console.error(e);
      return Response.json({ error: message }, { status, headers: { 'cache-control': 'no-store' } });
    }
  };
}

export function check<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new HttpError(500, r.error.message);
  return r.data;
}
