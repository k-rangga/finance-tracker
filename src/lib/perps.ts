import { run } from './gas';

/** One Hyperliquid fill as the perp_fills tab keeps it (`time` in ms, money in USDC). `pnl` is already net of its fee. */
export type Fill = { tid: string; time: number; coin: string; dir: string; px: number; sz: number; fee: number; pnl: number };

/** Your review of a trade, the same fields as a typed-in entry's. `mistakes` is a comma-separated list. */
export type PerpNote = { setup: string; mistakes: string; rating: number; note: string; followed?: '' | 'Yes' | 'Partly' | 'No'; skipped?: boolean };

/** A funding payment on an open position: negative when you paid it. */
export type Funding = { time: number; coin: string; usdc: number };

/** A position open right now, with its unrealized PnL. `size` is negative for a short. */
export type Position = { coin: string; size: number; entry: number; unrealized: number };

export type PerpState = {
  address: string;
  syncedAt: number | null;
  fills: Fill[];
  funding?: Funding[];
  positions?: Position[];
  /** Account value in USDC: margin on every perp market plus spot USDC (null when it couldn't be read). */
  equity?: number | null;
  notes: Record<string, PerpNote>;
};

export const getPerps = () => run<PerpState>('getPerps');
export const syncPerps = () => run<PerpState>('syncPerps');
/** The wallet to journal (it can also be typed in the Sheet's config tab). '' clears it. */
export const setPerpAddress = (address: string) => run<true>('setPerpAddress', { address });
export const setPerpNote = (tradeId: string, note: PerpNote | null) => run('setPerpNote', { tradeId, note });
export const skipPerpNotes = (ids: string[]) => run<number>('skipPerpNotes', { ids });

/** Monthly journal notes, by "account|YYYY-MM". */
export const getJournalMonths = () => run<Record<string, string>>('getJournalMonths');
export const setJournalMonth = (key: string, note: string) => run('setJournalMonth', { key, note });
export const draftJournalMonth = (summary: string) => run<{ text?: string; error?: string; detail?: string }>('draftJournalMonth', { summary });

export const SETUPS = ['Breakout', 'Pullback', 'Range', 'Reversal', 'News', 'Scalp'];
export const MISTAKES = ['FOMO', 'No stop', 'Moved stop', 'Oversized', 'Revenge', 'Early exit', 'Late entry'];

/**
 * One trade: every fill from the position opening (from zero) to it being back at zero, however many entries and
 * exits there were. A flip ("Long > Short") closes one trade and opens the next with the rest of its size.
 */
export type PerpTrade = {
  /** The first fill's tid: stable, so your notes stay on it as new fills arrive. */
  id: string;
  coin: string;
  side: 'Long' | 'Short';
  opened: Date;
  closed: Date | null;
  fills: Fill[];
  /** Size-weighted average entry and exit prices. */
  entry: number;
  exit: number | null;
  /** Biggest position size reached, and its value at the average entry. */
  maxSize: number;
  maxNotional: number;
  fees: number;
  /** Funding paid (negative) or received while it was open. */
  funding: number;
  /** After fees and funding. */
  pnl: number;
  liquidated: boolean;
};

/** Which way a fill moves the position: +1 buys, -1 sells. */
const SIGN: Record<string, 1 | -1> = {
  'Open Long': 1,
  'Close Short': 1,
  'Short > Long': 1,
  Buy: 1,
  'Market Order Liquidation: Close Short': 1,
  'Open Long (Price Improved)': 1,
  'Open Short': -1,
  'Close Long': -1,
  'Long > Short': -1,
  Sell: -1,
  'Market Order Liquidation: Close Long': -1,
};

const EPS = 1e-9;

/** Prediction-market outcomes ("BTC above 77610 on Aug 30…? - Yes", "HYPE touches 100… - Yes") aren't positions. */
const isOutcome = (coin: string) => /\?| - (Yes|No)$|^#/.test(coin);

/**
 * Fills merged into trades, oldest first; the last one per coin may still be open (`closed: null`). Each funding
 * payment goes to the trade of its coin that was open at the time.
 */
