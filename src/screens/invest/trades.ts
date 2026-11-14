import type { PerpNote, PerpTrade } from '../../lib/perps';
import { parseISO, sum } from '../../lib/format';
import { buyFee, sellFee, type FollowedPlan, type Portfolio, type Trade } from './model';

export type Source = 'manual' | 'perp';
export const SOURCE_NAME: Record<Source, string> = { manual: 'Stocks & crypto', perp: 'Hyperliquid' };

/**
 * A trade from either source, in one shape, so the Trades list and the Review count them the same way. Money is in
 * rupiah (Hyperliquid's USDC at your USD rate); each source's own detail stays on `manual` / `perp`.
 */
export type AnyTrade = {
  key: string;
  source: Source;
  /** Ticker or coin. */
  name: string;
  side: 'Long' | 'Short';
  opened: Date;
  closed: Date | null;
  /** Realised once closed; while open, unrealised for typed-in entries and 0 for Hyperliquid (its open PnL is on Overview). */
  pnl: number;
  /** Return on the money in the trade, % (Hyperliquid: on its biggest position value). */
  ret: number | null;
  /** In units of planned risk; only for entries with a stop. */
  r: number | null;
  fees: number;
  /** Funding paid (negative) or received; Hyperliquid only. */
  funding: number;
  liquidated: boolean;
  followed?: FollowedPlan;
  rating?: number;
  setup?: string;
  mistakes: string[];
  manual?: Trade;
  perp?: PerpTrade;
};

/** A Hyperliquid note's followed-plan answer; older notes only had a 1–5 rating, which meant the same. */
export const followedOf = (n?: PerpNote): FollowedPlan | undefined =>
  n?.followed ? n.followed : n?.rating ? (n.rating >= 4 ? 'Yes' : n.rating === 3 ? 'Partly' : 'No') : undefined;

export const splitTags = (v?: string) => (v ? v.split(',').map(x => x.trim()).filter(Boolean) : []);

export function allTrades(P: Portfolio, journal: Trade[], perps: PerpTrade[], notes: Record<string, PerpNote>, fx: number): AnyTrade[] {
  const manual = journal.map((t): AnyTrade => {
    const done = P.done.find(d => d.t.id === t.id);
    const pos = P.pos.find(p => p.t.id === t.id);
    return {
      key: 'm:' + t.id,
      source: 'manual',
      name: t.tk,
      side: t.dir === 'Short' ? 'Short' : 'Long',
      opened: parseISO(t.d),
      closed: t.ex ? parseISO(t.ex.d) : null,
      pnl: done ? done.net : (pos?.pl ?? 0),
      ret: done ? done.ret : pos ? pos.plp : null,
      r: done ? done.r : null,
      fees: P.toIdr(buyFee(t) + sellFee(t), t.mk),
      funding: 0,
      liquidated: false,
      followed: t.ex?.fp,
      rating: t.ex?.rt,
      setup: t.ex?.su,
      mistakes: splitTags(t.ex?.mi),
      manual: t,
    };
  });
  const hl = perps.map((t): AnyTrade => {
    const n = notes[t.id];
    return {
      key: 'p:' + t.id,
      source: 'perp',
      name: t.coin,
      side: t.side,
      opened: t.opened,
      closed: t.closed,
      pnl: t.closed ? t.pnl * fx : 0,
      ret: t.closed && t.maxNotional > 0 ? (t.pnl / t.maxNotional) * 100 : null,
      r: null,
      fees: t.fees * fx,
      funding: t.funding * fx,
      liquidated: t.liquidated,
      followed: followedOf(n),
      rating: n?.rating || undefined,
      setup: n?.setup || undefined,
      mistakes: splitTags(n?.mistakes),
      perp: t,
    };
  });
  return [...manual, ...hl].sort((a, b) => b.opened.getTime() - a.opened.getTime());
}

export type Group = { key: string; trades: number; wins: number; pnl: number };

/** Closed trades' numbers, the same for every source and period. */
export function reviewStats(closed: AnyTrade[]) {
  const wins = closed.filter(t => t.pnl > 0);
  const losses = closed.filter(t => t.pnl <= 0);
  const won = sum(wins.map(t => t.pnl));
  const lost = -sum(losses.map(t => t.pnl));
  const rs = closed.filter(t => t.r != null).map(t => t.r!);
  const answered = closed.filter(t => t.followed);
  const group = (keys: (t: AnyTrade) => string[]): Group[] => {
    const m = new Map<string, Group>();
    for (const t of closed)
      for (const k of keys(t)) {
        const g = m.get(k) ?? { key: k, trades: 0, wins: 0, pnl: 0 };
        g.trades++;
        if (t.pnl > 0) g.wins++;
        g.pnl += t.pnl;
        m.set(k, g);
      }
    return [...m.values()].sort((a, b) => a.pnl - b.pnl);
  };
  const avgOf = (list: AnyTrade[]) => (list.length ? sum(list.map(t => t.pnl)) / list.length : null);
  return {
    count: closed.length,
    wins: wins.length,
    winRate: closed.length ? (wins.length / closed.length) * 100 : null,
    pnl: won - lost,
    avgWin: wins.length ? won / wins.length : 0,
    avgLoss: losses.length ? lost / losses.length : 0,
    /** Won for every 1 lost; above 1 makes money. */
    perLost: lost > 0 ? won / lost : null,
    avgR: rs.length ? sum(rs) / rs.length : null,
    rCount: rs.length,
    followedPct: answered.length ? (answered.filter(t => t.followed === 'Yes').length / answered.length) * 100 : null,
    answered: answered.length,
    /** Average result when you followed the plan, and when you didn't (or only partly). */
    avgFollowed: avgOf(answered.filter(t => t.followed === 'Yes')),
    avgNotFollowed: avgOf(answered.filter(t => t.followed !== 'Yes')),
    fees: sum(closed.map(t => t.fees)),
    funding: sum(closed.map(t => t.funding)),
    liquidated: closed.filter(t => t.liquidated).length,
    byName: group(t => [t.name]),
    bySide: group(t => [t.side]),
    byMistake: group(t => t.mistakes),
    bySetup: group(t => (t.setup ? [t.setup] : [])),
  };
}
