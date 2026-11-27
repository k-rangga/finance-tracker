import { StrictMode, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import s from './styles/ui.module.css';
import App from './App';
import { SettingsProvider } from './lib/settings';
import { DataProvider } from './lib/data';
import { backend } from './lib/backend';
import { Logo, type MaxieMood } from './components/Logo';
import { applyTheme, getTheme } from './lib/theme';
import { onVercel } from './lib/supabase';
import { AuthGate } from './components/SignIn';
import { pickBootReflection, readBootHint } from './lib/bootHint';

// Before the first paint, so the page never flashes the other theme.
applyTheme(getTheme());

const BOOT_AT = Date.now();
const MIN_LOAD_MS = 3000;
const MAX_PROGRESS_MS = 5000;

function Centered({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, textAlign: 'center', maxWidth: 360 }}>
        <Logo size={56} followCursor />
        {children}
      </div>
    </div>
  );
}

/**
 * Simple, frameless, calm-yet-cheerful loader: Maxie's head & ice-blue eyes follow the cursor,
 * 4 subtle mood variations rotate by time of day & session, and a 3s minimum display window gives
 * you time to enjoy your personalized behavioral reflection before the app settles in.
 */
function EditorialLoader({ ready = false, onEnter }: { ready?: boolean; onEnter?: () => void }) {
  const hint = useMemo(() => readBootHint(), []);
  const reflection = useMemo(() => pickBootReflection(hint), [hint]);
  const [hovered, setHovered] = useState(false);
  const [progress, setProgress] = useState(8);
  const [slow, setSlow] = useState(false);

  // Smooth progress glide: reaches ~88% over the 3s minimum, eases to 96% up to 5s, and snaps to 100% when ready.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const elapsed = Date.now() - BOOT_AT;
      if (elapsed >= MAX_PROGRESS_MS) setSlow(true);
      const target = ready
        ? Math.min(100, Math.max(85, (elapsed / MIN_LOAD_MS) * 100))
        : elapsed < MIN_LOAD_MS
          ? 8 + (elapsed / MIN_LOAD_MS) * 76
          : 84 + Math.min(1, (elapsed - MIN_LOAD_MS) / (MAX_PROGRESS_MS - MIN_LOAD_MS)) * 12;
      setProgress(target);
      if (elapsed < MAX_PROGRESS_MS + 400 || !ready) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ready]);

  const id = hint?.lang === 'id';
  const hr = new Date().getHours();
  const isLateNight = hr >= 22 || hr < 5;
  const isMorningCup = hr >= 6 && hr < 11 && !hint?.quiet;
  const isPayday = !!hint?.isPayday;

  const variation = useMemo<MaxieMood>(() => {
    if (isPayday) return 'happy';
    if (isLateNight) return 'cozy';
    const pool: MaxieMood[] = ['calm', 'curious', 'wink'];
    return pool[(new Date().getMinutes() + new Date().getDate()) % pool.length];
  }, [isPayday, isLateNight]);

  const activeMood: MaxieMood = hovered ? (variation === 'wink' || variation === 'happy' ? 'happy' : 'wink') : variation;
  const aura = isPayday ? 'payday' : isLateNight ? 'sky' : hint?.aura ?? 'clay';

  const baseHi = isPayday
    ? id
      ? 'Selamat gajian'
      : 'Happy payday'
    : isLateNight
      ? id
        ? 'Malam yang tenang'
        : 'Quiet evening'
      : id
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

  const statusText = ready
    ? id
      ? 'Siap — ketuk untuk masuk'
      : 'Ready — tap anywhere to enter'
    : slow
      ? id
        ? 'Hampir siap — menyinkronkan catatanmu…'
        : 'Almost ready — finishing up…'
      : id
        ? 'Menyiapkan siklusmu…'
        : 'Setting up your cycle…';

  const screenRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef({ x: 50, y: 42 });
  const curRef = useRef({ x: 50, y: 42 });
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([]);

  // Smoothly interpolate the warm ambient glow toward pointer (web) or phone tilt (mobile).
  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;

    let raf = 0;
    const tick = () => {
      const c = curRef.current;
      const t = targetRef.current;
      c.x += (t.x - c.x) * 0.1;
      c.y += (t.y - c.y) * 0.1;
      if (screenRef.current) {
        screenRef.current.style.setProperty('--gx', `${c.x.toFixed(2)}%`);
        screenRef.current.style.setProperty('--gy', `${c.y.toFixed(2)}%`);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.gamma == null && e.beta == null) return;
      // Map phone tilt: gamma (-35..35 deg) -> X (14%..86%), beta (10..75 deg) -> Y (16%..78%).
      const gx = Math.min(86, Math.max(14, 50 + ((e.gamma ?? 0) / 35) * 36));
      const gy = Math.min(78, Math.max(16, 44 + (((e.beta ?? 45) - 45) / 32) * 30));
      targetRef.current = { x: gx, y: gy };
    };
    window.addEventListener('deviceorientation', onOrient, true);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('deviceorientation', onOrient, true);
    };
  }, []);

  const moveGlow = (clientX: number, clientY: number) => {
    const el = screenRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = Math.min(95, Math.max(5, ((clientX - r.left) / Math.max(1, r.width)) * 100));
    const y = Math.min(95, Math.max(5, ((clientY - r.top) / Math.max(1, r.height)) * 100));
    targetRef.current = { x, y };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    moveGlow(e.clientX, e.clientY);
    const el = screenRef.current;
    if (el) {
      const r = el.getBoundingClientRect();
      const x = ((e.clientX - r.left) / Math.max(1, r.width)) * 100;
      const y = ((e.clientY - r.top) / Math.max(1, r.height)) * 100;
      const rid = Date.now() + Math.random();
      setRipples(prev => [...prev.slice(-3), { id: rid, x, y }]);
      setTimeout(() => setRipples(prev => prev.filter(p => p.id !== rid)), 950);
    }
    // On iOS 13+, request gentle motion permission on first tap if available.
    const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined;
    if (typeof DOE?.requestPermission === 'function') {
      DOE.requestPermission().catch(() => {});
    }
  };

  const dateEyebrow = new Date().toLocaleDateString(id ? 'id-ID' : 'en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <div
      ref={screenRef}
      className={s.bootScreen}
      role="status"
      aria-label={statusText}
      onPointerMove={e => {
        if (e.pointerType !== 'touch') moveGlow(e.clientX, e.clientY);
      }}
      onPointerDown={handlePointerDown}
      onClick={ready && onEnter ? onEnter : undefined}
      style={ready && onEnter ? { cursor: 'pointer' } : undefined}
    >
      <div className={s.bootGlow} aria-hidden="true" />
      <div className={s.bootSpotlight} aria-hidden="true" />
      {ripples.map(rp => (
        <span key={rp.id} className={s.bootRipple} style={{ left: `${rp.x}%`, top: `${rp.y}%` }} aria-hidden="true" />
      ))}
      <div className={s.bootStage}>
        <span className={s.bootEyebrow}>{dateEyebrow}</span>
        <div className={s.bootHaloWrap}>
          <span
            className={s.bootHalo}
            data-aura={aura}
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
          >
            <Logo size={62} mood={activeMood} followCursor />
          </span>
          {isMorningCup && (
            <span className={s.bootCup} aria-hidden="true" title="Morning coffee">
              <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 10h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5v-5Z" />
                <path d="M16 11.5h1.8a2.2 2.2 0 0 1 0 4.4H16" />
                <path className={s.bootSteam} d="M8.5 6.5c0-1.1.9-1.5.9-2.6M12.5 6.5c0-1.1.9-1.5.9-2.6" />
              </svg>
            </span>
          )}
        </div>
        <h1 className={s.bootGreeting}>{greeting}</h1>
        {!hint?.quiet && (
          <>
            <span className={s.bootRule} aria-hidden="true" />
            <p className={s.bootReflection}>{reflection}</p>
          </>
        )}
        <div className={s.bootTrack} aria-hidden="true">
          <span className={s.bootFill} style={{ width: `${Math.min(100, progress).toFixed(1)}%` }} />
        </div>
        <span className={s.bootStatus}>{statusText}</span>
      </div>
    </div>
  );
}

// Apps Script: Google signs you in before it serves the page. Vercel: sign in by email link first.
const app = (
  <DataProvider
    backend={backend}
    minLoadMs={MIN_LOAD_MS}
    bootAt={BOOT_AT}
    loading={({ ready, enterNow }) => <EditorialLoader ready={ready} onEnter={enterNow} />}
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
