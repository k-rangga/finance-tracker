/**
 * Unit tests for Ask Maxie context awareness (weekday/weekend, local time, today budget) and 60% auto-compaction math.
 * Run with `npm run test:chat`.
 */
import assert from 'node:assert/strict';
import { getCycle } from './cycle';
import { addDays } from './format';
import { computeBudget } from './budget';
import { DEFAULT_SETTINGS, type Settings } from './settings';
import type { Transaction } from '../data/transactions';
import {
  AUTO_COMPACT_THRESHOLD_PCT,
  CHAT_CONTEXT_BUDGET_TOKENS,
  buildLocalCompactedSummary,
  chatContext,
  estimateChatContextUsage,
  shouldUseDeepMode,
  type ChatMessage,
} from './chat';

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log('ok  ', name);
};

const baseSettings: Settings = {
  ...DEFAULT_SETTINGS,
  name: 'Rangga',
  income: 25_000_000,
  savingsPct: 30,
  investPct: 10,
  city: 'Jakarta Selatan',
  maxieLanguage: 'en',
};

const makeTx = (id: string, day: string, amount: number, title = 'Kopi Kenangan', category = 'Dining'): Transaction => ({
  id,
  title,
  category,
  date: new Date(day + 'T09:00:00'),
  time: '09:00',
  amount,
  account: 'BCA',
  source: 'Bank email',
});

const makePrevWeekendWeightedTxs = (): Transaction[] => [
  makeTx('p1', '2026-10-31', 500_000, 'Union', 'Dining'), // Sat
  makeTx('p2', '2026-11-01', 450_000, 'Gyu Kaku', 'Dining'), // Sun
  makeTx('p3', '2026-11-02', 80_000, 'Warteg', 'Dining'), // Mon
  makeTx('p4', '2026-11-03', 80_000, 'Warteg', 'Dining'), // Tue
  makeTx('p5', '2026-11-07', 480_000, 'PS Cafe', 'Dining'), // Sat
  makeTx('p6', '2026-11-08', 460_000, 'Common Grounds', 'Dining'), // Sun
  makeTx('p7', '2026-11-14', 440_000, 'Bistro', 'Dining'), // Sat
  makeTx('p8', '2026-11-15', 420_000, 'Bakmi', 'Dining'), // Sun
];

test('chatContext exposes Saturday weekend awareness, today spend, and PYF percentages', () => {
  const saturday = new Date(2026, 10, 28, 11, 58, 0); // Saturday, 28 Nov 2026 11:58
  const cycle = getCycle(saturday);
  const prevCycle = getCycle(addDays(cycle.start, -1));
  const txs = [
    makeTx('t1', '2026-11-28', 120_000, 'Saladstop', 'Dining'),
    makeTx('t2', '2026-11-26', 250_000, 'Grand Lucky', 'Groceries'),
  ];
  const budget = computeBudget({
    cycle,
    prevCycle,
    transactions: txs,
    prevTransactions: makePrevWeekendWeightedTxs(),
    bills: [],
    recat: {},
    links: {},
    shares: {},
    warnAt: 80,
    income: baseSettings.income,
  });

  const ctx = chatContext({
    cycle,
    budget,
    settings: baseSettings,
    notes: {},
    withNotes: false,
    now: saturday,
  });

  assert.equal(ctx.today, '2026-11-28');
  assert.equal(ctx.now.weekday, 'Saturday');
  assert.equal(ctx.now.isWeekend, true);
  assert.equal(ctx.now.dayType, 'weekend');
  assert.equal(ctx.now.localTime, '11:58');
  assert.equal(ctx.now.timeOfDay, 'midday');
  assert.match(ctx.now.formatted, /^Saturday, 28 Nov 2026, 11:58 \(weekend\)$/);
  assert.equal(ctx.spentToday, 120_000);
  assert.ok(ctx.projectionInsight.weekendSafe && ctx.projectionInsight.weekdaySafe);
  assert.equal(ctx.todaySafeSpend, ctx.projectionInsight.weekendSafe);
  assert.equal(ctx.todayRemaining, Math.max(0, ctx.todaySafeSpend - 120_000));
  assert.equal(ctx.savingsTargetPct, 30);
  assert.equal(ctx.investTargetPct, 10);
  assert.equal(ctx.transactions[0].weekday, 'Sat');
});

