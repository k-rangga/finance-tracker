/**
 * Where this cycle's spending is heading by payday — a pure, testable forecast.
 *
 * - A. Confidence blend: early in the cycle lean on a baseline (last cycle's regular spend, or the plan); trust the
 *      live pace more as days pass (weight = share of the cycle elapsed).
 * - B. One-offs counted once: unusually large everyday purchases are added as-is and never extrapolated.
 * - C. Spending rhythm: the last 2–3 cycles' day-by-day curve tells how much is usually gone by today (e.g. front-loaded
 *      after payday), instead of assuming a straight line.
 * - D. Bills land on their due dates, so the projected path steps up on those days.
 */

export type PaceTx = {
  /** Day offset from the cycle start (0-based). */
  offset: number;
  /** Net amount counted as your spending. */
  amount: number;
  /** Already-committed payments (e.g. installments): counted, but never part of the habit pace. */
  committed?: boolean;
};

export type PaceBill = { offset: number; amount: number };

export type PaceInput = {
  cycleDays: number;
  /** 0-based offset of today. */
  dayIdx: number;
  /** Day-of-week (0=Sun..6=Sat) of this cycle's start date, for weekend-aware guidance. */
  startDow?: number;
  /** This cycle's variable-category spending so far. */
  cur: PaceTx[];
  /**
   * Past cycles' variable-category spending, most recent first (up to 3 are used). Offsets are relative to
   * each cycle's own start; cycles too thin or partial to trust are skipped.
   */
  history?: { txs: PaceTx[]; days: number; startDow?: number }[];
  /** Planned variable budget for this cycle. */
  varBudget: number;
  /** Variable-category bills still due this cycle (already part of `varBudget`). */
  varBillsDue?: number;
  /** All bills still due this cycle. */
  bills: PaceBill[];
};

export type PaceResult = {
  /** Single purchases at or above this are treated as one-offs (Infinity = none). */
  oneOffThreshold: number;
  /** Spent so far on one-offs and committed payments (counted once, never extrapolated). */
  oneOffs: number;
  oneOffCount: number;
  /** Spent so far on regular everyday spending. */
  regularSpent: number;
  /** Projected regular everyday spending for the rest of the cycle. */
  remainingVar: number;
  fixedDue: number;
  /** Projected spend added after today, cumulative per day (length cycleDays; 0 up to today). */
  add: number[];
  /** Calm confidence band around `add` (length cycleDays; bills have zero uncertainty). */
  bandLow: number[];
  bandHigh: number[];
  /** Half-width of the confidence band at payday (0 on last day). */
  bandHalf: number;
  /** Bills landing on each day (length cycleDays). */
  billOn: number[];
  /** Learned weekend-to-weekday daily spending ratio (>=1.2 when history shows heavier weekends, else 1). */
  weekendRatio: number;
  /** What the baseline came from. */
  basis: 'history' | 'plan' | 'pace';
  /** How many past cycles fed the rhythm and baseline (0–3). */
  historyCycles: number;
  /** Weight given to the live pace (0–1). */
  confidence: number;
};

const MIN_TX_FOR_MEDIAN = 5;
const MIN_PREV_TX_FOR_SHAPE = 8;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const sumOf = (xs: number[]) => xs.reduce((a, v) => a + v, 0);

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Where a bill due on `offset` lands in the projection: overdue ones tomorrow, late ones on the last day. */
export function billLandingDay(offset: number, dayIdx: number, cycleDays: number): number {
  return clamp(Math.max(offset, dayIdx + 1), 0, cycleDays - 1);
}

/** Largest single purchase still counted as regular spending. */
export function oneOffThreshold(amounts: number[], varBudget: number): number {
  const fromMedian = amounts.length >= MIN_TX_FOR_MEDIAN ? 5 * median(amounts) : 0;
  const fromBudget = varBudget > 0 ? 0.1 * varBudget : 0;
  const t = Math.max(fromMedian, fromBudget);
  return t > 0 ? t : Infinity;
}

/**
 * Cumulative share of a past cycle's regular spend by fraction of the cycle elapsed (lightly smoothed), or null
 * when that cycle is too thin or partial (e.g. data only imported mid-cycle) to trust its rhythm.
 */
