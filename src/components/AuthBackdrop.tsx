import { useEffect, useRef, useState } from 'react';
import s from '../styles/ui.module.css';
import { reducedMotion } from './Delight';
import type { ResolvedAtmosphere, SeasonVibe, WeatherMood } from '../lib/atmosphere';

export type TreatDrop = { id: number; x: number; y: number };

type Variant = 'hop-arc' | 'peek-bounce' | 'zoom-dash' | 'pounce-spin';
type Side = 'left' | 'right';
type HeadMood = 'happy' | 'wink' | 'curious' | 'full';
type Mode = 'ambient' | 'chase' | 'eating' | 'exit' | 'full';
type TreatKind = 'bone' | 'kibble' | 'biscuit' | 'gingerbread' | 'starCookie' | 'pupsicle';

type ActiveTreat = {
  id: number;
  x: number;
  y: number;
  kind: TreatKind;
  rot: number;
};

type CrumbBurst = {
  id: number;
  x: number;
  y: number;
  ripple: boolean;
};

type MiniQuip = {
  id: number;
  x: number;
  y: number;
  text: string;
};

type PetHeart = {
  id: number;
  dx: number;
};

type HuskyEvent = {
  id: number;
  variant: Variant;
  side: Side;
  mood: Exclude<HeadMood, 'full'>;
  yOffset: number;
};

const VARIANTS: Variant[] = ['hop-arc', 'peek-bounce', 'zoom-dash', 'pounce-spin'];
const MOODS: Array<Exclude<HeadMood, 'full'>> = ['happy', 'wink', 'curious'];

const DURATION_MS: Record<Variant, number> = {
  'hop-arc': 3200,
  'peek-bounce': 3400,
  'zoom-dash': 4200,
  'pounce-spin': 3000,
};

const BITE_QUIPS = [
  'nom nom!',
  'crunch!',
  'ooh snacks!',
  'getting round...',
  'oof, tight collar',
];

const FULL_LINES = [
  "Oof... I'm officially a happy loaf. Need a tiny breather.",
  "Belly's at 100%. Too cozy to sprint right now!",
  "Okay okay, I'm stuffed! Just resting my paws for a bit.",
  'Too many good snacks... catching a quick food nap.',
  "I'm full! Give my little tummy a moment to settle.",
];

const EXTRA_FULL_LINES = [
  'Still full! My collar is working overtime here.',
  'Nice try — my belly says save it for later.',
  'Not even one tiny crumb fits right now, friend.',
];

const BELLY_RUB_LINES = [
  'Ooh, nice belly rub...',
  'Hehe that actually helps!',
  'Good scratches — almost ready to run again!',
];

// Deterministic atmospheric particle coordinates so renders stay clean and predictable.
const RAIN_DROPS = Array.from({ length: 18 }, (_, i) => ({
  left: `${4 + ((i * 5.3 + (i % 3) * 1.4) % 92).toFixed(1)}%`,
  delay: `${-((i * 0.21) % 1.4).toFixed(2)}s`,
  dur: `${(0.75 + (i % 4) * 0.14).toFixed(2)}s`,
}));

const SNOW_FLAKES = Array.from({ length: 16 }, (_, i) => ({
  left: `${5 + ((i * 6.1 + (i % 2) * 2.5) % 90).toFixed(1)}%`,
  delay: `${-((i * 0.85) % 6).toFixed(2)}s`,
  dur: `${(5.5 + (i % 5) * 1.1).toFixed(1)}s`,
  size: 5 + (i % 3) * 2,
}));

const NIGHT_STARS = [
  { x: '9%', y: '12%', r: 2.2, d: '0s' },
  { x: '18%', y: '22%', r: 1.6, d: '1.1s' },
  { x: '27%', y: '9%', r: 2.4, d: '0.5s' },
  { x: '36%', y: '19%', r: 1.5, d: '1.9s' },
  { x: '48%', y: '7%', r: 1.8, d: '0.8s' },
  { x: '61%', y: '14%', r: 2.1, d: '1.5s' },
  { x: '71%', y: '26%', r: 1.7, d: '0.3s' },
  { x: '79%', y: '10%', r: 2.3, d: '2.1s' },
  { x: '91%', y: '18%', r: 1.8, d: '1.4s' },
  { x: '13%', y: '38%', r: 1.5, d: '2.4s' },
  { x: '86%', y: '34%', r: 1.9, d: '0.7s' },
  { x: '22%', y: '52%', r: 1.4, d: '1.7s' },
];

const SUN_MOTES = Array.from({ length: 10 }, (_, i) => ({
  left: `${10 + i * 8.4}%`,
  top: `${16 + ((i * 19) % 58)}%`,
  delay: `${(i * 0.65).toFixed(2)}s`,
  size: 4 + (i % 3) * 2,
}));

const CONFETTI_BITS = Array.from({ length: 14 }, (_, i) => ({
  left: `${6 + ((i * 6.8) % 88).toFixed(1)}%`,
  delay: `${-((i * 0.55) % 4.5).toFixed(2)}s`,
  dur: `${(4.2 + (i % 4) * 0.8).toFixed(1)}s`,
  color: ['#D98366', '#E8C27A', '#7CC8EE', '#F6F0E6'][i % 4] ?? '#E8C27A',
}));

const FAIRY_COLORS = ['#F5C37A', '#D98366', '#88B48C', '#F6F0E6'];

function treatPoolFor(season: SeasonVibe): TreatKind[] {
  if (season === 'christmas') return ['gingerbread', 'starCookie', 'bone'];
  if (season === 'summer') return ['pupsicle', 'bone', 'biscuit'];
  return ['bone', 'kibble', 'biscuit'];
}

function fullLinesFor(atmo: ResolvedAtmosphere): string[] {
  if (atmo.season === 'christmas') {
    return [
      'Too many holiday cookies... resting by the tree.',
      'Full of gingerbread! Just taking a cozy winter nap.',
    ];
  }
  if (atmo.season === 'newyear') {
    return [
      'Too many party snacks... pacing myself for the new year.',
      'Confetti and treats caught up with me — quick breather!',
    ];
  }
  if (atmo.season === 'summer') {
    return ['Brain freeze from too many pupsicles... chilling for a bit.', ...FULL_LINES];
  }
  if (atmo.weather === 'rain' || atmo.weather === 'storm') {
    return ['Full belly plus rainy weather equals instant nap time.', ...FULL_LINES];
  }
  return FULL_LINES;
}

// Natural brown-black fur coat palette inspired by Maxie in CycleStoryModal
const FUR_DARK = '#2A211F';
const FUR_SHADOW = '#1F1816';
const FUR_SABLE = '#694938';
const FUR_CREAM = '#F6F0E6';
const FUR_CREAM_SHADE = '#DDD3C6';
const COLLAR = '#D98366';
const COLLAR_TAG = '#E8C27A';
const EYE_BLUE = '#7CC8EE';
const EYE_PUPIL = '#1B2128';
const NOSE_DARK = '#1B1615';
const TONGUE_PINK = '#DF8B86';
const BLUSH_PINK = '#E59180';

