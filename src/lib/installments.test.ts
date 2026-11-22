/**
 * Installments are one schedule: Fixed bills (bills + payments already in), Next cycle, each transaction's
 * "n of m" and the card bill must all agree. Run with `npm run test:plans`.
 */
import assert from 'node:assert/strict';
import { getCycle } from './cycle';
import { toISO } from './format';
import { cardViews, type TxView } from './budget';
import { expectedBills, inCycle, installmentPayments, type Transaction } from '../data/transactions';
import { INSTALLMENTS_CATEGORY } from '../data/categories';
import { detectInstallments, dueIn, matchTracked, planBills, planViews, trackFound, withTrackedPlans } from './installments';

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const day = (y: number, m: number, d: number) => new Date(y, m, d);
const tx = (id: string, date: Date, title: string, amount: number, category: string, account = 'CC BCA'): Transaction => ({ id, date, time: '10:00', title, category, amount, source: 'Gmail', account, type: 'expense' });

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log('ok   ' + name);
};

const today = day(2026, 10, 22); // 22 Nov 2026, payday the 25th
const cycle = getCycle(today);
// The next cycle, as seen the day before it starts (as Next cycle planning sees it).
const nextRaw = getCycle(new Date(cycle.end.getTime() + 864e5));
const next = { ...nextRaw, today: new Date(nextRaw.start.getTime() - 864e5) };

// A purchase split into 12 payments, first on 18 Sep.
const phone = tx('p1', day(2026, 8, 10), 'IBOX PLAZA SENAYAN', 12_000_000, 'Shopping');
const plans = { p1: { start: '2026-09-18', amounts: Array(12).fill(1_000_000) } };
const generated = installmentPayments([phone], plans, t => t.category);

// A plan the bank bills itself: "CICILAN LAPTOP 03/06" then "04/06", 1.5M each.
const bank = [tx('b1', day(2026, 9, 18), 'CICILAN LAPTOP ASUS 03/06', 1_500_000, 'Shopping'), tx('b2', day(2026, 10, 18), 'CICILAN LAPTOP ASUS 04/06', 1_500_000, 'Shopping')];

test('detects the bank installment with payment and length', () => {
  const found = detectInstallments(bank, { catOf: t => t.category, skipCats: ['Housing'], subMerchants: [], tracked: [], notInstallments: [], minAmount: 100_000 });
  assert.equal(found.length, 1);
  assert.equal(found[0].payment, 4);
  assert.equal(found[0].months, 6);
  assert.equal(found[0].charges, 2);
});

const found = detectInstallments(bank, { catOf: t => t.category, skipCats: [], subMerchants: [], tracked: [], notInstallments: [], minAmount: 100_000 })[0];
const tracked = [trackFound(found, 4, 6)];
const matched = matchTracked(bank, tracked);
const kept = withTrackedPlans([phone, ...bank], tracked, matched);
const views = planViews(generated, [phone], tracked, matched, today);
const all = [...kept, ...generated];

test('payments keep the purchase category; interest goes to Interest & fees', () => {
  assert.ok(generated.every(t => t.category === 'Shopping'));
  const withInterest = installmentPayments([phone], { p1: { start: '2026-09-18', amounts: Array(12).fill(1_050_000) } }, t => t.category);
  assert.ok(withInterest.filter(t => t.plan!.part === 'price').every(t => t.category === 'Shopping'));
  assert.ok(withInterest.filter(t => t.plan!.part === 'interest').every(t => t.category === 'Interest & fees'));
  const v = planViews(withInterest, [phone], [], new Map(), today);
  const bills = planBills(v, next);
  assert.deepEqual(bills.map(b => b.category).sort(), ['Interest & fees', 'Shopping']);
});

test('a confirmed bank plan marks its charges as payments 3 and 4 of 6', () => {
  const marked = kept.filter(t => t.plan).map(t => `${t.plan!.month}/${t.plan!.months}`);
  assert.deepEqual(marked, ['3/6', '4/6']);
  const laptop = views.find(v => v.kind === 'detected')!;
  assert.deepEqual(laptop.payments.map(p => p.n), [3, 4, 5, 6]);
  assert.equal(toISO(laptop.payments[2].date), '2026-12-18');
});

test('this cycle: payments already in plus bills still due equal the schedule', () => {
  const recat: Record<string, string> = {};
  for (const t of kept) if (t.plan) recat[t.id] = INSTALLMENTS_CATEGORY;
  const inThisCycle = inCycle(all, cycle).filter(t => t.plan);
  const bills = planBills(views, cycle);
  const schedule = sum(views.map(v => dueIn(v, cycle)));
  assert.equal(sum(inThisCycle.map(t => t.amount)) + sum(bills.map(b => b.amount)), schedule);
});

test('next cycle: bills equal the schedule, one per plan', () => {
  const bills = planBills(views, next);
  assert.equal(sum(bills.map(b => b.amount)), sum(views.map(v => dueIn(v, next))));
  assert.equal(bills.length, 2);
  assert.ok(bills.some(b => b.title === 'Cicilan Laptop Asus (5/6)' || /\(5\/6\)$/.test(b.title)));
});

test('the card bill counts the same installment payments', () => {
  const inThisCycle = inCycle(all, cycle);
  const views2 = inThisCycle.map(t => ({ ...t, cat: t.category, isCcPayment: false })) as unknown as TxView[];
  const card = cardViews(views2, []).find(c => c.account === 'CC BCA')!;
  const paidInCycle = sum(views.flatMap(v => v.payments.filter(p => p.date >= cycle.start && p.date <= cycle.today).map(p => p.amount)));
  assert.equal(card.installments, paidInCycle);
});

test("last cycle's installment payments aren't predicted again as bills", () => {
  const prevCycle = getCycle(new Date(cycle.start.getTime() - 864e5));
  const prev = all.filter(t => t.date >= prevCycle.start && t.date < cycle.start);
  const recat: Record<string, string> = {};
  for (const t of all) if (t.plan) recat[t.id] = INSTALLMENTS_CATEGORY;
  const predicted = expectedBills(prev, prevCycle, inCycle(all, cycle), cycle, recat);
  assert.equal(predicted.filter(b => b.category === INSTALLMENTS_CATEGORY).length, 0);
});

console.log(`\nall passed (${passed})`);
