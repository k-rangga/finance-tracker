/**
 * Pure multi-cycle financial projection engine (3 / 6 / 12 pay cycles ahead).
 * Projects real scheduled commitments (individual fixed bills including quarterly/yearly spikes, installment
 * schedules and drop-offs, subscriptions, future one-off costs & extra inflows), optional What-If purchases,
 * and compounded savings/investing trajectories.
 */
import { paydaysFrom, type Cycle } from './cycle';
import { addDays, parseISO, sum, toISO } from './format';
import { fixedBillsForNextCycle, type FixedBill } from './fixedBills';
import type { PlanView } from './installments';
import { addEvery, type Subscription } from './subscriptions';
import type { CyclePlan } from './cyclePlans';

const DAY = 86_400_000;

export type WhatIfPurchase = {
  name: string;
  /** Total purchase price in display currency. */
  amount: number;
  /** 1 = paid in cash in one cycle; >1 = split evenly across `months` consecutive cycles. */
  months: number;
  /** Which future cycle index it starts in (0 = next cycle). */
  startIdx?: number;
};

export type ProjectionInput = {
  /** First cycle to project (typically `nextCycle`). */
  startCycle: Cycle;
  /** How many cycles ahead to project (e.g. 3, 6, 12). */
  horizon: number;
  /** Regular monthly base income (display currency). */
  regularIncome: number;
  /** Regular monthly fixed-category budget for categories NOT covered by active individual fixedBills. */
  legacyFixedTotal: number;
  /** Regular monthly everyday budget total (display currency). */
  regularEverydayTotal: number;
  /** Regular monthly savings target (display currency). */
  regularSavings: number;
  /** Regular monthly investing portion of savings (display currency). */
  regularInvest: number;
  /** Exact overrides for cycle index 0 (the live Next Cycle model currently being edited). */
  firstCycleOverride?: {
    inflow: number;
    fixedTotal: number;
    everydayTotal: number;
    savings: number;
    invest: number;
  };
  /** Saved per-cycle plans keyed by cycle start ISO (`YYYY-MM-DD`). */
  cyclePlans?: Record<string, CyclePlan>;
  /** Individual fixed bills (monthly, quarterly, yearly). */
  fixedBills?: FixedBill[];
  /** Active installment schedules. */
  installmentPlans?: PlanView[];
  /** Active subscriptions (to detect yearly/quarterly subscription spikes). */
  subscriptions?: Record<string, Subscription>;
  /** Buffer goal as % of inflow (default 10). */
  bufferPct?: number;
  /** Expected annual return rate on the Investing bucket (e.g. 0, 0.05, 0.08). */
  annualReturn?: number;
  /** Optional scale multiplier on everyday spending (e.g. 0.85 for Lean scenario comparison). */
  everydayScale?: number;
  /** Optional simulated big purchase (cash or installment). */
  whatIf?: WhatIfPurchase | null;
};

export type ProjectedCycle = {
  index: number;
  key: string;
  start: Date;
  end: Date;
  days: number;
  inflow: number;
  extras: number;
  fixedBills: number;
  /** Yearly/quarterly individual fixed bills that spike this cycle (names). */
  spikeBills: string[];
  installments: number;
  /** Installment plans that finished just before this cycle, freeing monthly cashflow. */
  endedInstallments: { title: string; freed: number }[];
  oneOffs: number;
  whatIfPayment: number;
  committed: number;
  everyday: number;
  plannedSavings: number;
  /** Actual total wealth added this cycle (inflow minus all spending/commitments, floored at 0). */
  netSaved: number;
  /** Unassigned cashflow left after planned savings & all outflows (negative = shortfall). */
  bufferAfterPlan: number;
  bufferGoal: number;
  invested: number;
  cashSaved: number;
  cumCash: number;
  cumInvest: number;
  cumTotal: number;
  savingsRate: number;
  hasCustomPlan: boolean;
};

export type ProjectionResult = {
  cycles: ProjectedCycle[];
  totalAdded: number;
  totalCash: number;
  totalInvest: number;
  avgSavingsRate: number;
  lowestBuffer: { cycle: ProjectedCycle; amount: number } | null;
  shortfallCycles: number;
  /** First cycle where cumulative installments drop to 0 (if any active at start). */
  debtFreeCycle: ProjectedCycle | null;
  /** Total monthly cashflow freed by installments finishing within the horizon. */
  freedByInstallments: number;
  /** Total extra wealth generated purely from investment compounding over the horizon. */
  compoundingGain: number;
};

