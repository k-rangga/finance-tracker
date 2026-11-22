import { useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import s from '../styles/ui.module.css';
import { Logo } from './Logo';
import { supabase } from '../lib/supabase';

/** The Vercel version: the app once you're signed in, else the email-link sign-in. */
export function AuthGate({ children, loading }: { children: ReactNode; loading: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    supabase!.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase!.auth.onAuthStateChange((_e, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);
  if (session === undefined) return <>{loading}</>;
  if (!session) return <SignIn />;
  return <>{children}</>;
}

function SignIn() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'' | 'sending' | 'sent'>('');
  const [err, setErr] = useState('');
  const send = async () => {
    const e = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(e)) return setErr('Enter your email address.');
    setState('sending');
    setErr('');
    const { error } = await supabase!.auth.signInWithOtp({ email: e, options: { emailRedirectTo: location.origin } });
    if (error) {
      setState('');
      setErr(error.message);
    } else setState('sent');
  };
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, textAlign: 'center', width: 'min(360px, 100%)' }}>
        <Logo size={56} />
        <h1 style={{ fontSize: 24 }}>Personal Spending Tracker</h1>
        {state === 'sent' ? (
          <>
            <span style={{ fontSize: 15, color: 'var(--text-soft)' }}>
              Check <strong>{email.trim()}</strong> for a sign-in link. Open it on this device.
            </span>
            <button type="button" className={s.textBtnSm} onClick={() => setState('')}>
              Use another email
            </button>
          </>
        ) : (
          <form
            style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}
            onSubmit={e => {
              e.preventDefault();
              send();
            }}
          >
            <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>Sign in with a link sent to your email. No password.</span>
            <input className={s.input} type="email" autoComplete="email" autoFocus placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} aria-label="Email" />
            {err && <span className={s.error}>{err}</span>}
            <button type="submit" className={s.btnPrimary} disabled={state === 'sending'}>
              {state === 'sending' ? 'Sending…' : 'Send sign-in link'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export const signOut = async () => {
  await supabase?.auth.signOut();
  location.reload();
};
