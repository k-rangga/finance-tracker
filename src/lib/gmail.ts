import { accessToken } from './auth';

/** The Apps Script project that reads Gmail and posts receipts to /api/ingest. */
export const SCRIPT_ID = (import.meta.env.VITE_APPS_SCRIPT_ID as string | undefined) || '1cc9XbesHR8YwZagOgEeqrwIli9SIn4jXUwPu0ak-uSFWZ8pAaoTZFZ0m';
export const SCRIPT_URL = `https://script.google.com/d/${SCRIPT_ID}/edit`;

async function api<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch('/api/gmail/' + path, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + (await accessToken()), 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status}).`);
  return j;
}

/** New connection key for the INGEST_KEY script property; replaces any previous key. */
export const createKey = () => api<{ key: string }>('key').then(r => r.key);
export const chooseLabel = (name: string) => api<{ ok: true }>('label', { name });
export const requestSync = () => api<{ ok: true }>('sync');
export const disconnectGmail = () => api<{ ok: true }>('disconnect');