function rhythm(txs: PaceTx[], cycleDays: number): ((frac: number) => number) | null {
  const regular = txs.filter(t => t.offset >= 0 && t.offset < cycleDays);
  const total = sumOf(regular.map(t => t.amount));
  if (regular.length < MIN_PREV_TX_FOR_SHAPE || total <= 0 || cycleDays < 7) return null;
  const third = cycleDays / 3;
  const thirds = [0, 1, 2].map(k => regular.some(t => t.offset >= k * third && t.offset < (k + 1) * third));
  if (thirds.filter(Boolean).length < 3) return null;

  const daily = new Array<number>(cycleDays).fill(0);
  for (const t of regular) daily[t.offset] += t.amount;
  // Centred 5-day moving average keeps the shape (front-loading, mid-cycle dips) without single-day spikes.
  const smooth = daily.map((_, i) => {
    let s = 0;
    let n = 0;
    for (let k = i - 2; k <= i + 2; k++) if (k >= 0 && k < cycleDays) (s += daily[k]), n++;
    return s / n;
  });
  const smoothTotal = sumOf(smooth);
  const cum: number[] = [0];
  for (let i = 0; i < cycleDays; i++) cum.push(cum[i] + smooth[i] / smoothTotal);
  return (frac: number) => {
    const d = clamp(frac, 0, 1) * cycleDays;
    const lo = Math.floor(d);
    const hi = Math.min(cycleDays, lo + 1);
    return cum[lo] + (cum[hi] - cum[lo]) * (d - lo);
  };
}

/** Recency weights for up to 3 past cycles (most recent first). */
const RECENCY = [0.5, 0.3, 0.2];