/** Exact installment payments due inside [start, end], plus per-plan amounts so drop-offs are detected cleanly. */
function installmentsInWindow(plans: PlanView[], start: Date, end: Date): { total: number; byPlan: Map<string, { title: string; amount: number }> } {
  const byPlan = new Map<string, { title: string; amount: number }>();
  let total = 0;
  for (const p of plans) {
    let amt = 0;
    for (const pay of p.payments) {
      if (pay.date >= start && pay.date <= end) amt += pay.amount;
    }
    if (amt > 0) {
      byPlan.set(p.key, { title: p.title, amount: amt });
      total += amt;
    }
  }
  return { total, byPlan };
}

/** Yearly/irregular subscription renewals landing in [start, end] (monthly ones are already in legacyFixedTotal). */
function yearlySubSpikesInWindow(subs: Record<string, Subscription>, start: Date, end: Date): { total: number; names: string[] } {
  let total = 0;
  const names: string[] = [];
  for (const x of Object.values(subs)) {
    if (x.status === 'cancelled' || x.every !== 'year' || !(x.amount > 0)) continue;
    let d = parseISO(x.next);
    let guard = 0;
    while (d < start && guard < 10) {
      d = addEvery(d, 'year');
      guard++;
    }
    if (d >= start && d <= end) {
      total += x.amount;
      names.push(x.name);
    }
  }
  return { total, names };
}

