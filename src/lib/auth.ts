import { KEYS, storage } from './storage';

/**
 * Auth boundary. Today it keeps a demo session in localStorage; Google sign-in
 * uses Google Identity Services when VITE_GOOGLE_CLIENT_ID is set (with the
 * Gmail read-only scope the receipt sync will need), otherwise it falls back to
 * the demo session so the app stays usable locally.
 */

export const isAuthed = () => storage.getRaw(KEYS.auth) !== '0';
export const setAuthed = (v: boolean) => storage.setRaw(KEYS.auth, v ? '1' : '0');

export async function signInWithPassword(email: string, password: string): Promise<void> {
  // Replace with a call to the real auth backend.
  void email;
  void password;
  setAuthed(true);
}

type TokenResponse = { access_token?: string; error?: string };
type GoogleOAuth = {
  accounts: {
    oauth2: {
      initTokenClient(cfg: { client_id: string; scope: string; callback: (r: TokenResponse) => void }): { requestAccessToken(): void };
      revoke(token: string, done?: () => void): void;
    };
  };
};

const GOOGLE_SCOPE = 'openid email profile https://www.googleapis.com/auth/gmail.readonly';
let googleToken: string | null = null;

function loadGis(): Promise<GoogleOAuth> {
  const w = window as unknown as { google?: GoogleOAuth };
  if (w.google?.accounts?.oauth2) return Promise.resolve(w.google);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => (w.google ? resolve(w.google) : reject(new Error('Google sign-in failed to load.')));
    s.onerror = () => reject(new Error('Google sign-in failed to load.'));
    document.head.appendChild(s);
  });
}

export async function signInWithGoogle(): Promise<void> {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
  if (!clientId) {
    setAuthed(true);
    return;
  }
  const google = await loadGis();
  await new Promise<void>((resolve, reject) => {
    google.accounts.oauth2
      .initTokenClient({
        client_id: clientId,
        scope: GOOGLE_SCOPE,
        callback: r => {
          if (r.error || !r.access_token) return reject(new Error('Google sign-in was cancelled.'));
          googleToken = r.access_token;
          resolve();
        },
      })
      .requestAccessToken();
  });
  setAuthed(true);
}

export function signOut() {
  const w = window as unknown as { google?: GoogleOAuth };
  if (googleToken && w.google) w.google.accounts.oauth2.revoke(googleToken);
  googleToken = null;
  setAuthed(false);
}
