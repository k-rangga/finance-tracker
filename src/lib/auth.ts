import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { KEYS, storage } from './storage';

/**
 * Auth boundary. With Supabase configured this is real accounts (email +
 * password, Google). Without it, a demo session kept in localStorage.
 */

export type User = { id: string; email: string | null };

const LOCAL_USER: User = { id: 'local', email: null };

/** undefined while the session is being restored, null when signed out. */
export function useUser(): User | null | undefined {
  const [user, setUser] = useState<User | null | undefined>(() => (supabase ? undefined : storage.getRaw(KEYS.auth) !== '0' ? LOCAL_USER : null));

  useEffect(() => {
    if (!supabase) {
      const onChange = () => setUser(storage.getRaw(KEYS.auth) !== '0' ? LOCAL_USER : null);
      window.addEventListener('mt-auth', onChange);
      return () => window.removeEventListener('mt-auth', onChange);
    }
    const toUser = (s: { user: { id: string; email?: string | null } } | null) => (s ? { id: s.user.id, email: s.user.email ?? null } : null);
    supabase.auth.getSession().then(({ data }) => setUser(toUser(data.session)));
    const { data } = supabase.auth.onAuthStateChange((_e, session) => setUser(prev => (prev?.id === session?.user.id ? prev : toUser(session))));
    return () => data.subscription.unsubscribe();
  }, []);

  return user;
}

const setLocal = (v: boolean) => {
  storage.setRaw(KEYS.auth, v ? '1' : '0');
  window.dispatchEvent(new Event('mt-auth'));
};

export const isDemoAuth = () => !supabase;

export async function signInWithPassword(email: string, password: string): Promise<void> {
  if (!supabase) return setLocal(true);
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Email or password is incorrect.' : error.message);
}

/** Returns true when the account still needs its email confirmed. */
export async function signUp(email: string, password: string): Promise<boolean> {
  if (!supabase) {
    setLocal(true);
    return false;
  }
  const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
  if (error) throw new Error(error.message);
  return !data.session;
}

export async function signInWithGoogle(): Promise<void> {
  if (!supabase) return setLocal(true);
  const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
  if (error) throw new Error(/not enabled/i.test(error.message) ? 'Google sign-in is not set up yet. Use email and password for now.' : error.message);
}

export async function signOut(): Promise<void> {
  if (!supabase) return setLocal(false);
  await supabase.auth.signOut();
}