/** Project `horizon` pay cycles ahead from `startCycle`. */
export function projectCycles(input: ProjectionInput): ProjectionResult {
  const {
    startCycle,
    horizon,
    regularIncome,
    legacyFixedTotal,
    regularEverydayTotal,
    regularSavings,
    regularInvest,
    firstCycleOverride,
    cyclePlans = {},
    fixedBills = [],
    installmentPlans = [],
    subscriptions = {},
    bufferPct = 10,
    annualReturn = 0,
    everydayScale = 1,
    whatIf = null,
  } = input;

  const count = Math.max(1, Math.min(24, Math.round(horizon)));
  const paydays = paydaysFrom(startCycle.start, count + 1);
  const monthlyRate = annualReturn > 0 ? annualReturn / 12 : 0;

  const cycles: ProjectedCycle[] = [];
  let cumCash = 0;
  let cumInvest = 0;
  let rawInvestContributions = 0;
  let prevInstByPlan = new Map<string, { title: string; amount: number }>();
  let freedByInstallments = 0;

  for (let i = 0; i < count; i++) {
    const start = paydays[i];
    const end = new Date(paydays[i + 1].getTime() - DAY);
    const days = Math.round((paydays[i + 1].getTime() - start.getTime()) / DAY);
    const key = toISO(start);
    const winCycle: Cycle = {
      start,
      end,
      next: paydays[i + 1],
      today: addDays(start, -1),
      cycleDays: days,
      dayIdx: 0,
      dayN: 1,
      daysLeft: days - 1,
      weekIdx: 0,
      offsetOf: d => Math.round((d.getTime() - start.getTime()) / DAY),
      dateOf: off => addDays(start, off),
    };

    const plan = cyclePlans[key];
    const extras = sum((plan?.extras ?? []).map(x => Math.max(0, x.amount || 0)));
    const oneOffs = sum((plan?.costs ?? []).map(x => Math.max(0, x.amount || 0)));

    // Individual fixed bills scheduled for this specific cycle (monthly + matching quarterly/yearly).
    const schedBills = fixedBillsForNextCycle(fixedBills, winCycle);
    const activeNonMonthly = new Set(fixedBills.filter(b => !b.paused && b.every && b.every !== 'month').map(b => b.name));
    const spikeBills = schedBills.filter(b => activeNonMonthly.has(b.title)).map(b => b.title);
    const subSpikes = yearlySubSpikesInWindow(subscriptions, start, end);
    for (const n of subSpikes.names) spikeBills.push(n);

    const inst = installmentsInWindow(installmentPlans, start, end);
    const endedInstallments: { title: string; freed: number }[] = [];
    if (i > 0) {
      for (const [pk, prev] of prevInstByPlan) {
        if (!inst.byPlan.has(pk)) {
          endedInstallments.push({ title: prev.title, freed: prev.amount });
          freedByInstallments += prev.amount;
        }
      }
    }
    prevInstByPlan = inst.byPlan;

    // Inflow, fixed, everyday, savings/invest for this cycle.
    const useFirst = i === 0 && !!firstCycleOverride;
    const baseInc = plan?.income != null && plan.income > 0 ? plan.income : regularIncome;
    const inflow = useFirst ? firstCycleOverride!.inflow : baseInc + extras;
    const fixedTotal = useFirst
      ? firstCycleOverride!.fixedTotal
      : sum(schedBills.map(b => b.amount)) + legacyFixedTotal + subSpikes.total;

    // Everyday total for future cycles: apply any saved per-cycle everyday limits delta or scale cleanly.
    const rawEveryday = useFirst ? firstCycleOverride!.everydayTotal : regularEverydayTotal;
    const everyday = Math.max(0, Math.round(rawEveryday * everydayScale));

    // What-If purchase payment landing in this cycle.
    let whatIfPayment = 0;
    if (whatIf && whatIf.amount > 0 && whatIf.months >= 1) {
      const sIdx = whatIf.startIdx ?? 0;
      const m = Math.max(1, Math.round(whatIf.months));
      if (i >= sIdx && i < sIdx + m) whatIfPayment = whatIf.amount / m;
    }

    const committed = fixedTotal + inst.total + oneOffs + whatIfPayment;
    const plannedSavings = useFirst ? firstCycleOverride!.savings : (plan?.savings ?? regularSavings);
    const plannedInvest = useFirst ? firstCycleOverride!.invest : Math.min(plannedSavings, plan?.invest ?? regularInvest);

    const netSaved = Math.max(0, inflow - committed - everyday);
    const bufferAfterPlan = inflow - committed - everyday - plannedSavings;
    const bufferGoal = (bufferPct / 100) * inflow;

    const invested = Math.min(netSaved, Math.max(0, plannedInvest));
    const cashSaved = Math.max(0, netSaved - invested);
    rawInvestContributions += invested;

    cumCash += cashSaved;
    cumInvest = cumInvest * (1 + monthlyRate) + invested;
    const cumTotal = cumCash + cumInvest;
    const savingsRate = inflow > 0 ? (netSaved / inflow) * 100 : 0;

    const hasCustomPlan =
      !!plan &&
      ((plan.costs?.length ?? 0) > 0 ||
        (plan.extras?.length ?? 0) > 0 ||
        plan.income != null ||
        plan.savings != null ||
        plan.invest != null ||
        Object.keys(plan.limits ?? {}).length > 0);

    cycles.push({
      index: i,
      key,
      start,
      end,
      days,
      inflow,
      extras,
      fixedBills: fixedTotal,
      spikeBills,
      installments: inst.total,
      endedInstallments,
      oneOffs,
      whatIfPayment,
      committed,
      everyday,
      plannedSavings,
      netSaved,
      bufferAfterPlan,
      bufferGoal,
      invested,
      cashSaved,
      cumCash,
      cumInvest,
      cumTotal,
      savingsRate,
      hasCustomPlan,
    });
  }

  const last = cycles[cycles.length - 1];
  const lowest = cycles.reduce<ProjectedCycle | null>((min, c) => (!min || c.bufferAfterPlan < min.bufferAfterPlan ? c : min), null);
  const hadInst = cycles[0]?.installments > 0;
  const debtFreeCycle = hadInst ? cycles.find((c, idx) => idx > 0 && c.installments === 0) ?? null : null;

  return {
    cycles,
    totalAdded: last?.cumTotal ?? 0,
    totalCash: last?.cumCash ?? 0,
    totalInvest: last?.cumInvest ?? 0,
    avgSavingsRate: cycles.length ? sum(cycles.map(c => c.savingsRate)) / cycles.length : 0,
    lowestBuffer: lowest ? { cycle: lowest, amount: lowest.bufferAfterPlan } : null,
    shortfallCycles: cycles.filter(c => c.bufferAfterPlan < -1).length,
    debtFreeCycle,
    freedByInstallments,
    compoundingGain: Math.max(0, (last?.cumInvest ?? 0) - rawInvestContributions),
  };
}
