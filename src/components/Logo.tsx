import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import s from '../styles/ui.module.css';
import { reducedMotion } from './Delight';
import { haptic } from '../lib/haptics';

export type MaxieMood = 'calm' | 'happy' | 'curious' | 'steady' | 'cozy' | 'wink';

const PET_CHEERS = {
  en: ['You are doing great.', 'High five.', 'Cheering you on.', 'Got your back.', 'Smooth sailing.'],
  id: ['Keren hari ini.', 'Tos dulu.', 'Aku dukung terus.', 'Santai, aman kok.', 'Lancar terus.'],
};
const STREAK_CHEERS = {
  en: ['Quietly unstoppable.', 'High five x3 — lovely energy.'],
  id: ['Tenang tapi mantap.', 'Tos tiga kali — energi yang enak.'],
};

const currentLang = (): 'en' | 'id' => (typeof document !== 'undefined' && document.documentElement.dataset.lang === 'id' ? 'id' : 'en');

type BubblePos = { text: string; style: CSSProperties; place: 'right' | 'bottom' | 'top' };

/**
 * Maxie, the Siberian husky mark: upright closer-set husky ears, double-tuft wolf cheeks, ivory mask with thin
 * forehead blaze and iconic white eyebrow pips, broad dog nose, and calm moods (`calm`, `happy`, `curious`,
 * `steady`, `cozy`, `wink`). Supports optional cursor-following eyes and gentle head tilt.
 */
const FACE_BASE =
  'M32 60C26.5 60 21 57 17.5 52L11.5 48.5L13.8 43.2L9.8 39L12.6 32.8C11.4 28.5 12 24 13.5 19.5Q19.5 15 27.6 13.6Q32 12.6 36.4 13.6Q44.5 15 50.5 19.5C52 24 52.6 28.5 51.4 32.8L54.2 39L50.2 43.2L52.5 48.5L46.5 52C43 57 37.5 60 32 60Z';
const LEFT_EAR_OUTER = 'M13.2 23L13.5 19.5L16.6 5.6Q17.6 3 19.8 4.8L27.6 13.6L28.2 16.5Z';
const RIGHT_EAR_OUTER = 'M50.8 23L50.5 19.5L47.4 5.6Q46.4 3 44.2 4.8L36.4 13.6L35.8 16.5Z';
const LEFT_EAR_INNER = 'M19 9.5L16.8 20.2Q20.4 16.8 24.4 15.8Z';
const RIGHT_EAR_INNER = 'M45 9.5L47.2 20.2Q43.6 16.8 39.6 15.8Z';
const MASK =
  'M32 15.6L33.8 25.4C36.4 24.2 39.8 24 43.2 25.6C46.4 27.2 48.2 30.2 48.4 33.8C50.2 37.5 50.4 42.2 48.4 46.2C45.4 52.2 39.2 56.4 32 56.4C24.8 56.4 18.6 52.2 15.6 46.2C13.6 42.2 13.8 37.5 15.6 33.8C15.8 30.2 17.6 27.2 20.8 25.6C24.2 24 27.6 24.2 30.2 25.4Z';
const BROWS = 'M20.8 22.0Q24.0 19.2 27.2 21.2Q24.2 23.0 20.8 22.0Z M43.2 22.0Q40.0 19.2 36.8 21.2Q39.8 23.0 43.2 22.0Z';
const NOSE = 'M26.8 41.2Q32 39.6 37.2 41.2Q36.8 44.8 32 46.6Q27.2 44.8 26.8 41.2Z';
const LEFT_EYE = 'M18.6 32.2Q23.5 27.6 28.4 32.8Q23.3 37.0 18.6 32.2Z';
const RIGHT_EYE = 'M45.4 32.2Q40.5 27.6 35.6 32.8Q40.7 37.0 45.4 32.2Z';
const EYES = `${LEFT_EYE} ${RIGHT_EYE}`;
const LEFT_EYE_FILL = 'M20.4 32.4Q23.6 29.6 26.8 32.8Q23.4 35.4 20.4 32.4Z';
const RIGHT_EYE_FILL = 'M43.6 32.4Q40.4 29.6 37.2 32.8Q40.6 35.4 43.6 32.4Z';
const EYE_FILL = `${LEFT_EYE_FILL} ${RIGHT_EYE_FILL}`;
const EYES_SMALL = 'M18 32Q23.5 27.6 28.8 32.8Q23 37 18 32Z M46 32Q40.5 27.6 35.2 32.8Q41 37 46 32Z';
const NOSE_SMALL = 'M26.2 41Q32 39.2 37.8 41Q37.4 45.4 32 47.6Q26.6 45.4 26.2 41Z';

