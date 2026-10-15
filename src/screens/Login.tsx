import { useState, type FormEvent } from 'react';
import s from '../styles/ui.module.css';
import { Logo } from '../components/Logo';
import { signInWithGoogle, signInWithPassword } from '../lib/auth';

export function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email)) return setErr('Enter a valid email address.');
    if (!pw) return setErr('Enter your password.');
    setBusy(true);
    try {
      await signInWithPassword(email, pw);
      setPw('');
      onSignedIn();
    } catch (x) {
      setErr(x instanceof Error ? x.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setBusy(true);
    try {
      await signInWithGoogle();
      onSignedIn();
    } catch (x) {
      setErr(x instanceof Error ? x.message : 'Google sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: 'var(--bg)' }}>
      <form onSubmit={submit} noValidate style={{ width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 28 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, textAlign: 'center' }}>
          <Logo size={56} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h1 style={{ fontWeight: 700, fontSize: 24 }}>Welcome back</h1>
            <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>Sign in to Personal Spending Tracker</span>
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
              autoComplete="current-password"
            />
          </label>
          {err && (
            <span role="alert" style={{ fontSize: 13, color: 'var(--red-ink)' }}>
              {err}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button type="submit" className={s.btnPrimary} style={{ fontWeight: 600, padding: 14 }} disabled={busy}>
            Sign in
          </button>
          <button type="button" className={s.btnSecondary} onClick={google} disabled={busy}>
            Continue with Google
          </button>
        </div>
      </form>
    </div>
  );
}
