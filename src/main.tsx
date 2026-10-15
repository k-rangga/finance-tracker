import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import s from './styles/ui.module.css';
import App from './App';
import { SettingsProvider } from './lib/settings';
import { DataProvider } from './lib/data';
import { backend } from './lib/backend';
import { Logo } from './components/Logo';

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

// Google signs you in before Apps Script serves the page, so there is no login screen.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DataProvider
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
  </StrictMode>,
);
