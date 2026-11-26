import assert from 'node:assert/strict';
import { buildCalendarMonth, buildIcsExport } from './calendar';
import type { Cycle } from './cycle';
import type { FixedBillStatus } from './fixedBills';
import type { PlanView } from './installments';
import { DEFAULT_SETTINGS, type Settings } from './settings';
import type { TxView } from './budget';

function test(name: string, fn: () => void) {
  fn();
  console.log('ok  ', name);
}

const cycle: Cycle = {
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

test('builds calendar month with paydays, fixed bills, card dates, planned costs, spend & zero-spend days', () => {
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    income: 30_000_000,
    cards: { 'CC BCA': { statement: 18, due: 3 } },
    cyclePlans: {
      '2026-11-25': {
        extras: [{ id: 'ex1', name: 'Bonus', amount: 5_000_000 }],
        costs: [{ id: 'c1', name: 'Flight', amount: 2_500_000, date: '2026-11-20', category: 'Travel' }],
      },
    },
  };
  const fixedBillStatuses: FixedBillStatus[] = [
    {
      bill: { id: 'fb1', name: 'Rent', category: 'Rent', amount: 6_000_000, dueDay: 1, every: 'month', kind: 'fixed', keywords: [] },
      expected: 6_000_000,
      actual: 6_000_000,
      dueDate: new Date(2026, 10, 1),
      status: 'paid',
    },
  ];
  const plans: PlanView[] = [
    {
      key: 'p1',
      kind: 'purchase',
      title: 'Phone',
      account: 'CC BCA',
      category: 'Shopping',
      months: 6,
      payments: [{ n: 3, date: new Date(2026, 10, 18), amount: 1_500_000, interest: 0, paid: false }],
    },
  ];
  const allTxs = [
    {
      id: 'tx1',
      date: new Date(2026, 10, 2),
      title: 'Kopi Kenangan',
      account: 'BCA',
      category: 'Cafe',
      cat: 'Cafe',
      amount: 45_000,
      net: 45_000,
      type: 'expense',
      isIncome: false,
      isTransfer: false,
      isSavings: false,
      isCcPayment: false,
      offset: 8,
    },
  ] as unknown as TxView[];

  const data = buildCalendarMonth({
    year: 2026,
    month: 10, // November 2026
    cycle,
    allTxs,
    fixedBillStatuses,
    subscriptions: { s1: { name: 'Spotify', amount: 55_000, every: 'month', next: '2026-11-12', status: 'active' } },
    plans,
    settings,
  });

  assert.equal(data.label, 'November 2026');
  const nov1 = data.days.find(d => d.iso === '2026-11-01')!;
  assert.ok(nov1.events.some(e => e.kind === 'fixed' && e.title === 'Rent' && e.paid));
  const nov2 = data.days.find(d => d.iso === '2026-11-02')!;
  assert.equal(nov2.spend, 45_000);
  assert.equal(nov2.zeroSpend, false);
  const nov3 = data.days.find(d => d.iso === '2026-11-03')!;
  assert.equal(nov3.zeroSpend, true);
  assert.ok(nov3.events.some(e => e.kind === 'card_due' && e.title === 'CC BCA due'));
  const nov12 = data.days.find(d => d.iso === '2026-11-12')!;
  assert.ok(nov12.events.some(e => e.kind === 'subscription' && e.title === 'Spotify'));
  const nov18 = data.days.find(d => d.iso === '2026-11-18')!;
  assert.ok(nov18.events.some(e => e.kind === 'installment' && e.title === 'Phone'));
  assert.ok(nov18.events.some(e => e.kind === 'card_statement'));
  const nov20 = data.days.find(d => d.iso === '2026-11-20')!;
  assert.ok(nov20.events.some(e => e.kind === 'planned' && e.title === 'Flight'));
  const nov25 = data.days.find(d => d.iso === '2026-11-25')!;
  assert.ok(nov25.events.some(e => e.kind === 'payday'));
  assert.ok(nov25.events.some(e => e.kind === 'inflow' && e.title === 'Bonus'));
  assert.equal(data.totalInflows, 35_000_000);
  assert.equal(data.totalCommitments, 6_000_000 + 55_000 + 1_500_000 + 2_500_000);

  const ics = buildIcsExport(data.allEvents, 'IDR');
  assert.ok(ics.includes('BEGIN:VCALENDAR'));
  assert.ok(ics.includes('SUMMARY:Payday (Rp30.000.000)'));
  assert.ok(ics.includes('SUMMARY:Flight (Rp2.500.000)'));
  assert.ok(ics.includes('END:VCALENDAR'));
});

console.log('\nall passed (1)');