/** `tone`: clay (default), ink (one colour), or on-clay (sitting on a clay fill). */
export function Logo({
  size,
  tone = 'clay',
  mood = 'calm',
  interactive = false,
  followCursor = false,
  coverEyes = false,
  celebrate = false,
  cheer,
  label,
}: {
  size: number;
  tone?: 'clay' | 'ink' | 'on-clay';
  mood?: MaxieMood;
  /** Clicking Maxie gives a gentle perk + brief cheerful speech bubble (respects reduced motion). */
  interactive?: boolean;
  /** Gently tilts Maxie's head, perks the nearer ear, and shifts the ice-blue eyes toward the cursor. */
  followCursor?: boolean;
  /** Covers Maxie's eyes with cute paws (e.g., while typing a secret PIN). */
  coverEyes?: boolean;
  /** Triggers a happy celebration hop on sign-in success. */
  celebrate?: boolean;
  /** Optional custom short line shown when tapped (falls back to cheerful defaults). */
  cheer?: string;
  label?: string;
}) {
  const [perked, setPerked] = useState(false);
  const [bubble, setBubble] = useState<BubblePos | null>(null);
  const [gaze, setGaze] = useState({ x: 0, y: 0 });
  const [blinking, setBlinking] = useState(false);
  const [idleEar, setIdleEar] = useState<-1 | 0 | 1>(0);
  const tapCount = useRef(0);
  const btnRef = useRef<HTMLButtonElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const clipId = useId();

  useEffect(() => {
    if (!perked) return;
    const t = setTimeout(() => setPerked(false), 750);
    return () => clearTimeout(t);
  }, [perked]);
  useEffect(() => {
    if (!bubble) return;
    const t = setTimeout(() => setBubble(null), 1900);
    return () => clearTimeout(t);
  }, [bubble]);

  // Cursor tracking for gentle head tilt, ear perk, and eye gaze.
  useEffect(() => {
    if (!followCursor || reducedMotion() || typeof window === 'undefined') return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = svgRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const dx = Math.max(-1, Math.min(1, (e.clientX - cx) / 240));
        const dy = Math.max(-1, Math.min(1, (e.clientY - cy) / 240));
        setGaze({ x: dx, y: dy });
      });
    };
    const onLeave = () => setGaze({ x: 0, y: 0 });
    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('mouseleave', onLeave);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('mouseleave', onLeave);
    };
  }, [followCursor]);

  // Natural calm blink every ~4.6s when alive (tracking cursor or interactive on phones).
  useEffect(() => {
    if ((!followCursor && !interactive) || reducedMotion()) return;
    let blinkOff = 0;
    const interval = window.setInterval(() => {
      setBlinking(true);
      blinkOff = window.setTimeout(() => setBlinking(false), 140);
    }, 4600);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(blinkOff);
    };
  }, [followCursor, interactive]);

  // Subtle idle ear flick every ~7.8s when interactive so Maxie feels warmly alive on touch devices.
  useEffect(() => {
    if (!interactive || reducedMotion()) return;
    let off = 0;
    let side: -1 | 1 = 1;
    const interval = window.setInterval(() => {
      side = side === 1 ? -1 : 1;
      setIdleEar(side);
      off = window.setTimeout(() => setIdleEar(0), 420);
    }, 7800);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(off);
    };
  }, [interactive]);

  const small = size <= 24;
  const hiding = coverEyes && !small;
  const activeMood: MaxieMood = perked || celebrate ? 'happy' : mood;
  const cap = tone === 'clay' ? 'var(--clay)' : 'var(--mark-ink)';
  const face = 'var(--mark-face)';
  const baseTilt = hiding ? 0 : activeMood === 'curious' ? -5 : activeMood === 'cozy' ? 2.5 : 0;
  const deg = baseTilt + (followCursor && !hiding ? gaze.x * 7.5 : 0);
  const headDx = followCursor && !hiding ? gaze.x * 1.15 : 0;
  const headDy = followCursor && !hiding ? gaze.y * 0.85 : 0;
  const eyeDx = followCursor && !hiding ? gaze.x * 1.45 : 0;
  const eyeDy = followCursor && !hiding ? gaze.y * 0.95 : 0;
  const leftEarDeg = (followCursor && !hiding && gaze.x < -0.15 ? gaze.x * 4.2 : 0) + (idleEar === -1 ? -4.5 : 0);
  const rightEarDeg = (followCursor && !hiding && gaze.x > 0.15 ? gaze.x * 4.2 : 0) + (idleEar === 1 ? 4.5 : 0);
  const headTransform =
    deg !== 0 || headDx !== 0 || headDy !== 0
      ? `translate(${headDx.toFixed(2)} ${headDy.toFixed(2)}) rotate(${deg.toFixed(2)} 32 34)`
      : undefined;
  const eyeTransform = eyeDx !== 0 || eyeDy !== 0 ? `translate(${eyeDx.toFixed(2)} ${eyeDy.toFixed(2)})` : undefined;
  const leftEarTransform = leftEarDeg !== 0 ? `rotate(${leftEarDeg.toFixed(2)} 20.5 16.5)` : undefined;
  const rightEarTransform = rightEarDeg !== 0 ? `rotate(${rightEarDeg.toFixed(2)} 43.5 16.5)` : undefined;

  const svg = (
    <svg
      ref={svgRef}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={(perked || celebrate) && !reducedMotion() ? s.mxBounce : undefined}
      style={{
        flex: 'none',
        display: 'block',
        overflow: 'visible',
        transition: 'transform 200ms cubic-bezier(0.22, 1, 0.36, 1)',
      }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {!small && (
        <defs>
          <clipPath id={clipId}>
            <path d={activeMood === 'wink' ? LEFT_EYE : EYES} />
          </clipPath>
        </defs>
      )}
      <g transform={headTransform} style={{ transition: 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)' }}>
        <path d={FACE_BASE} fill={cap} />
        <g transform={leftEarTransform} style={{ transition: 'transform 180ms cubic-bezier(0.22, 1, 0.36, 1)' }}>
          <path d={LEFT_EAR_OUTER} fill={cap} />
          <path d={LEFT_EAR_INNER} fill={face} />
        </g>
        <g transform={rightEarTransform} style={{ transition: 'transform 180ms cubic-bezier(0.22, 1, 0.36, 1)' }}>
          <path d={RIGHT_EAR_OUTER} fill={cap} />
          <path d={RIGHT_EAR_INNER} fill={face} />
        </g>
        <path d={MASK} fill={face} />
        <path d={BROWS} fill={face} />
        {activeMood === 'happy' || blinking ? (
          <>
            <path d="M19.4 33.4Q23.6 28.6 27.8 33.4 M36.2 33.4Q40.4 28.6 44.6 33.4" fill="none" stroke={cap} strokeWidth={small ? 3.2 : 2.6} strokeLinecap="round" />
            <path d={small ? NOSE_SMALL : NOSE} fill={cap} />
            {!small &&
              (activeMood === 'happy' ? (
                <path d="M26 49.4Q32 55 38 49.4Q32 51.2 26 49.4Z" fill={cap} />
              ) : (
                <path d="M32 46.2V49.2 M26.4 50.4Q29.2 52.4 32 49.4Q34.8 52.4 37.6 50.4" fill="none" stroke={cap} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
              ))}
          </>
        ) : activeMood === 'cozy' ? (
          <>
            <path d="M19.2 32.8Q23.6 35.6 28.0 32.8 M36.0 32.8Q40.4 35.6 44.8 32.8" fill="none" stroke={cap} strokeWidth={small ? 3.0 : 2.4} strokeLinecap="round" />
            <path d={small ? NOSE_SMALL : NOSE} fill={cap} />
            {!small && <path d="M32 46.2V49.2 M27.2 50.4Q32 52.6 36.8 50.4" fill="none" stroke={cap} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />}
          </>
        ) : activeMood === 'wink' ? (
          <>
            <path d={LEFT_EYE} fill={cap} />
            {!small && (
              <g clipPath={`url(#${clipId})`}>
                <g transform={eyeTransform} style={{ transition: 'transform 160ms cubic-bezier(0.22, 1, 0.36, 1)' }}>
                  {tone === 'clay' && <path d={LEFT_EYE_FILL} fill="var(--mark-eye)" />}
                  <circle cx={24.5} cy={31.9} r={tone === 'clay' ? 0.85 : 1.05} fill={face} />
                </g>
              </g>
            )}
            <path d="M36.2 33.2Q40.4 28.8 44.6 33.2" fill="none" stroke={cap} strokeWidth={small ? 3.2 : 2.6} strokeLinecap="round" />
            <path d={small ? NOSE_SMALL : NOSE} fill={cap} />
            {!small && <path d="M32 46.2V49.2 M26.4 50.4Q29.2 52.6 32 49.4Q34.8 52.6 37.6 50.4" fill="none" stroke={cap} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />}
          </>
        ) : (
          <>
            <path d={small ? EYES_SMALL : EYES} fill={cap} />
            {!small && (
              <g clipPath={`url(#${clipId})`}>
                <g transform={eyeTransform} style={{ transition: 'transform 160ms cubic-bezier(0.22, 1, 0.36, 1)' }}>
                  {tone === 'clay' && <path d={EYE_FILL} fill="var(--mark-eye)" />}
                  <circle cx={24.5} cy={31.9} r={tone === 'clay' ? 0.85 : 1.05} fill={face} />
                  <circle cx={39.5} cy={31.9} r={tone === 'clay' ? 0.85 : 1.05} fill={face} />
                </g>
              </g>
            )}
            <path d={small ? NOSE_SMALL : NOSE} fill={cap} />
            {!small &&
              (activeMood === 'steady' ? (
                <path d="M32 46.2V49.2 M27.4 50.4Q32 51.8 36.6 50.4" fill="none" stroke={cap} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
              ) : (
                <path d="M32 46.2V49.2 M26.4 50.4Q29.2 52.4 32 49.4Q34.8 52.4 37.6 50.4" fill="none" stroke={cap} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
              ))}
          </>
        )}
        {!small && (
          <g
            style={{
              transform: hiding ? 'translateY(0px)' : 'translateY(24px)',
              opacity: hiding ? 1 : 0,
              transition: 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1), opacity 160ms ease',
              pointerEvents: 'none',
            }}
          >
            {/* Left paw gently covering left eye while PIN is focused */}
            <ellipse cx="22.5" cy="32.5" rx="6.8" ry="5.6" transform="rotate(-14 22.5 32.5)" fill={face} stroke={cap} strokeWidth="2" />
            <line x1="20.4" y1="28.6" x2="21" y2="32.4" stroke={cap} strokeWidth="1.4" strokeLinecap="round" />
            <line x1="23.4" y1="28.1" x2="23.6" y2="32" stroke={cap} strokeWidth="1.4" strokeLinecap="round" />
            {/* Right paw gently covering right eye */}
            <ellipse cx="41.5" cy="32.5" rx="6.8" ry="5.6" transform="rotate(14 41.5 32.5)" fill={face} stroke={cap} strokeWidth="2" />
            <line x1="40.6" y1="28.1" x2="40.4" y2="32" stroke={cap} strokeWidth="1.4" strokeLinecap="round" />
            <line x1="43.6" y1="28.6" x2="43" y2="32.4" stroke={cap} strokeWidth="1.4" strokeLinecap="round" />
          </g>
        )}
      </g>
    </svg>
  );

  if (!interactive) return svg;
  const onPet = () => {
    haptic('tap');
    const idx = tapCount.current++;
    const lang = currentLang();
    const list = PET_CHEERS[lang];
    const streak = STREAK_CHEERS[lang];
    const text =
      idx === 0 && cheer
        ? cheer
        : idx >= 2 && (idx + 1) % 3 === 0
          ? streak[Math.floor(idx / 3) % streak.length]
          : list[idx % list.length];
    setPerked(true);
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    const vw = window.innerWidth;
    if (rect.top < 64 && rect.left < 140) {
      // Near top-left (e.g. sidebar brand mark): pop neatly to the right.
      setBubble({ text, place: 'right', style: { left: rect.right + 10, top: rect.top + rect.height / 2 } });
    } else if (rect.top < 64) {
      // Near the top edge elsewhere (mobile header, chat header): pop cleanly below.
      setBubble({ text, place: 'bottom', style: { left: Math.max(12, Math.min(rect.left, vw - 220)), top: rect.bottom + 8 } });
    } else {
      // Room above: pop above, clamped safely inside the viewport.
      setBubble({ text, place: 'top', style: { left: Math.max(12, Math.min(rect.left, vw - 220)), top: rect.top - 8 } });
    }
  };
  return (
    <span className={s.mxLogoWrap}>
      <button
        ref={btnRef}
        type="button"
        onClick={onPet}
        aria-label={label ?? 'Say hi to Maxie'}
        title="Say hi to Maxie"
        className={s.mxLogoBtn}
      >
        {svg}
      </button>
      {bubble &&
        typeof document !== 'undefined' &&
        createPortal(
          <span key={tapCount.current} className={s.mxSpeech} data-place={bubble.place} style={bubble.style} role="status" aria-live="polite">
            {bubble.text}
          </span>,
          document.body,
        )}
    </span>
  );
}
