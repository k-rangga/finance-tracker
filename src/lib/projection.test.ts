/**
 * Unit tests for the multi-cycle financial projection engine: yearly fixed bill spikes, installment drop-offs,
 * What-If cash & installment simulations, future cycle one-off/extra overrides, and investment compounding.
 * Run with `npm run test:proj`.
 */
import assert from 'node:assert/strict';
import { getCycle } from './cycle';
import { projectCycles } from './projection';
import { toISO } from './format';
import type { FixedBill } from './fixedBills';
import type { PlanView } from './installments';

const day = (y: number, m: number, d: number) => new Date(y, m, d);

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log('ok  ', name);
};

// Next cycle starts 25 Nov 2026
const nextCycle = getCycle(day(2026, 10, 26));

const rent: FixedBill = { id: 'rent', name: 'Rent', category: 'Housing', amount: 3_500_000, dueDay: 1 };
const carTax: FixedBill = { id: 'tax', name: 'Car tax', category: 'Insurance', amount: 2_400_000, dueDay: 15, every: 'year', anchorMonth: 3 };

const laptopPlan: PlanView = {
  key: 'p1',
  kind: 'split',
  title: 'Laptop',
  account: 'CC BCA',
  category: 'Shopping',
  months: 3,
  payments: [
    { n: 1, date: day(2026, 10, 10), amount: 2_000_000, interest: 0 },
    { n: 2, date: day(2026, 11, 10), amount: 2_000_000, interest: 0 }, // inside cycle 0 (25 Nov - 24 Dec)
    { n: 3, date: day(2027, 0, 10), amount: 2_000_000, interest: 0 },  // inside cycle 1 (25 Dec - 24 Jan)
  ],
};

test('projects 6 cycles with yearly fixed bill spike and installment drop-off detection', () => {
  const res = projectCycles({
    startCycle: nextCycle,
    horizon: 6,
    regularIncome: 25_000_000,
    legacyFixedTotal: 500_000,
    regularEverydayTotal: 6_000_000,
    regularSavings: 10_000_000,
    regularInvest: 5_000_000,
    fixedBills: [rent, carTax],
    installmentPlans: [laptopPlan],
  });

  assert.equal(res.cycles.length, 6);
  // Cycle 0 (Nov 25 - Dec 24) & Cycle 1 (Dec 25 - Jan 24) include 2M laptop installment
  assert.equal(res.cycles[0].installments, 2_000_000);
  assert.equal(res.cycles[1].installments, 2_000_000);
  // Cycle 2 (Jan 25 - Feb 24) has 0 installments and detects Laptop finishing!
  assert.equal(res.cycles[2].installments, 0);
  assert.equal(res.cycles[2].endedInstallments.length, 1);
  assert.equal(res.cycles[2].endedInstallments[0].freed, 2_000_000);
  assert.equal(res.debtFreeCycle?.index, 2);
  assert.equal(res.freedByInstallments, 2_000_000);

  // Cycle 3 (Feb 25 - Mar 24) catches the yearly March 15 Car tax spike!
  assert.ok(res.cycles[3].spikeBills.includes('Car tax'));
  assert.equal(res.cycles[3].fixedBills, 3_500_000 + 2_400_000 + 500_000);
});

test('simulates What-If cash and installment purchases and flags shortfalls', () => {
  const base = projectCycles({
    startCycle: nextCycle,
    horizon: 6,
    regularIncome: 20_000_000,
    legacyFixedTotal: 4_000_000,
    regularEverydayTotal: 5_000_000,
    regularSavings: 9_000_000,
    regularInvest: 4_000_000,
  });
  assert.equal(base.shortfallCycles, 0);

  // Big cash purchase of 6M in cycle 0 exceeds the 2M buffer -> 1 shortfall cycle
  const cashSim = projectCycles({
    startCycle: nextCycle,
    horizon: 6,
    regularIncome: 20_000_000,
    legacyFixedTotal: 4_000_000,
    regularEverydayTotal: 5_000_000,
    regularSavings: 9_000_000,
    regularInvest: 4_000_000,
    whatIf: { name: 'Camera', amount: 6_000_000, months: 1 },
  });
  assert.equal(cashSim.shortfallCycles, 1);
  assert.equal(cashSim.cycles[0].whatIfPayment, 6_000_000);
  assert.equal(cashSim.cycles[1].whatIfPayment, 0);
  assert.equal(Math.round(base.totalAdded - cashSim.totalAdded), 6_000_000);

  // Same 6M split over 6 months (1M/mo) fits inside the 2M buffer with 0 shortfalls!
  const instSim = projectCycles({
    startCycle: nextCycle,
    horizon: 6,
    regularIncome: 20_000_000,
    legacyFixedTotal: 4_000_000,
    regularEverydayTotal: 5_000_000,
    regularSavings: 9_000_000,
    regularInvest: 4_000_000,
    whatIf: { name: 'Camera', amount: 6_000_000, months: 6 },
  });
  assert.equal(instSim.shortfallCycles, 0);
  assert.equal(instSim.cycles[0].whatIfPayment, 1_000_000);
  assert.equal(instSim.cycles[5].whatIfPayment, 1_000_000);
});

test('compounds investing returns and honors future cycle plans', () => {
  const res = projectCycles({
    startCycle: nextCycle,
    horizon: 12,
    regularIncome: 30_000_000,
    legacyFixedTotal: 5_000_000,
    regularEverydayTotal: 5_000_000,
    regularSavings: 15_000_000,
    regularInvest: 10_000_000,
    annualReturn: 0.08,
    cyclePlans: {
      [toISO(nextCycle.start)]: {
        extras: [{ id: 'e1', name: 'THR', amount: 10_000_000 }],
      },
    },
  });
  // 12 * 10M = 120M contributed; with 8% annual compounding, cumInvest > 120M
  assert.ok(res.compoundingGain > 3_000_000);
  assert.equal(res.cycles[0].extras, 10_000_000);
  assert.equal(res.cycles[0].inflow, 40_000_000);
});

console.log(`\nall passed (${passed})`);
