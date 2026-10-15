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

/**
 * Last prices by ticker. `at`: date of the last update (ISO day).
 * `auto`: tickers last priced from Google Finance (ticker → quote time); any other price was typed in.
 * `quotedAt`: when Google Finance was last asked (ISO timestamp), to refresh about every 30 minutes.
 */
export type Prices = { map: Record<string, number>; at: string; auto?: Record<string, string>; quotedAt?: string };

/** An update on an open position: buying more (average up or down) or just a note. */
export type UpdateKind = 'avg_up' | 'avg_down' | 'note';
export type TradeUpdate = {
  id: string;
  tradeId: string;
  /** When it happened (ISO timestamp). */
  at: string;
  kind: UpdateKind;
  /** Avg up/down only: buy price, quantity (shares or units, like Trade.q) and fee (auto when missing). */
  px?: number;
  q?: number;
  fee?: number;
  note?: string;
};

export const UPDATE_LABEL: Record<UpdateKind, string> = { avg_up: 'Avg up', avg_down: 'Avg down', note: 'Note' };
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
/** Fee of an avg up/down buy: as entered, else the same auto rate as the first buy. */
export const addFee = (t: Pick<Trade, 'mk'>, u: TradeUpdate) => (u.fee != null ? u.fee : (u.px ?? 0) * (u.q ?? 0) * (t.mk === 'IDX' ? 0.0015 : 0.001));
export const isAdd = (u: TradeUpdate) => u.kind !== 'note' && (u.px ?? 0) > 0 && (u.q ?? 0) > 0;

/** A position at one moment: quantity, average buy price, and cost including all buy fees (native currency). */
export type PosState = { q: number; avg: number; cost: number };

/**
 * The position after each update, oldest first: `before` and `after` for every update (a note leaves it unchanged).
 * The average is quantity-weighted over the buys; fees are carried in the cost, as for the first buy.
 */
export function positionHistory(t: Trade, updates: TradeUpdate[]) {
  let cur: PosState = { q: t.q, avg: t.px, cost: t.px * t.q + buyFee(t) };
  return updates
    .filter(u => u.tradeId === t.id)
    .sort((a, b) => a.at.localeCompare(b.at))
    .map(u => {
      const before = cur;
      if (isAdd(u)) {
        const q = before.q + u.q!;
        cur = { q, avg: (before.avg * before.q + u.px! * u.q!) / q, cost: before.cost + u.px! * u.q! + addFee(t, u) };
      }
      return { u, before, after: cur };
    });
}

/**
 * The trade as it stands with its avg ups/downs folded in: total quantity, weighted average price and total buy fees.
 * The stored entry is never changed; everything that values the position uses this.
 */
export function effectiveTrade(t: Trade, updates: TradeUpdate[]): Trade {
  const adds = updates.filter(u => u.tradeId === t.id && isAdd(u));
  if (!adds.length) return t;
  const q = t.q + sum(adds.map(u => u.q!));
  const px = (t.px * t.q + sum(adds.map(u => u.px! * u.q!))) / q;
  return { ...t, px, q, fee: buyFee(t) + sum(adds.map(u => addFee(t, u))) };
}
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
  /** Required: null until chosen. */
  cv: Trade['cv'] | null;
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
  // Target and catalyst are optional; reward : risk is only checked once a target is set.
  const r: Rule[] = [{ label: 'Stop loss set', ok: okSl }];
  if (tg > 0) r.push({ label: 'Reward : risk at least 2 : 1', ok: rr >= 2 });
  if (lev > 1) {
    const liq = px * (1 - dr / lev);
    r.push({ label: 'Stop hits before liquidation', ok: okSl && (sl - liq) * dr > 0 });
  }
  return r;
}