/** Cozy steaming coffee mug resting on a rainy sill corner. */
function RainyMugSvg() {
  return (
    <svg width="40" height="38" viewBox="0 0 40 38" fill="none" aria-hidden="true">
      <path d="M13 11 Q15 6 13 3 M20 10 Q22 5 20 2 M27 11 Q29 6 27 3" stroke={FUR_CREAM} strokeWidth="1.5" strokeLinecap="round" opacity="0.55" />
      <rect x="9" y="14" width="20" height="17" rx="4" fill={COLLAR} stroke={FUR_DARK} strokeWidth="1.5" />
      <path d="M29 17 H32 A3.5 3.5 0 0 1 32 25 H29" stroke={FUR_DARK} strokeWidth="1.6" fill="none" />
      <rect x="7" y="31" width="24" height="3" rx="1.5" fill={FUR_CREAM} opacity="0.7" />
    </svg>
  );
}

/** Warm glowing camp lantern for quiet nights. */
function NightLanternSvg() {
  return (
    <svg width="32" height="44" viewBox="0 0 32 44" fill="none" aria-hidden="true">
      <circle cx="16" cy="24" r="16" fill="#F5C37A" opacity="0.24" />
      <path d="M10 12 Q16 3 22 12" stroke="#B7B0A4" strokeWidth="1.8" fill="none" />
      <rect x="7" y="12" width="18" height="22" rx="4" fill="#F2BE72" opacity="0.92" />
      <rect x="10.5" y="16" width="11" height="14" rx="2.5" fill="#FFF2D6" opacity="0.95" />
      <rect x="6" y="11" width="20" height="3.2" rx="1.6" fill="#3D3431" />
      <rect x="6" y="32" width="20" height="3.2" rx="1.6" fill="#3D3431" />
    </svg>
  );
}

/** Crescent moon in the quiet night corner. */
function NightMoonSvg() {
  return (
    <svg width="42" height="42" viewBox="0 0 42 42" fill="none" aria-hidden="true">
      <path d="M26 7 A13 13 0 1 0 35 28 A10.5 10.5 0 1 1 26 7 Z" fill="#F5D9A4" opacity="0.75" />
    </svg>
  );
}

/** Festive tilted headgear & seasonal accessories fitted cleanly on Maxie's head. */
function SeasonalHat({ season, sideView }: { season: SeasonVibe; sideView?: boolean }) {
  if (season === 'christmas') {
    return (
      <g transform={sideView ? 'translate(8 -10) rotate(-10 14 14)' : 'translate(16 -8) rotate(-10 16 14)'}>
        <path d="M4 16 Q16 2 28 10 Q25 16 28 18 L2 18 Z" fill="#C84B3E" />
        <rect x="1" y="16" width="26" height="5" rx="2.5" fill={FUR_CREAM} />
        <circle cx="28" cy="10" r="3.4" fill={FUR_CREAM} />
      </g>
    );
  }
  if (season === 'newyear') {
    return (
      <g transform={sideView ? 'translate(12 -11) rotate(8 10 14)' : 'translate(22 -10) rotate(8 10 14)'}>
        <path d="M3 18 L10 2 L17 18 Z" fill={COLLAR} stroke={FUR_DARK} strokeWidth="1.2" />
        <path d="M5 13 L15 11" stroke={COLLAR_TAG} strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="10" cy="2" r="2.8" fill={COLLAR_TAG} />
      </g>
    );
  }
  return null;
}

/**
 * Full-body natural Siberian Husky Maxie with deep brown-black coat, warm sable shoulder
 * highlights, ivory ruff & mask, terracotta collar, and ice-blue eye.
 * `chonk` (`0..4`) makes Maxie visibly rounder as he eats more treats.
 */
