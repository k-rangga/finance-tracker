import { CATEGORIES, INCOME_CATEGORY, SAVINGS_TARGET_PCT, type Category } from '../data/categories';
import type { Bill, Transaction } from '../data/transactions';
import { weekOf, type Cycle } from './cycle';
import { sum } from './format';
import { C } from './tokens';

export type StatusKey = 'over' | 'near' | 'ok';

export type Status = {
  key: StatusKey;
  label: string;
  bg: string;
  ink: string;
  /** Progress bar fill. */
  bar: string;
  rowBg: string;
  rank: number;
};

export function categoryStatus(used: number, type: Category['type'], warnAt: number): Status {
  if (used >= 100.5) return { key: 'over', label: 'Over limit', bg: C.red, ink: '#ffffff', bar: C.red, rowBg: '#fff8f7', rank: 0 };
  if (type === 'fixed')
    return { key: 'ok', label: used >= 99 ? 'Bill paid' : 'On plan', bg: C.accentTint, ink: C.accent800, bar: '#3d9a88', rowBg: 'transparent', rank: 2 };
  if (used >= warnAt) return { key: 'near', label: 'Near limit', bg: C.amberTint, ink: C.amberInk, bar: C.amber, rowBg: '#fffcf5', rank: 1 };
  return { key: 'ok', label: 'On track', bg: C.accentTint, ink: C.accent800, bar: C.mint[5], rowBg: 'transparent', rank: 2 };
}

export type TxView = Transaction & {
  /** Effective category after the user's re-categorisation. */
  cat: string;
  offset: number;
  week: number;
  edited: boolean;
  isIncome: boolean;
};

export type CatView = Category & {
  limit: number;
  /** This cycle's spend per week (W1–W4). */
  cur: number[];
  /** Last cycle's spend per week. */
  prev: number[];
  spent: number;
  /** Last cycle's spend over the same number of days. */
  lastSameDays: number;
  remaining: number;
  used: number;
  status: Status;
};

export type Budget = {
  txs: TxView[];
  bills: Bill[];
  cats: CatView[];
  income: number;
  incomeReceived: number;
  budget: number;
  varBudget: number;
  savingsTarget: number;
  fixedSpent: number;
  varSpent: number;
  spent: number;
  fixedDue: number;
  /** Variable spend per day so far. */
  velDay: number;
  projTotal: number;
  projSavePct: number;
  paceToday: number;
  safeDay: number;
  weekTotal: (w: number) => number;
};

export function computeBudget(args: {
  transactions: Transaction[];
  /** Last cycle's transactions, for the comparisons. */
  prevTransactions: Transaction[];
  prevCycle: Cycle;
  bills: Bill[];
  recat: Record<string, string>;
  cycle: Cycle;
  income: number;
  warnAt: number;
}): Budget {
  const { transactions, prevTransactions, prevCycle, bills, recat, cycle, income, warnAt } = args;
  const ofIncome = (p: number) => (p / 100) * income;

  const txs: TxView[] = transactions
    .map(t => {
      const cat = recat[t.id] ?? t.category;
      const offset = cycle.offsetOf(t.date);
      return { ...t, cat, offset, week: weekOf(offset), edited: cat !== t.category, isIncome: t.category === INCOME_CATEGORY };
    })
    .sort((a, b) => b.date.getTime() - a.date.getTime() || b.time.localeCompare(a.time));

  const weekFrac = Math.min(1, (cycle.dayIdx - cycle.weekIdx * 7 + 1) / 7);
  const cats: CatView[] = CATEGORIES.map(c => {
    const mine = txs.filter(t => t.cat === c.name);
    const cur = [0, 1, 2, 3].map(w => sum(mine.filter(t => t.week === w).map(t => t.amount)));
    const prevMine = prevTransactions.filter(t => (recat[t.id] ?? t.category) === c.name);
    const prev = [0, 1, 2, 3].map(w => sum(prevMine.filter(t => weekOf(prevCycle.offsetOf(t.date)) === w).map(t => t.amount)));
    const spent = sum(cur);
    const limit = ofIncome(c.limitPct);
    const used = limit ? (spent / limit) * 100 : 0;
    const lastSameDays = sum(prev.slice(0, cycle.weekIdx)) + prev[cycle.weekIdx] * weekFrac;
    return { ...c, limit, cur, prev, spent, lastSameDays, remaining: limit - spent, used, status: categoryStatus(used, c.type, warnAt) };
  });

  const fixedSpent = sum(cats.filter(c => c.type === 'fixed').map(c => c.spent));
  const varSpent = sum(cats.filter(c => c.type === 'variable').map(c => c.spent));
  const spent = fixedSpent + varSpent;
  const budget = sum(cats.map(c => c.limit));
  const varBudget = sum(cats.filter(c => c.type === 'variable').map(c => c.limit));
  const fixedDue = sum(bills.map(b => b.amount));
  const velDay = varSpent / cycle.dayN;
  const projTotal = spent + velDay * cycle.daysLeft + fixedDue;

  return {
    txs,
    bills,
    cats,
    income,
    incomeReceived: sum(txs.filter(t => t.cat === INCOME_CATEGORY).map(t => t.amount)),
    budget,
    varBudget,
    savingsTarget: ofIncome(SAVINGS_TARGET_PCT),
    fixedSpent,
    varSpent,
    spent,
    fixedDue,
    velDay,
    projTotal,
    projSavePct: 100 - (projTotal / income) * 100,
    paceToday: fixedSpent + (varBudget * cycle.dayN) / cycle.cycleDays,
    safeDay: Math.max(0, (budget - spent - fixedDue) / Math.max(1, cycle.daysLeft)),
    weekTotal: w => sum(cats.map(c => c.cur[w])),
  };
}

/** Change-vs-last badge: ↓ good (mint), ↑ bad (red). */
export function changeBadge(cur: number, last: number) {
  const ch = last ? ((cur - last) / last) * 100 : 0;
  const r = Math.round(Math.abs(ch));
  if (r === 0) return { label: '0%', bg: C.divider, ink: C.textMuted };
  return ch < 0 ? { label: '↓ ' + r + '%', bg: C.accentTint, ink: C.accent800 } : { label: '↑ ' + r + '%', bg: C.redTint, ink: C.redInk };
}

/** Icon chip colours for a category type. */
export const iconColors = (type?: string) => ({ bg: C.accentTint, ink: type === 'variable' ? C.accent600 : C.accent800 });
