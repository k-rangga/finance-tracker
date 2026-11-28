/**
 * Deterministic "What-If" scenario parser and projection simulator for Ask Maxie.
 * Runs all arithmetic strictly in TypeScript (never letting the LLM guess formulas or drop `billsStillDue`),
 * outputs interactive multi-chart data (line, bar, treemap, bubble, table), and suggests exact category
 * spending pocket adjustments that users can tweak and apply straight to their budget limits.
 */
import { CATEGORIES, HUES } from '../data/categories';
import type { Budget } from './budget';
import type { Cycle } from './cycle';
import { addDays, dayMonth, fmtFull, fmtShort, sum, type Currency } from './format';
import { computeWindfallSplit, opportunityCost, type WealthSnapshot } from './wealth';
import type { Settings } from './settings';

export type ChartKind = 'line' | 'bar' | 'treemap' | 'bubble' | 'table';

export type WhatIfSpec =
  | { kind: 'daily_cap'; dailyAmount: number }
  | { kind: 'weekday_weekend_cap'; weekdayAmount: number; weekendAmount: number }
  | { kind: 'zero_spend_days'; zeroDays: number }
  | { kind: 'category_trim'; category?: string; trimPct: number }
  | { kind: 'big_purchase'; name: string; amount: number; months: number }
  | { kind: 'runway_eta'; monthlyAdd: number; targetMonths: number }
  | { kind: 'income_drop'; dropPct: number }
  | { kind: 'windfall_split'; amount: number; assetPct: number }
  | { kind: 'habit_compound'; weeklyAmount: number; label: string; annualRate: number }
  | { kind: 'freedom_path'; monthlyInvest: number; annualYield: number };

export type PocketAdjustment = {
  category: string;
  color: string;
  tint: string;
  spent: number;
  currentLimit: number;
  nextLimit: number;
  currentPct: number;
  nextPct: number;
};

export type WhatIfMetric = {
  label: string;
  before?: string;
  after: string;
  delta?: string;
  tone?: 'good' | 'warn' | 'bad';
};

export type WhatIfLineData = {
  xLabels: string[];
  baseline: number[];
  scenario: number[];
  targetLine?: { value: number; label: string };
  unit: 'currency' | 'months';
};

export type WhatIfBarItem = {
  id: string;
  label: string;
  value: number;
  secondary?: number;
  tone?: 'muted' | 'clay' | 'good' | 'amber' | 'bad';
  detail?: string;
  active?: boolean;
  specPatch?: Partial<WhatIfSpec>;
};

export type WhatIfTreemapItem = {
  id: string;
  label: string;
  value: number;
  before?: number;
  color: string;
  tint: string;
  note?: string;
};

export type WhatIfBubbleItem = {
  id: string;
  label: string;
  value: number;
  sub?: string;
  color: string;
  tint: string;
};

export type WhatIfTableRow = {
  id: string;
  cells: string[];
  tone?: 'good' | 'warn' | 'bad';
  active?: boolean;
  specPatch?: Partial<WhatIfSpec>;
};

export type WhatIfRecommendedAction =
  | { kind: 'pockets' }
  | { kind: 'wishlist'; name: string; amount: number; coolDays: number }
  | { kind: 'pyf'; savingsPct?: number; investPct?: number }
  | { kind: 'challenge'; category: string };

export type WhatIfResult = {
  spec: WhatIfSpec;
  title: string;
  subtitle: string;
  primaryChart: ChartKind;
  availableCharts: ChartKind[];
  metrics: WhatIfMetric[];
  breakdown?: string;
  currentTotal: number;
  projectedTotal: number;
  currentSpare: number;
  projectedSpare: number;
  deltaSpare: number;
  billsStillDue: number;
  line?: WhatIfLineData;
  bar?: { items: WhatIfBarItem[] };
  treemap?: { items: WhatIfTreemapItem[] };
  bubble?: { items: WhatIfBubbleItem[] };
  table?: { columns: string[]; rows: WhatIfTableRow[] };
  suggestedPockets?: PocketAdjustment[];
  recommendedAction?: WhatIfRecommendedAction;
  summaryForPrompt: Record<string, unknown>;
};

const roundStep = (v: number, currency: Currency) => {
  const step = currency === 'IDR' ? 10_000 : 5;
  return Math.max(0, Math.round(v / step) * step);
};

/** Parse Indonesian/English monetary tokens like "300k", "300rb", "1.5m", "1,5jt", "8 juta", "Rp 350.000". */
export function parseAmountToken(raw: string, currency: Currency = 'IDR'): number | null {
  const text = String(raw || '').toLowerCase().trim();
  if (!text) return null;
  // Ignore bare percentages like "30%"
  if (/%/.test(text)) return null;

  const m = text.match(/(?:rp\.?\s*)?(\d+(?:[.,]\d+)?)\s*(k|rb|ribu|m|jt|juta)?\b/i);
  if (!m) return null;
  let numStr = m[1];
  const unit = (m[2] || '').toLowerCase();

  if (unit === 'k' || unit === 'rb' || unit === 'ribu') {
    const normalized = Number(numStr.replace(',', '.'));
    return isFinite(normalized) ? Math.round(normalized * 1_000) : null;
  }
  if (unit === 'm' || unit === 'jt' || unit === 'juta') {
    const normalized = Number(numStr.replace(',', '.'));
    return isFinite(normalized) ? Math.round(normalized * 1_000_000) : null;
  }

  // No unit suffix: handle grouped thousands in IDR like 300.000 or 1,500,000
  if (currency === 'IDR' && /^\d{1,3}(?:[.,]\d{3})+$/.test(numStr)) {
    numStr = numStr.replace(/[.,]/g, '');
  } else {
    numStr = numStr.replace(',', '.');
  }
  const n = Number(numStr);
  return isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** Extract every monetary amount appearing in a sentence (excluding percentages & x-multipliers). */
function extractAmounts(prompt: string, currency: Currency): number[] {
  const clean = prompt
    .replace(/\d+(?:[.,]\d+)?\s*%/g, ' ')
    .replace(/\b\d+\s*[x×]\b/gi, ' ');
  const re = /(?:rp\.?\s*)?\d+(?:[.,]\d+)?(?:\s*(?:k|rb|ribu|m|jt|juta))?\b/gi;
  const out: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    const val = parseAmountToken(m[0], currency);
    if (val != null && (val >= 1_000 || currency === 'USD')) out.push(val);
  }
  return out;
}

const findCategoryInPrompt = (prompt: string, budget: Budget): string | undefined => {
  const lower = prompt.toLowerCase();
  const variable = budget.cats.filter(c => c.type === 'variable' && !c.auto);
  const exact = variable.find(c => lower.includes(c.name.toLowerCase()));
  if (exact) return exact.name;
  // Common EN/ID aliases
  const aliases: Array<[RegExp, string[]]> = [
    [/\b(makan|food|restaurant|dinner|lunch|resto)\b/i, ['Dining']],
    [/\b(kopi|coffee|ngopi|cafe|matcha)\b/i, ['Cafe']],
    [/\b(jajan|gofood|grabfood|shopeefood|delivery|takeout)\b/i, ['Take out']],
    [/\b(belanja|grocer|supermarket|mart)\b/i, ['Groceries']],
    [/\b(baju|mall|online shop|tokped|shopee|shopping)\b/i, ['Shopping']],
    [/\b(transport|grab|gojek|ojol|bensin|parkir|commute|ride)\b/i, ['Transport']],
    [/\b(hiburan|nonton|movie|game|entertainment)\b/i, ['Entertainment']],
  ];
  for (const [re, candidates] of aliases) {
    if (re.test(lower)) {
      const match = variable.find(c => candidates.includes(c.name));
      if (match) return match.name;
    }
  }
  return undefined;
};

