import { env, HttpError } from './server.js';

export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

export function redirectUri(req: Request): string {
  return process.env.GOOGLE_REDIRECT_URI || new URL(req.url).origin + '/api/gmail/callback';
}

/** The client ID, checked for shape so a bad paste fails here with a clear message instead of Google's invalid_client. */
export function clientId(): string {
  const id = env('GOOGLE_CLIENT_ID');
  if (!/^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(id)) {
    const hint = id.startsWith('GOCSPX')
      ? 'it looks like the client secret, not the ID'
      : !id.endsWith('.apps.googleusercontent.com')
        ? 'it should end with .apps.googleusercontent.com'
        : !/^\d+-/.test(id)
          ? 'it should start with the project number and a dash'
          : 'it contains unexpected characters';
    throw new HttpError(500, `GOOGLE_CLIENT_ID looks wrong (${id.length} characters; ${hint}). Copy the full Client ID from Google Cloud and save it again.`);
  }
  return id;
}

function clientSecret(): string {
  const s = env('GOOGLE_CLIENT_SECRET');
  if (s.endsWith('.apps.googleusercontent.com'))
    throw new HttpError(500, 'GOOGLE_CLIENT_SECRET looks like the client ID, not the secret. Save the Client secret (starts with GOCSPX-) from Google Cloud.');
  return s;
}

export function consentUrl(req: Request, state: string): string {
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.search = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(req),
    response_type: 'code',
    scope: `openid email ${GMAIL_SCOPE}`,
    access_type: 'offline',
    prompt: 'consent',
    state,
  }).toString();
  return u.toString();
}

type TokenResponse = { access_token: string; refresh_token?: string; id_token?: string; scope?: string; error?: string; error_description?: string };

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId(), client_secret: clientSecret(), ...body }),
  });
  const j = (await r.json()) as TokenResponse;
  if (!r.ok || j.error) {
    const msg = j.error === 'invalid_grant' ? 'Gmail access was revoked or expired. Connect Gmail again.' : j.error_description || j.error || 'Google token request failed.';
    throw new HttpError(j.error === 'invalid_grant' ? 401 : 502, msg);
  }
  return j;
}

export async function exchangeCode(req: Request, code: string) {
  const t = await tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: redirectUri(req) });
  let email: string | null = null;
  if (t.id_token) {
    // Received directly from Google's token endpoint over TLS, so the payload can be read without verifying.
    const payload = JSON.parse(Buffer.from(t.id_token.split('.')[1], 'base64url').toString('utf8')) as { email?: string };
    email = payload.email ?? null;
  }
  return { refreshToken: t.refresh_token, email, scope: t.scope ?? '' };
}

export async function accessToken(refreshToken: string): Promise<string> {
  return (await tokenRequest({ refresh_token: refreshToken, grant_type: 'refresh_token' })).access_token;
}

export async function revoke(token: string) {
  await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(token), { method: 'POST' }).catch(() => undefined);
}

export async function gmail<T>(token: string, path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const u = new URL('https://gmail.googleapis.com/gmail/v1/users/me/' + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, String(v));
  const r = await fetch(u, { headers: { authorization: 'Bearer ' + token } });
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new HttpError(r.status === 401 || r.status === 403 ? 401 : 502, 'Gmail: ' + (j.error?.message ?? r.statusText));
  }
  return (await r.json()) as T;
}

export type GmailLabel = { id: string; name: string; type: 'system' | 'user'; messagesTotal?: number };

export type GmailPart = { mimeType?: string; body?: { data?: string; size?: number }; parts?: GmailPart[]; headers?: { name: string; value: string }[] };
export type GmailMessage = { id: string; internalDate: string; snippet?: string; payload?: GmailPart };

const decode = (data: string) => Buffer.from(data, 'base64url').toString('utf8');

/** Plain text of a message: text/plain parts if any, else text/html with tags stripped. */
export function messageText(m: GmailMessage): string {
  const plain: string[] = [];
  const html: string[] = [];
  const walk = (p?: GmailPart) => {
    if (!p) return;
    if (p.body?.data) {
      if (p.mimeType === 'text/plain') plain.push(decode(p.body.data));
      else if (p.mimeType === 'text/html') html.push(decode(p.body.data));
    }
    p.parts?.forEach(walk);
  };
  walk(m.payload);
  if (plain.length) return plain.join('\n');
  return html
    .join('\n')
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|td|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, ' ');
}

export const header = (m: GmailMessage, name: string) => m.payload?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
