/**
 * Unit tests for src/lib/wealth.ts covering Rich Dad, Poor Dad + Jakarta Millennial Saving Behavior calculations.
 * Run with `npm run test:wealth`.
 */
import assert from 'node:assert/strict';
import {
  buildShareableFlexSummary,
  computeImpulseSummary,
  computePayYourselfFirstStreak,
  computeReturnOfCapital,
  computeWealthSnapshot,
  computeWindfallSplit,
  detectFortAssetsDip,
  detectLifestyleCreep,
  evaluateBenchmarks,
  evaluateNoiseVsAnalysis,
  evaluateWishlistItem,
  monthlyAssetCashflow,
  opportunityCost,
  type AssetCashflow,
  type WishlistItem,
} from './wealth';
import { effectiveTrade, positionHistory, totalBoughtCostOf, trimmedProceedsOf, type Trade, type TradeUpdate } from '../screens/invest/model';

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log('ok  ', name);
};

test('aggregates impulse skip triggers accurately and ignores income/transfers', () => {
  const txs = [
    { id: 't1', net: 250_000, isIncome: false, isTransfer: false },
    { id: 't2', net: 450_000, isIncome: false, isTransfer: false },
    { id: 't3', net: 150_000, isIncome: false, isTransfer: false },
    { id: 't4', net: 500_000, isIncome: false, isTransfer: true },
  ];
  const res = computeImpulseSummary(txs, {
    t1: { vote: 'skip', trigger: 'promo', at: '2026-11-25' },
    t2: { vote: 'skip', trigger: 'fomo', at: '2026-11-26' },
    t3: { vote: 'worth', at: '2026-11-26' },
    t4: { vote: 'skip', trigger: 'promo', at: '2026-11-26' },
  });
  assert.equal(res.skipCount, 2);
  assert.equal(res.skipTotal, 700_000);
  assert.equal(res.topTrigger?.key, 'fomo');
  assert.equal(res.topTrigger?.total, 450_000);
  assert.equal(res.byTrigger.length, 2);
});

test('evaluates Jakarta millennial benchmarks and builds privacy-safe flex text', () => {
  const b = evaluateBenchmarks({ savedPct: 28, runwayMonths: 6.5, emergencyFund: 90_000_000, targetMonths: 6 });
  assert.equal(b.savingRateBeatingPeers, true);
  assert.equal(b.runwayBeatingPeers, true);
  assert.match(b.savingSummary, /47%/);
  assert.match(b.runwaySummary, /38%/);

  const flex = buildShareableFlexSummary({
    cycleLabel: 'Nov – Dec',
    savedPct: 28,
    zeroSpendDays: 6,
    dayN: 12,
    cycleDays: 30,
    runwayMonths: 6.5,
    pyfStreak: 3,
    freedomPct: 14.2,
  });
  // Must contain percentages/metrics and never leak Rupiah currency amounts.
  assert.match(flex, /28%/);
  assert.match(flex, /6\.5 months/);
  assert.match(flex, /14\.2%/);
  assert.equal(/Rp|IDR|\$/i.test(flex), false);
});

test('normalizes monthly, quarterly, yearly, and recent one-off asset cash flows', () => {
  const flows: AssetCashflow[] = [
    { id: '1', label: 'RDPU interest', source: 'interest', amount: 500_000, every: 'monthly', date: '2026-11-01' },
    { id: '2', label: 'SCHD dividend', source: 'dividend', amount: 1_200_000, every: 'quarterly', date: '2026-10-15', ticker: 'SCHD' },
    { id: '3', label: 'BBCA dividend', source: 'dividend', amount: 6_000_000, every: 'yearly', date: '2026-04-01', ticker: 'BBCA' },
    { id: '4', label: 'One-off yield', source: 'staking', amount: 1_200_000, every: 'once', date: '2026-11-10' },
  ];
  const res = monthlyAssetCashflow(flows, '2026-11-28');
  // 500k + 400k + 500k + 100k = 1,500,000 / month
  assert.equal(Math.round(res.monthly), 1_500_000);
  assert.equal(Math.round(res.annual), 18_000_000);
  assert.equal(res.bySource[0].source, 'dividend');
});

