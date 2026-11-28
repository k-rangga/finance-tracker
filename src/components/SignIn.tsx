import { useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import s from '../styles/ui.module.css';
import { Logo } from './Logo';
import { supabase } from '../lib/supabase';
import { storage } from '../lib/storage';

const METHOD_KEY = 'moneyTracker.signInMethod';
const LAST_EMAIL_KEY = 'moneyTracker.lastEmail';
/** A PIN is 6 digits: Supabase keeps it as the account password. */
export const PIN_LENGTH = 6;

type AuthMethod = 'pin' | 'signup' | 'link';

function isWeakPin(p: string): boolean {
  return /^(\d)\1+$/.test(p) || '0123456789'.includes(p) || '9876543210'.includes(p);
}

/** The Vercel version: the app once you're signed in, else Google + Email/PIN sign-in. */
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
  const [method, setMethodState] = useState<AuthMethod>(() => {
    const saved = storage.getRaw(METHOD_KEY);
    return saved === 'link' || saved === 'signup' || saved === 'pin' ? saved : 'pin';
  });
  const setMethod = (m: AuthMethod) => {
    storage.setRaw(METHOD_KEY, m);
    setMethodState(m);
    setErr('');
    setPin('');
  };
  const [pin, setPin] = useState('');
  const [email, setEmail] = useState(() => storage.getRaw(LAST_EMAIL_KEY) ?? '');
  const [state, setState] = useState<'' | 'sending' | 'sent'>('');
  const [googleBusy, setGoogleBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [err, setErr] = useState('');
  const [code, setCode] = useState('');
  const [checking, setChecking] = useState(false);

  // Surface friendly error messages if returning from a cancelled or inactive OAuth redirect.
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
    const raw = q.get('error_description') || hash.get('error_description') || q.get('error') || hash.get('error');
    if (raw) {
      const msg = /banned|inactive/i.test(raw)
        ? 'This account has been deactivated.'
        : /access_denied|cancel/i.test(raw)
          ? 'Google sign-in was cancelled.'
          : raw;
      setErr(msg);
      history.replaceState(null, '', location.pathname);
    }
  }, []);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn(n => Math.max(0, n - 1)), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const signInWithGoogle = async () => {
    setErr('');
    setGoogleBusy(true);
    const { error } = await supabase!.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: location.origin },
    });
    if (error) {
      setGoogleBusy(false);
      setErr(
        /not enabled|unsupported provider/i.test(error.message)
          ? "Google sign-in isn't enabled in Supabase yet (Authentication → Providers → Google)."
          : error.message,
      );
    }
  };

  /** The 6-digit code from the confirmation / sign-in email. */
  const verify = async (raw = code) => {
    const token = raw.replace(/\D/g, '');
    if (token.length < 6) return setErr('Enter the 6-digit code from the email.');
    setChecking(true);
    setErr('');
    const { error } = await supabase!.auth.verifyOtp({ email: email.trim(), token, type: 'email' });
    setChecking(false);
    if (error) setErr(error.message.includes('expired') || error.message.includes('invalid') ? 'That code is wrong or has expired. Send a new link.' : error.message);
  };

  const signInWithPin = async (rawPin = pin) => {
    const e = email.trim();
    const p = rawPin.replace(/\D/g, '');
    if (!/^\S+@\S+\.\S+$/.test(e)) return setErr('Enter your email address.');
    if (p.length !== PIN_LENGTH) return setErr(`Enter your ${PIN_LENGTH}-digit PIN.`);
    storage.setRaw(LAST_EMAIL_KEY, e);
    setChecking(true);
    setErr('');
    const { error } = await supabase!.auth.signInWithPassword({ email: e, password: p });
    setChecking(false);
    if (error) {
      setPin('');
      setErr(
        /banned|inactive/i.test(error.message)
          ? 'This account has been deactivated.'
          : /invalid/i.test(error.message)
            ? "That email and PIN don't match. New here? Tap Create account, or sign in with Google."
            : /rate|many/i.test(error.message)
              ? 'Too many tries. Wait a few minutes, or sign in with Google.'
              : /disabled|not enabled/i.test(error.message)
                ? 'Email sign-in is currently disabled — please Continue with Google above.'
                : error.message,
      );
    }
  };

  const signUpWithPin = async (rawPin = pin) => {
    const e = email.trim();
    const p = rawPin.replace(/\D/g, '');
    if (!/^\S+@\S+\.\S+$/.test(e)) return setErr('Enter your email address.');
    if (p.length !== PIN_LENGTH) return setErr(`Choose a ${PIN_LENGTH}-digit PIN.`);
    if (isWeakPin(p)) return setErr('Pick a PIN that is harder to guess than a run or repeat.');
    storage.setRaw(LAST_EMAIL_KEY, e);
    setChecking(true);
    setErr('');
    const { data, error } = await supabase!.auth.signUp({
      email: e,
      password: p,
      options: { emailRedirectTo: location.origin },
    });
    setChecking(false);
    if (error) {
      setErr(
        /disabled|not enabled/i.test(error.message)
          ? 'Email sign-up is currently disabled — tap Continue with Google above.'
          : /already registered/i.test(error.message)
            ? 'An account with this email already exists. Try Email + PIN or Continue with Google.'
            : error.message,
      );
      return;
    }
    if (!data.session) {
      // Confirm email is ON in Supabase: show one-time verification code/link screen.
      setState('sent');
      setResendIn(30);
    }
  };

  const send = async () => {
    const e = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(e)) return setErr('Enter your email address.');
    storage.setRaw(LAST_EMAIL_KEY, e);
    setState('sending');
    setErr('');
    const { error } = await supabase!.auth.signInWithOtp({ email: e, options: { emailRedirectTo: location.origin } });
    if (error) {
      setState('');
      setErr(
        /disabled|not enabled/i.test(error.message)
          ? 'Email sign-in is currently disabled — please Continue with Google above.'
          : error.message,
      );
    } else {
      setState('sent');
      setResendIn(30);
    }
  };

  const hr = new Date().getHours();
  const hello = hr < 12 ? 'Good morning! Ready to check in?' : hr < 18 ? 'Good afternoon! Ready to check in?' : 'Good evening! Ready to check in?';
  const hasEmail = /^\S+@\S+\.\S+$/.test(email.trim());
  const readyToGo = state === 'sent' || hasEmail || pin.length === PIN_LENGTH;

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, textAlign: 'center', width: 'min(370px, 100%)' }}>
        <Logo size={64} mood={readyToGo ? 'happy' : 'calm'} interactive followCursor cheer="Welcome back!" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h1 style={{ fontSize: 30, fontFamily: 'var(--font-serif)', fontWeight: 500 }}>Maxie</h1>
          <span style={{ fontSize: 15, fontFamily: 'var(--font-serif)', color: 'var(--ink-muted)' }}>{hello}</span>
        </div>

        {state === 'sent' ? (
          <>
            <span style={{ fontSize: 15, color: 'var(--text-soft)', lineHeight: 1.5 }}>
              Check <strong>{email.trim()}</strong> for a confirmation link, or paste the 6-digit code below.
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
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="6-digit code"
                maxLength={6}
                value={code}
                onChange={e => {
                  const next = e.target.value.replace(/\D/g, '').slice(0, 6);
                  setCode(next);
                  setErr('');
                  if (next.length === 6 && !checking) void verify(next);
                }}
                aria-label="Code from the email"
                style={{ letterSpacing: 4, textAlign: 'center', fontWeight: 600 }}
              />
              <button type="submit" className={s.btnPrimary} disabled={checking} style={{ flex: 'none' }}>
                {checking ? 'Checking…' : 'Verify'}
              </button>
            </form>
            {err && <span className={s.error}>{err}</span>}
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <button type="button" className={s.textBtnSm} disabled={resendIn > 0} onClick={() => void send()}>
                {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend link'}
              </button>
              <button
                type="button"
                className={s.textBtnSm}
                onClick={() => {
                  setState('');
                  setCode('');
                  setErr('');
                }}
              >
                Back
              </button>
            </div>
          </>
        ) : (
          <>
            {/* 1-tap Google Sign-In via Supabase Auth */}
            <button
              type="button"
              className={s.googleSignInBtn}
              disabled={googleBusy || checking}
              onClick={() => void signInWithGoogle()}
            >
              <GoogleGIcon />
              <span>{googleBusy ? 'Opening Google…' : 'Continue with Google'}</span>
            </button>

            <div className={s.authDivider}>
              <span>or with email</span>
            </div>

            <div className={s.segment} role="group" aria-label="Email sign-in options" style={{ alignSelf: 'center' }}>
              <button type="button" aria-pressed={method === 'pin'} onClick={() => setMethod('pin')}>
                Email + PIN
              </button>
              <button type="button" aria-pressed={method === 'signup'} onClick={() => setMethod('signup')}>
                Create account
              </button>
              <button type="button" aria-pressed={method === 'link'} onClick={() => setMethod('link')}>
                Email link
              </button>
            </div>

            {method === 'pin' && (
              <form
                style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}
                onSubmit={e => {
                  e.preventDefault();
                  void signInWithPin();
                }}
              >
                <span style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>Signs in immediately once you enter your {PIN_LENGTH}-digit PIN.</span>
                <input
                  className={s.input}
                  type="email"
                  autoComplete="username"
                  placeholder="you@example.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  aria-label="Email"
                />
                <input
                  className={s.input}
                  type="password"
                  inputMode="numeric"
                  autoComplete="current-password"
                  placeholder="6-digit PIN"
                  maxLength={PIN_LENGTH}
                  value={pin}
                  onChange={e => {
                    const next = e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH);
                    setPin(next);
                    setErr('');
                    if (next.length === PIN_LENGTH && hasEmail && !checking) void signInWithPin(next);
                  }}
                  aria-label="PIN"
                  style={{ letterSpacing: 6, textAlign: 'center', fontWeight: 600 }}
                />
                {err && <span className={s.error}>{err}</span>}
                <button type="submit" className={s.btnPrimary} disabled={checking || googleBusy}>
                  {checking ? 'Signing in…' : 'Sign in'}
                </button>
              </form>
            )}

            {method === 'signup' && (
              <form
                style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}
                onSubmit={e => {
                  e.preventDefault();
                  void signUpWithPin();
                }}
              >
                <span style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>
                  Create your account with an email and a {PIN_LENGTH}-digit PIN.
                </span>
                <input
                  className={s.input}
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  aria-label="Email"
                />
                <input
                  className={s.input}
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  placeholder={`Choose a ${PIN_LENGTH}-digit PIN`}
                  maxLength={PIN_LENGTH}
                  value={pin}
                  onChange={e => {
                    const next = e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH);
                    setPin(next);
                    setErr('');
                  }}
                  aria-label="New 6-digit PIN"
                  style={{ letterSpacing: 6, textAlign: 'center', fontWeight: 600 }}
                />
                {err && <span className={s.error}>{err}</span>}
                <button type="submit" className={s.btnPrimary} disabled={checking || googleBusy}>
                  {checking ? 'Creating account…' : 'Create account'}
                </button>
              </form>
            )}

            {method === 'link' && (
              <form
                style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}
                onSubmit={e => {
                  e.preventDefault();
                  void send();
                }}
              >
                <span style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>We&apos;ll email you a one-tap link. No PIN needed.</span>
                <input
                  className={s.input}
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  aria-label="Email"
                />
                {err && <span className={s.error}>{err}</span>}
                <button type="submit" className={s.btnPrimary} disabled={state === 'sending' || googleBusy}>
                  {state === 'sending' ? 'Sending…' : 'Send sign-in link'}
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function GoogleGIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden="true" style={{ flex: 'none' }}>
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29c-.24-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"
      />
    </svg>
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
  if (isWeakPin(p)) return 'Pick a PIN that is harder to guess than a run or repeat.';
  const { error } = await supabase!.auth.updateUser({ password: p });
  return error ? error.message : null;
}