/** Detect and parse a hypothetical ("What-If") prompt into a structured `WhatIfSpec`. */
export function parseWhatIfPrompt(
  prompt: string,
  budget: Budget,
  settings: Settings,
  wealth?: WealthSnapshot,
): WhatIfSpec | null {
  const text = prompt.trim();
  if (!text) return null;
  const lower = text.toLowerCase();
  const cur = settings.currency;
  const amounts = extractAmounts(text, cur);
  const pctMatch = lower.match(/(\d+(?:[.,]\d+)?)\s*%/);
  const pct = pctMatch ? Math.max(1, Math.min(100, Math.round(Number(pctMatch[1].replace(',', '.'))))) : null;

  const isHypothetical =
    /\b(what if|if i|suppose|assuming|projection|projected|to spare|capped|cap my|cap at|freeze|no[- ]?spend|zero[- ]?spend|stress test|cash vs|cicilan|installment|bonus|windfall|thr|runway|eta|compound|passive income|freedom|kalau|andaikan|seandainya|proyeksi|misal|kalau aku|jika)\b/i.test(
      lower,
    );

  // 1. Weekday vs Weekend Split Cap
  if (/weekday|hari kerja/i.test(lower) && /weekend|akhir pekan/i.test(lower) && amounts.length >= 2) {
    return {
      kind: 'weekday_weekend_cap',
      weekdayAmount: amounts[0],
      weekendAmount: amounts[1],
    };
  }

  // 2. Daily Spend Cap ("cap my spending at 300k per day", "limit daily to 250k")
  if (
    (/(\/day|per day|a day|daily|sehari|per hari|harian)/i.test(lower) || /\bcap(?:ped|ping)?\b/i.test(lower)) &&
    amounts.length >= 1 &&
    !/coffee|kopi|habit|week|minggu/i.test(lower)
  ) {
    return { kind: 'daily_cap', dailyAmount: amounts[0] };
  }

  // 3. Zero-Spend Days ("4 no-spend days", "5 zero spend days", "4 hari tanpa belanja")
  const zeroMatch = lower.match(/(\d+)\s*(?:no[- ]?spend|zero[- ]?spend|hari tanpa|puasa belanja|day[s]?\s*(?:with\s*)?(?:no|zero)\s*spend)/i);
  if (zeroMatch || (/no[- ]?spend|zero[- ]?spend|puasa belanja|hari tanpa belanja/i.test(lower) && isHypothetical)) {
    const days = zeroMatch ? Math.max(1, Math.min(20, Number(zeroMatch[1]))) : 4;
    return { kind: 'zero_spend_days', zeroDays: days };
  }

  // 4. Bonus / Windfall Split ("15M bonus", "dapet THR 10 juta")
  if (/\b(bonus|thr|windfall|rejeki|extra income|dapat uang)\b/i.test(lower) && (amounts.length >= 1 || isHypothetical)) {
    const amt = amounts[0] ?? (cur === 'IDR' ? 10_000_000 : 1_500);
    return { kind: 'windfall_split', amount: amt, assetPct: 70 };
  }

  // 5. Income Drop / Layoff Stress Test
  if (/\b(income drop|pay cut|salary cut|layoff|turun gaji|penghasilan turun|income pauses|lose.*job)\b/i.test(lower)) {
    return { kind: 'income_drop', dropPct: pct ?? (/pause|stop|layoff|lose/i.test(lower) ? 100 : 25) };
  }

  // 6. Emergency Runway ETA ("emergency fund 3M per month", "hit 6 months runway")
  if (/\b(runway|emergency fund|dana darurat)\b/i.test(lower) && (isHypothetical || amounts.length >= 1 || /when|kapan|bulan|month/i.test(lower))) {
    const fallbackMonthly = Math.max(cur === 'IDR' ? 1_000_000 : 200, Math.round(settings.income * (settings.savingsPct / 100) * 0.5));
    return {
      kind: 'runway_eta',
      monthlyAdd: amounts[0] ?? fallbackMonthly,
      targetMonths: settings.emergencyTargetMonths ?? 6,
    };
  }

  // 7. Freedom Ratio / Passive Cash Flow Path
  if (/\b(freedom ratio|passive income|passive cash|cover fixed bills|financial freedom|fast track|bebas finansial)\b/i.test(lower) && isHypothetical) {
    const invBase = Math.max(cur === 'IDR' ? 1_000_000 : 100, Math.round(settings.income * Math.max(10, settings.investPct) / 100));
    return {
      kind: 'freedom_path',
      monthlyInvest: amounts[0] ?? invBase,
      annualYield: pct ? Math.min(18, Math.max(2, pct)) / 100 : 0.07,
    };
  }

  // 8. Habit / Subscription Compounding ("coffee 150k/week", "cut subscription 200k a month")
  if (/\b(habit|coffee|kopi|subscription|langganan|compound|per week|a week|seminggu|per minggu)\b/i.test(lower) && (amounts.length >= 1 || isHypothetical)) {
    const raw = amounts[0] ?? (cur === 'IDR' ? 150_000 : 25);
    const isMonthly = /\b(month|bulan|monthly|bulanan)\b/i.test(lower);
    const weekly = isMonthly ? Math.round((raw * 12) / 52) : raw;
    const label = /coffee|kopi/i.test(lower) ? 'Coffee & treats' : /sub|langganan/i.test(lower) ? 'Subscriptions' : 'Everyday habit';
    return {
      kind: 'habit_compound',
      weeklyAmount: weekly,
      label,
      annualRate: 0.08,
    };
  }

  // 9. Category Trim / Freeze ("cut dining 30%", "freeze shopping", "kurangi dining 25%")
  const matchedCat = findCategoryInPrompt(text, budget);
  if (matchedCat && (pct != null || /\b(cut|trim|reduce|freeze|stop|save|kurangi|hemat|rem|bekukan)\b/i.test(lower))) {
    const trimPct = /\b(freeze|stop|zero|bekukan|hentikan)\b/i.test(lower) ? 100 : pct ?? 30;
    return { kind: 'category_trim', category: matchedCat, trimPct };
  }

  // 10. Big Purchase: Cash vs Installments ("buy laptop 15M", "ipad 8M cash vs 6x")
  if (
    (/\b(buy|afford|purchase|beli|cicil|cicilan|installment|cash vs)\b/i.test(lower) && amounts.length >= 1) ||
    (isHypothetical && /\b(phone|laptop|ipad|macbook|iphone|motor|trip|liburan|watch|kamera|camera|gadget)\b/i.test(lower))
  ) {
    const splitMatch = lower.match(/(\d+)\s*(?:x|×|mo|month|months|bln|bulan)\b/);
    const months = splitMatch ? Math.min(12, Math.max(1, Number(splitMatch[1]))) : 6;
    const itemMatch = text.match(/\b(?:buy|afford|purchase|beli)\s+(?:a|an|the)?\s*([a-z0-9\s-]{2,26}?)(?=\s+(?:for|at|worth|seharga|cash|rp|\d)|$)/i);
    const name = itemMatch?.[1]?.trim() || (wealth ? 'Planned purchase' : 'Big purchase');
    return {
      kind: 'big_purchase',
      name: name.slice(0, 28),
      amount: amounts[0] ?? (cur === 'IDR' ? 6_000_000 : 800),
      months,
    };
  }

  // Generic trim fallback when user mentions "what if i spend X less / cut Y%"
  if (isHypothetical && pct != null && !matchedCat) {
    const topVar = [...budget.cats]
      .filter(c => c.type === 'variable' && !c.auto && c.spent > 0)
      .sort((a, z) => z.spent - a.spent)[0];
    if (topVar) return { kind: 'category_trim', category: topVar.name, trimPct: pct };
  }

  // Generic daily cap fallback if "what if" + single daily-scale amount
  if (isHypothetical && amounts.length === 1 && amounts[0] <= Math.max(budget.varBudget * 0.4, 2_000_000)) {
    return { kind: 'daily_cap', dailyAmount: amounts[0] };
  }

  return null;
}