function CycleStoryHusky({
  flip = false,
  chonk = 0,
  pose = 'run',
  season = 'none',
  weather = 'sunny',
}: {
  flip?: boolean;
  chonk?: number;
  pose?: 'run' | 'eat' | 'leap';
  season?: SeasonVibe;
  weather?: WeatherMood;
}) {
  const chonkVal = Math.min(4, Math.max(0, chonk));
  const bellyScale = 1 + chonkVal * 0.14;
  const cheekScale = 1 + chonkVal * 0.04;
  const eating = pose === 'eat';
  const running = pose === 'run';

  return (
    <svg
      width="108"
      height="88"
      viewBox="0 0 116 92"
      fill="none"
      style={{
        transform: flip ? 'scaleX(-1)' : undefined,
        filter: 'drop-shadow(0 8px 12px rgba(0, 0, 0, 0.28))',
        overflow: 'visible',
      }}
      aria-hidden="true"
    >
      {/* Plumed curled Siberian husky tail (brown-black outer, cream underside) */}
      <g
        className={running || pose === 'leap' ? s.huskyTailWag : undefined}
        style={{ transformBox: 'view-box', transformOrigin: '26px 42px' }}
      >
        <path d="M22 45 C7 38 1 20 13 11 C23 5 32 14 29 30 Z" fill={FUR_DARK} />
        <path d="M23 43 C11 36 8 22 16 15 C22 11 27 17 25 29 Z" fill={FUR_CREAM} />
      </g>

      {/* Far legs */}
      <g className={running ? s.huskyLegB : undefined} style={{ transformBox: 'view-box', transformOrigin: '40px 49px' }}>
        <path d="M36 47 C36 43 45 43 46 49 L44 56 L31 79 L25 81 Q20 80 23 76 Z" fill={FUR_CREAM_SHADE} />
      </g>
      <g className={running ? s.huskyLegA : undefined} style={{ transformBox: 'view-box', transformOrigin: '73px 47px' }}>
        <path d="M70 46 C70 42 79 42 79 48 L96 67 Q100 71 96 74 L90 73 L69 54 Z" fill={FUR_CREAM_SHADE} />
      </g>

      {/* Sturdy brown-black torso + warm sable shoulder + round ivory belly expanding downward from spine */}
      <g transform={`translate(56 36) scale(${(1 + chonkVal * 0.03).toFixed(2)} ${bellyScale.toFixed(2)}) translate(-56 -36)`}>
        <path d="M24 44 C28 27 48 22 75 26 C87 28 93 36 89 48 C84 58 67 61 46 59 C32 57 22 52 24 44 Z" fill={FUR_DARK} />
        <path d="M35 33 Q56 26 75 30 Q65 39 41 38 Z" fill={FUR_SABLE} opacity="0.82" />
        <path
          d="M32 51 C44 46 60 45 73 36 C80 31 88 33 91 41 C92 51 84 60 70 61 C54 62 38 59 32 51 Z"
          fill={FUR_CREAM}
        />
        <path d="M87 42 L94 46 L88 50 L91 54 L83 55 Z" fill={FUR_CREAM} />
      </g>

      {/* Near legs */}
      <g className={running ? s.huskyLegA : undefined} style={{ transformBox: 'view-box', transformOrigin: '46px 49px' }}>
        <path d="M41 47 C42 42 52 43 53 49 L53 55 L43 80 L37 82 Q32 82 34 77 Z" fill={FUR_CREAM} />
      </g>
      <g className={running ? s.huskyLegB : undefined} style={{ transformBox: 'view-box', transformOrigin: '74px 46px' }}>
        <path d="M68 45 C69 40 78 40 79 45 L98 69 L97 74 Q92 76 89 72 L70 51 Z" fill={FUR_CREAM} />
      </g>

      {/* Terracotta collar, rain scarf, or festive bandana */}
      {season === 'independence' ? (
        <g>
          <path d="M74 33 Q83 40 89 38" fill="none" stroke="#D3453E" strokeWidth="4.6" strokeLinecap="round" />
          <path d="M80 37 L92 40 L84 48 Z" fill="#D3453E" />
          <path d="M83 42 L89 43 L85 47 Z" fill={FUR_CREAM} />
        </g>
      ) : (weather === 'rain' || weather === 'storm') && season === 'none' ? (
        <g>
          <path d="M73 33 Q83 40 90 38" fill="none" stroke="#C86D4A" strokeWidth="5.4" strokeLinecap="round" />
          <path d="M77 37 Q81 47 86 45 L88 38 Z" fill="#B55B3A" />
        </g>
      ) : (
        <>
          <path d="M74 33 Q83 40 89 38" fill="none" stroke={COLLAR} strokeWidth="4.4" strokeLinecap="round" />
          <circle cx="89" cy="41" r="2.4" fill={COLLAR_TAG} />
        </>
      )}

      {/* Natural Cycle-Story husky head */}
      <g transform="translate(76 10)">
        <g
          transform={`scale(${cheekScale.toFixed(2)} 1)`}
          className={eating ? s.huskyChomp : undefined}
          style={{ transformBox: 'fill-box', transformOrigin: '38% 62%' }}
        >
          <path d="M18 11 L23 0 Q25 -1 27 2 L28 13 Z" fill={FUR_SHADOW} />
          <path d="M21 10 L24 3 L26 11 Z" fill={FUR_CREAM_SHADE} />
          <path d="M4 22 C4 12 12 7 22 9 C29 10 35 15 38 20 L42 23 C43 26 40 29 35 30 L28 32 C20 34 10 31 5 26 Z" fill={FUR_DARK} />
          <path d="M8 17 Q18 10 30 13 Q23 17 11 19 Z" fill={FUR_SABLE} opacity="0.72" />
          <path d="M7 14 L8 0 Q10 -2 13 1 L20 11 Z" fill={FUR_DARK} />
          <path d="M10 12 L11 3 L17 11 Z" fill={FUR_CREAM} />
          <path d="M14 20 C19 16 27 16 34 19 L41 22 C43 25 40 29 34 30 L24 32 C15 33 8 29 6 25 L10 23 L7 20 Z" fill={FUR_CREAM} />
          <ellipse cx="23.5" cy="14.5" rx="2.4" ry="1.2" transform="rotate(-12 23.5 14.5)" fill={FUR_CREAM} />

          {eating ? (
            <path d="M23.5 19 Q26.5 16.5 29.5 19" fill="none" stroke={EYE_PUPIL} strokeWidth="1.9" strokeLinecap="round" />
          ) : (
            <>
              <ellipse cx="26.2" cy="18.6" rx="2.3" ry="2.1" fill={EYE_BLUE} />
              <circle cx="26.6" cy="18.6" r="1.05" fill={EYE_PUPIL} />
              <circle cx="27.2" cy="17.9" r="0.55" fill="#FFFFFF" />
            </>
          )}

          {/* Cool summer sunglasses */}
          {season === 'summer' && !eating && (
            <g>
              <rect x="21" y="15.8" width="11.5" height="5.4" rx="2.2" fill="#1D1A18" stroke="#453C38" strokeWidth="1" />
              <line x1="14" y1="18.2" x2="21.5" y2="18.2" stroke="#1D1A18" strokeWidth="1.3" />
              <line x1="23.5" y1="17.6" x2="26.5" y2="19.6" stroke="#FFFFFF" strokeWidth="0.9" opacity="0.45" strokeLinecap="round" />
            </g>
          )}

          <path d="M38.5 21.2 Q42 20.8 42.5 23.5 Q41 25.5 38.2 24.4 Z" fill={NOSE_DARK} />
          <path d="M31 26.8 Q35.5 28.5 38.8 26.2" fill="none" stroke={FUR_DARK} strokeWidth="1.4" strokeLinecap="round" />
          <path d="M33.5 27.5 Q35.5 31.6 37.6 27.6 Z" fill={TONGUE_PINK} />

          <SeasonalHat season={season} sideView />
        </g>
      </g>
    </svg>
  );
}

