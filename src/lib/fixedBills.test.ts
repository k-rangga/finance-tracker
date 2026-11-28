/**
 * Fixed bills verification tests: due-date scheduling, auto-matching receipts, possible-match detection from
 * Buffer/Transfer, overdue detection, double-claim prevention, manual links, cash marks, and skips.
 * Run with `npm run test:bills`.
 */
import assert from 'node:assert/strict';
import { getCycle } from './cycle';
import { toISO } from './format';
import { txViews } from './budget';
import { type Transaction } from '../data/transactions';
import {
  billDraftFromTx,
  dueDateInCycle,
  fixedBillCategoryLimits,
  fixedBillDueItems,
  fixedBillsForNextCycle,
  historyForFixedBill,
  matchFixedBills,
  type FixedBill,
} from './fixedBills';

const day = (y: number, m: number, d: number) => new Date(y, m, d);
const tx = (id: string, date: Date, title: string, amount: number, category: string, type: Transaction['type'] = 'expense'): Transaction => ({
  id,
  date,
  time: '10:00',
  title,
  category,
  amount,
  source: 'Gmail',
  account: 'BCA',
  type,
});

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log('ok  ', name);
};

// Cycle: 25 Oct 2026 – 24 Nov 2026; today = 12 Nov 2026
const today = day(2026, 10, 12);
const cycle = getCycle(today);

const rent: FixedBill = { id: 'b1', name: 'Rent', category: 'Housing', amount: 3_500_000, dueDay: 1, merchant: 'ibu kos' };
const pln: FixedBill = { id: 'b2', name: 'Electricity (PLN)', category: 'Utilities', amount: 400_000, dueDay: 5, merchant: 'pln', varies: true };
const wifi: FixedBill = { id: 'b3', name: 'Internet', category: 'Utilities', amount: 385_000, dueDay: 18, merchant: 'indihome' };
const insurance: FixedBill = { id: 'b4', name: 'Insurance', category: 'Insurance', amount: 600_000, dueDay: 7 };
const yearly: FixedBill = { id: 'b5', name: 'Car tax', category: 'Insurance', amount: 2_000_000, dueDay: 15, every: 'year', anchorMonth: 3 };

test('schedules due dates inside the pay cycle and skips non-matching yearly months', () => {
  assert.equal(toISO(dueDateInCycle(rent, cycle)!), '2026-11-01');
  assert.equal(toISO(dueDateInCycle(wifi, cycle)!), '2026-11-18');
  assert.equal(dueDateInCycle(yearly, cycle), null);
});

test('auto-verifies variable utility bills by merchant keyword and computes variance', () => {
  const raw = [tx('t1', day(2026, 10, 4), 'TOKOPEDIA PLN PASCABAYAR', 465_000, 'Utilities')];
  const views = txViews(raw, raw, { recat: {}, links: {}, shares: {}, cycle }).txs;
  const res = matchFixedBills([pln, wifi], views, cycle);
  assert.equal(res[0].status, 'paid');
  assert.equal(res[0].matchKind, 'auto');
  assert.equal(res[0].actual, 465_000);
  assert.equal(res[0].variance, 65_000);
  // Wi-Fi is still unpaid (does NOT get falsely marked paid just because Utilities has a tx!)
  assert.equal(res[1].status, 'due');
  assert.equal(res[1].matchedTx, undefined);
});

test('detects overdue unpaid bills and suggests possible match from Transfer / Buffer', () => {
  const raw = [
    tx('t_rent', day(2026, 10, 2), 'TRANSFER TO IBU KOS', 3_500_000, 'Transfer', 'transfer'),
    tx('t_other', day(2026, 10, 8), 'COFFEE SHOP', 45_000, 'Cafe'),
  ];
  const views = txViews(raw, raw, { recat: {}, links: {}, shares: {}, cycle }).txs;
  const res = matchFixedBills([rent, insurance], views, cycle);
  assert.equal(res[0].status, 'overdue');
  assert.equal(res[0].possibleTx?.id, 't_rent');
  assert.equal(res[1].status, 'overdue');
  assert.equal(res[1].possibleTx, undefined);
});

test('manual link, cash mark-paid, and skip all clear bill from fixedBillDueItems', () => {
  const raw = [tx('t_rent', day(2026, 10, 2), 'TRANSFER TO IBU KOS', 3_500_000, 'Housing')];
  const views = txViews(raw, raw, { recat: {}, links: {}, shares: {}, cycle }).txs;
  const res = matchFixedBills([rent, insurance, wifi], views, cycle, {
    linked: { b1: 't_rent' },
    paid: ['b4'],
    skipped: ['b3'],
  });
  assert.equal(res[0].status, 'paid');
  assert.equal(res[0].matchKind, 'linked');
  assert.equal(res[1].status, 'paid');
  assert.equal(res[1].matchKind, 'manual');
  assert.equal(res[2].status, 'skipped');
  assert.equal(fixedBillDueItems(res, cycle).length, 0);
  const limits = fixedBillCategoryLimits(res);
  assert.equal(limits.Housing, 3_500_000);
  assert.equal(limits.Insurance, 600_000);
  assert.equal(limits.Utilities, undefined); // skipped bill doesn't reserve budget
});

