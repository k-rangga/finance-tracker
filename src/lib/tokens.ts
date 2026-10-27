/** Design tokens mirrored from styles/tokens.css for values computed in TS (chart colours, status inks). */
export const C = {
  bg: '#f3f7f6',
  surface: '#ffffff',
  border: '#e2e9e7',
  borderStrong: '#d8e1df',
  divider: '#ecf1f0',
  text: '#16201e',
  textMuted: '#4b5855',
  textSoft: '#3f4a44',
  grey: '#b7c2bc',
  greyDark: '#8c9892',
  accent500: '#14a08a',
  accent600: '#0b7a6a',
  accent700: '#0b6b5c',
  accent800: '#0b5c50',
  accent900: '#086052',
  accentTint: '#e3f6f2',
  accentHover: '#eef7f5',
  accentSoft: '#ecf8f5',
  mint: ['#0b4f45', '#0b7a6a', '#3d9a88', '#7fb8aa', '#14a08a', '#2fc2a4', '#6fd9c2', '#b4ecdf', '#a6e4d6'],
  red: '#c94a4a',
  redInk: '#a3302f',
  redTint: '#fdeceb',
  amber: '#e59a1a',
  amberInk: '#8a5a06',
  amberTint: '#fff4de',
} as const;

/** Positive/negative ink for P/L and deltas. */
export const plInk = (v: number) => (v >= 0 ? C.accent800 : C.redInk);
