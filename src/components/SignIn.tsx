import { useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import s from '../styles/ui.module.css';
import { Logo } from './Logo';
import { supabase } from '../lib/supabase';
import { storage } from '../lib/storage';

const METHOD_KEY = 'moneyTracker.signInMethod';
/** A PIN is 6 digits: Supabase keeps it as the account password. */
export const PIN_LENGTH = 6;

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
  /** Email link (no password) or email + the PIN you set in Settings; the last one used is remembered on this device. */
  const [method, setMethodState] = useState<'link' | 'pin'>(() => (storage.getRaw(METHOD_KEY) === 'pin' ? 'pin' : 'link'));
  const setMethod = (m: 'link' | 'pin') => {
    storage.setRaw(METHOD_KEY, m);
    setMethodState(m);
    setErr('');
  };
  const [pin, setPin] = useState('');
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'' | 'sending' | 'sent'>('');
  const [err, setErr] = useState('');
  const [code, setCode] = useState('');
  const [checking, setChecking] = useState(false);
  /** The 6-digit code from the same email: for when the email opens on another device. */
  const verify = async () => {
    const token = code.replace(/\D/g, '');
    if (token.length < 6) return setErr('Enter the 6-digit code from the email.');
    setChecking(true);
    setErr('');
    const { error } = await supabase!.auth.verifyOtp({ email: email.trim(), token, type: 'email' });
    setChecking(false);
    if (error) setErr(error.message.includes('expired') || error.message.includes('invalid') ? 'That code is wrong or has expired. Send a new link.' : error.message);
  };
  const signInWithPin = async () => {
    const e = email.trim();
    const p = pin.replace(/\D/g, '');
    if (!/^\S+@\S+\.\S+$/.test(e)) return setErr('Enter your email address.');
    if (p.length !== PIN_LENGTH) return setErr(`Enter your ${PIN_LENGTH}-digit PIN.`);
    setChecking(true);
    setErr('');
    const { error } = await supabase!.auth.signInWithPassword({ email: e, password: p });
    setChecking(false);
    if (error)
      setErr(
        /invalid/i.test(error.message)
          ? "That email and PIN don't match. No PIN yet? Sign in with an email link, then set one in Settings."
          : /rate|many/i.test(error.message)
            ? 'Too many tries. Wait a few minutes, or sign in with an email link.'
            : error.message,
      );
  };
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
  const hr = new Date().getHours();
  const hello = hr < 12 ? 'Good morning! Ready to check in?' : hr < 18 ? 'Good afternoon! Ready to check in?' : 'Good evening! Ready to check in?';
  const readyToGo = state === 'sent' || /^\S+@\S+\.\S+$/.test(email.trim()) || pin.length === PIN_LENGTH;
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, textAlign: 'center', width: 'min(360px, 100%)' }}>
        <Logo size={60} mood={readyToGo ? 'happy' : 'calm'} interactive cheer="Welcome back!" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h1 style={{ fontSize: 30, fontFamily: 'var(--font-serif)', fontWeight: 500 }}>Maxie</h1>
          <span style={{ fontSize: 15, fontFamily: 'var(--font-serif)', color: 'var(--ink-muted)' }}>{hello}</span>
        </div>
        {state === 'sent' ? (
          <>
            <span style={{ fontSize: 15, color: 'var(--text-soft)' }}>
              Check <strong>{email.trim()}</strong> for a sign-in link. Open it on this device, or type the 6-digit code from the email.
            </span>
            <form
              style={{ display: 'flex', gap: 8, width: '100%' }}
              onSubmit={e => {
                e.preventDefault();
                verify();
              }}
            >
              <input
                className={s.input}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="6-digit code"
                value={code}
                onChange={e => setCode(e.target.value)}
                aria-label="Code from the email"
                style={{ letterSpacing: 2, textAlign: 'center' }}
              />
              <button type="submit" className={s.btnPrimary} disabled={checking} style={{ flex: 'none' }}>
                {checking ? 'Checking…' : 'Sign in'}
              </button>
            </form>
            {err && <span className={s.error}>{err}</span>}
            <button
              type="button"
              className={s.textBtnSm}
              onClick={() => {
                setState('');
                setCode('');
                setErr('');
              }}
            >
              Use another email
            </button>
          </>
        ) : (
          <>
            <div className={s.segment} role="group" aria-label="Sign in with" style={{ alignSelf: 'center' }}>
              <button type="button" aria-pressed={method === 'link'} onClick={() => setMethod('link')}>
                Email link
              </button>
              <button type="button" aria-pressed={method === 'pin'} onClick={() => setMethod('pin')}>
                Email + PIN
              </button>
            </div>
            {method === 'link' ? (
              <form
                style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}
                onSubmit={e => {
                  e.preventDefault();
                  send();
                }}
              >
                <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>We'll email you a link to sign in. No password.</span>
                <input className={s.input} type="email" autoComplete="email" autoFocus placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} aria-label="Email" />
                {err && <span className={s.error}>{err}</span>}
                <button type="submit" className={s.btnPrimary} disabled={state === 'sending'}>
                  {state === 'sending' ? 'Sending…' : 'Send sign-in link'}
                </button>
              </form>
            ) : (
              <form
                style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}
                onSubmit={e => {
                  e.preventDefault();
                  signInWithPin();
                }}
              >
                <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>Your email and the {PIN_LENGTH}-digit PIN you set in Settings.</span>
                <input className={s.input} type="email" autoComplete="username" autoFocus placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} aria-label="Email" />
                <input
                  className={s.input}
                  type="password"
                  inputMode="numeric"
                  autoComplete="current-password"
                  placeholder="PIN"
                  maxLength={PIN_LENGTH}
                  value={pin}
                  onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
                  aria-label="PIN"
                  style={{ letterSpacing: 6, textAlign: 'center' }}
                />
                {err && <span className={s.error}>{err}</span>}
                <button type="submit" className={s.btnPrimary} disabled={checking}>
                  {checking ? 'Signing in…' : 'Sign in'}
                </button>
                <button type="button" className={s.textBtnSm} onClick={() => setMethod('link')} style={{ alignSelf: 'center' }}>
                  Forgot your PIN? Use an email link
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export const signOut = async () => {
  await supabase?.auth.signOut();
  location.reload();
};

/** Sets (or changes) your sign-in PIN: it becomes the account's password in Supabase. */
export async function setPin(pin: string): Promise<string | null> {
  const p = pin.replace(/\D/g, '');
  if (p.length !== PIN_LENGTH) return `Your PIN needs ${PIN_LENGTH} digits.`;
  if (/^(\d)\1+$/.test(p) || '0123456789'.includes(p) || '9876543210'.includes(p)) return 'Pick a PIN that is harder to guess than a run or repeat.';
  const { error } = await supabase!.auth.updateUser({ password: p });
  return error ? error.message : null;
}