test('computes unified WealthSnapshot: Survival Runway, Freedom Ratio, and Balance Sheet', () => {
  const snap = computeWealthSnapshot({
    budget: {
      income: 30_000_000,
      incomeReceived: 30_000_000,
      budget: 12_000_000,
      fixedSpent: 5_000_000,
      varBudget: 7_000_000,
      spent: 8_000_000,
      projTotal: 11_000_000,
      saved: 10_000_000,
      invested: 6_000_000,
      cards: [{ account: 'CC BCA', spent: 2_000_000, lastBill: 0, paid: 0, paidOn: null, carriedOver: 0, owed: 2_000_000, paidInFull: true, installments: 0 }],
    },
    emergencyFund: 60_000_000,
    emergencyTargetMonths: 6,
    portfolioValue: 150_000_000,
    installmentLiabilities: 8_000_000,
    monthlyInstallments: 1_000_000,
    assetCashflows: [
      { id: 'a1', label: 'Dividends', source: 'dividend', amount: 2_400_000, every: 'monthly', date: '2026-11-01' },
    ],
    todayISO: '2026-11-28',
    giveFirstPct: 2.5,
  });

  // Essential monthly = 5M fixed + 65% of 7M var = 9.55M -> 60M / 9.55M = ~6.28 months
  assert.ok(snap.runwayMonths > 6.2 && snap.runwayMonths < 6.4);
  assert.equal(snap.runwayPct, 100);
  // Freedom ratio: 2.4M / 12M = 20% -> Gaining Traction
  assert.equal(Math.round(snap.freedomPct), 20);
  assert.equal(snap.freedomStage, 'Gaining Traction');
  assert.equal(snap.assetsTotal, 210_000_000);
  assert.equal(snap.liabilitiesTotal, 10_000_000);
  assert.equal(snap.netProductiveWealth, 200_000_000);
  assert.equal(snap.cashflowPattern, 'wealth_builder');
  assert.equal(snap.giveFirstAmount, 750_000);
});

test('tracks Pay Yourself First streak, Fort Assets dip, Lifestyle Creep, and 70/30 windfall split', () => {
  const streak = computePayYourselfFirstStreak(
    {
      '2026-08-25': { savedDone: true, investedDone: false },
      '2026-09-25': { savedDone: true, investedDone: true },
      '2026-10-25': { savedDone: true, investedDone: true },
    },
    '2026-11-25',
    true,
  );
  assert.equal(streak, 3);

  const dip = detectFortAssetsDip({
    txs: [{ title: 'Tarik Dana Darurat ke BCA', cat: 'Transfer', amount: 3_000_000, isIncome: false, isTransfer: true }],
    spent: 10_000_000,
    budget: 12_000_000,
    income: 25_000_000,
    saved: 0,
    dayN: 12,
  });
  assert.equal(dip?.dipped, true);
  assert.equal(dip?.amount, 3_000_000);

  const creep = detectLifestyleCreep({
    currentIncome: 35_000_000,
    prevIncome: 30_000_000,
    currentExpenses: 16_000_000,
    prevExpenses: 12_000_000,
  });
  assert.equal(creep?.detected, true);
  assert.equal(creep?.expenseCapturePct, 80);

  const split = computeWindfallSplit(10_000_000, 0.6);
  assert.equal(split.toAssets, 7_000_000);
  assert.equal(split.toInvest, 4_200_000);
  assert.equal(split.toEmergency, 2_800_000);
  assert.equal(split.toEnjoy, 3_000_000);
});