export function projectCycleSpend(input: PaceInput): PaceResult {
  const { cycleDays, dayIdx, cur, history = [], varBudget, varBillsDue = 0, bills } = input;
  const days = Math.max(1, cycleDays);
  const today = clamp(dayIdx, 0, days - 1);
  const dayN = today + 1;
  const f = dayN / days;
  const past = history.slice(0, RECENCY.length);

  // B. One-offs: purchases far above your typical size (or >10% of the everyday plan).
  const habit = (xs: PaceTx[]) => xs.filter(t => !t.committed && t.amount > 0);
  const thr = oneOffThreshold([...habit(cur), ...past.flatMap(h => habit(h.txs))].map(t => t.amount), varBudget);
  const isRegular = (t: PaceTx) => !t.committed && t.amount > 0 && t.amount < thr;

  const curRegular = cur.filter(isRegular);
  const regularSpent = sumOf(curRegular.map(t => t.amount));
  const curOther = cur.filter(t => !isRegular(t) && t.amount > 0);
  const oneOffs = sumOf(curOther.map(t => t.amount));

  // C. Rhythm averaged over the past cycles that are complete enough to trust (none → straight line).
  const usable = past
    .map((h, k) => {
      const regular = h.txs.filter(isRegular);
      const shape = rhythm(regular, Math.max(1, h.days));
      // Each cycle's regular total, scaled to this cycle's length.
      const total = (sumOf(regular.map(t => t.amount)) * days) / Math.max(1, h.days);
      return shape && total > 0 ? { shape, total, w: RECENCY[k], regular, days: Math.max(1, h.days), startDow: h.startDow } : null;
    })
    .filter((u): u is NonNullable<typeof u> => u != null);
  const wSum = sumOf(usable.map(u => u.w));
  const shareAt = (elapsedHere: number) =>
    usable.length ? sumOf(usable.map(u => u.w * u.shape(elapsedHere / days))) / wSum : elapsedHere / days;
  // Blend the learned rhythm with a straight line so one odd cycle can't dominate.
  const shareNow = clamp(0.7 * shareAt(dayN) + 0.3 * f, 0.05, 0.98);

  // Learn weekend vs. weekday spending ratio from usable history when day-of-week is available.
  let wkndSum = 0;
  let wkndDays = 0;
  let wkdySum = 0;
  let wkdyDays = 0;
  for (const u of usable) {
    if (u.startDow == null) continue;
    for (let d = 0; d < u.days; d++) {
      const dow = (u.startDow + d) % 7;
      if (dow === 0 || dow === 6) wkndDays++;
      else wkdyDays++;
    }
    for (const t of u.regular) {
      const dow = (u.startDow + t.offset) % 7;
      if (dow === 0 || dow === 6) wkndSum += t.amount;
      else wkdySum += t.amount;
    }
  }
  const wkdyAvg = wkdyDays > 0 ? wkdySum / wkdyDays : 0;
  const wkndAvg = wkndDays > 0 ? wkndSum / wkndDays : 0;
  const rawRatio = wkdyAvg > 0 && wkndDays >= 4 ? wkndAvg / wkdyAvg : 1;
  const weekendRatio = rawRatio >= 1.2 ? clamp(rawRatio, 1.2, 2.2) : 1;

  const futureDays = days - dayN;
  let remainingVar = 0;
  let basis: PaceResult['basis'] = usable.length ? 'history' : varBudget > 0 ? 'plan' : 'pace';
  if (futureDays > 0) {
    const paceRemaining = (regularSpent * (1 - shareNow)) / shareNow;

    // A. Baseline: recency-weighted regular total of past cycles, else the plan.
    let baselineTotal: number | null = null;
    if (usable.length) baselineTotal = sumOf(usable.map(u => u.w * u.total)) / wSum;
    else if (varBudget > 0) baselineTotal = Math.max(0, varBudget - varBillsDue);
    if (baselineTotal == null) {
      remainingVar = paceRemaining;
      basis = 'pace';
    } else {
      const baselineRemaining = baselineTotal * (1 - shareNow);
      remainingVar = f * paceRemaining + (1 - f) * baselineRemaining;
    }
  }

  // Calm confidence band: derived from past-cycle variance (when >=2 cycles) or a gentle default, narrowing to 0 by payday.
  let baseSpread = 0.14;
  if (usable.length >= 2) {
    const mu = sumOf(usable.map(u => u.w * u.total)) / wSum;
    const variance = sumOf(usable.map(u => u.w * (u.total - mu) ** 2)) / wSum;
    baseSpread = mu > 0 ? clamp(Math.sqrt(variance) / mu, 0.06, 0.25) : 0.14;
  }
  const spread = futureDays > 0 ? baseSpread * (1 - f) : 0;

  // D. Day-by-day path: regular spend spread by rhythm, bills stepped onto their due dates.
  const billOn = new Array<number>(days).fill(0);
  for (const b of bills) if (b.amount > 0) billOn[billLandingDay(b.offset, today, days)] += b.amount;
  const fixedDue = sumOf(billOn);

  const add = new Array<number>(days).fill(0);
  const bandLow = new Array<number>(days).fill(0);
  const bandHigh = new Array<number>(days).fill(0);
  if (futureDays > 0) {
    const weights: number[] = [];
    for (let i = dayN; i < days; i++) weights.push(0.7 * Math.max(0, shareAt(i + 1) - shareAt(i)) + 0.3 / days);
    const wTotal = sumOf(weights) || 1;
    let varAcc = 0;
    let billAcc = 0;
    for (let i = dayN; i < days; i++) {
      varAcc += (remainingVar * weights[i - dayN]) / wTotal;
      billAcc += billOn[i];
      add[i] = varAcc + billAcc;
      bandLow[i] = Math.max(0, varAcc * (1 - spread)) + billAcc;
      bandHigh[i] = varAcc * (1 + spread) + billAcc;
    }
  } else if (fixedDue > 0) {
    add[days - 1] = fixedDue;
    bandLow[days - 1] = fixedDue;
    bandHigh[days - 1] = fixedDue;
  }

  return {
    oneOffThreshold: thr,
    oneOffs,
    oneOffCount: curOther.filter(t => !t.committed).length,
    regularSpent,
    remainingVar,
    fixedDue,
    add,
    bandLow,
    bandHigh,
    bandHalf: futureDays > 0 ? remainingVar * spread : 0,
    billOn,
    weekendRatio,
    basis,
    historyCycles: usable.length,
    confidence: f,
  };
}

