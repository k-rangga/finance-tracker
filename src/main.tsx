import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import s from './styles/ui.module.css';
import App from './App';
import { SettingsProvider } from './lib/settings';
import { DataProvider } from './lib/data';
import { backend } from './lib/backend';
import { Logo } from './components/Logo';
import { applyTheme, getTheme } from './lib/theme';

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

/** While your data loads: the page's shapes in grey, so it settles into place instead of popping in. */
function LoadingSkeleton() {
  const block = (w: string | number, h: number) => <div className={s.skeleton} style={{ width: w, height: h }} />;
  return (
    <div role="status" aria-label="Loading your data" style={{ maxWidth: 1240, margin: '0 auto', padding: '40px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Logo size={36} />
        {block(220, 28)}
      </div>
      {block('60%', 18)}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 20 }}>
        {block('100%', 260)}
        {block('100%', 260)}
      </div>
      {block('100%', 180)}
    </div>
  );
}

// Google signs you in before Apps Script serves the page, so there is no login screen.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DataProvider
      backend={backend}
      loading={<LoadingSkeleton />}
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