test('evaluates Assets Buy Luxuries cooling-off wishlist and 5-year opportunity cost', () => {
  const item: WishlistItem = {
    id: 'w1',
    name: 'Espresso Machine',
    amount: 10_000_000,
    addedAt: '2026-11-26',
    coolDays: 7,
    fundingMode: 'assets',
    status: 'cooling',
  };
  const ev = evaluateWishlistItem(item, {
    todayISO: '2026-11-28',
    monthlyPassiveCashflow: 2_000_000,
    monthlyLeanSurplus: 2_500_000,
    portfolioValue: 100_000_000,
  });
  assert.equal(ev.daysWaited, 2);
  assert.equal(ev.daysLeft, 5);
  assert.equal(ev.cooledDown, false);
  assert.equal(ev.cyclesViaAssets, 5);
  assert.equal(ev.cyclesViaLean, 4);
  assert.equal(ev.opportunityCost5Yr, opportunityCost(10_000_000, 5, 0.08));
  assert.ok(ev.opportunityCost5Yr > 14_600_000);
});

test('computes Return of Capital (Free-Roll) and Noise vs. Analysis stats', () => {
  const roc = computeReturnOfCapital({
    initialCostDisplay: 20_000_000,
    recoveredFromTrimsDisplay: 18_000_000,
    ticker: 'BBCA',
    assetCashflows: [
      { id: 'd1', label: 'BBCA Div', source: 'dividend', amount: 2_500_000, every: 'yearly', date: '2026-04-10', ticker: 'bbca' },
    ],
  });
  assert.equal(roc.isFreeRoll, true);
  assert.ok(roc.recoveredPct > 102);

  const nva = evaluateNoiseVsAnalysis(
    [
      { id: 't1', pnl: 3_000_000 },
      { id: 't2', pnl: 1_500_000 },
      { id: 't3', pnl: -2_000_000 },
      { id: 't4', pnl: -500_000 },
    ],
    { t1: 'analysis', t2: 'catalyst', t3: 'social', t4: 'tip' },
  );
  assert.equal(nva.length, 2);
  assert.equal(nva[0].group, 'Own analysis');
  assert.equal(nva[0].winRate, 100);
  assert.equal(nva[1].group, 'Tips & social noise');
  assert.equal(nva[1].pnl, -2_500_000);
});

test('handles partial profit-take trims without altering avg buy price and credits Free-Roll recovery', () => {
  const trade: Trade = {
    id: 't_bbca',
    mk: 'IDX',
    tk: 'BBCA',
    nm: 'Bank Central Asia',
    d: '2026-01-10',
    px: 9_000,
    q: 2_000, // 20 lots = Rp 18M
    fee: 27_000,
    st: 'Long-term',
    cv: 5,
    th: 'Core compounder',
  };
  const updates: TradeUpdate[] = [
    { id: 'u1', tradeId: 't_bbca', at: '2026-03-01T10:00:00Z', kind: 'avg_down', px: 8_000, q: 1_000, fee: 12_000 }, // 10 lots @ 8000 -> total 30 lots @ 8666.67
    { id: 'u2', tradeId: 't_bbca', at: '2026-08-01T10:00:00Z', kind: 'trim', px: 14_000, q: 2_000, fee: 70_000 }, // sell 20 lots -> net 27.93M > 26.039M initial cost!
  ];
  const hist = positionHistory(trade, updates);
  assert.equal(hist.length, 2);
  assert.equal(hist[0].after.q, 3_000);
  assert.equal(hist[1].after.q, 1_000);
  assert.ok(Math.abs(hist[1].after.avg - hist[0].after.avg) < 0.01);

  const eff = effectiveTrade(trade, updates);
  assert.equal(eff.q, 1_000);
  assert.ok(Math.abs(eff.px - 26_000_000 / 3_000) < 0.01);

  const initialCost = totalBoughtCostOf(trade, updates);
  const recovered = trimmedProceedsOf(trade, updates);
  assert.equal(initialCost, 26_039_000);
  assert.equal(recovered, 27_930_000);

  const roc = computeReturnOfCapital({
    initialCostDisplay: initialCost,
    recoveredFromTrimsDisplay: recovered,
    ticker: 'BBCA',
    assetCashflows: [],
  });
  assert.equal(roc.isFreeRoll, true);
  assert.ok(roc.recoveredPct > 107);
});

console.log(`\nall passed (${passed})`);
