import { StrictMode, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import s from './styles/ui.module.css';
import App from './App';
import { SettingsProvider } from './lib/settings';
import { DataProvider } from './lib/data';
import { localBackend, supabaseBackend } from './lib/backend';
import { supabase } from './lib/supabase';
import { signOut, useUser } from './lib/auth';
import { Login } from './screens/Login';
import { Logo } from './components/Logo';

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, textAlign: 'center', maxWidth: 360 }}>
        <Logo size={56} />
        {children}
      </div>
    </div>
  );
}

function Root() {
  const user = useUser();
  const backend = useMemo(() => (supabase ? supabaseBackend(supabase) : localBackend), []);

  if (user === undefined) return <Centered><span className={s.label}>Loading…</span></Centered>;
  if (!user) return <Login />;

  return (
    <DataProvider
      key={user.id}
      backend={backend}
      loading={
        <Centered>
          <span className={s.label}>Loading your data…</span>
        </Centered>
      }
      failed={(msg, retry) => (
        <Centered>
          <h1 style={{ fontSize: 22 }}>Couldn't load your data</h1>
          <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>{msg}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className={s.btnPrimary} onClick={retry}>
              Try again
            </button>
            <button type="button" className={s.btnGhost} onClick={() => void signOut()}>
              Log out
            </button>
          </div>
        </Centered>
      )}
    >
      <SettingsProvider>
        <App email={user.email} />
      </SettingsProvider>
    </DataProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
