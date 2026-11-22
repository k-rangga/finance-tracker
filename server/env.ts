/** Server settings, from Vercel's environment variables. */
export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}: add it in Vercel → Settings → Environment Variables.`);
  return v;
}

export const supabaseUrl = () => env('SUPABASE_URL').replace(/\/$/, '');
export const serviceKey = () => env('SUPABASE_SERVICE_ROLE_KEY');

/** Supabase's REST API with the server key (bypasses row security, so every call must name the user). */
export async function admin(path: string, init: RequestInit = {}) {
  const key = serviceKey();
  const r = await fetch(supabaseUrl() + '/rest/v1/' + path, {
    ...init,
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error('Database error ' + r.status + ': ' + (await r.text()).slice(0, 300));
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

/** The app's own address, for Google's redirect back. */
export const originOf = (req: Request) => {
  const u = new URL(req.url);
  const host = req.headers.get('x-forwarded-host') || u.host;
  const proto = req.headers.get('x-forwarded-proto') || u.protocol.replace(':', '');
  return `${proto}://${host}`;
};