/** Front-facing Cycle-Story Siberian Husky head with deep brown-black fur & seasonal flair. */
function CycleStoryHuskyHead({
  mood = 'happy',
  stuffed = false,
  size = 64,
  season = 'none',
}: {
  mood?: HeadMood;
  stuffed?: boolean;
  size?: number;
  season?: SeasonVibe;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      style={{
        display: 'block',
        overflow: 'visible',
        filter: 'drop-shadow(0 6px 12px rgba(0, 0, 0, 0.26))',
      }}
      aria-hidden="true"
    >
      {stuffed && (
        <>
          <path d="M18 54 Q32 61 46 54" fill="none" stroke={season === 'independence' ? '#D3453E' : COLLAR} strokeWidth="4.5" strokeLinecap="round" />
          <circle cx="32" cy="59.5" r="2.5" fill={season === 'independence' ? FUR_CREAM : COLLAR_TAG} />
        </>
      )}

      <g transform={stuffed ? 'scale(1.1 0.96) translate(-2.8 2.5)' : undefined}>
        <path d="M13.5 22 L15 4 Q17.2 1 20.5 4.2 L27 15 Z" fill={FUR_DARK} />
        <path d="M50.5 22 L49 4 Q46.8 1 43.5 4.2 L37 15 Z" fill={FUR_DARK} />
        <path d="M16.8 18 L18.2 7.5 L24 15.8 Z" fill={FUR_CREAM} />
        <path d="M47.2 18 L45.8 7.5 L40 15.8 Z" fill={FUR_CREAM} />

        <path
          d="M11 35 L7.5 30 L12 25.5 C11 18.5 16 13.5 32 12.5 C48 13.5 53 18.5 52 25.5 L56.5 30 L53 35 L55 40.5 L47.5 43.5 C43.5 49.5 38 53 32 53 C26 53 20.5 49.5 16.5 43.5 L9 40.5 Z"
          fill={FUR_DARK}
        />
        <path d="M18 18 Q32 13 46 18 Q38 22 26 22 Z" fill={FUR_SABLE} opacity="0.65" />
        <path
          d="M32 16 L33.8 25.2 C37.2 24 42.2 24.6 45.8 27.4 C48.8 30 49.4 35.8 47.8 41 C45.2 47.2 39 51 32 51 C25 51 18.8 47.2 16.2 41 C14.6 35.8 15.2 30 18.2 27.4 C21.8 24.6 26.8 24 30.2 25.2 Z"
          fill={FUR_CREAM}
        />

        <ellipse cx="24.5" cy="22.4" rx="2.8" ry="1.35" transform="rotate(-14 24.5 22.4)" fill={FUR_CREAM} />
        <ellipse cx="39.5" cy="22.4" rx="2.8" ry="1.35" transform="rotate(14 39.5 22.4)" fill={FUR_CREAM} />

        {stuffed && (
          <>
            <ellipse cx="19" cy="36.5" rx="3.8" ry="2.2" fill={BLUSH_PINK} opacity="0.58" />
            <ellipse cx="45" cy="36.5" rx="3.8" ry="2.2" fill={BLUSH_PINK} opacity="0.58" />
          </>
        )}

        {mood === 'full' ? (
          <>
            <path d="M20.2 32.6 Q24.5 35.8 28.8 32.6" fill="none" stroke={FUR_DARK} strokeWidth="2.3" strokeLinecap="round" />
            <path d="M35.2 32.6 Q39.5 35.8 43.8 32.6" fill="none" stroke={FUR_DARK} strokeWidth="2.3" strokeLinecap="round" />
          </>
        ) : mood === 'happy' ? (
          <>
            <path d="M20.2 33.4 Q24.5 28.6 28.8 33.4" fill="none" stroke={FUR_DARK} strokeWidth="2.4" strokeLinecap="round" />
            <path d="M35.2 33.4 Q39.5 28.6 43.8 33.4" fill="none" stroke={FUR_DARK} strokeWidth="2.4" strokeLinecap="round" />
          </>
        ) : mood === 'wink' ? (
          <>
            <ellipse cx="24.5" cy="31.8" rx="2.9" ry="2.5" fill={EYE_BLUE} />
            <circle cx="24.5" cy="31.8" r="1.3" fill={EYE_PUPIL} />
            <circle cx="25.3" cy="31" r="0.6" fill="#FFFFFF" />
            <path d="M35.4 33 Q39.6 28.8 43.8 33" fill="none" stroke={FUR_DARK} strokeWidth="2.4" strokeLinecap="round" />
          </>
        ) : (
          <>
            <ellipse cx="24.5" cy="31.8" rx="2.9" ry="2.5" fill={EYE_BLUE} />
            <ellipse cx="39.5" cy="31.8" rx="2.9" ry="2.5" fill={EYE_BLUE} />
            <circle cx="24.5" cy="31.8" r="1.3" fill={EYE_PUPIL} />
            <circle cx="39.5" cy="31.8" r="1.3" fill={EYE_PUPIL} />
            <circle cx="25.3" cy="31" r="0.6" fill="#FFFFFF" />
            <circle cx="40.3" cy="31" r="0.6" fill="#FFFFFF" />
          </>
        )}

        {season === 'summer' && mood !== 'full' && (
          <g>
            <rect x="17" y="28.2" width="13" height="6.8" rx="2.5" fill="#1D1A18" stroke="#453C38" strokeWidth="1" />
            <rect x="34" y="28.2" width="13" height="6.8" rx="2.5" fill="#1D1A18" stroke="#453C38" strokeWidth="1" />
            <line x1="30" y1="30.8" x2="34" y2="30.8" stroke="#1D1A18" strokeWidth="1.6" />
          </g>
        )}

        <path d="M27.6 38.4 Q32 37 36.4 38.4 Q35.8 41.8 32 43.4 Q28.2 41.8 27.6 38.4 Z" fill={NOSE_DARK} />
        <path
          d="M32 43 V45.4 M27.2 46.2 Q29.6 48.2 32 45.6 Q34.4 48.2 36.8 46.2"
          fill="none"
          stroke={FUR_DARK}
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {(stuffed || mood === 'happy') && <path d="M29.4 46.8 Q32 52.4 34.6 46.8 Z" fill={TONGUE_PINK} />}

        <SeasonalHat season={season} />
      </g>
    </svg>
  );
}