/** Validate and clamp a Gemini-emitted `scenario` object against real categories & sane numeric bounds. */
export function normalizeWhatIfSpec(raw: unknown, budget: Budget, settings: Settings): WhatIfSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const kind = String(r.kind || '');
  const pos = (v: unknown, fallback: number, max = 5_000_000_000) => {
    const n = Number(v);
    return isFinite(n) && n >= 0 ? Math.min(max, Math.round(n)) : fallback;
  };
  const validCat = (name?: unknown) => {
    const s = String(name ?? '').trim().toLowerCase();
    return budget.cats.find(c => c.type === 'variable' && !c.auto && c.name.toLowerCase() === s)?.name;
  };

  switch (kind) {
    case 'daily_cap':
      return { kind: 'daily_cap', dailyAmount: pos(r.dailyAmount, Math.round(budget.safeDay)) };
    case 'weekday_weekend_cap':
      return {
        kind: 'weekday_weekend_cap',
        weekdayAmount: pos(r.weekdayAmount, Math.round(budget.safeDay * 0.75)),
        weekendAmount: pos(r.weekendAmount, Math.round(budget.safeDay * 1.4)),
      };
    case 'zero_spend_days':
      return { kind: 'zero_spend_days', zeroDays: Math.max(1, Math.min(25, pos(r.zeroDays, 4, 25))) };
    case 'category_trim':
      return {
        kind: 'category_trim',
        category: validCat(r.category) ?? budget.cats.find(c => c.type === 'variable' && !c.auto)?.name,
        trimPct: Math.max(5, Math.min(100, pos(r.trimPct, 30, 100))),
      };
    case 'big_purchase':
      return {
        kind: 'big_purchase',
        name: String(r.name || 'Planned purchase').trim().slice(0, 32) || 'Planned purchase',
        amount: Math.max(1, pos(r.amount, settings.currency === 'IDR' ? 5_000_000 : 500)),
        months: Math.max(1, Math.min(12, pos(r.months, 6, 12))),
      };
    case 'runway_eta':
      return {
        kind: 'runway_eta',
        monthlyAdd: Math.max(1, pos(r.monthlyAdd, Math.round(settings.income * 0.15))),
        targetMonths: Math.max(1, Math.min(24, pos(r.targetMonths, settings.emergencyTargetMonths ?? 6, 24))),
      };
    case 'income_drop':
      return { kind: 'income_drop', dropPct: Math.max(5, Math.min(100, pos(r.dropPct, 25, 100))) };
    case 'windfall_split':
      return {
        kind: 'windfall_split',
        amount: Math.max(1, pos(r.amount, Math.round(settings.income * 0.5))),
        assetPct: Math.max(10, Math.min(95, pos(r.assetPct, 70, 95))),
      };
    case 'habit_compound':
      return {
        kind: 'habit_compound',
        weeklyAmount: Math.max(1, pos(r.weeklyAmount, settings.currency === 'IDR' ? 150_000 : 25)),
        label: String(r.label || 'Everyday habit').trim().slice(0, 32) || 'Everyday habit',
        annualRate: Math.max(0.01, Math.min(0.2, Number(r.annualRate) || 0.08)),
      };
    case 'freedom_path':
      return {
        kind: 'freedom_path',
        monthlyInvest: Math.max(1, pos(r.monthlyInvest, Math.round((settings.income * Math.max(10, settings.investPct)) / 100))),
        annualYield: Math.max(0.02, Math.min(0.18, Number(r.annualYield) || 0.07)),
      };
    default:
      return null;
  }
}

/** Build editable category spending pocket adjustments that reach `targetDeltaVar` without cutting below spent. */
export function suggestPocketAdjustments(
  budget: Budget,
  settings: Settings,
  targetDeltaVar: number,
  focusCategory?: string,
): PocketAdjustment[] {
  const vars = budget.cats.filter(c => c.type === 'variable' && !c.auto);
  if (!vars.length) return [];

  const cur = settings.currency;
  const roundUp = (v: number) => {
    const step = cur === 'IDR' ? 10_000 : 1;
    return Math.ceil(v / step) * step;
  };
  const roundNearest = (v: number) => {
    const step = cur === 'IDR' ? 10_000 : 1;
    return Math.round(v / step) * step;
  };

  const pctFor = (amt: number, fallbackPct: number) =>
    settings.income > 0 ? Math.round(((amt / settings.income) * 100) * 1e4) / 1e4 : fallbackPct;

  const base: PocketAdjustment[] = vars.map(c => ({
    category: c.name,
    color: c.color,
    tint: c.tint,
    spent: Math.round(c.spent),
    currentLimit: Math.round(c.limit),
    nextLimit: Math.round(c.limit),
    currentPct: c.limitPct,
    nextPct: c.limitPct,
  }));

  if (Math.abs(targetDeltaVar) < (cur === 'IDR' ? 10_000 : 1)) {
    return base;
  }

  // Focus category takes the trim/boost first, clamped safely above spent.
  if (focusCategory) {
    const target = base.find(x => x.category === focusCategory);
    if (target) {
      const floor = roundUp(target.spent);
      const rawNext = Math.max(floor, roundNearest(target.currentLimit + targetDeltaVar));
      target.nextLimit = rawNext;
      target.nextPct = pctFor(rawNext, target.currentPct);
      return base;
    }
  }

  // Distribute variable delta across categories proportional to remaining slack (when trimming) or limits (when relaxing).
  const isTrim = targetDeltaVar < 0;
  let remainingDelta = targetDeltaVar;
  const weights = base.map(p => {
    const floor = roundUp(p.spent);
    const maxRoom = Math.max(0, p.currentLimit - floor);
    return isTrim ? maxRoom : Math.max(p.currentLimit, cur === 'IDR' ? 200_000 : 20);
  });
  const totalWeight = sum(weights);
  if (totalWeight <= 0) return base;

  for (let i = 0; i < base.length; i++) {
    const p = base[i];
    if (weights[i] <= 0) continue;
    const share = (weights[i] / totalWeight) * remainingDelta;
    const floor = roundUp(p.spent);
    const candidate = isTrim ? Math.max(floor, roundNearest(p.currentLimit + share)) : Math.max(floor, roundNearest(p.currentLimit + share));
    p.nextLimit = candidate;
    p.nextPct = pctFor(candidate, p.currentPct);
  }

  return base;
}

