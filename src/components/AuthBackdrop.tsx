import { useEffect, useState } from 'react';
import s from '../styles/ui.module.css';
import { Logo, type MaxieMood } from './Logo';
import { reducedMotion } from './Delight';

type Variant = 'hop-arc' | 'peek-bounce' | 'zoom-dash' | 'pounce-spin';
type Side = 'left' | 'right';

type HuskyEvent = {
  id: number;
  variant: Variant;
  side: Side;
  mood: MaxieMood;
  yOffset: number;
};

const VARIANTS: Variant[] = ['hop-arc', 'peek-bounce', 'zoom-dash', 'pounce-spin'];
const MOODS: MaxieMood[] = ['happy', 'wink', 'curious'];

const DURATION_MS: Record<Variant, number> = {
  'hop-arc': 3200,
  'peek-bounce': 3400,
  'zoom-dash': 4200,
  'pounce-spin': 3000,
};

/** Full-body jumping husky pup drawn in Maxie's ceramic clay, ivory mask, and ice-blue eye palette. */
function LeapingHuskyPup({ flip = false }: { flip?: boolean }) {
  return (
    <svg
      width="84"
      height="66"
      viewBox="0 0 96 76"
      fill="none"
      style={flip ? { transform: 'scaleX(-1)' } : undefined}
      aria-hidden="true"
    >
      {/* Curled husky plume tail */}
      <path
        d="M27 42 C16 37 11 26 16 17 C20 11 28 14 27 22 C26 27 23 30 28 35 Z"
        fill="var(--clay)"
      />
      <path
        d="M17 19 C19 14 25 15 25 21 C23 23 19 23 17 19 Z"
        fill="var(--mark-face)"
      />
      {/* Trailing hind leg */}
      <path d="M31 48 L19 59 Q16 62 20 63 L35 53 Z" fill="var(--clay)" />
      <ellipse cx="20" cy="61.5" rx="3.4" ry="2.2" fill="var(--mark-face)" />
      {/* Torso + ivory chest */}
      <path
        d="M27 38 C32 30 48 28 59 33 C63 39 59 49 48 51 C36 53 26 48 27 38 Z"
        fill="var(--clay)"
      />
      <path
        d="M36 47 C43 47 52 46 58 41 C60 44 55 50 47 51 C40 52 35 50 36 47 Z"
        fill="var(--mark-face)"
      />
      {/* Reached front paws */}
      <path d="M55 37 L74 31 Q78 30 77 34 L57 42 Z" fill="var(--clay)" />
      <ellipse cx="75.5" cy="32.5" rx="3.4" ry="2.2" fill="var(--mark-face)" />
      <path d="M52 44 L69 47 Q73 48 71 52 L50 48 Z" fill="var(--clay)" />
      <ellipse cx="70" cy="49.5" rx="3.2" ry="2.1" fill="var(--mark-face)" />
      {/* Upright Siberian husky ears */}
      <path d="M54 22 L53 8 Q55 6 58 9 L62 19 Z" fill="var(--clay)" />
      <path d="M55 19 L55 11 L59 17 Z" fill="var(--mark-face)" />
      <path d="M63 21 L67 7 Q70 6 71 10 L71 21 Z" fill="var(--clay)" />
      <path d="M65 18 L68 11 L70 18 Z" fill="var(--mark-face)" />
      {/* Head + ivory mask */}
      <circle cx="65" cy="27" r="11.5" fill="var(--clay)" />
      <path
        d="M58 29 C61 23 68 22 74 25 C77 27 80 28 80 31 C80 35 74 37 66 37 C60 37 56 34 58 29 Z"
        fill="var(--mark-face)"
      />
      {/* Husky brow pip + happy eye + snout nose */}
      <ellipse cx="64.5" cy="22.5" rx="2.1" ry="1.1" fill="var(--mark-face)" />
      <circle cx="67.5" cy="26.8" r="2.1" fill="var(--mark-ink)" />
      <circle cx="68.2" cy="26.3" r="0.85" fill="var(--mark-eye)" />
      <path d="M77 27.5 Q81 27.5 80 31 Q77 32 76 29.5 Z" fill="var(--mark-ink)" />
    </svg>
  );
}

/** Tiny ceramic paw print trail accent. */
function PawPrint({ scale = 1, rotate = 0 }: { scale?: number; rotate?: number }) {
  return (
    <svg
      width={18 * scale}
      height={18 * scale}
      viewBox="0 0 24 24"
      fill="var(--clay)"
      style={{ transform: `rotate(${rotate}deg)` }}
      aria-hidden="true"
    >
      <ellipse cx="12" cy="15.5" rx="4.4" ry="3.8" />
      <circle cx="6.8" cy="9.6" r="1.8" />
      <circle cx="10.4" cy="7.2" r="1.8" />
      <circle cx="14.2" cy="7.2" r="1.8" />
      <circle cx="17.6" cy="9.8" r="1.8" />
    </svg>
  );
}

/** Four-point ceramic sparkle chased during the pounce variation. */
function ClaySparkle() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--clay)" aria-hidden="true">
      <path d="M12 2 L14.4 9.6 L22 12 L14.4 14.4 L12 22 L9.6 14.4 L2 12 L9.6 9.6 Z" />
    </svg>
  );
}