test('chatContext switches to weekdaySafe on a Wednesday afternoon', () => {
  const wednesday = new Date(2026, 11, 2, 15, 10, 0); // Wednesday, 2 Dec 2026 15:10
  const cycle = getCycle(wednesday);
  const prevCycle = getCycle(addDays(cycle.start, -1));
  const budget = computeBudget({
    cycle,
    prevCycle,
    transactions: [],
    prevTransactions: makePrevWeekendWeightedTxs(),
    bills: [],
    recat: {},
    links: {},
    shares: {},
    warnAt: 80,
    income: baseSettings.income,
  });

  const ctx = chatContext({
    cycle,
    budget,
    settings: baseSettings,
    notes: {},
    withNotes: false,
    now: wednesday,
  });

  assert.equal(ctx.now.weekday, 'Wednesday');
  assert.equal(ctx.now.isWeekend, false);
  assert.equal(ctx.now.dayType, 'weekday');
  assert.equal(ctx.now.timeOfDay, 'afternoon');
  assert.ok(ctx.projectionInsight.weekdaySafe);
  assert.equal(ctx.todaySafeSpend, ctx.projectionInsight.weekdaySafe);
});

test('estimateChatContextUsage hits 60% threshold cleanly and buildLocalCompactedSummary merges memory', () => {
  const msgs: ChatMessage[] = Array.from({ length: 8 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'model',
    text: `Turn ${i + 1}: Checking Rp 400.948 weekend budget on Saturday with emergency runway notes.`,
  }));

  const under = estimateChatContextUsage({
    context: { today: '2026-11-28' },
    summary: '',
    activeMessages: msgs,
    reportedPromptTokens: Math.floor(CHAT_CONTEXT_BUDGET_TOKENS * 0.45),
  });
  assert.ok(under.pct < AUTO_COMPACT_THRESHOLD_PCT);
  assert.equal(under.canCompact, true);

  const over = estimateChatContextUsage({
    context: { today: '2026-11-28' },
    summary: '',
    activeMessages: msgs,
    reportedPromptTokens: Math.ceil(CHAT_CONTEXT_BUDGET_TOKENS * 0.62),
  });
  assert.ok(over.pct >= AUTO_COMPACT_THRESHOLD_PCT);
  assert.equal(over.canCompact, true);

  const merged = buildLocalCompactedSummary('- User lives in Jakarta Selatan.', msgs.slice(0, 4));
  assert.match(merged, /Jakarta Selatan/);
  assert.match(merged, /Turn 4/);
});

test('shouldUseDeepMode auto-routes simple lookups vs deep reasoning and includes notes by default', () => {
  assert.equal(shouldUseDeepMode('check today budget', false), false);
  assert.equal(shouldUseDeepMode('today is saturday', false), false);
  assert.equal(shouldUseDeepMode('how much left in dining?', false), false);

  assert.equal(shouldUseDeepMode('what if I cap my spending at 300k per day', true), true);
  assert.equal(shouldUseDeepMode('How should I plan my emergency runway and investments this cycle?', false), true);
  assert.equal(shouldUseDeepMode('kenapa pengeluaran dining naik minggu ini? gimana solusinya?', false), true);

  const sat = new Date(2026, 10, 28, 11, 58, 0);
  const cycle = getCycle(sat);
  const prevCycle = getCycle(addDays(cycle.start, -1));
  const txs = [makeTx('note-1', '2026-11-28', 95_000, 'Saladstop', 'Dining')];
  const budget = computeBudget({
    cycle,
    prevCycle,
    transactions: txs,
    prevTransactions: [],
    bills: [],
    recat: {},
    links: {},
    shares: {},
    warnAt: 80,
    income: baseSettings.income,
  });
  const ctx = chatContext({
    cycle,
    budget,
    settings: baseSettings,
    notes: { 'note-1': 'Team lunch reimbursed Monday' },
    now: sat,
  });
  assert.equal(ctx.transactions[0].note, 'Team lunch reimbursed Monday');
});

console.log(`\nall passed (${passed})`);