/** Cute treats including holiday gingerbread/star cookies and chilled summer pupsicles. */
function PetTreatSvg({ kind }: { kind: TreatKind }) {
  if (kind === 'gingerbread') {
    return (
      <svg width="32" height="24" viewBox="0 0 36 24" fill="none" style={{ filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.28))' }} aria-hidden="true">
        <path
          d="M9 8 C6.5 8 5 6.4 5 4.8 C5 3 6.6 1.8 8.4 2.2 C9.6 2.5 10.4 3.4 10.8 4.6 H25.2 C25.6 3.4 26.4 2.5 27.6 2.2 C29.4 1.8 31 3 31 4.8 C31 6.4 29.5 8 27 8 C29.5 8.2 31 9.8 31 11.4 C31 13.2 29.4 14.4 27.6 14 C26.4 13.7 25.6 12.8 25.2 11.6 H10.8 C10.4 12.8 9.6 13.7 8.4 14 C6.6 14.4 5 13.2 5 11.4 C5 9.8 6.5 8.2 9 8 Z"
          transform="translate(0 4)"
          fill="#BA7A49"
          stroke="#724322"
          strokeWidth="1.5"
        />
        <path d="M12 11.5 Q18 9.5 24 11.5" stroke={FUR_CREAM} strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'starCookie') {
    return (
      <svg width="28" height="28" viewBox="0 0 30 30" fill="none" style={{ filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.28))' }} aria-hidden="true">
        <path
          d="M15 3 L18.4 10.5 L26.5 11.4 L20.4 17 L22 25 L15 21 L8 25 L9.6 17 L3.5 11.4 L11.6 10.5 Z"
          fill="#E9C79B"
          stroke="#C84B3E"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <circle cx="15" cy="14.5" r="2.2" fill="#C84B3E" opacity="0.85" />
      </svg>
    );
  }
  if (kind === 'pupsicle') {
    return (
      <svg width="28" height="32" viewBox="0 0 28 34" fill="none" style={{ filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.28))' }} aria-hidden="true">
        <rect x="12" y="21" width="4" height="10" rx="2" fill="#E3C39B" />
        <rect x="6" y="3" width="16" height="19" rx="8" fill="#7CC8EE" stroke={FUR_DARK} strokeWidth="1.3" />
        <rect x="6" y="13" width="16" height="9" rx="4" fill="#F2E2D8" opacity="0.85" />
        <line x1="10" y1="7" x2="10" y2="12" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
      </svg>
    );
  }
  if (kind === 'bone') {
    return (
      <svg width="32" height="24" viewBox="0 0 36 24" fill="none" style={{ filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.28))' }} aria-hidden="true">
        <path
          d="M9 8 C6.5 8 5 6.4 5 4.8 C5 3 6.6 1.8 8.4 2.2 C9.6 2.5 10.4 3.4 10.8 4.6 H25.2 C25.6 3.4 26.4 2.5 27.6 2.2 C29.4 1.8 31 3 31 4.8 C31 6.4 29.5 8 27 8 C29.5 8.2 31 9.8 31 11.4 C31 13.2 29.4 14.4 27.6 14 C26.4 13.7 25.6 12.8 25.2 11.6 H10.8 C10.4 12.8 9.6 13.7 8.4 14 C6.6 14.4 5 13.2 5 11.4 C5 9.8 6.5 8.2 9 8 Z"
          transform="translate(0 4)"
          fill="#E9C79B"
          stroke="#9E6E42"
          strokeWidth="1.5"
        />
        <circle cx="15" cy="11.5" r="0.9" fill="#9E6E42" opacity="0.55" />
        <circle cx="21" cy="12.5" r="0.9" fill="#9E6E42" opacity="0.55" />
      </svg>
    );
  }
  if (kind === 'kibble') {
    return (
      <svg width="32" height="26" viewBox="0 0 36 28" fill="none" style={{ filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.28))' }} aria-hidden="true">
        <circle cx="13" cy="11" r="3" fill="#6D4B3A" />
        <circle cx="18.5" cy="9.5" r="3.2" fill="#8A5D44" />
        <circle cx="23.5" cy="11.2" r="2.9" fill="#6D4B3A" />
        <circle cx="16" cy="13" r="2.8" fill="#5A3C2E" />
        <circle cx="21" cy="13" r="2.8" fill="#7A523C" />
        <path d="M6 14 H30 L27 23 C26.5 24.5 24.5 25 23 25 H13 C11.5 25 9.5 24.5 9 23 Z" fill={COLLAR} stroke="#8B432A" strokeWidth="1.4" />
        <path d="M10 18 H26" stroke={FUR_CREAM} strokeWidth="1.2" strokeLinecap="round" opacity="0.6" />
      </svg>
    );
  }
  return (
    <svg width="28" height="28" viewBox="0 0 30 30" fill="none" style={{ filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.28))' }} aria-hidden="true">
      <circle cx="15" cy="15" r="11" fill="#E4BA86" stroke="#9B693C" strokeWidth="1.5" />
      <ellipse cx="15" cy="17.2" rx="3.4" ry="2.6" fill="#7B4F35" opacity="0.82" />
      <circle cx="10.8" cy="12.5" r="1.4" fill="#7B4F35" opacity="0.82" />
      <circle cx="15" cy="10.8" r="1.4" fill="#7B4F35" opacity="0.82" />
      <circle cx="19.2" cy="12.5" r="1.4" fill="#7B4F35" opacity="0.82" />
    </svg>
  );
}

/** Tiny ceramic paw print trail accent. */
function PawPrint({ scale = 1, rotate = 0 }: { scale?: number; rotate?: number }) {
  return (
    <svg width={18 * scale} height={18 * scale} viewBox="0 0 24 24" fill={FUR_SABLE} style={{ transform: `rotate(${rotate}deg)` }} aria-hidden="true">
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
    <svg width="20" height="20" viewBox="0 0 24 24" fill={COLLAR} aria-hidden="true">
      <path d="M12 2 L14.4 9.6 L22 12 L14.4 14.4 L12 22 L9.6 14.4 L2 12 L9.6 9.6 Z" />
    </svg>
  );
}

/** Atmospheric sky & seasonal particles behind Maxie's board. */
function AtmosphereVisuals({ atmo }: { atmo: ResolvedAtmosphere }) {
  const { weather, season } = atmo;
  const rainy = weather === 'rain' || weather === 'storm';

  return (
    <>
      {rainy && (
        <>
          {RAIN_DROPS.map((d, i) => (
            <span
              key={i}
              className={s.authRainDrop}
              style={{ left: d.left, animationDelay: d.delay, animationDuration: d.dur }}
            />
          ))}
          {weather === 'storm' && <div className={s.authStormFlash} />}
          <div className={s.authCornerPropLeft}>
            <RainyMugSvg />
          </div>
        </>
      )}

      {(weather === 'sunny' || season === 'summer') && !rainy && (
        <>
          <div className={s.authSunbeam} />
          {SUN_MOTES.map((m, i) => (
            <span
              key={i}
              className={s.authMote}
              style={{ left: m.left, top: m.top, width: m.size, height: m.size, animationDelay: m.delay }}
            />
          ))}
        </>
      )}

      {weather === 'cloudy' && (
        <>
          <svg className={s.authCloud} style={{ top: '7%', left: '6%', animationDuration: '32s' }} width="110" height="44" viewBox="0 0 110 44" fill="currentColor">
            <path d="M22 36 H88 A12 12 0 0 0 88 14 Q80 4 64 8 Q54 0 40 8 Q26 6 22 18 A10 10 0 0 0 22 36 Z" />
          </svg>
          <svg className={s.authCloud} style={{ top: '14%', right: '8%', animationDuration: '40s', animationDelay: '-12s' }} width="92" height="38" viewBox="0 0 110 44" fill="currentColor">
            <path d="M22 36 H88 A12 12 0 0 0 88 14 Q80 4 64 8 Q54 0 40 8 Q26 6 22 18 A10 10 0 0 0 22 36 Z" />
          </svg>
        </>
      )}

      {(weather === 'night' || season === 'christmas' || season === 'newyear') && !rainy && (
        <>
          {NIGHT_STARS.map((st, i) => (
            <span
              key={i}
              className={s.authStar}
              style={{ left: st.x, top: st.y, width: st.r * 2, height: st.r * 2, animationDelay: st.d }}
            />
          ))}
          <div className={s.authCornerPropTopRight}>
            <NightMoonSvg />
          </div>
        </>
      )}

      {season === 'christmas' && (
        <>
          <div className={s.authFairyRow}>
            {Array.from({ length: 12 }, (_, i) => (
              <span
                key={i}
                className={s.authFairyBulb}
                style={{
                  background: FAIRY_COLORS[i % FAIRY_COLORS.length],
                  animationDelay: `${(i * 0.35).toFixed(2)}s`,
                }}
              />
            ))}
          </div>
          {SNOW_FLAKES.map((f, i) => (
            <span
              key={i}
              className={s.authSnow}
              style={{ left: f.left, width: f.size, height: f.size, animationDelay: f.delay, animationDuration: f.dur }}
            />
          ))}
        </>
      )}

      {season === 'newyear' && (
        <>
          <div className={s.authFirework} style={{ top: '15%', left: '14%' }} />
          <div className={s.authFirework} style={{ top: '20%', right: '15%', animationDelay: '1.8s' }} />
          {CONFETTI_BITS.map((c, i) => (
            <span
              key={i}
              className={s.authConfetti}
              style={{ left: c.left, background: c.color, animationDelay: c.delay, animationDuration: c.dur }}
            />
          ))}
        </>
      )}
    </>
  );
}

/**
 * Interactive atmospheric backdrop for Sign-In:
 * - Warm home weather & seasonal sky effects (`AtmosphereVisuals`)
 * - Natural brown-black Cycle-Story Maxie idle jumping loop & seasonal attire
 * - Click outside board -> drop treat -> Maxie runs over, gobbles, grows rounder
 * - 5 treats -> stuffed peeking head with warm natural quips + clickable belly rubs to wake faster.
 */
export function AuthBackdrop({
  treatDrop,
  atmosphere,
}: {
  treatDrop?: TreatDrop | null;
  atmosphere: ResolvedAtmosphere;
}) {
  const [mode, setMode] = useState<Mode>('ambient');
  const [facing, setFacing] = useState<Side>('right');
  const [fullness, setFullness] = useState(0);
  const [treats, setTreats] = useState<ActiveTreat[]>([]);
  const [crumbs, setCrumbs] = useState<CrumbBurst[]>([]);
  const [quips, setQuips] = useState<MiniQuip[]>([]);
  const [hearts, setHearts] = useState<PetHeart[]>([]);
  const [ambientEvt, setAmbientEvt] = useState<HuskyEvent | null>(null);
  const [fullState, setFullState] = useState<{ side: Side; text: string; wiggleKey: number }>({
    side: 'right',
    text: FULL_LINES[0],
    wiggleKey: 0,
  });

  const modeRef = useRef<Mode>('ambient');
  const fullnessRef = useRef(0);
  const facingRef = useRef<Side>('right');
  const treatsRef = useRef<ActiveTreat[]>([]);
  const atmoRef = useRef(atmosphere);
  atmoRef.current = atmosphere;

  const posRef = useRef({ x: -130, y: 320 });
  const runnerRef = useRef<HTMLDivElement>(null);

  const lastHandledDropIdRef = useRef(0);
  const eatTimerRef = useRef(0);
  const fullTimerRef = useRef(0);
  const fullEndAtRef = useRef(0);
  const slimTimerRef = useRef(0);
  const crumbSeqRef = useRef(1);
  const extraFullIdxRef = useRef(0);
  const rubIdxRef = useRef(0);

  const syncMode = (next: Mode) => {
    modeRef.current = next;
    setMode(next);
  };

  const syncFullness = (next: number) => {
    fullnessRef.current = next;
    setFullness(next);
  };

  const syncFacing = (next: Side) => {
    if (facingRef.current !== next) {
      facingRef.current = next;
      setFacing(next);
    }
  };

  const syncTreats = (next: ActiveTreat[]) => {
    treatsRef.current = next;
    setTreats(next);
  };

  const scheduleFullRecovery = (msRemaining: number) => {
    window.clearTimeout(fullTimerRef.current);
    fullTimerRef.current = window.setTimeout(() => {
      syncFullness(0);
      setHearts([]);
      syncMode('ambient');
    }, Math.max(400, msRemaining));
  };

  const petFullMaxie = () => {
    if (modeRef.current !== 'full') return;
    const nextLine = BELLY_RUB_LINES[rubIdxRef.current++ % BELLY_RUB_LINES.length];
    setFullState(prev => ({
      ...prev,
      text: nextLine,
      wiggleKey: prev.wiggleKey + 1,
    }));

    const h1 = crumbSeqRef.current++;
    const h2 = crumbSeqRef.current++;
    setHearts(prev => [...prev.slice(-4), { id: h1, dx: -14 }, { id: h2, dx: 14 }]);
    window.setTimeout(() => {
      setHearts(prev => prev.filter(h => h.id !== h1 && h.id !== h2));
    }, 950);

    const nextEnd = Math.max(Date.now() + 650, fullEndAtRef.current - 1500);
    fullEndAtRef.current = nextEnd;
    scheduleFullRecovery(nextEnd - Date.now());
  };

  const spawnCrumbAndQuip = (x: number, y: number, biteIndex: number) => {
    const cid = crumbSeqRef.current++;
    const w = atmoRef.current.weather;
    setCrumbs(prev => [...prev, { id: cid, x, y, ripple: w === 'rain' || w === 'storm' }]);
    window.setTimeout(() => {
      setCrumbs(prev => prev.filter(c => c.id !== cid));
    }, 680);

    const quip = BITE_QUIPS[Math.min(biteIndex, BITE_QUIPS.length - 1)] ?? 'nom nom!';
    setQuips(prev => [...prev.slice(-1), { id: cid, x, y: Math.max(36, y - 46), text: quip }]);
    window.setTimeout(() => {
      setQuips(prev => prev.filter(q => q.id !== cid));
    }, 850);
  };

  useEffect(() => {
    return () => {
      window.clearTimeout(eatTimerRef.current);
      window.clearTimeout(fullTimerRef.current);
      window.clearTimeout(slimTimerRef.current);
    };
  }, []);

  // React to outside-box treat drops.
  useEffect(() => {
    if (!treatDrop || treatDrop.id === lastHandledDropIdRef.current) return;
    lastHandledDropIdRef.current = treatDrop.id;

    if (reducedMotion() || typeof window === 'undefined') return;

    if (modeRef.current === 'full') {
      const nextLine = EXTRA_FULL_LINES[extraFullIdxRef.current++ % EXTRA_FULL_LINES.length];
      setFullState(prev => ({
        ...prev,
        text: nextLine,
        wiggleKey: prev.wiggleKey + 1,
      }));
      return;
    }

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const tx = Math.max(36, Math.min(vw - 36, treatDrop.x));
    const ty = Math.max(54, Math.min(vh - 46, treatDrop.y));
    const pool = treatPoolFor(atmoRef.current.season);
    const kind = pool[treatDrop.id % pool.length] ?? 'bone';
    const rot = Math.round(((treatDrop.id * 37) % 30) - 15);

    const nextQueue = [...treatsRef.current.slice(-5), { id: treatDrop.id, x: tx, y: ty, kind, rot }];
    syncTreats(nextQueue);
    setAmbientEvt(null);
    window.clearTimeout(slimTimerRef.current);

    if (modeRef.current === 'ambient') {
      const fromLeft = tx < vw / 2;
      posRef.current = { x: fromLeft ? -115 : vw + 115, y: ty };
      syncFacing(fromLeft ? 'right' : 'left');
      syncMode('chase');
    } else if (modeRef.current === 'exit') {
      syncMode('chase');
    }
  }, [treatDrop]);

  // 60fps runner loop.
  useEffect(() => {
    if ((mode !== 'chase' && mode !== 'exit') || typeof window === 'undefined') return;

    let raf = 0;
    let prevTs = performance.now();
    let elapsed = 0;

    const applyTransform = (x: number, y: number, hop: number) => {
      if (runnerRef.current) {
        runnerRef.current.style.transform = `translate3d(${(x - 54).toFixed(1)}px, ${(y - 44 - hop).toFixed(1)}px, 0)`;
      }
    };

    applyTransform(posRef.current.x, posRef.current.y, 0);

    const step = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - prevTs) / 1000));
      prevTs = now;
      elapsed += dt;

      const curMode = modeRef.current;
      if (curMode !== 'chase' && curMode !== 'exit') return;

      const vw = window.innerWidth;
      const speeds = [380, 330, 280, 230, 180];
      const baseSpeed = speeds[Math.min(fullnessRef.current, speeds.length - 1)] ?? 220;

      if (curMode === 'chase') {
        const target = treatsRef.current[0];
        if (!target) {
          syncMode('exit');
          return;
        }

        const dx = target.x - posRef.current.x;
        const dy = target.y - posRef.current.y;
        const dist = Math.hypot(dx, dy);
        if (Math.abs(dx) > 4) {
          syncFacing(dx >= 0 ? 'right' : 'left');
        }

        if (dist <= 28) {
          posRef.current = { x: target.x, y: target.y };
          applyTransform(posRef.current.x, posRef.current.y, 0);

          const remaining = treatsRef.current.slice(1);
          syncTreats(remaining);

          const nextFull = fullnessRef.current + 1;
          syncFullness(nextFull);
          spawnCrumbAndQuip(target.x, target.y, nextFull - 1);
          syncMode('eating');

          window.clearTimeout(eatTimerRef.current);
          const eatMs = nextFull >= 5 ? 280 : remaining.length > 0 ? 310 : 500;
          eatTimerRef.current = window.setTimeout(() => {
            if (nextFull >= 5) {
              syncTreats([]);
              const cornerSide: Side = posRef.current.x < vw / 2 ? 'left' : 'right';
              const lines = fullLinesFor(atmoRef.current);
              const msg = lines[Math.floor(Math.random() * lines.length)] ?? FULL_LINES[0];
              setFullState(prev => ({ side: cornerSide, text: msg, wiggleKey: prev.wiggleKey + 1 }));
              syncMode('full');

              fullEndAtRef.current = Date.now() + 7000;
              scheduleFullRecovery(7000);
              return;
            }

            if (treatsRef.current.length > 0) {
              syncMode('chase');
            } else {
              syncMode('exit');
              window.clearTimeout(slimTimerRef.current);
              slimTimerRef.current = window.setTimeout(() => {
                if (modeRef.current === 'ambient') syncFullness(0);
              }, 12000);
            }
          }, eatMs);
          return;
        }

        const move = Math.min(dist, baseSpeed * dt);
        posRef.current = {
          x: posRef.current.x + (dx / dist) * move,
          y: posRef.current.y + (dy / dist) * move,
        };
        const hop = Math.abs(Math.sin(elapsed * 11)) * Math.max(4, 11 - fullnessRef.current * 1.4);
        applyTransform(posRef.current.x, posRef.current.y, hop);
      } else if (curMode === 'exit') {
        const goLeft = posRef.current.x < vw / 2;
        const exitX = goLeft ? -130 : vw + 130;
        syncFacing(goLeft ? 'left' : 'right');

        const dx = exitX - posRef.current.x;
        const stepX = Math.sign(dx) * Math.min(Math.abs(dx), baseSpeed * 0.9 * dt);
        posRef.current = { x: posRef.current.x + stepX, y: posRef.current.y };

        if (Math.abs(exitX - posRef.current.x) <= 6) {
          syncMode('ambient');
          return;
        }
        const hop = Math.abs(Math.sin(elapsed * 9.5)) * 7;
        applyTransform(posRef.current.x, posRef.current.y, hop);
      }

      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [mode]);

  useEffect(() => {
    if (mode === 'eating' && runnerRef.current) {
      runnerRef.current.style.transform = `translate3d(${(posRef.current.x - 54).toFixed(1)}px, ${(posRef.current.y - 44).toFixed(1)}px, 0)`;
    }
  }, [mode]);

  // Ambient idle jumping loop.
  useEffect(() => {
    if (mode !== 'ambient' || reducedMotion() || typeof window === 'undefined') {
      setAmbientEvt(null);
      return;
    }

    let cancelled = false;
    let idSeq = 1;
    let lastVariant: Variant | null = null;
    let nextTimer = 0;
    let clearTimer = 0;

    const triggerOnce = () => {
      if (cancelled || modeRef.current !== 'ambient') return;
      const choices = VARIANTS.filter(v => v !== lastVariant);
      const variant = choices[Math.floor(Math.random() * choices.length)] ?? 'hop-arc';
      lastVariant = variant;

      const side: Side = Math.random() < 0.5 ? 'left' : 'right';
      const mood = MOODS[Math.floor(Math.random() * MOODS.length)] ?? 'happy';
      const yOffset = Math.round(Math.random() * 10);

      setAmbientEvt({ id: idSeq++, variant, side, mood, yOffset });

      clearTimer = window.setTimeout(() => {
        if (cancelled) return;
        setAmbientEvt(null);
        const pauseMs = 4200 + Math.round(Math.random() * 2600);
        nextTimer = window.setTimeout(triggerOnce, pauseMs);
      }, DURATION_MS[variant]);
    };

    nextTimer = window.setTimeout(triggerOnce, 1500);

    return () => {
      cancelled = true;
      window.clearTimeout(nextTimer);
      window.clearTimeout(clearTimer);
    };
  }, [mode]);

  const showRunner = mode === 'chase' || mode === 'eating' || mode === 'exit';

  return (
    <div
      className={s.authBackdrop}
      data-weather={atmosphere.weather}
      data-season={atmosphere.season}
      aria-hidden="true"
    >
      <div className={s.authGlowA} />
      <div className={s.authGlowB} />
      <div className={s.authDots} />
      <AtmosphereVisuals atmo={atmosphere} />

      {treats.map(t => (
        <div
          key={t.id}
          className={s.petTreat}
          style={{ left: t.x, top: t.y, transform: `translate(-50%, -50%) rotate(${t.rot}deg)` }}
        >
          <PetTreatSvg kind={t.kind} />
        </div>
      ))}

      {crumbs.map(c => (
        <div key={c.id} className={s.treatCrumbWrap} style={{ left: c.x, top: c.y }}>
          <span className={s.treatCrumb} style={{ ['--cx' as string]: '-18px', ['--cy' as string]: '-16px' }} />
          <span className={s.treatCrumb} style={{ ['--cx' as string]: '16px', ['--cy' as string]: '-20px' }} />
          <span className={s.treatCrumb} style={{ ['--cx' as string]: '-10px', ['--cy' as string]: '10px' }} />
          <span className={s.treatCrumb} style={{ ['--cx' as string]: '20px', ['--cy' as string]: '6px' }} />
          {c.ripple && <span className={s.treatRipple} />}
        </div>
      ))}

      {quips.map(q => (
        <div key={q.id} className={s.huskyMiniQuip} style={{ left: q.x, top: q.y }}>
          {q.text}
        </div>
      ))}

      {showRunner && (
        <div ref={runnerRef} className={s.huskyRunner}>
          <CycleStoryHusky
            flip={facing === 'left'}
            chonk={fullness}
            pose={mode === 'eating' ? 'eat' : 'run'}
            season={atmosphere.season}
            weather={atmosphere.weather}
          />
        </div>
      )}

      {/* Stuffed recovery state: clickable head for gentle belly rubs */}
      {mode === 'full' && (
        <div
          data-auth-ui="true"
          className={s.huskyFullWrap}
          onPointerDown={e => {
            e.stopPropagation();
            petFullMaxie();
          }}
          style={{
            bottom: -4,
            ...(fullState.side === 'left' ? { left: '7%' } : { right: '7%' }),
            alignItems: fullState.side === 'left' ? 'flex-start' : 'flex-end',
            pointerEvents: 'auto',
            cursor: 'pointer',
          }}
          title="Pat Maxie for belly rubs"
        >
          <div key={fullState.wiggleKey} className={s.huskySpeechBubble} data-side={fullState.side}>
            {fullState.text}
          </div>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end', gap: 8 }}>
            {atmosphere.weather === 'night' && fullState.side === 'right' && <NightLanternSvg />}
            <div key={`head-${fullState.wiggleKey}`} className={s.huskyFullWiggle} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              {hearts.map(h => (
                <svg
                  key={h.id}
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill={COLLAR}
                  className={s.petHeart}
                  style={{ left: `calc(50% + ${h.dx}px)` }}
                >
                  <path d="M12 20 C12 20 4 14.5 4 9.2 A4.5 4.5 0 0 1 12 6.8 A4.5 4.5 0 0 1 20 9.2 C20 14.5 12 20 12 20 Z" />
                </svg>
              ))}
              <CycleStoryHuskyHead mood="full" stuffed size={74} season={atmosphere.season} />
              <div style={{ display: 'flex', gap: 22, marginTop: -8 }}>
                <span style={{ width: 16, height: 9, borderRadius: '9px 9px 3px 3px', background: FUR_CREAM, border: `2px solid ${FUR_DARK}` }} />
                <span style={{ width: 16, height: 9, borderRadius: '9px 9px 3px 3px', background: FUR_CREAM, border: `2px solid ${FUR_DARK}` }} />
              </div>
            </div>
            {atmosphere.weather === 'night' && fullState.side === 'left' && <NightLanternSvg />}
          </div>
        </div>
      )}

      {mode === 'ambient' && ambientEvt && ambientEvt.variant === 'hop-arc' && (
        <div
          key={ambientEvt.id}
          className={`${s.huskyStageItem} ${ambientEvt.side === 'left' ? s.huskyHopArcL : s.huskyHopArcR}`}
          style={{
            bottom: `${4 + ambientEvt.yOffset}%`,
            ...(ambientEvt.side === 'left' ? { left: '5%' } : { right: '5%' }),
          }}
        >
          <CycleStoryHusky
            flip={ambientEvt.side === 'right'}
            chonk={fullness}
            pose="leap"
            season={atmosphere.season}
            weather={atmosphere.weather}
          />
          <span
            className={s.huskyPawFade}
            style={{
              position: 'absolute',
              bottom: -6,
              ...(ambientEvt.side === 'left' ? { left: 10 } : { right: 10 }),
              animationDelay: '250ms',
            }}
          >
            <PawPrint scale={0.85} rotate={ambientEvt.side === 'left' ? 18 : -18} />
          </span>
        </div>
      )}

      {mode === 'ambient' && ambientEvt && ambientEvt.variant === 'peek-bounce' && (
        <div
          key={ambientEvt.id}
          className={`${s.huskyStageItem} ${s.huskyPeekUp}`}
          style={{
            bottom: -4,
            ...(ambientEvt.side === 'left' ? { left: `${10 + ambientEvt.yOffset}%` } : { right: `${10 + ambientEvt.yOffset}%` }),
            display: 'flex',
            alignItems: 'flex-end',
            gap: 8,
          }}
        >
          {atmosphere.weather === 'night' && ambientEvt.side === 'right' && <NightLanternSvg />}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <CycleStoryHuskyHead mood={ambientEvt.mood} size={58} season={atmosphere.season} />
            <div style={{ display: 'flex', gap: 18, marginTop: -6 }}>
              <span style={{ width: 14, height: 8, borderRadius: '8px 8px 3px 3px', background: FUR_CREAM, border: `2px solid ${FUR_DARK}` }} />
              <span style={{ width: 14, height: 8, borderRadius: '8px 8px 3px 3px', background: FUR_CREAM, border: `2px solid ${FUR_DARK}` }} />
            </div>
          </div>
          {atmosphere.weather === 'night' && ambientEvt.side === 'left' && <NightLanternSvg />}
        </div>
      )}

      {mode === 'ambient' && ambientEvt && ambientEvt.variant === 'zoom-dash' && (
        <div key={ambientEvt.id} style={{ position: 'absolute', left: 0, right: 0, bottom: `${3 + (ambientEvt.yOffset % 5)}%`, height: 90 }}>
          <div className={`${s.huskyStageItem} ${ambientEvt.side === 'left' ? s.huskyZoomLR : s.huskyZoomRL}`}>
            <CycleStoryHusky
              flip={ambientEvt.side === 'right'}
              chonk={fullness}
              pose="leap"
              season={atmosphere.season}
              weather={atmosphere.weather}
            />
          </div>
          {[0, 1, 2].map(i => (
            <span
              key={i}
              className={s.huskyPawFade}
              style={{
                position: 'absolute',
                bottom: 4 + (i % 2) * 8,
                left: ambientEvt.side === 'left' ? `${22 + i * 24}%` : `${74 - i * 24}%`,
                animationDelay: `${650 + i * 820}ms`,
              }}
            >
              <PawPrint scale={0.85} rotate={ambientEvt.side === 'left' ? 72 : -72} />
            </span>
          ))}
        </div>
      )}

      {mode === 'ambient' && ambientEvt && ambientEvt.variant === 'pounce-spin' && (
        <div
          key={ambientEvt.id}
          className={`${s.huskyStageItem} ${ambientEvt.side === 'left' ? s.huskyPounceL : s.huskyPounceR}`}
          style={{
            top: `${14 + ambientEvt.yOffset}%`,
            ...(ambientEvt.side === 'left' ? { left: '7%' } : { right: '7%' }),
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          {ambientEvt.side === 'right' && (
            <span className={s.huskySparkle}>
              <ClaySparkle />
            </span>
          )}
          <CycleStoryHuskyHead mood={ambientEvt.mood} size={50} season={atmosphere.season} />
          {ambientEvt.side === 'left' && (
            <span className={s.huskySparkle}>
              <ClaySparkle />
            </span>
          )}
        </div>
      )}
    </div>
  );
}
