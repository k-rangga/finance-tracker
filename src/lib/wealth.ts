/**
 * Pure financial-intelligence & behavioral saving engine combining:
 * 1. Rich Dad, Poor Dad (Kiyosaki & Lechter): Income Statement <-> Balance Sheet cash flow, Buckminster Fuller
 *    Survival Runway ("days forward"), Freedom Ratio ("Rat Race -> Fast Track"), Pay Yourself First & Fort Assets,
 *    Assets Buy Luxuries, Lifestyle Creep detection, Return of Capital ("Free-Roll"), and Noise vs. Analysis.
 * 2. Saving Behavior of the Millennial Generation in Jakarta (Pamungkas et al., IJAEB 2025; OCBC NISP 2023; BI 2024):
 *    Self-control impulse/lure defense (beta = 0.487), positive peer benchmarks & privacy-safe sharing (beta = 0.225),
 *    and reflective money-script awareness (beta = 0.178).
 */
import type { Budget, TxView } from './budget';
import { DAY, parseISO, sum } from './format';

// ---------------------------------------------------------------------------
// 1. Behavioral Self-Control & Impulse Triggers (Jakarta Study, beta = 0.487)
// ---------------------------------------------------------------------------

export type JoyVote = 'worth' | 'everyday' | 'skip';

export type ImpulseTrigger = 'promo' | 'fomo' | 'stress' | 'convenience' | 'peer';

export const IMPULSE_TRIGGERS: { key: ImpulseTrigger; label: string; short: string; hint: string }[] = [
  { key: 'promo', label: 'Promo / Flash sale', short: 'Promo', hint: 'Discount, voucher, or flash-sale lure' },
  { key: 'fomo', label: 'Social media / FOMO', short: 'FOMO', hint: 'Saw it online and bought in the moment' },
  { key: 'stress', label: 'Boredom / Stress', short: 'Stress', hint: 'Emotional comfort or tired-day treat' },
  { key: 'convenience', label: 'Easy checkout', short: 'Easy buy', hint: 'One-tap delivery or convenience habit' },
  { key: 'peer', label: 'Peer hangout', short: 'Social', hint: 'Keeping up with friends or group plans' },
];

export type JoyCheckEntry = {
  vote: JoyVote;
  trigger?: ImpulseTrigger;
  at: string;
};

export type ImpulseSummary = {
  skipCount: number;
  skipTotal: number;
  byTrigger: { key: ImpulseTrigger; label: string; count: number; total: number }[];
  topTrigger: { key: ImpulseTrigger; label: string; count: number; total: number } | null;
};

/** Summarize tagged "Could skip next time" spends and their impulse/lure triggers across a list of transactions. */
export function computeImpulseSummary(txs: Pick<TxView, 'id' | 'net' | 'isIncome' | 'isTransfer'>[], joyChecks: Record<string, JoyCheckEntry>): ImpulseSummary {
  let skipCount = 0;
  let skipTotal = 0;
  const map = new Map<ImpulseTrigger, { count: number; total: number }>();

  for (const t of txs) {
    if (t.isIncome || t.isTransfer || t.net <= 0) continue;
    const entry = joyChecks[t.id];
    if (!entry || entry.vote !== 'skip') continue;
    skipCount++;
    skipTotal += t.net;
    if (entry.trigger) {
      const cur = map.get(entry.trigger) ?? { count: 0, total: 0 };
      cur.count++;
      cur.total += t.net;
      map.set(entry.trigger, cur);
    }
  }

  const byTrigger = IMPULSE_TRIGGERS.map(meta => {
    const stat = map.get(meta.key);
    return stat ? { key: meta.key, label: meta.label, count: stat.count, total: stat.total } : null;
  })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => b.total - a.total || b.count - a.count);

  return {
    skipCount,
    skipTotal,
    byTrigger,
    topTrigger: byTrigger[0] ?? null,
  };
}

// ---------------------------------------------------------------------------
// 2. Jakarta / Indonesia Millennial Benchmarks & Privacy-Safe Cycle Flex
// ---------------------------------------------------------------------------