export function mergeFills(fills: Fill[], funding: Funding[] = []): PerpTrade[] {
  const sorted = [...fills].filter(f => SIGN[f.dir] && !isOutcome(f.coin)).sort((a, b) => a.time - b.time || Number(a.tid) - Number(b.tid));
  /** A trade being built, with running totals for its average prices. */
  type Building = PerpTrade & { inQty: number; inCost: number; outQty: number; outCost: number };
  const pos = new Map<string, number>();
  const open = new Map<string, Building>();
  const out: PerpTrade[] = [];

  const start = (f: Fill, side: 'Long' | 'Short'): Building => ({
    id: f.tid,
    coin: f.coin,
    side,
    opened: new Date(f.time),
    closed: null,
    fills: [],
    entry: 0,
    exit: null,
    maxSize: 0,
    maxNotional: 0,
    fees: 0,
    funding: 0,
    pnl: 0,
    liquidated: false,
    inQty: 0,
    inCost: 0,
    outQty: 0,
    outCost: 0,
  });
  const finish = (t: Building, at: number) => {
    const { inQty, inCost, outQty, outCost, ...trade } = t;
    out.push({ ...trade, closed: at ? new Date(at) : null, entry: inQty ? inCost / inQty : 0, exit: outQty ? outCost / outQty : null, maxNotional: trade.maxSize * (inQty ? inCost / inQty : 0) });
  };

  for (const f of sorted) {
    const s = SIGN[f.dir];
    const before = pos.get(f.coin) ?? 0;
    let t = open.get(f.coin);
    if (!t) {
      t = start(f, s > 0 ? 'Long' : 'Short');
      open.set(f.coin, t);
    }
    let after = before + s * f.sz;
    // Sizes are decimals: what's left after closing is float noise, not a position.
    if (Math.abs(after) < EPS) after = 0;
    // Going past zero opens the other way, whatever the fill is called: Hyperliquid reports what's left of a close
    // bigger than the position as the start of the opposite one.
    const crosses = Math.abs(before) > EPS && after * before < 0;
    // On a flip, only the part that brings the position to zero belongs to this trade.
    const closing = crosses ? Math.abs(before) : f.sz;
    const share = closing / f.sz;
    t.fills.push(f);
    t.fees += f.fee * share;
    // A fill's closed PnL already has its whole fee taken off; on a flip, the opening part's fee goes to the next trade.
    t.pnl += f.pnl + (crosses ? f.fee * (1 - share) : 0);
    if (f.dir.includes('Liquidation')) t.liquidated = true;
    const adds = (t.side === 'Long') === s > 0;
    if (adds) {
      t.inQty += f.sz;
      t.inCost += f.sz * f.px;
    } else {
      t.outQty += closing;
      t.outCost += closing * f.px;
    }
    t.maxSize = Math.max(t.maxSize, Math.abs(crosses ? before : after));

    if (Math.abs(after) < EPS || crosses) {
      finish(t, f.time);
      open.delete(f.coin);
      pos.set(f.coin, 0);
      if (crosses) {
        // The rest opens the other way; its share of the fee goes with it.
        const rest = start(f, after > 0 ? 'Long' : 'Short');
        const qty = Math.abs(after);
        rest.fills.push(f);
        rest.fees = f.fee * (1 - share);
        rest.pnl = -rest.fees;
        rest.inQty = qty;
        rest.inCost = qty * f.px;
        rest.maxSize = qty;
        open.set(f.coin, rest);
        pos.set(f.coin, after);
      }
    } else pos.set(f.coin, after);
  }
  for (const t of open.values()) finish(t, 0);
  out.sort((a, b) => a.opened.getTime() - b.opened.getTime());

  const byCoin = new Map<string, PerpTrade[]>();
  for (const t of out) byCoin.set(t.coin, [...(byCoin.get(t.coin) ?? []), t]);
  for (const f of funding) {
    const t = byCoin.get(f.coin)?.find(x => x.opened.getTime() <= f.time && (!x.closed || f.time <= x.closed.getTime()));
    if (!t) continue;
    t.funding += f.usdc;
    t.pnl += f.usdc;
  }
  return out;
}

export type PerpStats = {
  trades: number;
  wins: number;
  winRate: number;
  pnl: number;
  fees: number;
  funding: number;
  avgWin: number;
  avgLoss: number;
  /** Total won ÷ total lost. Above 1 makes money. */
  profitFactor: number;
  liquidated: number;
  /** Net PnL, trades and wins grouped by a key (coin, side, hour…), worst first. */
  by: (key: (t: PerpTrade) => string) => { key: string; trades: number; wins: number; pnl: number }[];
};

/** Closed trades only: an open one has no result yet. */
export function perpStats(all: PerpTrade[]): PerpStats {
  const trades = all.filter(t => t.closed);
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const won = wins.reduce((a, t) => a + t.pnl, 0);
  const lost = -losses.reduce((a, t) => a + t.pnl, 0);
  return {
    trades: trades.length,
    wins: wins.length,
    winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
    pnl: won - lost,
    fees: trades.reduce((a, t) => a + t.fees, 0),
    funding: trades.reduce((a, t) => a + t.funding, 0),
    avgWin: wins.length ? won / wins.length : 0,
    avgLoss: losses.length ? lost / losses.length : 0,
    profitFactor: lost > 0 ? won / lost : won > 0 ? Infinity : 0,
    liquidated: trades.filter(t => t.liquidated).length,
    by: key => {
      const m = new Map<string, { key: string; trades: number; wins: number; pnl: number }>();
      for (const t of trades) {
        const k = key(t);
        const x = m.get(k) ?? { key: k, trades: 0, wins: 0, pnl: 0 };
        x.trades++;
        if (t.pnl > 0) x.wins++;
        x.pnl += t.pnl;
        m.set(k, x);
      }
      return [...m.values()].sort((a, b) => a.pnl - b.pnl);
    },
  };
}

/** "45m", "6h", "3d": how long a trade was held. */
export function heldFor(t: PerpTrade, now = new Date()) {
  const ms = (t.closed ?? now).getTime() - t.opened.getTime();
  const m = Math.round(ms / 6e4);
  if (m < 60) return `${Math.max(1, m)}m`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
}

/** How long it was held, in buckets for the insights. */
export const holdBucket = (t: PerpTrade) => {
  const h = ((t.closed ?? new Date()).getTime() - t.opened.getTime()) / 36e5;
  return h < 1 ? 'Under 1 hour' : h < 6 ? '1–6 hours' : h < 24 ? '6–24 hours' : 'Over a day';
};

export const usd = (v: number, signed = false) =>
  (signed && v > 0 ? '+' : v < 0 ? '−' : '') + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
