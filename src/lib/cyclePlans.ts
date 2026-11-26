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
export type PlannedInflow = { id: string; name: string; amount: number };
/**
 * Per-cycle plan overrides:
 * - `limits`: % of regular base income per category, for this cycle only.
 * - `costs`: one-off expenses planned for this cycle.
 * - `income`: optional base income override for this cycle only.
 * - `extras`: extra inflows for this cycle (bonus, THR, dividend, freelance).
 * - `savings`: optional exact savings target amount for this cycle.
 * - `invest`: optional exact investing amount (portion of savings) for this cycle.
 */
export type CyclePlan = {
  limits?: Record<string, number>;
  costs?: PlannedCost[];
  income?: number;
  extras?: PlannedInflow[];
  savings?: number;
  invest?: number;
};

const DAY = 864e5;

/** The cycle after `cycle`, as seen the day before it starts. */
export function nextCycleOf(cycle: Cycle): Cycle {
  const next = getCycle(new Date(cycle.end.getTime() + DAY));
  return { ...next, today: new Date(next.start.getTime() - DAY) };
}

export const cycleKey = (c: { start: Date }) => toISO(c.start);
/** The key of the cycle running today. */
export const currentCycleKey = () => cycleKey(getCycle(new Date()));

/** Effective total inflow for a cycle: base income (or cycle override) plus any planned extra inflows. */
export function cycleIncomeOf(baseIncome: number, plan?: CyclePlan): number {
  const base = plan?.income != null && plan.income > 0 ? plan.income : baseIncome;
  const extras = (plan?.extras ?? []).reduce((a, x) => a + Math.max(0, x.amount || 0), 0);
  return base + extras;
}

/** Whether a cycle plan has any custom assignments or items in it. */
export const hasPlan = (p?: CyclePlan) =>
  !!p &&
  (Object.keys(p.limits ?? {}).length > 0 ||
    (p.costs ?? []).length > 0 ||
    (p.extras ?? []).length > 0 ||
    p.income != null ||
    p.savings != null ||
    p.invest != null);

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
    .map(c => ({ date: new Date(c.date + 'T00:00:00'), title: c.name, category: c.category, amount: c.amount, source: 'Planned', costId: c.id }))
    .filter(b => b.date >= cycle.start && b.date <= cycle.end)
    .map(b => (b.date < cycle.today ? { ...b, date: cycle.today } : b));
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

/** Round an amount cleanly to the nearest currency step (never negative). */
export const roundStep = (amount: number, step: number) => Math.max(0, Math.round(amount / step) * step);

export type ModelPreset = 'usual' | 'actuals' | 'lean' | 'save';

/**
 * When a next-cycle model is over-allocated (`unassigned < 0`), trim everyday categories proportionally first
 * (in clean currency steps), then savings only if still short, so the cycle finishes at >= 0 unassigned.
 */
export function autoBalancePlan(args: {
  totalInflow: number;
  committed: number;
  savings: number;
  everyday: Record<string, number>;
  step: number;
}): { everyday: Record<string, number>; savings: number; trimmedEveryday: number; trimmedSavings: number } {
  const { totalInflow, committed, step } = args;
  const everyday = { ...args.everyday };
  let savings = Math.max(0, args.savings);
  const sumEv = () => Object.values(everyday).reduce((a, v) => a + v, 0);
  const deficit = committed + savings + sumEv() - totalInflow;
  if (deficit <= 0) return { everyday, savings, trimmedEveryday: 0, trimmedSavings: 0 };

  const evTotal = sumEv();
  let trimmedEveryday = 0;
  if (evTotal > 0) {
    const cut = Math.min(deficit, evTotal);
    const ratio = (evTotal - cut) / evTotal;
    for (const [k, v] of Object.entries(everyday)) {
      const next = roundStep(v * ratio, step);
      trimmedEveryday += v - next;
      everyday[k] = next;
    }
    // If rounding left a small residual deficit, shave one step at a time from the largest categories.
    let rem = committed + savings + sumEv() - totalInflow;
    while (rem > 0) {
      const top = Object.entries(everyday)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])[0];
      if (!top) break;
      const take = Math.min(top[1], Math.max(step, Math.ceil(rem / step) * step === rem ? step : step));
      const actualTake = Math.min(top[1], rem < step ? rem : step);
      everyday[top[0]] = Math.max(0, top[1] - actualTake);
      trimmedEveryday += actualTake;
      rem = committed + savings + sumEv() - totalInflow;
      if (take <= 0) break;
    }
  }

  let trimmedSavings = 0;
  const remAfterEv = committed + savings + sumEv() - totalInflow;
  if (remAfterEv > 0 && savings > 0) {
    const cut = Math.min(savings, remAfterEv);
    savings = Math.max(0, savings - cut);
    trimmedSavings = cut;
  }
  return { everyday, savings, trimmedEveryday, trimmedSavings };
}

/**
 * Compute target everyday amounts and savings for a 1-tap Next Cycle scenario preset:
 * - `usual`: regular plan amounts and regular savings target.
 * - `actuals`: match each everyday category to this cycle's projected spend (falling back to usual when 0).
 * - `lean`: trim everyday categories by 15% and route the freed money into savings.
 * - `save`: boost savings by +10% of inflow (clamped to affordable room), trimming everyday if needed.
 */
export function buildPresetAmounts(
  preset: ModelPreset,
  args: {
    totalInflow: number;
    committed: number;
    regularSavings: number;
    regularEveryday: Record<string, number>;
    projectedEveryday: Record<string, number>;
    step: number;
  },
): { everyday: Record<string, number>; savings: number } {
  const { totalInflow, committed, regularSavings, regularEveryday, projectedEveryday, step } = args;
  if (preset === 'usual') {
    return { everyday: { ...regularEveryday }, savings: regularSavings };
  }
  if (preset === 'actuals') {
    const everyday: Record<string, number> = {};
    for (const [k, usual] of Object.entries(regularEveryday)) {
      const proj = projectedEveryday[k] ?? 0;
      everyday[k] = proj > 0 ? roundStep(proj, step) : usual;
    }
    return { everyday, savings: regularSavings };
  }
  if (preset === 'lean') {
    const everyday: Record<string, number> = {};
    let freed = 0;
    for (const [k, usual] of Object.entries(regularEveryday)) {
      const next = roundStep(usual * 0.85, step);
      freed += Math.max(0, usual - next);
      everyday[k] = next;
    }
    const maxSavings = Math.max(0, totalInflow - committed - Object.values(everyday).reduce((a, v) => a + v, 0));
    return { everyday, savings: Math.min(maxSavings, regularSavings + freed) };
  }
  // 'save': +10% of inflow into savings, auto-balancing everyday if needed.
  const targetSavings = Math.min(Math.max(0, totalInflow - committed), roundStep(regularSavings + totalInflow * 0.1, step));
  const balanced = autoBalancePlan({
    totalInflow,
    committed,
    savings: targetSavings,
    everyday: { ...regularEveryday },
    step,
  });
  return { everyday: balanced.everyday, savings: balanced.savings };
}