/** Empirical baselines from Pamungkas et al. (2025), OCBC NISP Financial Fitness Index (2023), and Bank Indonesia (2024). */
export const JAKARTA_BENCHMARKS = {
  /** Only 47% of Indonesian urban millennials (25-35) regularly save >= 20% of income. */
  savingRateTargetPct: 20,
  savingRatePeerPct: 47,
  /** Only 38% hold >= 6 months of emergency fund; 61.7% have no emergency fund at all. */
  emergencyMonthsTarget: 6,
  emergencyPeerPct: 38,
  noEmergencyFundPct: 61.7,
  /** Bank Indonesia May 2024 saving interest index (down from 19.8% in May 2023). */
  biSavingInterestPct: 15.4,
  /** 12% of urban millennials have monthly expenses exceeding income. */
  overspendingPeerPct: 12,
} as const;

export type BenchmarkCallout = {
  savingRateBeatingPeers: boolean;
  savingSummary: string;
  runwayBeatingPeers: boolean;
  runwaySummary: string;
};

export function evaluateBenchmarks(args: { savedPct: number; runwayMonths: number; emergencyFund: number; targetMonths?: number }): BenchmarkCallout {
  const targetM = Math.max(1, args.targetMonths ?? JAKARTA_BENCHMARKS.emergencyMonthsTarget);
  const saved = Math.round(args.savedPct);
  const savingRateBeatingPeers = saved >= JAKARTA_BENCHMARKS.savingRateTargetPct;
  const savingSummary = savingRateBeatingPeers
    ? `At ${saved}% saved, you're ahead of the 47% of Indonesian millennials who regularly save 20%+.`
    : `Target 20%+ saved to join the top 47% of urban millennials (currently ${saved}%).`;

  const runwayBeatingPeers = args.runwayMonths >= targetM;
  const runwaySummary =
    args.emergencyFund <= 0
      ? `61.7% of millennials lack an emergency fund — log yours to start tracking toward ${targetM} months.`
      : runwayBeatingPeers
        ? `${args.runwayMonths.toFixed(1)} months runway — ahead of the 38% who hold a full ${targetM}-month cushion.`
        : `${args.runwayMonths.toFixed(1)} of ${targetM} months saved (only 38% of urban millennials reach ${targetM} months).`;

  return { savingRateBeatingPeers, savingSummary, runwayBeatingPeers, runwaySummary };
}

/**
 * Privacy-safe percentage-only summary (zero currency amounts) for positive peer accountability
 * (Jakarta study: peer influence beta = 0.225).
 */
