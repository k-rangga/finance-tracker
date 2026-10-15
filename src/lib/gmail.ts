import { accessToken } from './auth';

export type GmailLabel = { id: string; name: string; system: boolean };
export type SyncResult = { imported: number; skipped: number; scanned: number };

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch('/api/gmail/' + path, {
    ...init,
    headers: { authorization: 'Bearer ' + (await accessToken()), 'content-type': 'application/json', ...init.headers },
  });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status}).`);
  return j;
}

/** Starts Google consent; the browser comes back to /?gmail=connected. */
export async function connectGmail() {
  const { url } = await api<{ url: string }>('connect', { method: 'POST' });
  window.location.assign(url);
}

export const listLabels = () => api<{ labels: GmailLabel[] }>('labels').then(r => r.labels);
export const chooseLabel = (l: GmailLabel) => api<SyncResult>('label', { method: 'POST', body: JSON.stringify({ id: l.id, name: l.name }) });
export const syncNow = () => api<SyncResult>('sync', { method: 'POST' });
export const disconnectGmail = () => api<{ ok: true }>('disconnect', { method: 'POST' });

/** Message for the `?gmail=` value the OAuth callback redirects with. */
export const CALLBACK_MESSAGES: Record<string, string> = {
  connected: 'Gmail connected. Choose the label that holds your receipts.',
  denied: 'Gmail access was not granted.',
  expired: 'That sign-in link expired. Try connecting again.',
  scope: 'Gmail read access is needed to import receipts. Tick the Gmail box on the Google screen.',
  error: 'Connecting Gmail failed. Try again.',
};
