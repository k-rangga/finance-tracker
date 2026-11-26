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
  grey: 'var(--line-strong)',
  greyDark: 'var(--ink-muted)',
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
  /** Clay-coloured text: links, eyebrows, selected items. */
  clayInk: 'var(--clay-ink)',
  // Good news and done states (Maxie's Moss green), apart from the brand clay so neither stands in for the other.
  good: 'var(--good)',
  goodTint: 'var(--good-soft)',
  sky: 'var(--sky)',
  skyTint: 'var(--sky-soft)',
  // Chart series: the Maxie category slots in order (own light and dark steps).
  series: ['var(--category-1)', 'var(--category-2)', 'var(--category-3)', 'var(--category-4)', 'var(--category-5)', 'var(--category-6)', 'var(--category-7)', 'var(--category-8)'],
  red: 'var(--red)',
  redInk: 'var(--red-ink)',
  redTint: 'var(--red-tint)',
  amber: 'var(--amber)',
  amberInk: 'var(--amber-ink)',
  amberTint: 'var(--amber-tint)',
} as const;

/** Positive/negative ink for P/L and deltas. */
export const plInk = (v: number) => (v >= 0 ? C.good : C.redInk);