export function buildShareableFlexSummary(args: {
  cycleLabel: string;
  savedPct: number;
  zeroSpendDays: number;
  dayN: number;
  cycleDays: number;
  runwayMonths?: number;
  pyfStreak?: number;
  freedomPct?: number;
}): string {
  const lines = [
    `Maxie Cycle Check-In (${args.cycleLabel}, Day ${args.dayN}/${args.cycleDays})`,
    `• Savings rate: ${Math.round(args.savedPct)}%${args.savedPct >= 20 ? ' (20%+ benchmark hit)' : ''}`,
    `• Quiet zero-spend days: ${args.zeroSpendDays}`,
  ];
  if (args.pyfStreak && args.pyfStreak > 0) lines.push(`• Pay-Yourself-First streak: ${args.pyfStreak} ${args.pyfStreak === 1 ? 'cycle' : 'cycles'}`);
  if (args.runwayMonths && args.runwayMonths > 0) lines.push(`• Emergency runway: ${args.runwayMonths.toFixed(1)} months (${Math.round(args.runwayMonths * 30)} days forward)`);
  if (args.freedomPct && args.freedomPct > 0) lines.push(`• Asset freedom ratio: ${args.freedomPct.toFixed(1)}% of expenses covered by assets`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 3. Asset Cash Flows, Survival Runway & Unified Financial Statement (Rich Dad Ch. 3)
// ---------------------------------------------------------------------------

export type CashflowSource = 'dividend' | 'coupon' | 'interest' | 'rental' | 'staking' | 'side_business' | 'other';
export type CashflowEvery = 'monthly' | 'quarterly' | 'yearly' | 'once';

export const CASHFLOW_SOURCES: { key: CashflowSource; label: string }[] = [
  { key: 'dividend', label: 'Dividend' },
  { key: 'coupon', label: 'Bond / SBN coupon' },
  { key: 'interest', label: 'Deposit / HYSA interest' },
  { key: 'rental', label: 'Rental income' },
  { key: 'staking', label: 'Staking / Funding yield' },
  { key: 'side_business', label: 'Side business / Royalty' },
  { key: 'other', label: 'Other asset income' },
];

export type AssetCashflow = {
  id: string;
  label: string;
  source: CashflowSource;
  /** Amount in display currency per payout. */
  amount: number;
  every: CashflowEvery;
  /** Date received or started (YYYY-MM-DD). */
  date: string;
  /** Optional ticker (e.g. BBCA, SCHD, ETH) to credit toward Return-of-Capital on that position. */
  ticker?: string;
};

/** Normalize logged passive/asset cash flows into an annualized-then-monthly run rate (plus recent 30-day one-offs). */
export function monthlyAssetCashflow(flows: AssetCashflow[], todayISO: string): { monthly: number; annual: number; bySource: { source: CashflowSource; label: string; monthly: number }[] } {
  const today = parseISO(todayISO).getTime();
  const byMap = new Map<CashflowSource, number>();
  let monthly = 0;

  for (const f of flows) {
    if (!(f.amount > 0)) continue;
    let m = 0;
    if (f.every === 'monthly') m = f.amount;
    else if (f.every === 'quarterly') m = f.amount / 3;
    else if (f.every === 'yearly') m = f.amount / 12;
    else {
      // One-off payout counts in the monthly run-rate over the trailing 12 months (/12), or full if within 30d?
      // Averaging trailing 365 days by /12 avoids wild spikes while honoring real dividends.
      const ageDays = (today - parseISO(f.date).getTime()) / DAY;
      if (ageDays >= -1 && ageDays <= 365) m = f.amount / 12;
    }
    if (m > 0) {
      monthly += m;
      byMap.set(f.source, (byMap.get(f.source) ?? 0) + m);
    }
  }

  const bySource = CASHFLOW_SOURCES.map(s => {
    const val = byMap.get(s.key) ?? 0;
    return val > 0 ? { source: s.key, label: s.label, monthly: val } : null;
  })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => b.monthly - a.monthly);

  return { monthly, annual: monthly * 12, bySource };
}

export type FreedomStage = 'Building Foundation' | 'Gaining Traction' | 'Halfway Free' | 'Fast Track';
export type CashflowPattern = 'wealth_builder' | 'middle_class' | 'paycheck_to_paycheck';

export type WealthSnapshot = {
  /** Active work income (configured income or salary received). */
  activeIncome: number;
  /** Monthly passive/asset cash flow normalized across all logged asset cash flows. */
  passiveMonthly: number;
  passiveAnnual: number;
  passiveBySource: { source: CashflowSource; label: string; monthly: number }[];
  /** Baseline monthly expenses (projected or budgeted). */
  monthlyExpenses: number;
  /** Essential monthly burn (fixed bills + 65% of everyday plan, floored cleanly). */
  essentialMonthly: number;
  /** Liquid emergency fund balance (display currency). */
  emergencyFund: number;
  emergencyTargetMonths: number;
  emergencyTargetAmount: number;
  /** Buckminster Fuller Survival Runway: months and days forward if active income stopped today. */
  runwayMonths: number;
  runwayDays: number;
  runwayPct: number;
  /** Kiyosaki Freedom Ratio: Monthly Passive Cash Flow / Monthly Expenses (%). >=100% = Fast Track! */
  freedomPct: number;
  freedomStage: FreedomStage;
  freedomGapMonthly: number;
  /** Balance Sheet: Productive Assets vs Liabilities. */
  portfolioValue: number;
  assetsTotal: number;
  cardLiabilities: number;
  installmentLiabilities: number;
  liabilitiesTotal: number;
  netProductiveWealth: number;
  /** Ratio of monthly debt payments (installments + CC carried over) vs monthly asset additions (saved + invested). */
  monthlyDebtService: number;
  monthlyAssetAdded: number;
  debtToAssetPct: number;
  cashflowPattern: CashflowPattern;
  /** Optional Give First allocation amount this cycle. */
  giveFirstAmount: number;
};

export function computeWealthSnapshot(args: {
  budget: Pick<Budget, 'income' | 'incomeReceived' | 'budget' | 'fixedSpent' | 'varBudget' | 'spent' | 'projTotal' | 'saved' | 'invested' | 'cards'>;
  emergencyFund: number;
  emergencyTargetMonths?: number;
  portfolioValue: number;
  installmentLiabilities: number;
  monthlyInstallments: number;
  assetCashflows: AssetCashflow[];
  todayISO: string;
  giveFirstPct?: number;
}): WealthSnapshot {
  const { budget: b, portfolioValue, installmentLiabilities, monthlyInstallments, assetCashflows, todayISO } = args;
  const emergencyFund = Math.max(0, args.emergencyFund || 0);
  const emergencyTargetMonths = Math.max(1, Math.min(24, args.emergencyTargetMonths ?? JAKARTA_BENCHMARKS.emergencyMonthsTarget));

  const activeIncome = Math.max(b.income, b.incomeReceived);
  const cf = monthlyAssetCashflow(assetCashflows, todayISO);
  const monthlyExpenses = Math.max(1, b.budget > 0 ? Math.max(b.budget, b.projTotal) : b.projTotal || b.spent || b.income * 0.6);
  const fixedBase = Math.max(b.fixedSpent, b.budget - b.varBudget);
  const essentialMonthly = Math.max(1, fixedBase + b.varBudget * 0.65);

  const runwayMonths = emergencyFund > 0 ? emergencyFund / essentialMonthly : 0;
  const runwayDays = Math.round(runwayMonths * 30);
  const emergencyTargetAmount = essentialMonthly * emergencyTargetMonths;
  const runwayPct = Math.min(100, (runwayMonths / emergencyTargetMonths) * 100);

  const freedomPct = monthlyExpenses > 0 ? (cf.monthly / monthlyExpenses) * 100 : 0;
  const freedomStage: FreedomStage =
    freedomPct >= 100 ? 'Fast Track' : freedomPct >= 50 ? 'Halfway Free' : freedomPct >= 10 ? 'Gaining Traction' : 'Building Foundation';
  const freedomGapMonthly = Math.max(0, monthlyExpenses - cf.monthly);

  const cardLiabilities = sum(b.cards.map(c => Math.max(0, c.owed)));
  const liabilitiesTotal = cardLiabilities + Math.max(0, installmentLiabilities);
  const assetsTotal = emergencyFund + Math.max(0, portfolioValue);
  const netProductiveWealth = assetsTotal - liabilitiesTotal;

  const monthlyDebtService = Math.max(0, monthlyInstallments) + sum(b.cards.map(c => Math.max(0, c.carriedOver)));
  const monthlyAssetAdded = Math.max(0, b.saved + b.invested);
  const debtToAssetPct = monthlyAssetAdded > 0 ? (monthlyDebtService / monthlyAssetAdded) * 100 : monthlyDebtService > 0 ? 999 : 0;

  let cashflowPattern: CashflowPattern = 'middle_class';
  if (b.projTotal > activeIncome && activeIncome > 0) {
    cashflowPattern = 'paycheck_to_paycheck';
  } else if (monthlyAssetAdded >= monthlyDebtService && (b.saved + b.invested >= activeIncome * 0.2 || freedomPct >= 10)) {
    cashflowPattern = 'wealth_builder';
  }

  const giveFirstAmount = args.giveFirstPct && args.giveFirstPct > 0 ? (args.giveFirstPct / 100) * activeIncome : 0;

  return {
    activeIncome,
    passiveMonthly: cf.monthly,
    passiveAnnual: cf.annual,
    passiveBySource: cf.bySource,
    monthlyExpenses,
    essentialMonthly,
    emergencyFund,
    emergencyTargetMonths,
    emergencyTargetAmount,
    runwayMonths,
    runwayDays,
    runwayPct,
    freedomPct,
    freedomStage,
    freedomGapMonthly,
    portfolioValue: Math.max(0, portfolioValue),
    assetsTotal,
    cardLiabilities,
    installmentLiabilities: Math.max(0, installmentLiabilities),
    liabilitiesTotal,
    netProductiveWealth,
    monthlyDebtService,
    monthlyAssetAdded,
    debtToAssetPct,
    cashflowPattern,
    giveFirstAmount,
  };
}

// ---------------------------------------------------------------------------
// 4. Pay Yourself First, Fort Assets Dip & Lifestyle Creep (Rich Dad Ch. 3, 8, 9)
// ---------------------------------------------------------------------------

export type PayYourselfFirstRecord = {
  savedDone?: boolean;
  investedDone?: boolean;
  completedAt?: string;
};

/** Count consecutive pay cycles (ending with the current cycle if complete, or the previous one) where Pay Yourself First was completed. */
export function computePayYourselfFirstStreak(
  records: Record<string, PayYourselfFirstRecord>,
  currentCycleKey: string,
  currentComplete: boolean,
): number {
  const keys = Object.keys(records).sort().reverse();
  let streak = currentComplete ? 1 : 0;
  for (const k of keys) {
    if (k >= currentCycleKey) continue;
    const r = records[k];
    if (r && r.savedDone && r.investedDone) streak++;
    else break;
  }
  return streak;
}

export type FortAssetsAlert = {
  dipped: boolean;
  reason: string;
  amount: number;
};

/** Detect "Dipping into savings" (Rich Dad Ch. 9): spending past income/budget while savings = 0, or explicit withdrawal markers. */
export function detectFortAssetsDip(args: {
  txs: Pick<TxView, 'title' | 'cat' | 'amount' | 'isIncome' | 'isTransfer'>[];
  spent: number;
  budget: number;
  income: number;
  saved: number;
  dayN: number;
}): FortAssetsAlert | null {
  // Check for transfers/incomes explicitly labelled as coming from savings/rdn/emergency fund to pay bills.
  const dipRe = /\b(tarik|withdraw|pencairan|from savings|dari tabungan|dana darurat|emergency fund|cairkan|rdn)\b/i;
  const dipTxs = args.txs.filter(t => dipRe.test(t.title) && (t.isTransfer || t.isIncome));
  if (dipTxs.length > 0) {
    const amount = sum(dipTxs.map(t => Math.abs(t.amount)));
    return {
      dipped: true,
      amount,
      reason: `Detected ${dipTxs.length} withdrawal-like transfer${dipTxs.length === 1 ? '' : 's'} — defend Fort Assets and keep savings working for you.`,
    };
  }
  if (args.dayN >= 10 && args.income > 0 && args.spent > args.income && args.saved <= 0) {
    return {
      dipped: true,
      amount: args.spent - args.income,
      reason: `Spending has passed your cycle income with nothing moved to savings yet — pause and protect your reserves.`,
    };
  }
  return null;
}

export type LifestyleCreepSignal = {
  detected: boolean;
  incomeDelta: number;
  expenseDelta: number;
  /** Share of the income increase that went straight into higher expenses (%). */
  expenseCapturePct: number;
  message: string;
};

/** Detect Rich Dad "Middle-Class Rat Race" lifestyle creep: when income increases, expenses climb right beside it. */
export function detectLifestyleCreep(args: {
  currentIncome: number;
  prevIncome: number;
  currentExpenses: number;
  prevExpenses: number;
}): LifestyleCreepSignal | null {
  if (!(args.prevIncome > 0) || !(args.prevExpenses > 0)) return null;
  const incomeDelta = args.currentIncome - args.prevIncome;
  const expenseDelta = args.currentExpenses - args.prevExpenses;
  // Trigger when income increased meaningfully (>= 5%) and expenses absorbed >= 65% of that raise/windfall.
  if (incomeDelta >= args.prevIncome * 0.05 && expenseDelta > 0) {
    const capture = (expenseDelta / incomeDelta) * 100;
    if (capture >= 65) {
      return {
        detected: true,
        incomeDelta,
        expenseDelta,
        expenseCapturePct: Math.round(capture),
        message: `Expenses absorbed ${Math.round(capture)}% of your income bump — route raises and bonuses into assets first to stay out of the Rat Race.`,
      };
    }
  }
  return null;
}

/** 70/30 Asset-First Windfall Split for extra inflows (Bonus, THR, Freelance): 70% into Savings/Investing, 30% max to enjoy. */
export function computeWindfallSplit(extraTotal: number, investShareOfSavings = 0.6): { toAssets: number; toInvest: number; toEmergency: number; toEnjoy: number } {
  const clean = Math.max(0, extraTotal);
  const toAssets = Math.round(clean * 0.7);
  const toInvest = Math.round(toAssets * Math.max(0, Math.min(1, investShareOfSavings)));
  const toEmergency = Math.max(0, toAssets - toInvest);
  const toEnjoy = Math.max(0, clean - toAssets);
  return { toAssets, toInvest, toEmergency, toEnjoy };
}

// ---------------------------------------------------------------------------
// 5. "Assets Buy Luxuries" Cooling-Off Wishlist (Rich Dad Ch. 4 & 9 + Self-Control)
// ---------------------------------------------------------------------------

export type WishlistStatus = 'cooling' | 'ready' | 'bought' | 'skipped';

export type WishlistItem = {
  id: string;
  name: string;
  amount: number;
  addedAt: string; // YYYY-MM-DD
  coolDays: number; // e.g. 3 (72h), 14, 30
  fundingMode: 'assets' | 'surplus';
  status: WishlistStatus;
  note?: string;
};

export type WishlistEval = {
  item: WishlistItem;
  daysWaited: number;
  daysLeft: number;
  cooledDown: boolean;
  /** 5-year compounded value at 8%/yr if invested instead of spent. */
  opportunityCost5Yr: number;
  /** Cycles needed for passive cash flow (or 8% yield on portfolio) to buy this without touching principal. */
  cyclesViaAssets: number | null;
  /** Cycles needed from lean-mode (-15% everyday) surplus to pay cash without debt. */
  cyclesViaLean: number | null;
};

/** 5-year opportunity cost of spending `amount` today vs compounding it at `annualRate` (default 8%). */
export function opportunityCost(amount: number, years = 5, annualRate = 0.08): number {
  if (!(amount > 0)) return 0;
  return Math.round(amount * Math.pow(1 + annualRate, years));
}

export function evaluateWishlistItem(
  item: WishlistItem,
  args: { todayISO: string; monthlyPassiveCashflow: number; monthlyLeanSurplus: number; portfolioValue: number },
): WishlistEval {
  const daysWaited = Math.max(0, Math.round((parseISO(args.todayISO).getTime() - parseISO(item.addedAt).getTime()) / DAY));
  const daysLeft = Math.max(0, item.coolDays - daysWaited);
  const cooledDown = daysLeft === 0;
  // Asset cash flow capacity: logged passive cash flow, or fallback to conservative 8%/yr portfolio return.
  const assetMonthly = args.monthlyPassiveCashflow > 0 ? args.monthlyPassiveCashflow : (args.portfolioValue * 0.08) / 12;
  const cyclesViaAssets = assetMonthly > 0 ? Math.max(1, Math.ceil(item.amount / assetMonthly)) : null;
  const cyclesViaLean = args.monthlyLeanSurplus > 0 ? Math.max(1, Math.ceil(item.amount / args.monthlyLeanSurplus)) : null;

  return {
    item,
    daysWaited,
    daysLeft,
    cooledDown,
    opportunityCost5Yr: opportunityCost(item.amount, 5, 0.08),
    cyclesViaAssets,
    cyclesViaLean,
  };
}

// ---------------------------------------------------------------------------
// 6. Rich Dad Investing Helpers: Return of Capital & Noise vs. Analysis
// ---------------------------------------------------------------------------

export type TradeIdeaSource = 'analysis' | 'catalyst' | 'tip' | 'social';

export const IDEA_SOURCES: { key: TradeIdeaSource; label: string; group: 'analysis' | 'noise' }[] = [
  { key: 'analysis', label: 'Own analysis', group: 'analysis' },
  { key: 'catalyst', label: 'Fundamental / Catalyst', group: 'analysis' },
  { key: 'tip', label: 'Friend / Group tip', group: 'noise' },
  { key: 'social', label: 'Social media / News', group: 'noise' },
];

export type CapitalRecovery = {
  initialCost: number;
  recoveredFromTrims: number;
  recoveredFromCashflow: number;
  totalRecovered: number;
  recoveredPct: number;
  isFreeRoll: boolean;
};

/**
 * Rich Dad Step 7 ("Return of Investment / Free-Roll Asset"):
 * Measures what % of your initial capital has already been pulled back via partial profit-taking (`trim`)
 * and dividends/yields linked to this ticker. Once >= 100%, the remaining position is a "Free-Roll Asset".
 */
export function computeReturnOfCapital(args: {
  initialCostDisplay: number;
  recoveredFromTrimsDisplay: number;
  ticker: string;
  assetCashflows: AssetCashflow[];
}): CapitalRecovery {
  const tk = args.ticker.trim().toUpperCase();
  const recoveredFromCashflow = sum(
    args.assetCashflows
      .filter(f => f.ticker && f.ticker.trim().toUpperCase() === tk)
      .map(f => Math.max(0, f.amount)),
  );
  const recoveredFromTrims = Math.max(0, args.recoveredFromTrimsDisplay);
  const totalRecovered = recoveredFromTrims + recoveredFromCashflow;
  const initialCost = Math.max(0, args.initialCostDisplay);
  const recoveredPct = initialCost > 0 ? (totalRecovered / initialCost) * 100 : 0;
  return {
    initialCost,
    recoveredFromTrims,
    recoveredFromCashflow,
    totalRecovered,
    recoveredPct,
    isFreeRoll: initialCost > 0 && recoveredPct >= 100,
  };
}

export type NoiseVsAnalysisRow = {
  group: 'Own analysis' | 'Tips & social noise';
  trades: number;
  wins: number;
  winRate: number;
  pnl: number;
};

/** Compare closed trades originated by Own Analysis/Catalyst vs Tips/Social Noise (Rich Dad Ch. 8). */
export function evaluateNoiseVsAnalysis(
  closedTrades: { id: string; pnl: number }[],
  tradeSources: Record<string, TradeIdeaSource>,
): NoiseVsAnalysisRow[] {
  const buckets: Record<'analysis' | 'noise', { trades: number; wins: number; pnl: number }> = {
    analysis: { trades: 0, wins: 0, pnl: 0 },
    noise: { trades: 0, wins: 0, pnl: 0 },
  };
  for (const t of closedTrades) {
    const src = tradeSources[t.id];
    if (!src) continue;
    const meta = IDEA_SOURCES.find(x => x.key === src);
    if (!meta) continue;
    const b = buckets[meta.group];
    b.trades++;
    if (t.pnl > 0) b.wins++;
    b.pnl += t.pnl;
  }
  const out: NoiseVsAnalysisRow[] = [];
  if (buckets.analysis.trades > 0) {
    out.push({
      group: 'Own analysis',
      trades: buckets.analysis.trades,
      wins: buckets.analysis.wins,
      winRate: (buckets.analysis.wins / buckets.analysis.trades) * 100,
      pnl: buckets.analysis.pnl,
    });
  }
  if (buckets.noise.trades > 0) {
    out.push({
      group: 'Tips & social noise',
      trades: buckets.noise.trades,
      wins: buckets.noise.wins,
      winRate: (buckets.noise.wins / buckets.noise.trades) * 100,
      pnl: buckets.noise.pnl,
    });
  }
  return out;
}
