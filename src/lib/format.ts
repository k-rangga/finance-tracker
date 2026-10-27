export type Currency = 'IDR' | 'USD';

const sign = (v: number, on: boolean) => (on ? (v > 0 ? '+ ' : v < 0 ? '− ' : '') : '');

/** `Rp 30.000.000` / `$6,500`. Pass `signed` to prefix + / −. */
export function fmtFull(v: number, cur: Currency, signed = false): string {
  const a = Math.abs(v);
  const body = cur === 'USD' ? '$' + Math.round(a).toLocaleString('en-US') : 'Rp ' + (Math.round(a / 1000) * 1000).toLocaleString('id-ID');
  return sign(v, signed) + body;
}

/** `Rp 1.2B`, `Rp 1.2M`, `Rp 450K`, `Rp 0`, `$1.2k`, `$450`. */
export function fmtShort(v: number, cur: Currency, signed = false): string {
  const a = Math.abs(v);
  let body: string;
  if (cur === 'USD') body = '$' + (a >= 1000 ? (a / 1000).toFixed(1) + 'k' : Math.round(a));
  else body = 'Rp ' + (a >= 1e9 ? (a / 1e9).toFixed(1) + 'B' : a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a >= 500 ? Math.round(a / 1e3) + 'K' : '0');
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

