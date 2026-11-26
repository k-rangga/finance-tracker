/**
 * Unit tests for Next Cycle financial model helpers: effective inflow with extras, auto-balance,
 * scenario presets (usual, actuals, lean, save), and hasPlan detection.
 * Run with `npm run test:cycle`.
 */
import assert from 'node:assert/strict';
import { autoBalancePlan, buildPresetAmounts, cycleIncomeOf, hasPlan } from './cyclePlans';

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log('ok  ', name);
};

test('cycleIncomeOf adds extra inflows to base or overridden cycle income', () => {
  assert.equal(cycleIncomeOf(30_000_000, undefined), 30_000_000);
  assert.equal(
    cycleIncomeOf(30_000_000, {
      extras: [
        { id: 'e1', name: 'Bonus', amount: 5_000_000 },
        { id: 'e2', name: 'Dividend', amount: 750_000 },
      ],
    }),
    35_750_000,
  );
  assert.equal(
    cycleIncomeOf(30_000_000, {
      income: 32_000_000,
      extras: [{ id: 'e1', name: 'Freelance', amount: 2_000_000 }],
    }),
    34_000_000,
  );
});

test('hasPlan recognizes income, extras, savings, and invest overrides', () => {
  assert.equal(hasPlan(undefined), false);
  assert.equal(hasPlan({}), false);
  assert.equal(hasPlan({ income: 28_000_000 }), true);
  assert.equal(hasPlan({ extras: [{ id: 'e1', name: 'Bonus', amount: 1_000_000 }] }), true);
  assert.equal(hasPlan({ savings: 15_000_000 }), true);
  assert.equal(hasPlan({ invest: 5_000_000 }), true);
});

test('autoBalancePlan trims everyday proportionally before touching savings', () => {
  const res = autoBalancePlan({
    totalInflow: 20_000_000,
    committed: 6_000_000,
    savings: 10_000_000,
    everyday: { Groceries: 3_000_000, Dining: 2_000_000, Shopping: 1_000_000 },
    step: 50_000,
  });
  // Deficit was 2M (22M total - 20M inflow), covered entirely by everyday without cutting savings.
  const evTotal = Object.values(res.everyday).reduce((a, v) => a + v, 0);
  assert.equal(res.savings, 10_000_000);
  assert.equal(res.trimmedSavings, 0);
  assert.ok(6_000_000 + res.savings + evTotal <= 20_000_000);
  assert.ok(evTotal >= 3_950_000 && evTotal <= 4_000_000);
});

test('autoBalancePlan trims savings only when everyday cannot cover deficit', () => {
  const res = autoBalancePlan({
    totalInflow: 15_000_000,
    committed: 8_000_000,
    savings: 8_000_000,
    everyday: { Groceries: 1_000_000 },
    step: 50_000,
  });
  assert.equal(res.everyday.Groceries, 0);
  assert.equal(res.savings, 7_000_000);
  assert.equal(res.trimmedSavings, 1_000_000);
});

test('buildPresetAmounts computes lean, actuals, and save presets accurately', () => {
  const base = {
    totalInflow: 30_000_000,
    committed: 6_000_000,
    regularSavings: 15_000_000,
    regularEveryday: { Groceries: 3_000_000, Dining: 2_000_000, Transport: 1_000_000 },
    projectedEveryday: { Groceries: 3_420_000, Dining: 1_110_000, Transport: 0 },
    step: 50_000,
  };

  const actuals = buildPresetAmounts('actuals', base);
  assert.equal(actuals.everyday.Groceries, 3_400_000);
  assert.equal(actuals.everyday.Dining, 1_100_000);
  assert.equal(actuals.everyday.Transport, 1_000_000); // 0 projected falls back to usual

  const lean = buildPresetAmounts('lean', base);
  assert.equal(lean.everyday.Groceries, 2_550_000);
  assert.equal(lean.everyday.Dining, 1_700_000);
  assert.equal(lean.everyday.Transport, 850_000);
  assert.equal(lean.savings, 15_900_000); // 900k freed routed into savings

  const save = buildPresetAmounts('save', base);
  assert.equal(save.savings, 18_000_000); // +10% of 30M inflow
  const saveEv = Object.values(save.everyday).reduce((a, v) => a + v, 0);
  assert.ok(base.committed + save.savings + saveEv <= base.totalInflow);
});

console.log(`\nall passed (${passed})`);
