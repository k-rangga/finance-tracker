/**
 * Plans for a particular pay cycle, on top of your regular plan: amounts that differ for that cycle only, and
 * one-off costs (a wedding gift, a car service) set aside in it. Saved in settings by the cycle's start date, and
 * used automatically once that cycle begins.
 */
import { getCycle, type Cycle } from './cycle';
import { toISO } from './format';
import type { Bill } from '../data/transactions';

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