test('one transaction cannot verify two bills simultaneously', () => {
  const bA: FixedBill = { id: 'a', name: 'Utilities A', category: 'Utilities', amount: 300_000, dueDay: 5 };
  const bB: FixedBill = { id: 'b', name: 'Utilities B', category: 'Utilities', amount: 300_000, dueDay: 6 };
  const raw = [tx('t1', day(2026, 10, 5), 'UTILITY CHARGE', 300_000, 'Utilities')];
  const views = txViews(raw, raw, { recat: {}, links: {}, shares: {}, cycle }).txs;
  const res = matchFixedBills([bA, bB], views, cycle);
  assert.equal(res.filter(x => x.status === 'paid').length, 1);
  assert.equal(res.filter(x => x.status === 'overdue').length, 1);
});

test('keeps due-today and overdue bills on today instead of shifting to tomorrow', () => {
  const dueToday: FixedBill = { id: 'dt', name: 'Gym', category: 'Utilities', amount: 500_000, dueDay: 12 };
  const res = matchFixedBills([dueToday, rent], [], cycle);
  const due = fixedBillDueItems(res, cycle);
  assert.equal(due.length, 2);
  assert.equal(toISO(due[0].date), '2026-11-12');
  assert.equal(due[0].title, 'Gym');
  assert.equal(toISO(due[1].date), '2026-11-12');
  assert.equal(due[1].title, 'Rent (overdue)');
});

test('schedules active individual fixed bills for next cycle', () => {
  const nextCycle = getCycle(day(2026, 10, 26));
  const paused: FixedBill = { ...wifi, id: 'paused', paused: true };
  const items = fixedBillsForNextCycle([rent, pln, paused, yearly], nextCycle);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Rent');
  assert.equal(toISO(items[0].date), '2026-12-01');
  assert.equal(items[1].title, 'Electricity (PLN)');
  assert.equal(toISO(items[1].date), '2026-12-05');
});

test('supports recurring account transfer bills from transactions without inflating spending due/limits', () => {
  const trRaw: Transaction = {
    id: 'tr1',
    date: day(2026, 10, 5),
    time: '09:00',
    title: 'Transfer to Ibu',
    category: 'Transfer',
    amount: 2_000_000,
    source: 'Gmail',
    account: 'BCA',
    toAccount: 'Mandiri',
    type: 'transfer',
  };
  const { txs } = txViews([trRaw], [trRaw], { recat: {}, links: {}, shares: {}, cycle, subs: [] });
  const draft = billDraftFromTx(txs[0]);
  assert.equal(draft.category, 'Transfer');
  assert.equal(draft.amount, 2_000_000);
  assert.equal(draft.dueDay, 5);

  const transferBill: FixedBill = {
    id: 'bt1',
    name: draft.name!,
    category: draft.category!,
    amount: draft.amount!,
    dueDay: draft.dueDay!,
    merchant: draft.merchant,
  };
  const unpaidBill: FixedBill = {
    id: 'bt2',
    name: 'Monthly Savings',
    category: 'Savings',
    amount: 5_000_000,
    dueDay: 18,
    merchant: 'blu saving',
  };

  const statuses = matchFixedBills([transferBill, unpaidBill], txs, cycle);
  assert.equal(statuses[0].status, 'paid');
  assert.equal(statuses[0].matchKind, 'auto');
  assert.equal(statuses[0].actual, 2_000_000);
  assert.equal(statuses[1].status, 'due');

  assert.equal(fixedBillDueItems(statuses, cycle).length, 0);
  assert.deepEqual(fixedBillCategoryLimits(statuses), {});
});

test('historyForFixedBill returns newest-first matching payments across cycles', () => {
  const plnOct = tx('h1', day(2026, 9, 5), 'PLN Token', 410_000, 'Utilities');
  const plnNov = tx('h2', day(2026, 10, 5), 'PLN Token', 395_000, 'Utilities');
  const transferOct = tx('h3', day(2026, 9, 6), 'Transfer to Ibu', 2_000_000, 'Transfer', 'transfer');
  const unrelated = tx('h4', day(2026, 10, 6), 'Grand Lucky', 200_000, 'Groceries');
  const transferBill: FixedBill = { id: 'tb', name: 'Transfer to Ibu', category: 'Transfer', amount: 2_000_000, dueDay: 6, merchant: 'ibu' };

  const plnHist = historyForFixedBill(pln, [plnOct, plnNov, transferOct, unrelated], t => t.category);
  assert.deepEqual(plnHist.map(t => t.id), ['h2', 'h1']);

  const transferHist = historyForFixedBill(transferBill, [plnOct, plnNov, transferOct, unrelated], t => t.category);
  assert.deepEqual(transferHist.map(t => t.id), ['h3']);
});

console.log(`\nall passed (${passed})`);
