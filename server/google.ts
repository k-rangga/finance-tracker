/**
 * Each user's Google connection, for reading their Gmail receipt label/queries and (optionally) saving receipt
 * files to Drive via the narrow `drive.file` scope.
 * - Initial connect requests ONLY `openid email gmail.readonly` (no blanket Google Drive access).
 * - Refresh tokens stored in `public.google_tokens` are encrypted at rest with AES-256-GCM.
 * - Disconnecting revokes the token directly at Google before deleting the local Supabase row.
 */
import crypto from 'node:crypto';
import { admin, env, serviceKey } from './env.js';

export const GOOGLE_GMAIL_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/gmail.readonly'];
export const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const GOOGLE_SCOPES = GOOGLE_GMAIL_SCOPES;
const STATE_MAX_AGE_MS = 15 * 60 * 1000;
const TOKEN_PREFIX = 'enc:v1:';

const tokenSecret = () => process.env.TOKEN_ENCRYPTION_KEY || serviceKey();
const stateKey = () => crypto.createHash('sha256').update('maxie-oauth-state:' + (process.env.OAUTH_STATE_SECRET || tokenSecret())).digest();
const deriveAesKey = (secret: string) => crypto.createHash('sha256').update('maxie-google-token-v1:' + secret).digest();

const sign = (s: string) => crypto.createHmac('sha256', stateKey()).update(s).digest('base64url');
const redirectUri = (origin: string) => origin + '/api/google/callback';

