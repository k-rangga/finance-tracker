import { StrictMode, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import s from './styles/ui.module.css';
import App from './App';
import { SettingsProvider } from './lib/settings';
import { DataProvider } from './lib/data';
import { backend } from './lib/backend';
import { Logo } from './components/Logo';
import { applyTheme, getTheme } from './lib/theme';
import { onVercel } from './lib/supabase';
import { AuthGate } from './components/SignIn';
import { pickBootReflection, readBootHint } from './lib/bootHint';

// Before the first paint, so the page never flashes the other theme.
applyTheme(getTheme());

function Centered({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, textAlign: 'center', maxWidth: 360 }}>
        <Logo size={56} />
        {children}
      </div>
    </div>
  );
}

/**
 * Editorial Sanctuary loader: warm breathing Maxie portrait, time-aware greeting using locally cached name,
 * whisper-thin clay shimmer line, staged calm status messages, and a personalized behavioral reflection.
 */
function EditorialLoader() {
  const hint = useMemo(() => readBootHint(), []);
  const reflection = useMemo(() => pickBootReflection(hint), [hint]);
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setStage(1), 1600),
      setTimeout(() => setStage(2), 3800),
      setTimeout(() => setStage(3), 7000),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  const id = hint?.lang === 'id';
  const hr = new Date().getHours();
  const baseHi = id
    ? hr < 11
      ? 'Selamat pagi'
      : hr < 15
        ? 'Selamat siang'
        : hr < 19
          ? 'Selamat sore'
          : 'Selamat malam'
    : hr < 12
      ? 'Good morning'
      : hr < 18
        ? 'Good afternoon'
        : 'Good evening';
  const greeting = `${baseHi}${hint?.name ? `, ${hint.name}` : ''}.`;

  const stages = id
    ? ['Membuka catatanmu…', 'Menyiapkan siklus terbaru…', 'Menyusun tagihan dan ritme…', 'Sebentar lagi siap…']
    : ['Opening your ledger…', 'Gathering your latest cycle…', 'Lining up bills and pace…', 'Almost ready — waking up the server…'];

  return (
    <div className={s.bootScreen} role="status" aria-label={stages[stage]}>
      <div className={s.bootCard}>
        <span className={s.bootHalo} aria-hidden="true">
          <Logo size={52} mood="calm" />
        </span>
        <div className={s.bootText}>
          <h1 className={s.bootGreeting}>{greeting}</h1>
          <span className={s.bootStatus}>{stages[stage]}</span>
        </div>
        <div className={s.bootTrack} aria-hidden="true">
          <span className={s.bootSweep} />
        </div>
        {!hint?.quiet && <p className={s.bootReflection}>{reflection}</p>}
      </div>
    </div>
  );
}

// Apps Script: Google signs you in before it serves the page. Vercel: sign in by email link first.
const app = (
  <DataProvider
    backend={backend}
    loading={<EditorialLoader />}
    failed={(msg, retry) => (
      <Centered>
        <h1 style={{ fontSize: 22 }}>Couldn't load your data</h1>
        <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>{msg}</span>
        <button type="button" className={s.btnPrimary} onClick={retry}>
          Try again
        </button>
      </Centered>
    )}
  >
    <SettingsProvider>
      <App />
    </SettingsProvider>
  </DataProvider>
);
createRoot(document.getElementById('root')!).render(<StrictMode>{onVercel ? <AuthGate loading={<EditorialLoader />}>{app}</AuthGate> : app}</StrictMode>);
