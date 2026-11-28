/**
 * Unit tests for src/lib/whatIf.ts covering all 10 hypothetical projection scenarios, exact billsStillDue math,
 * all 5 chart payloads (line, bar, treemap, bubble, table), and safe category spending pocket adjustments.
 * Run with `npm run test:whatif`.
 */
import assert from 'node:assert/strict';
import { computeBudget } from './budget';
import { getCycle } from './cycle';
import { addDays } from './format';
import { DEFAULT_SETTINGS, type Settings } from './settings';
import type { Transaction } from '../data/transactions';
import type { Bill } from '../data/transactions';
import { parseAmountToken, parseWhatIfPrompt, simulateWhatIf, suggestPocketAdjustments } from './whatIf';

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log('ok  ', name);
};

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  income: 25_000_000,
  savingsPct: 30,
  investPct: 10,
  emergencyFund: 30_000_000,
  emergencyTargetMonths: 6,
};

const today = new Date(2026, 10, 28, 12, 15, 0); // Day 4 of 30, 26 days to go (26 remaining daysLeft+1? Let's verify exact cycle math)
const cycle = getCycle(today);
const prevCycle = getCycle(addDays(cycle.start, -1));

const txs: Transaction[] = [
  { id: '1', title: 'Grand Lucky', category: 'Groceries', date: new Date(2026, 10, 26, 10, 0), time: '10:00', amount: 450_000, account: 'BCA', source: 'Bank email' },
  { id: '2', title: 'Saladstop', category: 'Dining', date: new Date(2026, 10, 27, 12, 0), time: '12:00', amount: 300_000, account: 'BCA', source: 'Bank email' },
  { id: '3', title: 'Kopi Kenangan', category: 'Cafe', date: new Date(2026, 10, 28, 9, 0), time: '09:00', amount: 90_000, account: 'BCA', source: 'Bank email' },
];

const bills: Bill[] = [
  { title: 'Apartment Rent', category: 'Housing', amount: 5_000_000, date: new Date(2026, 11, 1, 0, 0), account: 'BCA', source: 'Recurring' },
];

const budget = computeBudget({
  cycle,
  prevCycle,
  transactions: txs,
  prevTransactions: [],
  bills,
  recat: {},
  links: {},
  shares: {},
  warnAt: 80,
  income: settings.income,
});

test('parseAmountToken parses k, rb, jt, juta, and grouped Rupiah cleanly', () => {
  assert.equal(parseAmountToken('300k'), 300_000);
  assert.equal(parseAmountToken('300rb'), 300_000);
  assert.equal(parseAmountToken('1.5m'), 1_500_000);
  assert.equal(parseAmountToken('1,5jt'), 1_500_000);
  assert.equal(parseAmountToken('Rp 350.000'), 350_000);
});

test('daily_cap simulation strictly includes billsStillDue (preventing LLM math error)', () => {
  const spec = parseWhatIfPrompt('give me projection to spare if i capped my spending on 300k per day', budget, settings);
  assert.ok(spec && spec.kind === 'daily_cap');
  assert.equal(spec.dailyAmount, 300_000);

  const res = simulateWhatIf(spec, { cycle, budget, settings });
  const daysRem = cycle.daysLeft + 1;
  const expectedTotal = Math.round(budget.spent + budget.fixedDue + 300_000 * daysRem);
  assert.equal(res.billsStillDue, 5_000_000);
  assert.equal(res.projectedTotal, expectedTotal);
  assert.equal(res.projectedSpare, Math.round(budget.budget - expectedTotal));
  assert.equal(res.primaryChart, 'line');
  assert.ok(res.line && res.bar && res.table);
  assert.ok(res.suggestedPockets && res.suggestedPockets.length > 0);
});

test('all 10 scenarios parse cleanly and emit all 5 chart types across the suite', () => {
  const prompts = [
    'what if weekday 150k and weekend 350k',
    'what if i do 5 zero spend days this cycle',
    'what if i cut Dining 30%',
    'what if i buy iPad 9m cash vs 6x cicilan',
    'when do i hit 6 months emergency fund if i add 3m per month',
    'stress test if income drops 25%',
    'what if i get 12m bonus windfall',
    'what if i skip coffee 150k per week and compound it',
    'what if i invest 4m a month for financial freedom ratio',
  ];
  const seenCharts = new Set<string>();
  for (const p of prompts) {
    const spec = parseWhatIfPrompt(p, budget, settings);
    assert.ok(spec, `Expected spec for prompt: ${p}`);
    const res = simulateWhatIf(spec, { cycle, budget, settings });
    seenCharts.add(res.primaryChart);
    for (const c of res.availableCharts) seenCharts.add(c);
  }
  assert.ok(seenCharts.has('line'));
  assert.ok(seenCharts.has('bar'));
  assert.ok(seenCharts.has('treemap'));
  assert.ok(seenCharts.has('bubble'));
  assert.ok(seenCharts.has('table'));
});

test('suggestPocketAdjustments never cuts below already-spent amount', () => {
  const adj = suggestPocketAdjustments(budget, settings, -10_000_000);
  for (const p of adj) {
    assert.ok(p.nextLimit >= p.spent, `${p.category} limit ${p.nextLimit} dropped below spent ${p.spent}`);
    assert.ok(p.nextPct >= 0);
  }
});

console.log(`\nall passed (${passed})`);
