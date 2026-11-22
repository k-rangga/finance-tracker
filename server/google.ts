/**
 * Each user's Google connection, for reading their Gmail receipt label and their Drive receipts folder.
 * The page sends the user to Google's consent screen (authUrl); Google sends them back to /api/google/callback
 * with a code, which becomes a refresh token kept in google_tokens (only the server reads it). Each request that
 * needs Gmail or Drive trades it for a short-lived access token.
 */
import crypto from 'node:crypto';
import { admin, env, serviceKey } from './env.js';

export const GOOGLE_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/drive'];
const STATE_MAX_AGE_MS = 15 * 60 * 1000;

const sign = (s: string) => crypto.createHmac('sha256', serviceKey()).update(s).digest('base64url');
const redirectUri = (origin: string) => origin + '/api/google/callback';

/** Google's consent screen for this user; `state` proves the answer comes back for the same user. */
export function authUrl(userId: string, origin: string) {
  const payload = Buffer.from(JSON.stringify({ u: userId, t: Date.now() })).toString('base64url');
  const q = new URLSearchParams({
    client_id: env('GOOGLE_CLIENT_ID'),
    redirect_uri: redirectUri(origin),
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
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

/** Finish connecting: swap Google's code for tokens and keep the refresh token. */
export async function connect(userId: string, code: string, origin: string) {
  const { ok, data } = await tokenCall({ code, grant_type: 'authorization_code', redirect_uri: redirectUri(origin) });
  if (!ok || !data.access_token) throw new Error('Google: ' + (data.error_description || data.error || 'no token'));
  if (!data.refresh_token) throw new Error('Google sent no refresh token. Remove the app at myaccount.google.com/permissions and connect again.');
  // The id_token came straight from Google over TLS; its email names the account that was connected.
  const email = data.id_token ? (JSON.parse(Buffer.from(data.id_token.split('.')[1], 'base64url').toString('utf8')).email as string) : '';
  await admin('google_tokens?on_conflict=user_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ user_id: userId, email, refresh_token: data.refresh_token, scope: data.scope || '', updated_at: new Date().toISOString() }]),
  });
}

export async function hasGoogle(userId: string) {
  const rows = (await admin(`google_tokens?user_id=eq.${encodeURIComponent(userId)}&select=user_id`)) as unknown[];
  return rows.length > 0;
}

/** A fresh access token for the user's Gmail and Drive, or null when they haven't connected (or revoked it). */
export async function accessToken(userId: string): Promise<{ token: string; email: string } | null> {
  const rows = (await admin(`google_tokens?user_id=eq.${encodeURIComponent(userId)}&select=email,refresh_token`)) as { email: string; refresh_token: string }[];
  if (!rows.length) return null;
  const { ok, data } = await tokenCall({ refresh_token: rows[0].refresh_token, grant_type: 'refresh_token' });
  if (!ok || !data.access_token) {
    // Revoked or expired: forget it, so the page asks to connect again.
    if (data.error === 'invalid_grant') await disconnect(userId);
    return null;
  }
  return { token: data.access_token, email: rows[0].email };
}

export async function disconnect(userId: string) {
  await admin(`google_tokens?user_id=eq.${encodeURIComponent(userId)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
}
