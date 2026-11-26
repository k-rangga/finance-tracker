import assert from 'node:assert/strict';
import { buildBootHint, pickBootReflection } from './bootHint';
import type { Budget } from './budget';
import type { Cycle } from './cycle';
import type { PlanView } from './installments';
import { DEFAULT_SETTINGS, type Settings } from './settings';

function test(name: string, fn: () => void) {
  fn();
  console.log('ok  ', name);
}

const sampleCycle: Cycle = {
  start: new Date(2026, 9, 25),
  end: new Date(2026, 10, 24),
  next: new Date(2026, 10, 25),
  today: new Date(2026, 10, 5),
  cycleDays: 31,
  dayIdx: 11,
  dayN: 12,
  daysLeft: 19,
  dateOf: i => new Date(2026, 9, 25 + i),
  offsetOf: d => Math.round((d.getTime() - new Date(2026, 9, 25).getTime()) / 864e5),
};

const baseBudget = {
  budget: 10_000_000,
  spent: 3_000_000,
  fixedDue: 1_000_000,
  fixedSpent: 1_000_000,
  paceToday: 3_800_000,
  safeDay: 300_000,
  velDay: 250_000,
  projTotal: 8_500_000,
  savingsTarget: 5_000_000,
  saved: 5_200_000,
  savedPct: 52,
  bills: [],
  cards: [],
  cats: [
    { name: 'Dining', type: 'variable', spent: 600_000, limit: 2_000_000, lastSameDays: 1_000_000, prev: [], used: 30, color: '', status: { key: 'ok', rank: 0, ink: '', bar: '' } },
  ],
  txs: [
    { id: '1', offset: 1, cat: 'Dining', net: 200_000, amount: 200_000, isIncome: false, isTransfer: false, isSavings: false },
    { id: '2', offset: 4, cat: 'Dining', net: 400_000, amount: 400_000, isIncome: false, isTransfer: false, isSavings: false },
  ],
} as unknown as Budget;

test('generates personalized reflections from zero-spend days, savings goal, category drop, Buffer, and installments', () => {
  const settings: Settings = { ...DEFAULT_SETTINGS, name: 'Rangga', maxieLanguage: 'en', quietMode: false };
  const plans: PlanView[] = [
    {
      key: 'p1',
      kind: 'purchase',
      title: 'MacBook Air',
      account: 'CC BCA',
      category: 'Shopping',
      months: 6,
      payments: [
        { n: 1, date: new Date(2026, 5, 1), amount: 2_000_000, interest: 0, paid: true },
        { n: 6, date: new Date(2026, 10, 15), amount: 2_000_000, interest: 0, paid: false },
      ],
    },
  ];
  const hint = buildBootHint({ cycle: sampleCycle, budget: baseBudget, settings, plans });
  assert.equal(hint.name, 'Rangga');
  assert.equal(hint.quiet, false);
  assert.ok(hint.reflections.some(r => /zero-spend days/i.test(r)));
  assert.ok(hint.reflections.some(r => /Savings goal already reached/i.test(r)));
  assert.ok(hint.reflections.some(r => /Dining is 40% lighter/i.test(r)));
  assert.ok(hint.reflections.some(r => /Buffer/i.test(r)));
  assert.ok(hint.reflections.some(r => /1 payment left on MacBook Air/i.test(r)));
  assert.equal(hint.aura, 'good');
  assert.equal(hint.isPayday, false);
  assert.ok(pickBootReflection(hint).length > 10);
});

test('localizes personalized reflections in Bahasa Indonesia, detects payday aura, and respects quietMode flag', () => {
  const settings: Settings = { ...DEFAULT_SETTINGS, name: 'Rangga', maxieLanguage: 'id', quietMode: true };
  const paydayCycle: Cycle = { ...sampleCycle, dayN: 1, dayIdx: 0 };
  const hint = buildBootHint({ cycle: paydayCycle, budget: baseBudget, settings, plans: [] });
  assert.equal(hint.lang, 'id');
  assert.equal(hint.quiet, true);
  assert.equal(hint.isPayday, true);
  assert.equal(hint.aura, 'payday');
  assert.ok(hint.reflections.some(r => /Target tabungan/i.test(r)));
});

console.log('\nall passed (2)');
