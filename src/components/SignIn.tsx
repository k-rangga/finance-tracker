import { useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import s from '../styles/ui.module.css';
import { AuthBackdrop } from './AuthBackdrop';
import { Logo } from './Logo';
import { supabase } from '../lib/supabase';
import { storage } from '../lib/storage';

const METHOD_KEY = 'moneyTracker.signInMethod';
const LAST_EMAIL_KEY = 'moneyTracker.lastEmail';
export const RESET_PIN_KEY = 'maxie.resetPin';
/** A PIN is 6 digits: Supabase keeps it as the account password. */
export const PIN_LENGTH = 6;

type AuthFlow = 'signin' | 'signup';
type SignInMethod = 'pin' | 'link';
type OtpPurpose = 'signup' | 'login' | 'reset';

function isWeakPin(p: string): boolean {
  return /^(\d)\1+$/.test(p) || '0123456789'.includes(p) || '9876543210'.includes(p);
}

/** The Vercel version: the app once signed in (routing Forgot-PIN arrivals straight to Change PIN first). */
export function AuthGate({ children, loading }: { children: ReactNode; loading: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [needsPinReset, setNeedsPinReset] = useState(() => {
    try {
      const fromUrl = new URLSearchParams(location.search).get('resetPin') === '1';
      return fromUrl || sessionStorage.getItem(RESET_PIN_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    supabase!.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase!.auth.onAuthStateChange((_e, next) => {
      setSession(next);
      try {
        if (new URLSearchParams(location.search).get('resetPin') === '1' || sessionStorage.getItem(RESET_PIN_KEY) === '1') {
          setNeedsPinReset(true);
        }
      } catch {
        /* ignore */
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) return <>{loading}</>;
  if (!session) return <SignIn />;
  if (needsPinReset) {
    const clearResetFlag = () => {
      try {
        sessionStorage.removeItem(RESET_PIN_KEY);
      } catch {
        /* ignore */
      }
      const q = new URLSearchParams(location.search);
      if (q.has('resetPin')) {
        q.delete('resetPin');
        const nextUrl = location.pathname + (q.toString() ? '?' + q.toString() : '');
        history.replaceState(null, '', nextUrl);
      }
      setNeedsPinReset(false);
    };
    return <ChangePinScreen email={session.user?.email ?? ''} onDone={clearResetFlag} />;
  }
  return <>{children}</>;
}

/** Focused Change PIN screen shown right after logging in via a Forgot-PIN / Reset-PIN email link. */
function ChangePinScreen({ email, onDone }: { email: string; onDone: () => void }) {
  const [pin1, setPin1] = useState('');
  const [pin2, setPin2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const saveNewPin = async () => {
    if (pin1.length !== PIN_LENGTH) return setErr(`Enter a ${PIN_LENGTH}-digit PIN.`);
    if (pin1 !== pin2) return setErr("Those PINs don't match.");
    setBusy(true);
    setErr('');
    const problem = await setPin(pin1);
    setBusy(false);
    if (problem) setErr(problem);
    else onDone();
  };

  return (
    <div className={s.authStage}>
      <AuthBackdrop />
      <div className={s.authBoard}>
        <div className={s.authHeader}>
          <Logo size={56} mood="happy" interactive followCursor cheer="Almost there!" />
          <h1 style={{ margin: 0, fontSize: 24, fontFamily: 'var(--font-serif)', fontWeight: 500 }}>Set a new 6-digit PIN</h1>
          <span style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            {email ? `Signed in as ${email}. ` : ''}Choose a new PIN so you can sign in instantly next time.
          </span>
        </div>
        <form
          className={s.authForm}
          onSubmit={e => {
            e.preventDefault();
            void saveNewPin();
          }}
        >
          <input
            className={s.input}
            autoFocus
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            placeholder="New 6-digit PIN"
            maxLength={PIN_LENGTH}
            value={pin1}
            onChange={e => {
              setPin1(e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH));
              setErr('');
            }}
            aria-label="New 6-digit PIN"
            style={{ letterSpacing: pin1 ? 6 : undefined, textAlign: 'center', fontWeight: pin1 ? 600 : undefined }}
          />
          <input
            className={s.input}
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            placeholder="Confirm 6-digit PIN"
            maxLength={PIN_LENGTH}
            value={pin2}
            onChange={e => {
              setPin2(e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH));
              setErr('');
            }}
            aria-label="Confirm 6-digit PIN"
            style={{ letterSpacing: pin2 ? 6 : undefined, textAlign: 'center', fontWeight: pin2 ? 600 : undefined }}
          />
          {err && <span className={s.error}>{err}</span>}
          <button type="submit" className={s.btnPrimary} disabled={busy}>
            {busy ? 'Saving PIN…' : 'Save new PIN & continue'}
          </button>
          <button type="button" className={s.textBtnSm} onClick={onDone} style={{ alignSelf: 'center' }}>
            Skip for now
          </button>
        </form>
      </div>
    </div>
  );
}

function SignIn() {
  const [flow, setFlow] = useState<AuthFlow>('signin');
  const [signInMethod, setSignInMethodState] = useState<SignInMethod>(() =>
    storage.getRaw(METHOD_KEY) === 'link' ? 'link' : 'pin',
  );
  const setSignInMethod = (m: SignInMethod) => {
    storage.setRaw(METHOD_KEY, m);
    setSignInMethodState(m);
    setErr('');
    setPin('');
  };

  const [pin, setPin] = useState('');
  const [email, setEmail] = useState(() => storage.getRaw(LAST_EMAIL_KEY) ?? '');
  const [state, setState] = useState<'' | 'sending' | 'sent' | 'duplicate'>('');
  const [otpPurpose, setOtpPurpose] = useState<OtpPurpose>('login');
  const [googleBusy, setGoogleBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [err, setErr] = useState('');
  const [deactivatedNotice, setDeactivatedNotice] = useState(false);
  const [code, setCode] = useState('');
  const [checking, setChecking] = useState(false);

  // Surface friendly errors on OAuth return (cancelled or deactivated user).
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
    const raw = q.get('error_description') || hash.get('error_description') || q.get('error') || hash.get('error');
    if (raw) {
      const banned = /banned|inactive/i.test(raw);
      setDeactivatedNotice(banned);
      const msg = banned
        ? 'This email belongs to a deactivated account.'
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

  const switchFlow = (next: AuthFlow) => {
    setFlow(next);
    setState('');
    setErr('');
    setDeactivatedNotice(false);
    setPin('');
    setCode('');
  };

  const formatAuthError = (msg: string, disabledMsg?: string) => {
    if (/banned|inactive/i.test(msg)) {
      setDeactivatedNotice(true);
      return 'This email belongs to a deactivated account.';
    }
    setDeactivatedNotice(false);
    if (/rate|many|limit|exceeded/i.test(msg)) {
      return 'Email limit reached (~2/hour on default mailer). Wait a bit, check Spam, or Continue with Google.';
    }
    if (/disabled|not enabled/i.test(msg)) {
      return disabledMsg ?? 'Email sign-in is disabled — please Continue with Google above.';
    }
    return msg;
  };

  /** Free any email still held by an old deactivated user_id so a fresh user_id can be created. */
  const prepareSignupEmail = async (rawEmail: string) => {
    try {
      await fetch('/api/auth/prepare-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: rawEmail.trim() }),
      });
    } catch {
      /* non-blocking: proceed with Supabase auth */
    }
  };

  const reopenWithFreshAccount = async () => {
    if (!email.trim()) return;
    setChecking(true);
    setErr('');
    await prepareSignupEmail(email);
    setChecking(false);
    setDeactivatedNotice(false);
    setState('');
    setCode('');
    setPin('');
    setFlow('signup');
  };

  const signInWithGoogle = async () => {
    setErr('');
    setDeactivatedNotice(false);
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

  /** Send a one-time email link + 6-digit code (`reset` directs straight to Change PIN after sign-in). */
  const sendOtp = async (rawEmail: string, purpose: OtpPurpose) => {
    const e = rawEmail.trim();
    if (!/^\S+@\S+\.\S+$/.test(e)) return setErr('Enter your email address first.');
    storage.setRaw(LAST_EMAIL_KEY, e);
    setOtpPurpose(purpose);
    setState('sending');
    setErr('');
    setDeactivatedNotice(false);
    try {
      if (purpose === 'reset') sessionStorage.setItem(RESET_PIN_KEY, '1');
      else sessionStorage.removeItem(RESET_PIN_KEY);
    } catch {
      /* ignore */
    }
    if (purpose === 'signup') {
      await prepareSignupEmail(e);
    }
    const redirectTo = purpose === 'reset' ? `${location.origin}/?resetPin=1` : location.origin;
    const { error } = await supabase!.auth.signInWithOtp({ email: e, options: { emailRedirectTo: redirectTo } });
    if (error) {
      setState('');
      setErr(formatAuthError(error.message, 'Email sign-in is currently disabled — use Google above or enable Email in Supabase.'));
    } else {
      setState('sent');
      setResendIn(30);
    }
  };

  /** Resend either a signup confirmation email or a magic-link OTP email depending on the active step. */
  const resendEmail = async () => {
    const e = email.trim();
    if (!e || resendIn > 0) return;
    if (otpPurpose === 'signup') {
      setErr('');
      setDeactivatedNotice(false);
      setResendIn(30);
      const { error } = await supabase!.auth.resend({
        type: 'signup',
        email: e,
        options: { emailRedirectTo: location.origin },
      });
      if (error) {
        setErr(formatAuthError(error.message));
      }
      return;
    }
    await sendOtp(e, otpPurpose);
  };

  /** Verify 6-digit OTP code from email. */
  const verify = async (raw = code) => {
    const token = raw.replace(/\D/g, '');
    if (token.length < 6) return setErr('Enter the 6-digit code from the email.');
    setChecking(true);
    setErr('');
    setDeactivatedNotice(false);
    const e = email.trim();
    let res = await supabase!.auth.verifyOtp({ email: e, token, type: otpPurpose === 'signup' ? 'signup' : 'email' });
    if (res.error && otpPurpose === 'signup') {
      res = await supabase!.auth.verifyOtp({ email: e, token, type: 'email' });
    }
    setChecking(false);
    if (res.error) {
      if (/banned|inactive/i.test(res.error.message)) {
        setDeactivatedNotice(true);
        setErr('This email belongs to a deactivated account.');
      } else {
        setErr(
          res.error.message.includes('expired') || res.error.message.includes('invalid')
            ? 'That code is wrong or has expired. Send a new link.'
            : formatAuthError(res.error.message),
        );
      }
    }
  };

  /** Already have an account: Email + 6-digit PIN. */
  const signInWithPin = async (rawPin = pin) => {
    const e = email.trim();
    const p = rawPin.replace(/\D/g, '');
    if (!/^\S+@\S+\.\S+$/.test(e)) return setErr('Enter your email address.');
    if (p.length !== PIN_LENGTH) return setErr(`Enter your ${PIN_LENGTH}-digit PIN.`);
    storage.setRaw(LAST_EMAIL_KEY, e);
    setChecking(true);
    setErr('');
    setDeactivatedNotice(false);
    const { error } = await supabase!.auth.signInWithPassword({ email: e, password: p });
    setChecking(false);
    if (error) {
      setPin('');
      if (/banned|inactive/i.test(error.message)) {
        setDeactivatedNotice(true);
        setErr('This email belongs to a deactivated account.');
        return;
      }
      setErr(
        /invalid/i.test(error.message)
          ? "That email and PIN don't match. Forgot your PIN? Send a one-time reset link below."
          : formatAuthError(error.message),
      );
    }
  };

  /** New here? Sign up with Email + 6-digit PIN; if email already exists, offer Reset PIN or one-time login link. */
  const signUpWithPin = async () => {
    const e = email.trim();
    const p = pin.replace(/\D/g, '');
    if (!/^\S+@\S+\.\S+$/.test(e)) return setErr('Enter your email address.');
    if (p.length !== PIN_LENGTH) return setErr(`Choose a ${PIN_LENGTH}-digit PIN.`);
    if (isWeakPin(p)) return setErr('Pick a PIN that is harder to guess than a run or repeat.');
    storage.setRaw(LAST_EMAIL_KEY, e);
    setChecking(true);
    setErr('');
    setDeactivatedNotice(false);
    await prepareSignupEmail(e);
    const { data, error } = await supabase!.auth.signUp({
      email: e,
      password: p,
      options: { emailRedirectTo: location.origin },
    });
    setChecking(false);

    const isDuplicate =
      (error && /already registered|already exists/i.test(error.message)) ||
      (!error && data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0);

    if (isDuplicate) {
      setPin('');
      setState('duplicate');
      return;
    }

    if (error) {
      setErr(formatAuthError(error.message, 'Email sign-up is currently disabled — tap Sign up with Google above.'));
      return;
    }

    if (!data.session) {
      // Confirm email is ON: show one-time verification code/link screen.
      setOtpPurpose('signup');
      setState('sent');
      setResendIn(30);
    }
  };

  const hr = new Date().getHours();
  const hello = hr < 12 ? 'Good morning! Ready to check in?' : hr < 18 ? 'Good afternoon! Ready to check in?' : 'Good evening! Ready to check in?';
  const hasEmail = /^\S+@\S+\.\S+$/.test(email.trim());
  const readyToGo = state === 'sent' || hasEmail || pin.length === PIN_LENGTH;

  const onEmailChange = (v: string) => {
    setEmail(v);
    if (err) setErr('');
    if (deactivatedNotice) setDeactivatedNotice(false);
  };

  const freshAccountCta = deactivatedNotice && (
    <button
      type="button"
      className={s.textBtnSm}
      disabled={checking}
      onClick={() => void reopenWithFreshAccount()}
      style={{ alignSelf: 'center', textDecoration: 'underline' }}
    >
      {checking ? 'Preparing fresh account…' : 'Create a fresh account with this email'}
    </button>
  );

  return (
    <div className={s.authStage}>
      <AuthBackdrop />
      <div className={s.authBoard}>
        <div className={s.authHeader}>
          <Logo size={64} mood={readyToGo ? 'happy' : 'calm'} interactive followCursor cheer={flow === 'signup' ? 'Nice to meet you!' : 'Welcome back!'} />
          <h1 style={{ margin: 0, fontSize: 30, fontFamily: 'var(--font-serif)', fontWeight: 500 }}>Maxie</h1>
          <span style={{ fontSize: 15, fontFamily: 'var(--font-serif)', color: 'var(--ink-muted)' }}>{hello}</span>
        </div>

        {state === 'sent' ? (
          <div className={s.authSection}>
            <span style={{ fontSize: 14.5, color: 'var(--text-soft)', lineHeight: 1.55 }}>
              {otpPurpose === 'reset' ? (
                <>
                  We emailed <strong>{email.trim()}</strong> a one-time link and 6-digit code — signing in takes you straight to set a new PIN.
                </>
              ) : otpPurpose === 'signup' ? (
                <>
                  Check <strong>{email.trim()}</strong> to confirm your new account, or paste the 6-digit code below.
                </>
              ) : (
                <>
                  Check <strong>{email.trim()}</strong> for your one-time login link, or paste the 6-digit code below.
                </>
              )}
            </span>
            <form
              style={{ display: 'flex', gap: 8, width: '100%' }}
              onSubmit={e => {
                e.preventDefault();
                void verify();
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
                style={{ letterSpacing: code ? 5 : undefined, textAlign: 'center', fontWeight: code ? 600 : undefined }}
              />
              <button type="submit" className={s.btnPrimary} disabled={checking} style={{ flex: 'none' }}>
                {checking ? 'Checking…' : otpPurpose === 'reset' ? 'Continue' : 'Log in'}
              </button>
            </form>
            {err && <span className={s.error}>{err}</span>}
            {freshAccountCta}
            <div style={{ display: 'flex', gap: 18, alignItems: 'center', justifyContent: 'center' }}>
              <button type="button" className={s.textBtnSm} disabled={resendIn > 0} onClick={() => void resendEmail()}>
                {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend link'}
              </button>
              <button
                type="button"
                className={s.textBtnSm}
                onClick={() => {
                  setState('');
                  setCode('');
                  setErr('');
                  setDeactivatedNotice(false);
                }}
              >
                Back
              </button>
            </div>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.45 }}>
              Didn&apos;t receive it? Check Spam, or try Continue with Google.
            </span>
          </div>
        ) : state === 'duplicate' ? (
          <div className={s.authNoticeCard}>
            <strong style={{ fontSize: 15 }}>You already have an account</strong>
            <span style={{ fontSize: 13.5, color: 'var(--text-soft)', lineHeight: 1.5 }}>
              <strong>{email.trim()}</strong> is already registered. Reset your PIN or log in with a one-time email link:
            </span>
            {err && <span className={s.error}>{err}</span>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
              <button type="button" className={s.btnPrimary} onClick={() => void sendOtp(email, 'reset')}>
                Reset PIN via email
              </button>
              <button type="button" className={s.btnOutline} onClick={() => void sendOtp(email, 'login')}>
                Send one-time login email
              </button>
              <button
                type="button"
                className={s.textBtnSm}
                style={{ alignSelf: 'center', marginTop: 2 }}
                onClick={() => {
                  switchFlow('signin');
                  setSignInMethod('pin');
                }}
              >
                Log in with PIN instead
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className={s.authToggle} role="group" aria-label="Choose log in or create account">
              <button type="button" aria-pressed={flow === 'signin'} onClick={() => switchFlow('signin')}>
                Log in
              </button>
              <button type="button" aria-pressed={flow === 'signup'} onClick={() => switchFlow('signup')}>
                New here?
              </button>
            </div>

            {flow === 'signup' ? (
              <div className={s.authSection}>
                <button
                  type="button"
                  className={s.googleSignInBtn}
                  disabled={googleBusy || checking}
                  onClick={() => void signInWithGoogle()}
                >
                  <GoogleGIcon />
                  <span>{googleBusy ? 'Opening Google…' : 'Sign up with Google'}</span>
                </button>

                <div className={s.authDivider}>
                  <span>or</span>
                </div>

                <form
                  className={s.authForm}
                  onSubmit={e => {
                    e.preventDefault();
                    void signUpWithPin();
                  }}
                >
                  <input
                    className={s.input}
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={e => onEmailChange(e.target.value)}
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
                      setPin(e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH));
                      setErr('');
                    }}
                    aria-label="Choose 6-digit PIN"
                    style={{ letterSpacing: pin ? 6 : undefined, textAlign: 'center', fontWeight: pin ? 600 : undefined }}
                  />
                  {err && <span className={s.error}>{err}</span>}
                  {freshAccountCta}
                  <button type="submit" className={s.btnPrimary} disabled={checking || googleBusy || state === 'sending'}>
                    {checking ? 'Creating account…' : 'Create account'}
                  </button>
                  <button
                    type="button"
                    className={s.textBtnSm}
                    disabled={state === 'sending'}
                    onClick={() => void sendOtp(email, 'signup')}
                    style={{ alignSelf: 'center', marginTop: 2 }}
                  >
                    Or sign up with one-time email link
                  </button>
                </form>
              </div>
            ) : (
              <div className={s.authSection}>
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
                  <span>or</span>
                </div>

                {signInMethod === 'pin' ? (
                  <form
                    className={s.authForm}
                    onSubmit={e => {
                      e.preventDefault();
                      void signInWithPin();
                    }}
                  >
                    <input
                      className={s.input}
                      type="email"
                      autoComplete="username"
                      placeholder="you@example.com"
                      value={email}
                      onChange={e => onEmailChange(e.target.value)}
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
                      style={{ letterSpacing: pin ? 6 : undefined, textAlign: 'center', fontWeight: pin ? 600 : undefined }}
                    />
                    {err && <span className={s.error}>{err}</span>}
                    {freshAccountCta}
                    <button type="submit" className={s.btnPrimary} disabled={checking || googleBusy || state === 'sending'}>
                      {checking ? 'Logging in…' : 'Log in'}
                    </button>
                    <div className={s.authFootRow}>
                      <button type="button" className={s.textBtnSm} onClick={() => setSignInMethod('link')}>
                        Use email link
                      </button>
                      <button
                        type="button"
                        className={s.textBtnSm}
                        disabled={state === 'sending' || checking}
                        onClick={() => void sendOtp(email, 'reset')}
                      >
                        Forgot PIN?
                      </button>
                    </div>
                  </form>
                ) : (
                  <form
                    className={s.authForm}
                    onSubmit={e => {
                      e.preventDefault();
                      void sendOtp(email, 'login');
                    }}
                  >
                    <span style={{ fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.45 }}>
                      We&apos;ll email you a one-tap link and 6-digit code.
                    </span>
                    <input
                      className={s.input}
                      type="email"
                      autoComplete="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={e => onEmailChange(e.target.value)}
                      aria-label="Email"
                    />
                    {err && <span className={s.error}>{err}</span>}
                    {freshAccountCta}
                    <button type="submit" className={s.btnPrimary} disabled={state === 'sending' || googleBusy}>
                      {state === 'sending' ? 'Sending…' : 'Send login link'}
                    </button>
                    <button
                      type="button"
                      className={s.textBtnSm}
                      onClick={() => setSignInMethod('pin')}
                      style={{ alignSelf: 'center', marginTop: 2 }}
                    >
                      Use 6-digit PIN instead
                    </button>
                  </form>
                )}
              </div>
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