/** Encrypt a Google refresh token with AES-256-GCM (`enc:v1:<iv>:<tag>:<ciphertext>`). */
export function encryptToken(plain: string, secret = tokenSecret()): string {
  const key = deriveAesKey(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${TOKEN_PREFIX}${iv.toString('base64url')}:${tag.toString('base64url')}:${ct.toString('base64url')}`;
}

/**
 * Decrypt a stored token. Supports legacy plaintext rows (`needsReencrypt: true`) and key rotation via `fallbackSecret`.
 */
export function decryptToken(
  stored: string,
  secret?: string,
  fallbackSecret?: string,
): { value: string; needsReencrypt: boolean } {
  const raw = String(stored || '');
  if (!raw.startsWith(TOKEN_PREFIX)) {
    return { value: raw, needsReencrypt: Boolean(raw) };
  }
  const body = raw.slice(TOKEN_PREFIX.length);
  const parts = body.split(':');
  if (parts.length !== 3) throw new Error('Malformed encrypted token');
  const [ivB64, tagB64, ctB64] = parts;
  const iv = Buffer.from(ivB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  const ct = Buffer.from(ctB64, 'base64url');

  const tryDecrypt = (sec: string) => {
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveAesKey(sec), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  };

  const primary = secret ?? tokenSecret();
  try {
    return { value: tryDecrypt(primary), needsReencrypt: false };
  } catch (e) {
    const fallback = fallbackSecret ?? (process.env.TOKEN_ENCRYPTION_KEY ? serviceKey() : undefined);
    if (fallback && fallback !== primary) {
      return { value: tryDecrypt(fallback), needsReencrypt: true };
    }
    throw e;
  }
}

/** Google's consent screen for this user; `state` proves the answer comes back for the same user. */
export function authUrl(userId: string, origin: string, opts?: { includeDrive?: boolean }) {
  const scopes = opts?.includeDrive ? [...GOOGLE_GMAIL_SCOPES, GOOGLE_DRIVE_SCOPE] : GOOGLE_GMAIL_SCOPES;
  const payload = Buffer.from(JSON.stringify({ u: userId, t: Date.now() })).toString('base64url');
  const q = new URLSearchParams({
    client_id: env('GOOGLE_CLIENT_ID'),
    redirect_uri: redirectUri(origin),
    response_type: 'code',
    scope: scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: payload + '.' + sign(payload),
  });
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + q;
}

/** The user a `state` was made for, or null when it's forged or too old. */
export function userFromState(state: string): string | null {
  const [payload, mac] = String(state || '').split('.');
  if (!payload || !mac) return null;
  const want = sign(payload);
  if (want.length !== mac.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(mac))) return null;
  const { u, t } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { u: string; t: number };
  return Date.now() - t < STATE_MAX_AGE_MS ? u : null;
}

async function tokenCall(params: Record<string, string>) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET'), ...params }),
  });
  const data = (await r.json()) as { access_token?: string; refresh_token?: string; id_token?: string; scope?: string; error?: string; error_description?: string };
  return { ok: r.ok, data };
}

/** Finish connecting: swap Google's code for tokens and store an AES-256-GCM encrypted refresh token. */
export async function connect(userId: string, code: string, origin: string) {
  const { ok, data } = await tokenCall({ code, grant_type: 'authorization_code', redirect_uri: redirectUri(origin) });
  if (!ok || !data.access_token) throw new Error('Google: ' + (data.error_description || data.error || 'no token'));
  if (!data.refresh_token) throw new Error('Google sent no refresh token. Remove the app at myaccount.google.com/permissions and connect again.');
  // The id_token came straight from Google over TLS; its email names the account that was connected.
  const email = data.id_token ? (JSON.parse(Buffer.from(data.id_token.split('.')[1], 'base64url').toString('utf8')).email as string) : '';
  await admin('google_tokens?on_conflict=user_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([
      {
        user_id: userId,
        email,
        refresh_token: encryptToken(data.refresh_token),
        scope: data.scope || '',
        updated_at: new Date().toISOString(),
      },
    ]),
  });
}

export async function googleConnectionInfo(
  userId: string,
): Promise<{ connected: boolean; scope: string; hasDrive: boolean; encrypted: boolean }> {
  const rows = (await admin(
    `google_tokens?user_id=eq.${encodeURIComponent(userId)}&select=user_id,scope,refresh_token`,
  )) as { user_id: string; scope?: string | null; refresh_token?: string | null }[];
  if (!rows.length) return { connected: false, scope: '', hasDrive: false, encrypted: false };
  const scope = rows[0].scope || '';
  const hasDrive = /auth\/drive(\.file)?\b/.test(scope);
  const encrypted = String(rows[0].refresh_token || '').startsWith(TOKEN_PREFIX);
  return { connected: true, scope, hasDrive, encrypted };
}

export async function hasGoogle(userId: string) {
  return (await googleConnectionInfo(userId)).connected;
}

/** A fresh access token for the user's Gmail (and Drive if granted), or null when disconnected/revoked. */
export async function accessToken(userId: string): Promise<{ token: string; email: string } | null> {
  const rows = (await admin(`google_tokens?user_id=eq.${encodeURIComponent(userId)}&select=email,refresh_token`)) as { email: string; refresh_token: string }[];
  if (!rows.length) return null;
  let plainToken = '';
  let needsReencrypt = false;
  try {
    const dec = decryptToken(rows[0].refresh_token);
    plainToken = dec.value;
    needsReencrypt = dec.needsReencrypt;
  } catch {
    return null;
  }
  const { ok, data } = await tokenCall({ refresh_token: plainToken, grant_type: 'refresh_token' });
  if (!ok || !data.access_token) {
    // Revoked or expired: forget it, so the page asks to connect again.
    if (data.error === 'invalid_grant') await disconnect(userId);
    return null;
  }
  if (needsReencrypt) {
    // Auto-upgrade legacy plaintext or rotated rows seamlessly in the background.
    admin(`google_tokens?user_id=eq.${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ refresh_token: encryptToken(plainToken), updated_at: new Date().toISOString() }),
    }).catch(() => {});
  }
  return { token: data.access_token, email: rows[0].email };
}

/** Revoke the OAuth token directly at Google (best-effort) before deleting it from Supabase. */
export async function disconnect(userId: string) {
  try {
    const rows = (await admin(`google_tokens?user_id=eq.${encodeURIComponent(userId)}&select=refresh_token`)) as { refresh_token: string }[];
    if (rows.length && rows[0].refresh_token) {
      const { value: plainToken } = decryptToken(rows[0].refresh_token);
      if (plainToken) {
        await fetch('https://oauth2.googleapis.com/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: plainToken }),
        });
      }
    }
  } catch {
    // Never block local removal if Google already revoked the token or network fails.
  }
  await admin(`google_tokens?user_id=eq.${encodeURIComponent(userId)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
}
