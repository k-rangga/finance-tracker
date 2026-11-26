import assert from 'node:assert/strict';
import { billLandingDay, oneOffThreshold, projectCycleSpend, type PaceTx } from './pace';

function test(name: string, fn: () => void) {
  fn();
  console.log('ok  ', name);
}

const near = (a: number, b: number, tol: number) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

/** `perDay` spent on every day in [from, to]. */
const daily = (from: number, to: number, perDay: number): PaceTx[] =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ offset: from + i, amount: perDay }));

const hist = (...cycles: PaceTx[][]) => cycles.map(txs => ({ txs, days: 30 }));

test('A: day 2 leans on past cycles, not a 2-day extrapolation', () => {
  const prev = daily(0, 29, 100_000); // 3M last cycle, even spending
  // A heavy start: 400k on each of the first two days.
  const r = projectCycleSpend({ cycleDays: 30, dayIdx: 1, cur: daily(0, 1, 400_000), history: hist(prev), varBudget: 3_000_000, bills: [] });
  const naive = (800_000 / 2) * 28; // old formula: 11.2M remaining
  assert.equal(r.basis, 'history');
  assert.equal(r.historyCycles, 1);
  assert.ok(r.remainingVar < naive / 2, `remaining ${r.remainingVar} should be far below naive ${naive}`);
  near(r.remainingVar, 2_800_000 * (28 / 30) + 11_200_000 * (2 / 30), 600_000);
});

test('A: late in the cycle the live pace dominates', () => {
  const prev = daily(0, 29, 100_000);
  const r = projectCycleSpend({ cycleDays: 30, dayIdx: 26, cur: daily(0, 26, 200_000), history: hist(prev), varBudget: 3_000_000, bills: [] });
  // 3 days left at ~200k/day ≈ 600k; baseline would say ~300k.
  near(r.remainingVar, 570_000, 80_000);
});

test('A: falls back to the plan when there is no history', () => {
  const r = projectCycleSpend({ cycleDays: 30, dayIdx: 0, cur: [{ offset: 0, amount: 500_000 }], history: [], varBudget: 3_100_000, varBillsDue: 100_000, bills: [] });
  assert.equal(r.basis, 'plan');
  assert.equal(r.historyCycles, 0);
  // Day 1: ~97% weight on the plan rate (3M/30 per day × 29 days ≈ 2.9M).
  near(r.remainingVar, 2_900_000, 600_000);
});

test('B: a big one-off is counted once, not extrapolated', () => {
  const prev = daily(0, 29, 100_000);
  const cur = [...daily(0, 9, 100_000), { offset: 3, amount: 15_000_000 }]; // laptop on day 4
  const r = projectCycleSpend({ cycleDays: 30, dayIdx: 9, cur, history: hist(prev), varBudget: 3_000_000, bills: [] });
  assert.equal(r.oneOffCount, 1);
  assert.equal(r.oneOffs, 15_000_000);
  assert.equal(r.regularSpent, 1_000_000);
  near(r.remainingVar, 2_000_000, 150_000);
});

test('B: committed installment payments never feed the pace', () => {
  const r = projectCycleSpend({
    cycleDays: 30,
    dayIdx: 4,
    cur: [...daily(0, 4, 100_000), { offset: 0, amount: 50_000, committed: true }],
    history: hist(daily(0, 29, 100_000)),
    varBudget: 3_000_000,
    bills: [],
  });
  assert.equal(r.regularSpent, 500_000);
  assert.equal(r.oneOffs, 50_000);
  assert.equal(r.oneOffCount, 0);
});

test('B: threshold uses median when there is enough data, else 10% of plan', () => {
  assert.equal(oneOffThreshold([10, 20, 30, 40, 50], 0), 150);
  assert.equal(oneOffThreshold([10, 20], 1_000), 100);
  assert.equal(oneOffThreshold([], 0), Infinity);
});

test('C: front-loaded rhythm stops a straight line from overshooting', () => {
  // Last cycle: 200k/day in the first 10 days, then 50k/day.
  const prev = [...daily(0, 9, 200_000), ...daily(10, 29, 50_000)]; // 3M
  const cur = [...daily(0, 9, 200_000)]; // same start: 2M by day 10
  const r = projectCycleSpend({ cycleDays: 30, dayIdx: 9, cur, history: hist(prev), varBudget: 3_000_000, bills: [] });
  const linear = 200_000 * 20; // 4M remaining
  assert.ok(r.remainingVar < linear * 0.6, `remaining ${r.remainingVar} should be well below linear ${linear}`);
});

test('C: averages up to 3 cycles with recency weighting, skipping partial cycles', () => {
  const recent = daily(0, 29, 150_000); // 4.5M
  const mid = daily(0, 29, 100_000); // 3.0M
  const older = daily(0, 29, 100_000); // 3.0M
  const r3 = projectCycleSpend({ cycleDays: 30, dayIdx: 0, cur: daily(0, 0, 125_000), history: hist(recent, mid, older), varBudget: 3_000_000, bills: [] });
  assert.equal(r3.basis, 'history');
  assert.equal(r3.historyCycles, 3);
  // Recency-weighted baseline = 0.5*4.5M + 0.3*3M + 0.2*3M = 3.75M -> remaining ~ 3.75M * 29/30 ≈ 3.625M
  near(r3.remainingVar, 3_625_000, 150_000);

  // If the oldest cycle is partial, only the 2 complete ones are used.
  const partial = daily(20, 29, 100_000);
  const r2 = projectCycleSpend({ cycleDays: 30, dayIdx: 0, cur: daily(0, 0, 125_000), history: hist(recent, mid, partial), varBudget: 3_000_000, bills: [] });
  assert.equal(r2.historyCycles, 2);
});

test('C: a partial last cycle (imported mid-way) is not trusted as a rhythm', () => {
  const r = projectCycleSpend({ cycleDays: 30, dayIdx: 5, cur: daily(0, 5, 100_000), history: hist(daily(20, 29, 100_000)), varBudget: 3_000_000, bills: [] });
  assert.equal(r.basis, 'plan');
  assert.equal(r.historyCycles, 0);
});

test('D: bills land on their due dates; overdue ones tomorrow', () => {
  const r = projectCycleSpend({
    cycleDays: 30,
    dayIdx: 9,
    cur: daily(0, 9, 100_000),
    history: hist(daily(0, 29, 100_000)),
    varBudget: 3_000_000,
    bills: [
      { offset: 20, amount: 1_000_000 },
      { offset: 3, amount: 200_000 },
    ],
  });
  assert.equal(r.fixedDue, 1_200_000);
  assert.equal(r.billOn[20], 1_000_000);
  assert.equal(r.billOn[10], 200_000);
  assert.equal(r.add[9], 0);
  // Step on day 20.
  assert.ok(r.add[20] - r.add[19] >= 1_000_000);
  near(r.add[29], r.remainingVar + r.fixedDue, 1);
  assert.equal(billLandingDay(45, 9, 30), 29);
});

test('last day: nothing left to project, bills still counted', () => {
  const r = projectCycleSpend({ cycleDays: 30, dayIdx: 29, cur: daily(0, 29, 100_000), history: [], varBudget: 3_000_000, bills: [{ offset: 29, amount: 300 }] });
  assert.equal(r.remainingVar, 0);
  assert.equal(r.fixedDue, 300);
});