/** Atmospheric backdrop for sign-in: warm ceramic glows, subtle dot field, and occasional playful jumping huskies. */
export function AuthBackdrop() {
  const [evt, setEvt] = useState<HuskyEvent | null>(null);

  useEffect(() => {
    if (reducedMotion() || typeof window === 'undefined') return;

    let cancelled = false;
    let idSeq = 1;
    let lastVariant: Variant | null = null;
    let nextTimer = 0;
    let clearTimer = 0;

    const triggerOnce = () => {
      if (cancelled) return;
      const choices = VARIANTS.filter(v => v !== lastVariant);
      const variant = choices[Math.floor(Math.random() * choices.length)] ?? 'hop-arc';
      lastVariant = variant;

      const side: Side = Math.random() < 0.5 ? 'left' : 'right';
      const mood = MOODS[Math.floor(Math.random() * MOODS.length)] ?? 'happy';
      const yOffset = Math.round(Math.random() * 10);
      const duration = DURATION_MS[variant];

      setEvt({ id: idSeq++, variant, side, mood, yOffset });

      clearTimer = window.setTimeout(() => {
        if (cancelled) return;
        setEvt(null);
        const pauseMs = 4200 + Math.round(Math.random() * 2600);
        nextTimer = window.setTimeout(triggerOnce, pauseMs);
      }, duration);
    };

    // First playful appearance shortly after arriving on the screen.
    nextTimer = window.setTimeout(triggerOnce, 1500);

    return () => {
      cancelled = true;
      window.clearTimeout(nextTimer);
      window.clearTimeout(clearTimer);
    };
  }, []);

  return (
    <div className={s.authBackdrop} aria-hidden="true">
      <div className={s.authGlowA} />
      <div className={s.authGlowB} />
      <div className={s.authDots} />

      {evt && evt.variant === 'hop-arc' && (
        <div
          key={evt.id}
          className={`${s.huskyStageItem} ${evt.side === 'left' ? s.huskyHopArcL : s.huskyHopArcR}`}
          style={{
            bottom: `${4 + evt.yOffset}%`,
            ...(evt.side === 'left' ? { left: '5%' } : { right: '5%' }),
          }}
        >
          <LeapingHuskyPup flip={evt.side === 'right'} />
          <span
            className={s.huskyPawFade}
            style={{
              position: 'absolute',
              bottom: -10,
              ...(evt.side === 'left' ? { left: 10 } : { right: 10 }),
              animationDelay: '250ms',
            }}
          >
            <PawPrint scale={0.85} rotate={evt.side === 'left' ? 18 : -18} />
          </span>
        </div>
      )}

      {evt && evt.variant === 'peek-bounce' && (
        <div
          key={evt.id}
          className={`${s.huskyStageItem} ${s.huskyPeekUp}`}
          style={{
            bottom: -4,
            ...(evt.side === 'left' ? { left: `${10 + evt.yOffset}%` } : { right: `${10 + evt.yOffset}%` }),
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          <Logo size={56} mood={evt.mood} />
          <div style={{ display: 'flex', gap: 18, marginTop: -6 }}>
            <span style={{ width: 14, height: 8, borderRadius: '8px 8px 3px 3px', background: 'var(--mark-face)', border: '2px solid var(--clay)' }} />
            <span style={{ width: 14, height: 8, borderRadius: '8px 8px 3px 3px', background: 'var(--mark-face)', border: '2px solid var(--clay)' }} />
          </div>
        </div>
      )}

      {evt && evt.variant === 'zoom-dash' && (
        <div key={evt.id} style={{ position: 'absolute', left: 0, right: 0, bottom: `${3 + (evt.yOffset % 5)}%`, height: 84 }}>
          <div className={`${s.huskyStageItem} ${evt.side === 'left' ? s.huskyZoomLR : s.huskyZoomRL}`}>
            <LeapingHuskyPup flip={evt.side === 'right'} />
          </div>
          {[0, 1, 2].map(i => (
            <span
              key={i}
              className={s.huskyPawFade}
              style={{
                position: 'absolute',
                bottom: 4 + (i % 2) * 8,
                left: evt.side === 'left' ? `${22 + i * 24}%` : `${74 - i * 24}%`,
                animationDelay: `${650 + i * 820}ms`,
              }}
            >
              <PawPrint scale={0.85} rotate={evt.side === 'left' ? 72 : -72} />
            </span>
          ))}
        </div>
      )}

      {evt && evt.variant === 'pounce-spin' && (
        <div
          key={evt.id}
          className={`${s.huskyStageItem} ${evt.side === 'left' ? s.huskyPounceL : s.huskyPounceR}`}
          style={{
            top: `${14 + evt.yOffset}%`,
            ...(evt.side === 'left' ? { left: '7%' } : { right: '7%' }),
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          {evt.side === 'right' && (
            <span className={s.huskySparkle}>
              <ClaySparkle />
            </span>
          )}
          <Logo size={48} mood={evt.mood} />
          {evt.side === 'left' && (
            <span className={s.huskySparkle}>
              <ClaySparkle />
            </span>
          )}
        </div>
      )}
    </div>
  );
}
