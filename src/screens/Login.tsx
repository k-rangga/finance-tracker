import { useState, type FormEvent } from 'react';
import s from '../styles/ui.module.css';
import { Logo } from '../components/Logo';
import { signInWithGoogle, signInWithPassword, signUp } from '../lib/auth';

type Mode = 'signin' | 'signup';

/** Sign-in / create-account page. A successful sign-in is picked up by useUser(). */
export function Login() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const signup = mode === 'signup';

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr('');
    setInfo('');
    try {
      await fn();
    } catch (x) {
      setErr(x instanceof Error ? x.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email)) return setErr('Enter a valid email address.');
    if (!pw) return setErr('Enter your password.');
    if (signup && pw.length < 8) return setErr('Use at least 8 characters for your password.');
    void run(async () => {
      if (signup) {
        const needsConfirm = await signUp(email, pw);
        if (needsConfirm) {
          setInfo(`Check ${email} for a confirmation link, then sign in.`);
          setMode('signin');
        }
      } else {
        await signInWithPassword(email, pw);
      }
      setPw('');
    });
  };

  const switchMode = () => {
    setMode(signup ? 'signin' : 'signup');
    setErr('');
    setInfo('');
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: 'var(--bg)' }}>
      <form onSubmit={submit} noValidate style={{ width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 28 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, textAlign: 'center' }}>
          <Logo size={56} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h1 style={{ fontWeight: 700, fontSize: 24 }}>{signup ? 'Create your account' : 'Welcome back'}</h1>
            <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>{signup ? 'Start tracking with Personal Spending Tracker' : 'Sign in to Personal Spending Tracker'}</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label className={s.field}>
            Email
            <input
              className={s.input}
              style={{ fontWeight: 400 }}
              type="email"
              value={email}
              onChange={e => {
                setEmail(e.target.value);
                setErr('');
              }}
              placeholder="you@gmail.com"
              autoComplete="email"
            />
          </label>
          <label className={s.field}>
            Password
            <input
              className={s.input}
              style={{ fontWeight: 400 }}
              type="password"
              value={pw}
              onChange={e => {
                setPw(e.target.value);
                setErr('');
              }}
              placeholder="••••••••"
              autoComplete={signup ? 'new-password' : 'current-password'}
            />
          </label>
          {err && (
            <span role="alert" style={{ fontSize: 13, color: 'var(--red-ink)' }}>
              {err}
            </span>
          )}
          {info && (
            <span role="status" style={{ fontSize: 13, color: 'var(--accent-800)', background: 'var(--accent-tint)', borderRadius: 12, padding: '10px 12px' }}>
              {info}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button type="submit" className={s.btnPrimary} style={{ fontWeight: 600, padding: 14 }} disabled={busy}>
            {signup ? 'Create account' : 'Sign in'}
          </button>
          <button type="button" className={s.btnSecondary} onClick={() => void run(signInWithGoogle)} disabled={busy}>
            Continue with Google
          </button>
        </div>
        <div style={{ textAlign: 'center', fontSize: 14, color: 'var(--text-muted)' }}>
          {signup ? 'Already have an account? ' : 'New here? '}
          <button type="button" className={s.linkBtn} style={{ fontSize: 14 }} onClick={switchMode}>
            {signup ? 'Sign in' : 'Create an account'}
          </button>
        </div>
      </form>
    </div>
  );
}
