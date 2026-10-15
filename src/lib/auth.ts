import { useEffect, useState } from 'react';
import { supabase } from './supabase';

/** Supabase accounts: email + password and Google. */

export type User = { id: string; email: string | null };

/** undefined while the session is being restored, null when signed out. */
export function useUser(): User | null | undefined {
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    if (!supabase) return setUser(null);
    const toUser = (s: { user: { id: string; email?: string | null } } | null) => (s ? { id: s.user.id, email: s.user.email ?? null } : null);
    supabase.auth.getSession().then(({ data }) => setUser(toUser(data.session)));
    const { data } = supabase.auth.onAuthStateChange((_e, session) => setUser(prev => (prev?.id === session?.user.id ? prev : toUser(session))));
    return () => data.subscription.unsubscribe();
  }, []);

  return user;
}

function client() {
  if (!supabase) throw new Error('Supabase is not configured for this deployment.');
  return supabase;
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  const { error } = await client().auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Email or password is incorrect.' : error.message);
}

/** Returns true when the account still needs its email confirmed. */
export async function signUp(email: string, password: string): Promise<boolean> {
  const { data, error } = await client().auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
  if (error) throw new Error(error.message);
  return !data.session;
}

export async function signInWithGoogle(): Promise<void> {
  const { error } = await client().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
  if (error) throw new Error(/not enabled/i.test(error.message) ? 'Google sign-in is not set up yet. Use email and password for now.' : error.message);
}

export async function signOut(): Promise<void> {
  await supabase?.auth.signOut();
}

/** Current access token, for calling our /api routes. */
export async function accessToken(): Promise<string> {
  const { data } = await client().auth.getSession();
  if (!data.session) throw new Error('Sign in first.');
  return data.session.access_token;
}
