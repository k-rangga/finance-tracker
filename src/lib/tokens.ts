/** Design tokens for inline styles: the CSS variables in styles/global.css, so light and dark both follow. */
export const C = {
  bg: 'var(--bg)',
  surface: 'var(--surface)',
  border: 'var(--border)',
  borderStrong: 'var(--border-strong)',
  divider: 'var(--divider)',
  hover: 'var(--hover)',
  text: 'var(--text)',
  textMuted: 'var(--text-muted)',
  textSoft: 'var(--text-soft)',
  textFaint: 'var(--text-faint)',
  grey: '#b7b4aa',
  greyDark: '#8c8a82',
  accent500: 'var(--accent-500)',
  accent600: 'var(--accent-600)',
  accent700: 'var(--accent-700)',
  accent800: 'var(--accent-800)',
  accent900: 'var(--accent-900)',
  accentStrong: 'var(--accent-strong)',
  accentTint: 'var(--accent-tint)',
  accentHover: 'var(--accent-hover)',
  accentSoft: 'var(--accent-soft)',
  onAccent: 'var(--on-accent)',
  // Chart greens: fixed hex, readable on light and dark.
  mint: ['#0b4f45', '#1f7f6d', '#3d9a88', '#7fb8aa', '#2a9d86', '#2fc2a4', '#6fd9c2', '#b4ecdf', '#a6e4d6'],
  red: 'var(--red)',
  redInk: 'var(--red-ink)',
  redTint: 'var(--red-tint)',
  amber: 'var(--amber)',
  amberInk: 'var(--amber-ink)',
  amberTint: 'var(--amber-tint)',
} as const;

/** Positive/negative ink for P/L and deltas. */
export const plInk = (v: number) => (v >= 0 ? C.accent800 : C.redInk);