/**
 * Splits remaining safe spend into weekday vs. weekend daily allowances when your history shows heavier weekends
 * (`weekendRatio >= 1.2`) and both weekdays and weekend days remain.
 */
export function weekendSafeSplit(
  left: number,
  daysLeftInclToday: number,
  todayDow: number,
  weekendRatio: number,
): { weekdaySafe: number; weekendSafe: number; weekdaysLeft: number; weekendsLeft: number } | null {
  if (left <= 0 || daysLeftInclToday < 2 || weekendRatio < 1.2) return null;
  let weekendsLeft = 0;
  let weekdaysLeft = 0;
  for (let i = 0; i < daysLeftInclToday; i++) {
    const dow = (todayDow + i) % 7;
    if (dow === 0 || dow === 6) weekendsLeft++;
    else weekdaysLeft++;
  }
  if (weekendsLeft === 0 || weekdaysLeft === 0) return null;
  const weightedDays = weekdaysLeft + weekendsLeft * weekendRatio;
  const weekdaySafe = left / weightedDays;
  const weekendSafe = weekdaySafe * weekendRatio;
  return { weekdaySafe, weekendSafe, weekdaysLeft, weekendsLeft };
}

export type PaceTier = 'calm' | 'near' | 'over';

export type PaceInsight = {
  /** 3-tier calm tone: calm (<= plan), near (within 5% over), over (>5% over). */
  tier: PaceTier;
  /** True when everyday pace is on/under plan and one-offs alone explain the projected overage. */
  oneOffExplains: boolean;
  overBy: number;
  spareBy: number;
  /** Daily reduction needed across remaining days to land on plan (0 when on/under plan). */
  trimPerDay: number;
  /** Whole zero-spend days at projected remaining daily rate that would close the gap (0 if not applicable). */
  zeroDaysToFix: number;
  /** Single variable category most ahead of its expected pace so far, if notable. */
  topDriver: { name: string; ahead: number } | null;
};

/**
 * Turns the projection into a calm status tier and one concrete, actionable spending lever.
 */
export function paceInsight(args: {
  budget: number;
  projTotal: number;
  oneOffs: number;
  remainingVar: number;
  daysLeft: number;
  dayN: number;
  cycleDays: number;
  cats: { name: string; type: 'fixed' | 'variable'; spent: number; limit: number; lastSameDays: number }[];
}): PaceInsight {
  const { budget, projTotal, oneOffs, remainingVar, daysLeft, dayN, cycleDays, cats } = args;
  const overBy = budget > 0 ? Math.max(0, projTotal - budget) : 0;
  const spareBy = budget > 0 ? Math.max(0, budget - projTotal) : 0;
  const tier: PaceTier =
    budget <= 0 || projTotal <= budget ? 'calm' : projTotal <= budget * 1.05 ? 'near' : 'over';
  const oneOffExplains = overBy > 0 && oneOffs > 0 && projTotal - oneOffs <= budget;
  const trimPerDay = overBy > 0 && daysLeft > 0 ? overBy / daysLeft : 0;
  const remDaily = daysLeft > 0 ? remainingVar / daysLeft : 0;
  const zeroDaysToFix =
    overBy > 0 && daysLeft >= 2 && remDaily > 0 ? Math.min(daysLeft, Math.max(1, Math.ceil(overBy / remDaily))) : 0;

  let topDriver: { name: string; ahead: number } | null = null;
  const minNotable = budget > 0 ? budget * 0.02 : 0;
  for (const c of cats) {
    if (c.type !== 'variable' || c.spent <= 0) continue;
    const expected = c.lastSameDays > 0 ? c.lastSameDays : (c.limit * dayN) / Math.max(1, cycleDays);
    if (expected <= 0) continue;
    const ahead = c.spent - expected;
    if (ahead >= minNotable && c.spent >= expected * 1.15) {
      if (!topDriver || ahead > topDriver.ahead) topDriver = { name: c.name, ahead };
    }
  }

  return { tier, oneOffExplains, overBy, spareBy, trimPerDay, zeroDaysToFix, topDriver };
}