/** Pure deterministic simulator producing headline metrics, breakdown, interactive chart data, and pocket presets. */
export function simulateWhatIf(
  spec: WhatIfSpec,
  { cycle, budget, settings, wealth }: { cycle: Cycle; budget: Budget; settings: Settings; wealth?: WealthSnapshot },
): WhatIfResult {
  const cur = settings.currency;
  const fFull = (v: number) => fmtFull(v, cur);
  const fShort = (v: number) => fmtShort(v, cur);
  const isId = settings.maxieLanguage === 'id';
  const daysRem = Math.max(1, cycle.daysLeft + 1);
  const billsStillDue = Math.round(budget.fixedDue);
  const currentTotal = Math.round(budget.projTotal);
  const currentSpare = Math.round(budget.budget - currentTotal);
  const baselineRemVar = Math.max(0, Math.round(budget.proj.remainingVar));
  const baselineDailyVar = baselineRemVar / daysRem;

  // Helper to build a cumulative spend trajectory (baseline vs scenario) across remaining days in the cycle.
  const buildCycleLine = (dailyArrScenario: number[]): WhatIfLineData => {
    const steps = Math.min(daysRem, 10);
    const xLabels: string[] = [];
    const baseline: number[] = [];
    const scenario: number[] = [];
    let cumBase = Math.round(budget.spent + billsStillDue);
    let cumScen = Math.round(budget.spent + billsStillDue);
    const basePerDay = baselineRemVar / daysRem;

    const fullBase: number[] = [cumBase];
    const fullScen: number[] = [cumScen];
    for (let i = 0; i < daysRem; i++) {
      cumBase += basePerDay;
      cumScen += dailyArrScenario[i] ?? 0;
      fullBase.push(Math.round(cumBase));
      fullScen.push(Math.round(cumScen));
    }

    for (let sIdx = 0; sIdx <= steps; sIdx++) {
      const dayOffset = Math.min(daysRem, Math.round((sIdx / steps) * daysRem));
      const d = addDays(cycle.today, Math.max(0, dayOffset - 1));
      xLabels.push(dayOffset === 0 ? (isId ? 'Hari ini' : 'Now') : dayOffset === daysRem ? (isId ? 'Gajian' : 'Payday') : dayMonth(d));
      baseline.push(fullBase[dayOffset]);
      scenario.push(fullScen[dayOffset]);
    }
    return {
      xLabels,
      baseline,
      scenario,
      targetLine: { value: Math.round(budget.budget), label: `${isId ? 'Anggaran' : 'Budget'} ${fShort(budget.budget)}` },
      unit: 'currency',
    };
  };

  // ---- 1. Daily Spend Cap ----
  if (spec.kind === 'daily_cap') {
    const cap = Math.max(0, Math.round(spec.dailyAmount));
    const newRemVar = Math.round(cap * daysRem);
    const projectedTotal = Math.round(budget.spent + billsStillDue + newRemVar);
    const projectedSpare = Math.round(budget.budget - projectedTotal);
    const deltaSpare = projectedSpare - currentSpare;
    const line = buildCycleLine(Array.from({ length: daysRem }, () => cap));
    const suggestedPockets = suggestPocketAdjustments(budget, settings, newRemVar - baselineRemVar);

    return {
      spec,
      title: isId ? `Batas harian ${fShort(cap)}/hari` : `Daily cap at ${fShort(cap)}/day`,
      subtitle: isId
        ? `${daysRem} hari tersisa · termasuk tagihan tetap ${fShort(billsStillDue)}`
        : `${daysRem} days to payday · includes ${fShort(billsStillDue)} bills due`,
      primaryChart: 'line',
      availableCharts: ['line', 'bar', 'table'],
      currentTotal,
      projectedTotal,
      currentSpare,
      projectedSpare,
      deltaSpare,
      billsStillDue,
      metrics: [
        { label: isId ? 'Proyeksi sisa' : 'Projected spare', before: fFull(currentSpare), after: fFull(projectedSpare), delta: (deltaSpare >= 0 ? '+' : '-') + fShort(Math.abs(deltaSpare)), tone: projectedSpare >= 0 ? 'good' : 'bad' },
        { label: isId ? 'Total proyeksi keluar' : 'Projected spend', before: fShort(currentTotal), after: fShort(projectedTotal), tone: projectedTotal <= budget.budget ? 'good' : 'warn' },
        { label: isId ? 'Batas harian baru' : 'New daily pace', before: fShort(Math.round(baselineDailyVar)), after: fShort(cap) },
      ],
      breakdown: `${fShort(budget.spent)} spent + (${daysRem}d × ${fShort(cap)}) + ${fShort(billsStillDue)} bills due = ${fFull(projectedTotal)}`,
      line,
      bar: {
        items: [
          { id: 'current', label: isId ? 'Saat ini' : 'Current pace', value: currentTotal, secondary: currentSpare, tone: 'muted', detail: `${fShort(Math.round(baselineDailyVar))}/day` },
          { id: 'cap', label: isId ? 'Batas ini' : `${fShort(cap)}/day`, value: projectedTotal, secondary: projectedSpare, tone: projectedSpare >= 0 ? 'good' : 'amber', active: true, detail: `${fShort(cap)}/day` },
          { id: 'budget', label: isId ? 'Total anggaran' : 'Cycle budget', value: Math.round(budget.budget), tone: 'clay', detail: fShort(budget.budget) },
        ],
      },
      table: {
        columns: [isId ? 'Komponen' : 'Component', isId ? 'Saat ini' : 'Current', isId ? 'Skenario' : 'What-If'],
        rows: [
          { id: 'spent', cells: [isId ? 'Sudah terpakai' : 'Spent so far', fFull(budget.spent), fFull(budget.spent)] },
          { id: 'bills', cells: [isId ? 'Tagihan belum bayar' : 'Bills still due', fFull(billsStillDue), fFull(billsStillDue)] },
          { id: 'var', cells: [`${daysRem}d variable`, fFull(baselineRemVar), fFull(newRemVar)], tone: newRemVar <= baselineRemVar ? 'good' : 'warn' },
          { id: 'spare', cells: [isId ? 'Sisa di gajian' : 'Spare at payday', fFull(currentSpare), fFull(projectedSpare)], tone: projectedSpare >= 0 ? 'good' : 'bad' },
        ],
      },
      suggestedPockets,
      recommendedAction: deltaSpare > 0 ? { kind: 'pockets' } : undefined,
      summaryForPrompt: {
        kind: 'daily_cap',
        dailyCap: cap,
        daysRemainingIncludingToday: daysRem,
        spentSoFar: Math.round(budget.spent),
        billsStillDue,
        remainingVariableAtCap: newRemVar,
        baselineRemainingVariable: baselineRemVar,
        budgetTotal: Math.round(budget.budget),
        currentProjectedTotal: currentTotal,
        projectedTotal,
        currentSpare,
        projectedSpare,
        deltaSpare,
      },
    };
  }

  // ---- 2. Weekday vs Weekend Cap ----
  if (spec.kind === 'weekday_weekend_cap') {
    const wdCap = Math.max(0, Math.round(spec.weekdayAmount));
    const weCap = Math.max(0, Math.round(spec.weekendAmount));
    let wdCount = 0;
    let weCount = 0;
    const dailyArr: number[] = [];
    for (let i = 0; i < daysRem; i++) {
      const dow = (cycle.today.getDay() + i) % 7;
      const isWk = dow === 0 || dow === 6;
      if (isWk) {
        weCount++;
        dailyArr.push(weCap);
      } else {
        wdCount++;
        dailyArr.push(wdCap);
      }
    }
    const newRemVar = Math.round(wdCount * wdCap + weCount * weCap);
    const projectedTotal = Math.round(budget.spent + billsStillDue + newRemVar);
    const projectedSpare = Math.round(budget.budget - projectedTotal);
    const deltaSpare = projectedSpare - currentSpare;
    const suggestedPockets = suggestPocketAdjustments(budget, settings, newRemVar - baselineRemVar);

    return {
      spec,
      title: isId ? 'Batas hari kerja vs akhir pekan' : 'Weekday vs. weekend budget split',
      subtitle: `${wdCount} weekdays × ${fShort(wdCap)} + ${weCount} weekend days × ${fShort(weCap)}`,
      primaryChart: 'line',
      availableCharts: ['line', 'bar', 'table'],
      currentTotal,
      projectedTotal,
      currentSpare,
      projectedSpare,
      deltaSpare,
      billsStillDue,
      metrics: [
        { label: isId ? 'Proyeksi sisa' : 'Projected spare', before: fFull(currentSpare), after: fFull(projectedSpare), delta: (deltaSpare >= 0 ? '+' : '-') + fShort(Math.abs(deltaSpare)), tone: projectedSpare >= 0 ? 'good' : 'bad' },
        { label: isId ? 'Hari kerja' : `Weekdays (${wdCount}d)`, after: fShort(wdCount * wdCap), delta: `${fShort(wdCap)}/d` },
        { label: isId ? 'Akhir pekan' : `Weekends (${weCount}d)`, after: fShort(weCount * weCap), delta: `${fShort(weCap)}/d` },
      ],
      breakdown: `${fShort(budget.spent)} spent + ${wdCount}d×${fShort(wdCap)} + ${weCount}d×${fShort(weCap)} + ${fShort(billsStillDue)} bills = ${fFull(projectedTotal)}`,
      line: buildCycleLine(dailyArr),
      bar: {
        items: [
          { id: 'current', label: isId ? 'Saat ini' : 'Current pace', value: currentTotal, tone: 'muted', detail: fShort(currentTotal) },
          { id: 'split', label: isId ? 'Split baru' : 'Weekday/End split', value: projectedTotal, tone: projectedSpare >= 0 ? 'good' : 'amber', active: true, detail: fShort(projectedTotal) },
          { id: 'budget', label: isId ? 'Anggaran' : 'Budget', value: Math.round(budget.budget), tone: 'clay', detail: fShort(budget.budget) },
        ],
      },
      table: {
        columns: [isId ? 'Skenario' : 'Mode', isId ? 'Sisa variabel' : 'Var left', isId ? 'Sisa gajian' : 'Spare'],
        rows: [
          { id: 'cur', cells: [isId ? 'Ritme saat ini' : 'Current trajectory', fFull(baselineRemVar), fFull(currentSpare)] },
          { id: 'new', cells: [isId ? 'Split pilihanmu' : 'Your split cap', fFull(newRemVar), fFull(projectedSpare)], tone: projectedSpare >= 0 ? 'good' : 'bad', active: true },
        ],
      },
      suggestedPockets,
      recommendedAction: deltaSpare > 0 ? { kind: 'pockets' } : undefined,
      summaryForPrompt: {
        kind: 'weekday_weekend_cap',
        weekdayCap: wdCap,
        weekendCap: weCap,
        weekdaysLeft: wdCount,
        weekendsLeft: weCount,
        billsStillDue,
        projectedTotal,
        currentSpare,
        projectedSpare,
        deltaSpare,
      },
    };
  }

  // ---- 3. Zero-Spend Days ----
  if (spec.kind === 'zero_spend_days') {
    const zeroDays = Math.max(1, Math.min(daysRem, Math.round(spec.zeroDays)));
    const activeDays = Math.max(0, daysRem - zeroDays);
    const savedFromZero = Math.round(baselineDailyVar * zeroDays);
    const newRemVar = Math.round(baselineDailyVar * activeDays);
    const projectedTotal = Math.round(budget.spent + billsStillDue + newRemVar);
    const projectedSpare = Math.round(budget.budget - projectedTotal);
    const deltaSpare = projectedSpare - currentSpare;
    const dailyArr = Array.from({ length: daysRem }, (_, idx) => (idx < zeroDays ? 0 : baselineDailyVar));
    const options = [2, 4, 6, 8].filter(n => n <= daysRem);
    if (!options.includes(zeroDays) && zeroDays <= daysRem) options.push(zeroDays);
    options.sort((a, b) => a - b);
    const suggestedPockets = suggestPocketAdjustments(budget, settings, -savedFromZero);

    return {
      spec,
      title: isId ? `${zeroDays} hari tanpa belanja` : `${zeroDays} zero-spend days this cycle`,
      subtitle: isId
        ? `Menghemat ~${fShort(Math.round(baselineDailyVar))}/hari dari ritme saat ini`
        : `Skipping ~${fShort(Math.round(baselineDailyVar))}/day × ${zeroDays} quiet days`,
      primaryChart: 'bar',
      availableCharts: ['bar', 'line', 'table'],
      currentTotal,
      projectedTotal,
      currentSpare,
      projectedSpare,
      deltaSpare,
      billsStillDue,
      metrics: [
        { label: isId ? 'Proyeksi sisa' : 'Projected spare', before: fFull(currentSpare), after: fFull(projectedSpare), delta: `+${fShort(savedFromZero)}`, tone: projectedSpare >= 0 ? 'good' : 'warn' },
        { label: isId ? 'Tambahan hemat' : 'Quiet-day savings', after: fFull(savedFromZero), tone: 'good' },
        { label: isId ? 'Hari belanja aktif' : 'Active days left', after: `${activeDays} of ${daysRem}d` },
      ],
      breakdown: `${fShort(currentSpare)} baseline spare + (${zeroDays} × ${fShort(Math.round(baselineDailyVar))}/d) = ${fFull(projectedSpare)}`,
      bar: {
        items: options.slice(0, 5).map(n => {
          const spareAtN = currentSpare + Math.round(baselineDailyVar * n);
          return {
            id: `zero_${n}`,
            label: `${n}d quiet`,
            value: Math.max(0, spareAtN),
            tone: n === zeroDays ? 'good' : 'muted',
            detail: `+${fShort(Math.round(baselineDailyVar * n))}`,
            active: n === zeroDays,
            specPatch: { zeroDays: n },
          };
        }),
      },
      line: buildCycleLine(dailyArr),
      table: {
        columns: ['Quiet days', isId ? 'Hemat tambahan' : 'Extra saved', isId ? 'Sisa gajian' : 'Spare at payday'],
        rows: options.map(n => {
          const add = Math.round(baselineDailyVar * n);
          const sp = currentSpare + add;
          return {
            id: `row_${n}`,
            cells: [`${n} days`, `+${fShort(add)}`, fFull(sp)],
            tone: sp >= 0 ? 'good' : 'warn',
            active: n === zeroDays,
            specPatch: { zeroDays: n },
          };
        }),
      },
      suggestedPockets,
      recommendedAction: { kind: 'pockets' },
      summaryForPrompt: {
        kind: 'zero_spend_days',
        zeroDays,
        daysRemaining: daysRem,
        avgDailyVariable: Math.round(baselineDailyVar),
        extraSaved: savedFromZero,
        billsStillDue,
        currentSpare,
        projectedSpare,
        deltaSpare,
      },
    };
  }

  // ---- 4. Category Trim / Freeze ----
  if (spec.kind === 'category_trim') {
    const vars = budget.cats.filter(c => c.type === 'variable' && !c.auto);
    const chosen =
      vars.find(c => c.name.toLowerCase() === (spec.category ?? '').toLowerCase()) ??
      [...vars].sort((a, z) => z.limit - a.limit)[0];
    const trimPct = Math.max(5, Math.min(100, Math.round(spec.trimPct)));
    const catName = chosen?.name ?? 'Dining';
    const remCatBudget = chosen ? Math.max(0, chosen.limit - chosen.spent) : 0;
    const baseProjectedCat = chosen ? Math.max(chosen.spent, chosen.limit) : 0;
    const saved = Math.round((remCatBudget > 0 ? remCatBudget : baseProjectedCat * 0.3) * (trimPct / 100));
    const projectedTotal = Math.max(Math.round(budget.spent + billsStillDue), currentTotal - saved);
    const projectedSpare = Math.round(budget.budget - projectedTotal);
    const deltaSpare = projectedSpare - currentSpare;
    const suggestedPockets = suggestPocketAdjustments(budget, settings, -saved, catName);

    const treemapItems: WhatIfTreemapItem[] = suggestedPockets
      .filter(p => p.nextLimit > 0 || p.spent > 0)
      .map(p => ({
        id: p.category,
        label: p.category,
        value: Math.max(1, p.nextLimit),
        before: p.currentLimit,
        color: p.color,
        tint: p.tint,
        note: p.nextLimit < p.currentLimit ? `-${fShort(p.currentLimit - p.nextLimit)}` : undefined,
      }));

    return {
      spec: { ...spec, category: catName, trimPct },
      title: trimPct >= 100 ? (isId ? `Bekukan sisa ${catName}` : `Freeze remaining ${catName}`) : isId ? `Pangkas ${catName} ${trimPct}%` : `Trim ${catName} by ${trimPct}%`,
      subtitle: chosen
        ? `${fShort(chosen.spent)} spent of ${fShort(chosen.limit)} · ${fShort(remCatBudget)} left to shape`
        : catName,
      primaryChart: 'treemap',
      availableCharts: ['treemap', 'bubble', 'table'],
      currentTotal,
      projectedTotal,
      currentSpare,
      projectedSpare,
      deltaSpare,
      billsStillDue,
      metrics: [
        { label: isId ? 'Proyeksi sisa' : 'Projected spare', before: fFull(currentSpare), after: fFull(projectedSpare), delta: `+${fShort(deltaSpare)}`, tone: projectedSpare >= 0 ? 'good' : 'warn' },
        { label: `${catName} pocket`, before: chosen ? fShort(chosen.limit) : '-', after: fShort(Math.max(chosen?.spent ?? 0, (chosen?.limit ?? 0) - saved)) },
        { label: isId ? 'Ruang dihemat' : 'Freed room', after: fFull(saved), tone: 'good' },
      ],
      treemap: { items: treemapItems },
      bubble: {
        items: suggestedPockets.slice(0, 6).map(p => ({
          id: p.category,
          label: p.category,
          value: Math.max(1, p.nextLimit),
          sub: p.nextLimit < p.currentLimit ? `-${fShort(p.currentLimit - p.nextLimit)}` : fShort(p.nextLimit),
          color: p.color,
          tint: p.tint,
        })),
      },
      table: {
        columns: ['Category', 'Current limit', 'After trim', 'Spent'],
        rows: suggestedPockets.map(p => ({
          id: p.category,
          cells: [p.category, fShort(p.currentLimit), fShort(p.nextLimit), fShort(p.spent)],
          tone: p.nextLimit < p.currentLimit ? 'good' : undefined,
          active: p.category === catName,
          specPatch: { category: p.category },
        })),
      },
      suggestedPockets,
      recommendedAction: { kind: 'pockets' },
      summaryForPrompt: {
        kind: 'category_trim',
        category: catName,
        trimPct,
        savedAmount: saved,
        currentSpare,
        projectedSpare,
        deltaSpare,
        billsStillDue,
      },
    };
  }

  // ---- 5. Big Purchase: Cash vs Installments ----
  if (spec.kind === 'big_purchase') {
    const amount = Math.max(1, Math.round(spec.amount));
    const months = Math.max(1, Math.min(12, Math.round(spec.months)));
    const name = spec.name || 'Planned purchase';
    const monthlyHeadroom = Math.max(0, Math.round(budget.income - budget.budget - Math.round((settings.income * settings.savingsPct) / 100)));
    const cycleSpareRoom = Math.max(0, currentSpare) + monthlyHeadroom;
    const opp5yr = Math.round(opportunityCost(amount, 5, 0.08));
    const splits = [1, 3, 6, 12];
    const perSelected = Math.round(amount / months);
    const fitsCleanly = perSelected <= Math.max(currentSpare, cycleSpareRoom);

    return {
      spec: { ...spec, months },
      title: `${name} — ${fShort(amount)}`,
      subtitle: isId ? 'Bandingkan bayar cash vs cicilan & biaya peluang 5 thn' : 'Cash vs. installment stress test + 5-year compounding cost',
      primaryChart: 'table',
      availableCharts: ['table', 'bar'],
      currentTotal,
      projectedTotal: currentTotal + perSelected,
      currentSpare,
      projectedSpare: currentSpare - perSelected,
      deltaSpare: -perSelected,
      billsStillDue,
      metrics: [
        { label: months === 1 ? 'Cash hit now' : `${months}× per cycle`, after: fFull(perSelected), tone: fitsCleanly ? 'good' : 'warn' },
        { label: isId ? 'Sisa siklus jika diambil' : 'Cycle spare after', before: fShort(currentSpare), after: fShort(currentSpare - perSelected), tone: currentSpare - perSelected >= 0 ? 'good' : 'bad' },
        { label: '5-yr @ 8% cost', after: fShort(opp5yr), tone: 'warn' },
      ],
      table: {
        columns: ['Option', 'Per cycle', 'Cycle balance', 'Fit'],
        rows: splits.map(m => {
          const per = Math.round(amount / m);
          const rem = currentSpare - per;
          const ok = rem >= 0 ? 'Comfortable' : rem + monthlyHeadroom >= 0 ? 'Uses buffer' : 'Tight';
          return {
            id: `split_${m}`,
            cells: [m === 1 ? 'Cash (1×)' : `${m}× cicilan`, fShort(per), fShort(rem), ok],
            tone: rem >= 0 ? 'good' : rem + monthlyHeadroom >= 0 ? 'warn' : 'bad',
            active: m === months,
            specPatch: { months: m },
          };
        }),
      },
      bar: {
        items: splits.map(m => {
          const per = Math.round(amount / m);
          return {
            id: `b_${m}`,
            label: m === 1 ? 'Cash' : `${m}×`,
            value: per,
            tone: m === months ? 'clay' : currentSpare - per >= 0 ? 'good' : 'amber',
            detail: `${fShort(per)}/mo`,
            active: m === months,
            specPatch: { months: m },
          };
        }),
      },
      recommendedAction: { kind: 'wishlist', name, amount, coolDays: 14 },
      summaryForPrompt: {
        kind: 'big_purchase',
        name,
        amount,
        selectedMonths: months,
        perCycle: perSelected,
        currentSpare,
        spareAfterInstallment: currentSpare - perSelected,
        opportunityCost5Yr8Pct: opp5yr,
      },
    };
  }

  // ---- 6. Emergency Runway ETA ----
  if (spec.kind === 'runway_eta') {
    const monthlyAdd = Math.max(1, Math.round(spec.monthlyAdd));
    const targetMonths = Math.max(1, Math.min(24, Math.round(spec.targetMonths)));
    const curFund = Math.round(wealth?.emergencyFund ?? settings.emergencyFund ?? 0);
    const essential = Math.max(1, Math.round(wealth?.essentialMonthly ?? Math.max(budget.budget * 0.75, 1)));
    const targetFund = Math.round(essential * targetMonths);
    const gap = Math.max(0, targetFund - curFund);
    const monthsToTarget = gap === 0 ? 0 : Math.ceil(gap / monthlyAdd);
    const curMonths = Math.round((curFund / essential) * 10) / 10;
    const horizon = Math.max(6, Math.min(18, monthsToTarget + 2));
    const curSavePerMo = Math.max(0, Math.round(budget.saved || (settings.income * settings.savingsPct) / 100));

    const xLabels: string[] = [];
    const baseline: number[] = [];
    const scenario: number[] = [];
    for (let m = 0; m <= horizon; m++) {
      xLabels.push(m === 0 ? 'Now' : `+${m}m`);
      baseline.push(Math.round(((curFund + curSavePerMo * 0.4 * m) / essential) * 10) / 10);
      scenario.push(Math.round(((curFund + monthlyAdd * m) / essential) * 10) / 10);
    }

    return {
      spec,
      title: isId ? `Target dana darurat ${targetMonths} bulan` : `Path to ${targetMonths}-month emergency runway`,
      subtitle: `+${fShort(monthlyAdd)}/mo · essential base ${fShort(essential)}/mo`,
      primaryChart: 'line',
      availableCharts: ['line', 'table'],
      currentTotal: curFund,
      projectedTotal: targetFund,
      currentSpare,
      projectedSpare: currentSpare,
      deltaSpare: 0,
      billsStillDue,
      metrics: [
        { label: isId ? 'Waktu tercapai' : 'Target reached', after: monthsToTarget === 0 ? 'Already hit!' : `${monthsToTarget} cycles`, tone: 'good' },
        { label: 'Runway now', after: `${curMonths} mo` },
        { label: `Target (${targetMonths}m)`, after: fShort(targetFund) },
      ],
      line: {
        xLabels,
        baseline,
        scenario,
        targetLine: { value: targetMonths, label: `${targetMonths} mo benchmark` },
        unit: 'months',
      },
      table: {
        columns: ['Monthly boost', 'Time to goal', 'Fund at +6m'],
        rows: [0.5, 1, 1.5, 2].map(mult => {
          const add = roundStep(monthlyAdd * mult, cur);
          const mo = add > 0 ? Math.ceil(gap / add) : 99;
          return {
            id: `r_${mult}`,
            cells: [fShort(add), mo === 0 ? 'Now' : `${mo} mo`, fShort(curFund + add * 6)],
            tone: mo <= 12 ? 'good' : 'warn',
            active: Math.abs(mult - 1) < 0.01,
            specPatch: { monthlyAdd: add },
          };
        }),
      },
      summaryForPrompt: {
        kind: 'runway_eta',
        currentFund: curFund,
        essentialMonthly: essential,
        currentRunwayMonths: curMonths,
        targetMonths,
        targetFund,
        monthlyAdd,
        cyclesToReachGoal: monthsToTarget,
      },
    };
  }

  // ---- 7. Income Drop / Layoff Stress Test ----
  if (spec.kind === 'income_drop') {
    const dropPct = Math.max(5, Math.min(100, Math.round(spec.dropPct)));
    const curIncome = Math.max(1, Math.round(budget.income || settings.income));
    const newIncome = Math.round(curIncome * (1 - dropPct / 100));
    const essential = Math.round(wealth?.essentialMonthly ?? Math.max(budget.fixedSpent + budget.varBudget * 0.65, 1));
    const curFund = Math.round(wealth?.emergencyFund ?? settings.emergencyFund ?? 0);
    const monthlyGap = Math.max(0, essential - newIncome);
    const runwayMo = monthlyGap === 0 ? 99 : curFund > 0 ? Math.round((curFund / monthlyGap) * 10) / 10 : 0;

    return {
      spec,
      title: dropPct >= 100 ? (isId ? 'Simulasi jeda penghasilan' : 'Full income-pause stress test') : `Income down ${dropPct}% stress test`,
      subtitle: `${fShort(curIncome)} → ${fShort(newIncome)}/mo vs essential ${fShort(essential)}/mo`,
      primaryChart: 'bar',
      availableCharts: ['bar', 'line', 'table'],
      currentTotal: curIncome,
      projectedTotal: newIncome,
      currentSpare,
      projectedSpare: newIncome - essential,
      deltaSpare: newIncome - curIncome,
      billsStillDue,
      metrics: [
        { label: 'New inflow', before: fShort(curIncome), after: fShort(newIncome), tone: newIncome >= essential ? 'good' : 'bad' },
        { label: 'Monthly gap', after: monthlyGap === 0 ? 'Covered' : `-${fShort(monthlyGap)}/mo`, tone: monthlyGap === 0 ? 'good' : 'warn' },
        { label: 'Runway cushion', after: monthlyGap === 0 ? 'Self-funded' : `${runwayMo} mo` },
      ],
      bar: {
        items: [
          { id: 'cur_inc', label: 'Normal income', value: curIncome, tone: 'muted', detail: fShort(curIncome) },
          { id: 'drop_inc', label: `-${dropPct}% income`, value: newIncome, tone: newIncome >= essential ? 'good' : 'amber', active: true, detail: fShort(newIncome) },
          { id: 'ess', label: 'Essential floor', value: essential, tone: 'clay', detail: fShort(essential) },
          { id: 'full_bud', label: 'Current budget', value: Math.round(budget.budget), tone: 'muted', detail: fShort(budget.budget) },
        ],
      },
      line: {
        xLabels: ['Now', '+1m', '+2m', '+3m', '+4m', '+5m', '+6m'],
        baseline: Array.from({ length: 7 }, () => curFund),
        scenario: Array.from({ length: 7 }, (_, i) => Math.max(0, curFund - monthlyGap * i)),
        unit: 'currency',
      },
      table: {
        columns: ['Drop %', 'Income', 'Essential gap', 'Runway'],
        rows: [15, 25, 50, 100].map(p => {
          const inc = Math.round(curIncome * (1 - p / 100));
          const gap = Math.max(0, essential - inc);
          const rw = gap === 0 ? 'Covered' : curFund > 0 ? `${Math.round((curFund / gap) * 10) / 10} mo` : '0 mo';
          return {
            id: `drop_${p}`,
            cells: [`-${p}%`, fShort(inc), gap === 0 ? 'None' : `-${fShort(gap)}`, rw],
            tone: gap === 0 ? 'good' : p <= 25 ? 'warn' : 'bad',
            active: p === dropPct,
            specPatch: { dropPct: p },
          };
        }),
      },
      summaryForPrompt: {
        kind: 'income_drop',
        dropPct,
        normalIncome: curIncome,
        stressedIncome: newIncome,
        essentialMonthly: essential,
        monthlyGap,
        emergencyFund: curFund,
        runwayMonthsUnderStress: runwayMo,
      },
    };
  }

  // ---- 8. Windfall / Bonus 70/30 Split ----
  if (spec.kind === 'windfall_split') {
    const amount = Math.max(1, Math.round(spec.amount));
    const assetPct = Math.max(10, Math.min(95, Math.round(spec.assetPct)));
    const ratio = assetPct / 100;
    const toAssets = Math.round(amount * ratio);
    const toEnjoy = Math.max(0, amount - toAssets);
    const baseSplit = computeWindfallSplit(amount, 0.6);
    const toInvest = Math.round(toAssets * 0.6);
    const toEmergency = Math.max(0, toAssets - toInvest);
    const fiveYrInvest = Math.round(opportunityCost(toInvest, 5, 0.08));

    return {
      spec,
      title: `${assetPct}/${100 - assetPct} Asset-First bonus plan`,
      subtitle: `${fFull(amount)} windfall · compounding ${fShort(toInvest)} → ${fShort(fiveYrInvest)} in 5 yrs`,
      primaryChart: 'treemap',
      availableCharts: ['treemap', 'bubble', 'table'],
      currentTotal: amount,
      projectedTotal: fiveYrInvest,
      currentSpare,
      projectedSpare: currentSpare + toEnjoy,
      deltaSpare: toEnjoy,
      billsStillDue,
      metrics: [
        { label: `Assets (${assetPct}%)`, after: fFull(toAssets), tone: 'good' },
        { label: `Guilt-free joy (${100 - assetPct}%)`, after: fFull(toEnjoy) },
        { label: '5-yr invested value', after: fShort(fiveYrInvest), tone: 'good' },
      ],
      treemap: {
        items: [
          { id: 'invest', label: 'Long-term Invest', value: toInvest, color: HUES[5].color, tint: HUES[5].tint, note: `5yr ≈ ${fShort(fiveYrInvest)}` },
          { id: 'emerg', label: 'Emergency Cushion', value: toEmergency, color: HUES[1].color, tint: HUES[1].tint, note: 'Safety runway' },
          { id: 'enjoy', label: 'Enjoy Guilt-Free', value: toEnjoy, color: HUES[0].color, tint: HUES[0].tint, note: `${100 - assetPct}% treat` },
        ],
      },
      bubble: {
        items: [
          { id: 'b_inv', label: 'Invest', value: toInvest, sub: fShort(toInvest), color: HUES[5].color, tint: HUES[5].tint },
          { id: 'b_em', label: 'Runway', value: toEmergency, sub: fShort(toEmergency), color: HUES[1].color, tint: HUES[1].tint },
          { id: 'b_joy', label: 'Joy', value: toEnjoy, sub: fShort(toEnjoy), color: HUES[0].color, tint: HUES[0].tint },
        ],
      },
      table: {
        columns: ['Split', 'To Assets', 'To Enjoy', '5-yr @ 8%'],
        rows: [50, 70, 80, 90].map(p => {
          const ast = Math.round(amount * (p / 100));
          const joy = amount - ast;
          return {
            id: `sp_${p}`,
            cells: [`${p}/${100 - p}`, fShort(ast), fShort(joy), fShort(opportunityCost(Math.round(ast * 0.6), 5, 0.08))],
            tone: p >= 70 ? 'good' : undefined,
            active: p === assetPct,
            specPatch: { assetPct: p },
          };
        }),
      },
      recommendedAction: baseSplit.toAssets > 0 ? { kind: 'pyf', investPct: Math.min(60, (settings.investPct ?? 10) + 5) } : undefined,
      summaryForPrompt: {
        kind: 'windfall_split',
        amount,
        assetPct,
        toAssets,
        toInvest,
        toEmergency,
        toEnjoy,
        fiveYrInvestValueAt8Pct: fiveYrInvest,
      },
    };
  }

  // ---- 9. Habit Compounding ----
  if (spec.kind === 'habit_compound') {
    const weekly = Math.max(1, Math.round(spec.weeklyAmount));
    const rate = Math.max(0.01, Math.min(0.2, spec.annualRate || 0.08));
    const monthly = Math.round((weekly * 52) / 12);
    const futureValue = (yrs: number) => {
      const n = yrs * 12;
      const rMo = rate / 12;
      return rMo > 0 ? Math.round(monthly * ((Math.pow(1 + rMo, n) - 1) / rMo)) : monthly * n;
    };
    const y1 = futureValue(1);
    const y3 = futureValue(3);
    const y5 = futureValue(5);

    return {
      spec,
      title: `${spec.label} (${fShort(weekly)}/week compounded)`,
      subtitle: `${fShort(monthly)}/mo invested at ${Math.round(rate * 100)}%/yr`,
      primaryChart: 'bubble',
      availableCharts: ['bubble', 'line', 'table'],
      currentTotal: weekly,
      projectedTotal: y5,
      currentSpare,
      projectedSpare: currentSpare + monthly,
      deltaSpare: monthly,
      billsStillDue,
      metrics: [
        { label: '1 year', after: fShort(y1) },
        { label: '3 years', after: fShort(y3), tone: 'good' },
        { label: '5 years', after: fShort(y5), tone: 'good' },
      ],
      bubble: {
        items: [
          { id: 'm1', label: '1 Month', value: monthly, sub: fShort(monthly), color: HUES[3].color, tint: HUES[3].tint },
          { id: 'y1', label: '1 Year', value: y1, sub: fShort(y1), color: HUES[1].color, tint: HUES[1].tint },
          { id: 'y3', label: '3 Years', value: y3, sub: fShort(y3), color: HUES[0].color, tint: HUES[0].tint },
          { id: 'y5', label: '5 Years', value: y5, sub: fShort(y5), color: HUES[5].color, tint: HUES[5].tint },
        ],
      },
      line: {
        xLabels: ['Now', 'Yr 1', 'Yr 2', 'Yr 3', 'Yr 4', 'Yr 5'],
        baseline: [0, 1, 2, 3, 4, 5].map(y => monthly * 12 * y),
        scenario: [0, 1, 2, 3, 4, 5].map(y => futureValue(y)),
        unit: 'currency',
      },
      table: {
        columns: ['Horizon', 'Raw saved', `Compounded (${Math.round(rate * 100)}%)`],
        rows: [1, 2, 3, 5].map(y => ({
          id: `y_${y}`,
          cells: [`${y} yr`, fShort(monthly * 12 * y), fShort(futureValue(y))],
          tone: y >= 3 ? 'good' : undefined,
        })),
      },
      summaryForPrompt: {
        kind: 'habit_compound',
        label: spec.label,
        weeklyAmount: weekly,
        monthlyAmount: monthly,
        annualRatePct: Math.round(rate * 100),
        value1Yr: y1,
        value3Yr: y3,
        value5Yr: y5,
      },
    };
  }

  // ---- 10. Freedom Ratio Path ----
  const monthlyInvest = Math.max(1, Math.round(spec.monthlyInvest));
  const yieldRate = Math.max(0.02, Math.min(0.18, spec.annualYield || 0.07));
  const curPortfolio = Math.round(wealth?.portfolioValue ?? 0);
  const curPassive = Math.round(wealth?.passiveMonthly ?? 0);
  const fixedFloor = Math.max(1, Math.round(budget.fixedSpent || budget.budget * 0.35));
  const requiredForFixed = Math.round((fixedFloor * 12) / yieldRate);
  const requiredForFull = Math.round((Math.max(1, Math.round(budget.budget)) * 12) / yieldRate);

  const yearsNeeded = (targetCap: number) => {
    const rMo = yieldRate / 12;
    let bal = curPortfolio;
    for (let m = 0; m <= 360; m++) {
      if (bal >= targetCap) return Math.round((m / 12) * 10) / 10;
      bal = bal * (1 + rMo) + monthlyInvest;
    }
    return 30;
  };
  const yrFixed = yearsNeeded(requiredForFixed);
  const yrFull = yearsNeeded(requiredForFull);

  const passiveAtYr = (y: number) => {
    const n = y * 12;
    const rMo = yieldRate / 12;
    const cap = curPortfolio * Math.pow(1 + rMo, n) + monthlyInvest * ((Math.pow(1 + rMo, n) - 1) / rMo);
    return Math.round((cap * yieldRate) / 12);
  };

  return {
    spec,
    title: isId ? 'Jalur Kebebasan Aset' : 'Asset Freedom & Passive Income Path',
    subtitle: `+${fShort(monthlyInvest)}/mo invested @ ${Math.round(yieldRate * 100)}% annual yield`,
    primaryChart: 'line',
    availableCharts: ['line', 'table'],
    currentTotal: curPortfolio,
    projectedTotal: requiredForFixed,
    currentSpare,
    projectedSpare: currentSpare,
    deltaSpare: 0,
    billsStillDue,
    metrics: [
      { label: 'Cover fixed bills', after: `${yrFixed} yrs`, delta: fShort(fixedFloor) + '/mo', tone: 'good' },
      { label: 'Full budget freedom', after: `${yrFull} yrs`, delta: fShort(Math.round(budget.budget)) + '/mo' },
      { label: 'Passive @ 5 yrs', after: fShort(passiveAtYr(5)) + '/mo', before: fShort(curPassive) + '/mo' },
    ],
    line: {
      xLabels: ['Now', 'Yr 2', 'Yr 4', 'Yr 6', 'Yr 8', 'Yr 10'],
      baseline: [0, 2, 4, 6, 8, 10].map(() => fixedFloor),
      scenario: [0, 2, 4, 6, 8, 10].map(y => passiveAtYr(y)),
      targetLine: { value: fixedFloor, label: `Fixed bills ${fShort(fixedFloor)}/mo` },
      unit: 'currency',
    },
    table: {
      columns: ['Annual yield', 'Capital needed (fixed)', 'Time to fixed freedom'],
      rows: [0.05, 0.07, 0.09].map(r => {
        const cap = Math.round((fixedFloor * 12) / r);
        const rMo = r / 12;
        let bal = curPortfolio;
        let m = 0;
        while (bal < cap && m < 360) {
          bal = bal * (1 + rMo) + monthlyInvest;
          m++;
        }
        return {
          id: `y_${r}`,
          cells: [`${Math.round(r * 100)}%`, fShort(cap), `${Math.round((m / 12) * 10) / 10} yrs`],
          tone: Math.abs(r - yieldRate) < 0.005 ? 'good' : undefined,
          active: Math.abs(r - yieldRate) < 0.005,
          specPatch: { annualYield: r },
        };
      }),
    },
    summaryForPrompt: {
      kind: 'freedom_path',
      monthlyInvest,
      annualYieldPct: Math.round(yieldRate * 100),
      fixedBillsFloor: fixedFloor,
      requiredPortfolioFixed: requiredForFixed,
      yearsToCoverFixed: yrFixed,
      yearsToFullFreedom: yrFull,
      passiveAt5Yrs: passiveAtYr(5),
    },
  };
}

/** Suppress lint for unused CATEGORIES import check when tree-shaking; also keeps all category metadata handy. */
export const WHATIF_CATEGORY_NAMES = CATEGORIES.map(c => c.name);
