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

/** Last known prices for the demo tickers, used until the user enters their own. */
export const SEED_PRICES: Record<string, number> = { BBCA: 9375, TLKM: 2980, ANTM: 1985, BBRI: 4180, VOO: 548.2, NVDA: 141.3, BTC: 104500, ETH: 3280, SOL: 189 };

export const SEED_JOURNAL: Trade[] = [
  { id: 'j1', mk: 'IDX', tk: 'BBCA', nm: 'Bank Central Asia', d: '2026-03-12', px: 8950, q: 3000, st: 'Long-term', cv: 4, tg: 10500, sl: 8200, cat: 'Q3 results', cd: '2026-10-22', th: 'Largest private bank with steady loan growth and the cleanest asset quality in the sector. Holding through the rate-cut cycle; add on dips below 9,000.', tags: 'bank, dividend' },
  { id: 'j2', mk: 'IDX', tk: 'TLKM', nm: 'Telkom Indonesia', d: '2026-06-03', px: 3120, q: 3000, st: 'Swing', cv: 3, tg: 3600, sl: 2900, cat: 'Data-centre unit IPO filing', cd: '2026-11-12', th: 'Price bouncing off 3,000 support with talk of a data-centre spin-off. Wrong if it closes below 2,900.' },
  { id: 'j3', mk: 'IDX', tk: 'ANTM', nm: 'Aneka Tambang', d: '2026-08-18', px: 1640, q: 4000, st: 'Swing', cv: 4, tg: 2100, sl: 1520, cat: 'Gold price and nickel quota update', cd: '2026-11-03', th: 'Breakout above 1,600 on volume while gold trades near record highs. Foreign net buy for three straight weeks.' },
  { id: 'j4', mk: 'IDX', tk: 'BBRI', nm: 'Bank Rakyat Indonesia', d: '2026-09-08', px: 4310, q: 2000, st: 'Long-term', cv: 3, tg: 5000, sl: 3900, cat: 'Interim dividend announcement', cd: '2026-11-20', th: 'Microlending credit costs look past the peak and the dividend yield is above 7%. Sized small until NPL data confirms.' },
  { id: 'j5', mk: 'US', tk: 'VOO', nm: 'Vanguard S&P 500 ETF', d: '2026-01-26', px: 512, q: 3, st: 'Long-term', cv: 5, th: 'Core holding. Buy every quarter regardless of price; never sell for a trade.' },
  { id: 'j6', mk: 'US', tk: 'NVDA', nm: 'NVIDIA', d: '2026-07-14', px: 128, q: 5, st: 'Swing', cv: 3, tg: 155, sl: 116, cat: 'Q3 earnings', cd: '2026-11-18', th: 'Cloud providers raised AI capex guidance again. Riding into earnings with a stop under the July low.' },
  { id: 'j7', mk: 'Crypto', tk: 'BTC', nm: 'Bitcoin', d: '2026-05-20', px: 98000, q: 0.005, st: 'Long-term', cv: 3, th: 'Small long-term allocation. Cap crypto at 15% of the portfolio and rebalance above that.' },
  { id: 'j8', mk: 'Crypto', tk: 'ETH', nm: 'Ethereum', d: '2026-09-02', px: 3550, q: 0.1, st: 'Swing', cv: 2, tg: 4200, sl: 3150, cat: 'Network upgrade', cd: '2026-12-03', th: 'Reclaimed 3,400 with ETF inflows picking up. Low conviction, half size.' },
  { id: 'j9', mk: 'IDX', tk: 'ADRO', nm: 'Alamtri Resources Indonesia', d: '2026-08-04', px: 2480, q: 3000, st: 'Swing', cv: 4, tg: 2800, sl: 2350, cat: 'Coal price recovery', cd: '2026-09-15', th: 'Coal benchmark turning up and a cash-rich balance sheet. Range breakout above 2,450.', ex: { px: 2760, d: '2026-09-12', fp: 'Yes', rt: 4, ls: 'Sold just under target ahead of the coal price data. The plan worked; position size could have been larger for a 4/5 conviction.' } },
  { id: 'j10', mk: 'IDX', tk: 'GOTO', nm: 'GoTo Gojek Tokopedia', d: '2026-07-01', px: 82, q: 20000, st: 'Swing', cv: 2, tg: 100, sl: 74, cat: 'Profitability update', cd: '2026-07-30', th: 'Expected the first adjusted profit quarter to re-rate the stock.', ex: { px: 71, d: '2026-07-29', fp: 'No', rt: 2, ls: 'Moved the stop from 74 to 70 hoping for a bounce and lost more. Exit at the stop next time.' } },
  { id: 'j11', mk: 'US', tk: 'TSLA', nm: 'Tesla', d: '2026-06-10', px: 248, q: 4, st: 'Swing', cv: 2, tg: 290, sl: 232, th: 'Bought on robotaxi headlines and momentum.', ex: { px: 231, d: '2026-07-24', fp: 'Yes', rt: 3, ls: 'The stop did its job. Entered on hype with no dated catalyst; skip setups like this.' } },
  { id: 'j12', mk: 'Crypto', tk: 'SOL', nm: 'Solana', d: '2026-04-15', px: 142, q: 6, st: 'Swing', cv: 3, tg: 175, sl: 128, cat: 'ETF decision', cd: '2026-05-28', th: 'Retest of the 140 breakout level ahead of the ETF decision.', ex: { px: 171, d: '2026-05-30', fp: 'Yes', rt: 4, ls: 'Took profit at plan. Good entry on the retest.' } },
  { id: 'j13', mk: 'IDX', tk: 'BMRI', nm: 'Bank Mandiri', d: '2026-02-10', px: 5150, q: 1000, st: 'Swing', cv: 3, tg: 5800, sl: 4900, cat: 'Final dividend cum date', cd: '2026-04-10', th: 'Dividend run-up into the cum date with yield near 8%.', ex: { px: 5600, d: '2026-04-02', fp: 'Partly', rt: 3, ls: 'Exited early on one red day, eight days before the cum date. Wait for the catalyst.' } },
  { id: 'j14', mk: 'Crypto', tk: 'SOL', nm: 'Solana', d: '2026-10-06', px: 182, q: 6, lev: 3, dir: 'Long', st: 'Swing', cv: 3, tg: 215, sl: 170, cat: 'Firedancer client mainnet', cd: '2026-11-10', th: 'Higher low above 175 after the ETF approval. 3x on a small margin; the stop sits well above the liquidation price.' },
  { id: 'j15', mk: 'Crypto', tk: 'BTC', nm: 'Bitcoin', d: '2026-08-11', px: 112000, q: 0.01, lev: 5, dir: 'Short', st: 'Swing', cv: 2, tg: 104000, sl: 115000, cat: 'US CPI release', cd: '2026-08-13', th: 'Rejection at 112,000 resistance going into the CPI print.', ex: { px: 116200, d: '2026-08-14', fp: 'No', rt: 1, ls: 'Did not exit at the 115,000 stop and closed at 116,200. At 5x that cost 19% of margin. Place stop orders on the exchange instead of mental stops.' } },
];

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
  const lastOf = (t: Trade) => prices.map[t.tk] ?? SEED_PRICES[t.tk] ?? t.px;
  const hasPrice = (t: Trade) => prices.map[t.tk] != null || SEED_PRICES[t.tk] != null;

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
