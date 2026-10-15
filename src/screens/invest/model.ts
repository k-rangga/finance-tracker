import { DAY, fullDate, parseISO, sum } from '../../lib/format';

export type Market = 'IDX' | 'US' | 'Crypto';
export type Style = 'Long-term' | 'Swing';
export type FollowedPlan = 'Yes' | 'Partly' | 'No';

export type Trade = {
  id: string;
  mk: Market;
  tk: string;
  nm: string;
  /** Buy date (ISO). */
  d: string;
  px: number;
  q: number;
  fee?: number;
  st: Style;
  cv: 1 | 2 | 3 | 4 | 5;
  tg?: number;
  sl?: number;
  cat?: string;
  /** Catalyst date (ISO). */
  cd?: string;
  th: string;
  tags?: string;
  lev?: number;
  dir?: 'Long' | 'Short';
  ex?: { px: number; d: string; fp?: FollowedPlan; rt?: number; ls?: string };
};

export type Prices = { map: Record<string, number>; at: string };
export type Snap = { d: string; v: number; c: number };

export const MARKETS: Market[] = ['IDX', 'US', 'Crypto'];
export const MK_COLOR: Record<Market, string> = { IDX: '#0b6b5c', US: '#2fc2a4', Crypto: '#a6e4d6' };
export const MK_NAME: Record<Market, string> = { IDX: 'IDX stocks', US: 'US stocks', Crypto: 'Crypto' };

/** Parse a typed number. IDX prices are whole rupiah, so `.` is a thousands separator there. */
export const numIn = (v: string | number | undefined, mk?: Market) => parseFloat(String(v ?? '').replace(mk === 'IDX' ? /\D/g : /[^\d.]/g, ''));

/** Native price label: `Rp 9.375` for IDX, `$548.20` / `$104,500` otherwise. */
export const nat = (v: number, mk: Market) =>
  mk === 'IDX'
    ? 'Rp ' + Math.round(v).toLocaleString('id-ID')
    : '$' + (v >= 1000 ? Math.round(v).toLocaleString('en-US') : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export const qtyLabel = (t: Pick<Trade, 'mk' | 'q' | 'tk'>) =>
  t.mk === 'IDX' ? t.q / 100 + (t.q === 100 ? ' lot' : ' lots') : t.mk === 'US' ? t.q + (t.q === 1 ? ' share' : ' shares') : t.q + ' ' + t.tk;

export const dirOf = (t: Pick<Trade, 'dir'>) => (t.dir === 'Short' ? -1 : 1);
export const levOf = (t: Pick<Trade, 'lev'>) => t.lev || 1;
/** Approximate liquidation price: px × (1 − dir / lev). */
export const liqOf = (t: Trade) => t.px * (1 - dirOf(t) / levOf(t));
export const levTag = (t: Trade) => (levOf(t) > 1 ? `${levOf(t)}x ${t.dir || 'Long'}` : '');
export const buyFee = (t: Trade) => (t.fee != null ? t.fee : t.px * t.q * (t.mk === 'IDX' ? 0.0015 : 0.001));
export const sellFee = (t: Trade) => (t.ex ? t.ex.px * t.q * (t.mk === 'IDX' ? 0.0025 : 0.001) : 0);
/** Reward in units of planned risk. */
export const rMultiple = (t: Trade, px: number) => (t.sl && (t.px - t.sl) * dirOf(t) > 0 ? (px - t.px) / (t.px - t.sl) : null);
export const fmtR = (r: number) => (r >= 0 ? '+' : '−') + Math.abs(r).toFixed(1) + 'R';
export const fmtD = (iso: string) => fullDate(parseISO(iso));
export const daysBetween = (a: string, b: string) => Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / DAY);

export type Position = { t: Trade; last: number; val: number; cost: number; pl: number; plp: number };
export type Closed = { t: Trade; net: number; ret: number; r: number | null; days: number };

export function computePortfolio(journal: Trade[], prices: Prices, fx: number, year: number) {
  const toIdr = (v: number, mk: Market) => (mk === 'IDX' ? v : v * fx);
  const lastOf = (t: Trade) => prices.map[t.tk] ?? t.px;
  const hasPrice = (t: Trade) => prices.map[t.tk] != null;

  const pos: Position[] = journal
    .filter(t => !t.ex)
    .map(t => {
      const last = lastOf(t);
      const cost = toIdr((t.px * t.q) / levOf(t) + buyFee(t), t.mk);
      const pl = toIdr((last - t.px) * t.q * dirOf(t) - buyFee(t), t.mk);
      return { t, last, cost, pl, val: cost + pl, plp: (pl / cost) * 100 };
    });
  const tot = sum(pos.map(p => p.val));
  const cost = sum(pos.map(p => p.cost));

  const done: Closed[] = journal
    .filter(t => t.ex)
    .map(t => {
      const ex = t.ex!;
      return {
        t,
        net: toIdr((ex.px - t.px) * t.q * dirOf(t) - buyFee(t) - sellFee(t), t.mk),
        ret: ((ex.px - t.px) / t.px) * 100 * dirOf(t) * levOf(t),
        r: rMultiple(t, ex.px),
        days: daysBetween(t.d, ex.d),
      };
    })
    .sort((a, b) => b.t.ex!.d.localeCompare(a.t.ex!.d));

  const realized = sum(done.filter(d => d.t.ex!.d.startsWith(String(year))).map(d => d.net));
  const wins = done.filter(d => d.net > 0).length;
  const openTks = pos.map(p => p.t).filter((t, i, a) => a.findIndex(x => x.tk === t.tk) === i);

  return { pos, tot, cost, upl: tot - cost, done, realized, wins, openTks, lastOf, hasPrice, toIdr };
}

export type Portfolio = ReturnType<typeof computePortfolio>;

/** Draft shape for the New entry form (strings while typing). */
export type Draft = {
  mk: Market;
  tk: string;
  nm: string;
  d: string;
  px: string;
  q: string;
  fee: string;
  st: Style;
  th: string;
  cat: string;
  cd: string;
  tg: string;
  sl: string;
  cv: Trade['cv'];
  lev: number;
  dir: 'Long' | 'Short';
  tags: string;
};

export type Rule = { label: string; ok: boolean };

/** Entry rules apply to swing trades and any leveraged position. */
export function entryRules(D: Draft): Rule[] {
  const px = numIn(D.px, D.mk);
  const sl = numIn(D.sl, D.mk);
  const tg = numIn(D.tg, D.mk);
  const lev = D.mk === 'Crypto' ? D.lev || 1 : 1;
  const dr = lev > 1 && D.dir === 'Short' ? -1 : 1;
  if (D.st !== 'Swing' && lev === 1) return [];
  const okSl = sl > 0 && px > 0 && (px - sl) * dr > 0;
  const rr = okSl && tg > 0 ? (tg - px) / (px - sl) : 0;
  const r: Rule[] = [
    { label: 'Stop loss set', ok: okSl },
    { label: 'Catalyst with a date', ok: !!(D.cat.trim() && D.cd) },
    { label: 'Reward : risk at least 2 : 1', ok: rr >= 2 },
  ];
  if (lev > 1) {
    const liq = px * (1 - dr / lev);
    r.push({ label: 'Stop hits before liquidation', ok: okSl && (sl - liq) * dr > 0 });
  }
  return r;
}
