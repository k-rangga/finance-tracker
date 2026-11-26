import { useEffect, useRef, useState } from 'react';
import s from '../styles/ui.module.css';
import { reducedMotion } from './Delight';

export type MaxieMood = 'calm' | 'happy' | 'curious' | 'steady';

const PET_CHEERS = [
  'You are doing great!',
  'High five!',
  'Cheering you on!',
  'Got your back!',
  'Smooth sailing!',
];

/**
 * Maxie, the Siberian husky mark: upright closer-set husky ears, double-tuft wolf cheeks, ivory mask with thin
 * forehead blaze and iconic white eyebrow pips, broad dog nose, and four quiet moods (`calm`, `happy`, `curious`,
 * `steady`). At 24px and below it switches to simplified bolder features (no eye glints or mouth).
 */
const HEAD =
  'M32 60C26.5 60 21 57 17.5 52L11.5 48.5L13.8 43.2L9.8 39L12.6 32.8C11.4 28.5 12 24 13.5 19.5L16.6 5.6Q17.6 3 19.8 4.8L27.6 13.6Q32 12.6 36.4 13.6L44.2 4.8Q46.4 3 47.4 5.6L50.5 19.5C52 24 52.6 28.5 51.4 32.8L54.2 39L50.2 43.2L52.5 48.5L46.5 52C43 57 37.5 60 32 60Z';
const INNER_EARS = 'M19 9.5L16.8 20.2Q20.4 16.8 24.4 15.8Z M45 9.5L47.2 20.2Q43.6 16.8 39.6 15.8Z';
const MASK =
  'M32 15.6L33.8 25.4C36.4 24.2 39.8 24 43.2 25.6C46.4 27.2 48.2 30.2 48.4 33.8C50.2 37.5 50.4 42.2 48.4 46.2C45.4 52.2 39.2 56.4 32 56.4C24.8 56.4 18.6 52.2 15.6 46.2C13.6 42.2 13.8 37.5 15.6 33.8C15.8 30.2 17.6 27.2 20.8 25.6C24.2 24 27.6 24.2 30.2 25.4Z';
const BROWS = 'M20.8 22.0Q24.0 19.2 27.2 21.2Q24.2 23.0 20.8 22.0Z M43.2 22.0Q40.0 19.2 36.8 21.2Q39.8 23.0 43.2 22.0Z';
const NOSE = 'M26.8 41.2Q32 39.6 37.2 41.2Q36.8 44.8 32 46.6Q27.2 44.8 26.8 41.2Z';
const EYES = 'M18.6 32.2Q23.5 27.6 28.4 32.8Q23.3 37.0 18.6 32.2Z M45.4 32.2Q40.5 27.6 35.6 32.8Q40.7 37.0 45.4 32.2Z';
const EYE_FILL = 'M20.4 32.4Q23.6 29.6 26.8 32.8Q23.4 35.4 20.4 32.4Z M43.6 32.4Q40.4 29.6 37.2 32.8Q40.6 35.4 43.6 32.4Z';
const EYES_SMALL = 'M18 32Q23.5 27.6 28.8 32.8Q23 37 18 32Z M46 32Q40.5 27.6 35.2 32.8Q41 37 46 32Z';
const NOSE_SMALL = 'M26.2 41Q32 39.2 37.8 41Q37.4 45.4 32 47.6Q26.6 45.4 26.2 41Z';

/** `tone`: clay (default), ink (one colour), or on-clay (sitting on a clay fill). */
export function Logo({
  size,
  tone = 'clay',
  mood = 'calm',
  interactive = false,
  cheer,
  label,
}: {
  size: number;
  tone?: 'clay' | 'ink' | 'on-clay';
  mood?: MaxieMood;
  /** Clicking Maxie gives a playful happy perk + brief cheerful speech bubble (respects reduced motion). */
  interactive?: boolean;
  /** Optional custom short line shown when tapped (falls back to cheerful defaults). */
  cheer?: string;
  label?: string;
}) {
  const [perked, setPerked] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const tapCount = useRef(0);
  useEffect(() => {
    if (!perked) return;
    const t = setTimeout(() => setPerked(false), 750);
    return () => clearTimeout(t);
  }, [perked]);
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 1800);
    return () => clearTimeout(t);
  }, [note]);

  const small = size <= 24;
  const activeMood: MaxieMood = perked ? 'happy' : mood;
  const cap = tone === 'clay' ? 'var(--clay)' : 'var(--mark-ink)';
  const face = 'var(--mark-face)';
  const tilt = activeMood === 'curious' ? 'rotate(-5 32 34)' : undefined;

  const svg = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={perked && !reducedMotion() ? s.mxBounce : undefined}
      style={{
        flex: 'none',
        display: 'block',
        transition: 'transform 180ms ease-out',
      }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <g transform={tilt} style={{ transition: 'transform 180ms ease-out' }}>
        <path d={HEAD} fill={cap} />
        <path d={INNER_EARS} fill={face} />
        <path d={MASK} fill={face} />
        <path d={BROWS} fill={face} />
        {activeMood === 'happy' ? (
          <>
            <path d="M19.4 33.4Q23.6 28.6 27.8 33.4 M36.2 33.4Q40.4 28.6 44.6 33.4" fill="none" stroke={cap} strokeWidth={small ? 3.2 : 2.6} strokeLinecap="round" />
            <path d={small ? NOSE_SMALL : NOSE} fill={cap} />
            {!small && <path d="M26 49.4Q32 55 38 49.4Q32 51.2 26 49.4Z" fill={cap} />}
          </>
        ) : (
          <>
            <path d={small ? EYES_SMALL : EYES} fill={cap} />
            {!small && (
              <>
                {tone === 'clay' && <path d={EYE_FILL} fill="var(--mark-eye)" />}
                <circle cx={24.5} cy={31.9} r={tone === 'clay' ? 0.85 : 1.05} fill={face} />
                <circle cx={39.5} cy={31.9} r={tone === 'clay' ? 0.85 : 1.05} fill={face} />
              </>
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
      </g>
    </svg>
  );

  if (!interactive) return svg;
  const onPet = () => {
    const idx = tapCount.current++;
    const line = idx === 0 && cheer ? cheer : PET_CHEERS[idx % PET_CHEERS.length];
    setPerked(true);
    setNote(line);
  };
  return (
    <span className={s.mxLogoWrap}>
      <button
        type="button"
        onClick={onPet}
        aria-label={label ?? 'Say hi to Maxie'}
        title="Say hi to Maxie"
        className={s.mxLogoBtn}
      >
        {svg}
      </button>
      {note && (
        <span className={s.mxSpeech} role="status" aria-live="polite">
          {note}
        </span>
      )}
    </span>
  );
}
