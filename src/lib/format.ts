export type Currency = 'IDR' | 'USD';

const sign = (v: number, on: boolean) => (on ? (v > 0 ? '+ ' : v < 0 ? '− ' : '') : '');

/** `Rp30.000.000` / `$6,500` (Maxie: no space after Rp, dots for thousands, no decimals). Pass `signed` to prefix + / −. */
export function fmtFull(v: number, cur: Currency, signed = false): string {
  const a = Math.abs(v);
  const body = cur === 'USD' ? '$' + Math.round(a).toLocaleString('en-US') : 'Rp' + Math.round(a).toLocaleString('id-ID');
  return sign(v, signed) + body;
}

/** One decimal, English style, and no ".0": 1.84 → "1.8", 2.0 → "2". */
const oneDecimal = (v: number) => (Math.round(v * 10) / 10).toLocaleString('en-US', { maximumFractionDigits: 1 });

/** Compact amounts for lists, charts and tiles, in English units: `Rp1.2B`, `Rp1.8M`, `Rp450K`, `Rp750`; `$1.2K`, `$450`. */
export function fmtShort(v: number, cur: Currency, signed = false): string {
  const a = Math.abs(v);
  const unit = a >= 999_500_000 ? oneDecimal(a / 1e9) + 'B' : a >= 999_500 ? oneDecimal(a / 1e6) + 'M' : a >= 1000 ? Math.round(a / 1e3) + 'K' : null;
  const body = cur === 'USD' ? '$' + (unit ?? Math.round(a)) : 'Rp' + (unit ?? Math.round(a).toLocaleString('id-ID'));
  return sign(v, signed) + body;
}

/** Signed percentage with one decimal: `+4.2%`, `−1.0%`. */
export const fmtPct = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + '%';

/** Clamp to 0–100 and return a CSS percentage. */
export const pc = (v: number) => Math.max(0, Math.min(100, Number.isFinite(v) ? v : 0)) + '%';

export const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

/** `Wed 15 Oct` */
export const dayLabel = (d: Date) => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
/** `15 Oct` */
export const dayMonth = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
/** `15 Oct 2026` */
export const fullDate = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export const DAY = 864e5;

export function parseISO(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function toISO(d: Date): string {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const diffDays = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DAY);

export function startOfToday(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

/** "KALAKA RANGGA S" → "Kalaka Rangga S"; names already in mixed case are left alone. */
export const tidyName = (s: string) => (s === s.toUpperCase() && /[A-Z]/.test(s) ? s.toLowerCase().replace(/(^|[\s(/-])\p{L}/gu, c => c.toUpperCase()) : s);

/** `1` → `"1st"`, `25` → `"25th"`. */
export const ordinal = (n: number) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');


