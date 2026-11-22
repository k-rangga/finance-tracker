/**
 * Plans for a particular pay cycle, on top of your regular plan: amounts that differ for that cycle only, and
 * one-off costs (a wedding gift, a car service) set aside in it. Saved in settings by the cycle's start date, and
 * used automatically once that cycle begins.
 */
import { getCycle, type Cycle } from './cycle';
import { tidyName, toISO } from './format';
import type { Budget } from './budget';
import { merchantKey } from '../data/transactions';
import type { Bill } from '../data/transactions';
import { run } from './gas';

export type PlannedCost = { id: string; name: string; amount: number; date: string; category: string };
/** `limits`: % of income per category, for this cycle only. */
export type CyclePlan = { limits?: Record<string, number>; costs?: PlannedCost[] };

const DAY = 864e5;

/** The cycle after `cycle`, as seen the day before it starts. */
export function nextCycleOf(cycle: Cycle): Cycle {
  const next = getCycle(new Date(cycle.end.getTime() + DAY));
  return { ...next, today: new Date(next.start.getTime() - DAY) };
}

export const cycleKey = (c: { start: Date }) => toISO(c.start);
/** The key of the cycle running today. */
export const currentCycleKey = () => cycleKey(getCycle(new Date()));

/** Whether a cycle plan has anything in it. */
export const hasPlan = (p?: CyclePlan) => !!p && (Object.keys(p.limits ?? {}).length > 0 || (p.costs ?? []).length > 0);

/**
 * A one-off cost counts as paid once spending in its category comes in for about its amount (within 10%), from
 * three days before its date. Each transaction pays one cost. `txs`: this cycle's spending, with its category.
 */
export function matchCosts(costs: PlannedCost[], txs: { id: string; date: Date; amount: number; cat: string }[]) {
  const used = new Set<string>();
  const paid = new Map<string, { id: string; date: Date; amount: number }>();
  for (const c of [...costs].sort((a, b) => a.date.localeCompare(b.date))) {
    const from = new Date(c.date + 'T00:00:00').getTime() - 3 * DAY;
    const t = txs.find(
      x => !used.has(x.id) && x.cat === c.category && x.date.getTime() >= from && Math.abs(x.amount - c.amount) <= c.amount * 0.1,
    );
    if (t) {
      used.add(t.id);
      paid.set(c.id, t);
    }
  }
  return paid;
}

/** Unpaid one-off costs in this cycle, as bills: they're set aside like any bill coming up. */
export function plannedCostBills(costs: PlannedCost[], cycle: Cycle, paid: Map<string, unknown>): Bill[] {
  return costs
    .filter(c => !paid.has(c.id))
    .map(c => ({ date: new Date(c.date + 'T00:00:00'), title: c.name, category: c.category, amount: c.amount, source: 'Planned' }))
    .filter(b => b.date >= cycle.start && b.date <= cycle.end)
    .map(b => (b.date <= cycle.today ? { ...b, date: new Date(cycle.today.getTime() + DAY) } : b));
}

/** Maxie's check of a plan: one line, and up to three amounts to change. */
export type PlanCheck = {
  verdict?: string;
  changes?: { category: string; amount: number; why: string }[];
  /** Short findings on the rest of the plan: bills, installments, one-offs, savings, buffer. */
  notes?: string[];
  /** Whether Maxie looked up local prices (Google Search) for this answer. */
  searched?: boolean;
  error?: string;
  detail?: string;
};
export const checkPlan = (payload: unknown) => run<PlanCheck>('checkPlan', payload);

/**
 * How a category is really being spent this cycle, for Maxie's planning: so far and projected to the end, per day,
 * how many purchases and their average size, the merchants and sub-categories it goes to. Spending only (no
 * income, transfers or refunds).
 */
export function spendingProfile(cycle: Cycle, b: Budget, category: string) {
  const r = Math.round;
  const txs = b.txs.filter(t => t.cat === category && !t.isIncome && !t.isTransfer && t.net > 0);
  const soFar = txs.reduce((a, t) => a + t.net, 0);
  const byMerchant = new Map<string, { name: string; count: number; total: number }>();
  for (const t of txs) {
    const k = merchantKey(t.title) || t.title;
    const m = byMerchant.get(k) ?? { name: tidyName(t.title), count: 0, total: 0 };
    m.count++;
    m.total += t.net;
    byMerchant.set(k, m);
  }
  const bySub = new Map<string, number>();
  for (const t of txs) if (t.sub) bySub.set(t.sub, (bySub.get(t.sub) ?? 0) + t.net);
  return {
    soFar: r(soFar),
    projectedThisCycle: r((soFar / Math.max(1, cycle.dayN)) * cycle.cycleDays),
    perDay: r(soFar / Math.max(1, cycle.dayN)),
    purchases: txs.length,
    averagePurchase: txs.length ? r(soFar / txs.length) : 0,
    biggestPurchase: txs.length ? r(Math.max(...txs.map(t => t.net))) : 0,
    topMerchants: [...byMerchant.values()]
      .sort((x, y) => y.total - x.total)
      .slice(0, 5)
      .map(m => ({ name: m.name, purchases: m.count, total: r(m.total), average: r(m.total / m.count) })),
    ...(bySub.size ? { subCategories: Object.fromEntries([...bySub].map(([k, v]) => [k, r(v)])) } : {}),
  };
}
