import { CATEGORIES, CC_PAYMENT_CATEGORY, categoryByName, INCOME_CATEGORY, INVESTMENT_CATEGORY, SAVINGS_TARGET_PCT, TRANSFER_CATEGORY, type Category } from '../data/categories';
import { isCard, type Bill, type CardCycle, type Transaction } from '../data/transactions';
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

/** Red (over) and amber (near) override the category's own colour on bars. */
export function categoryStatus(used: number, c: Pick<Category, 'type' | 'color'>, warnAt: number): Status {
  if (used >= 100.5) return { key: 'over', label: 'Over limit', bg: C.red, ink: '#ffffff', bar: C.red, rowBg: '#fff8f7', rank: 0 };
  if (c.type === 'fixed')
    return { key: 'ok', label: used >= 99 ? 'Bill paid' : 'On plan', bg: C.accentTint, ink: C.accent800, bar: c.color, rowBg: 'transparent', rank: 2 };
  if (used >= warnAt) return { key: 'near', label: 'Near limit', bg: C.amberTint, ink: C.amberInk, bar: C.amber, rowBg: '#fffcf5', rank: 1 };
  return { key: 'ok', label: 'On track', bg: C.accentTint, ink: C.accent800, bar: c.color, rowBg: 'transparent', rank: 2 };
}

export type TxView = Transaction & {
  /** Effective category after the user's re-categorisation. */
  cat: string;
  offset: number;
  week: number;
  edited: boolean;
  isIncome: boolean;
  /** Any move between your own accounts: card bill payments and investments included. */
  isTransfer: boolean;
  /** Moved to the Investing pocket (brokers): not spending. */
  isInvestment: boolean;
  isCcPayment: boolean;
  /** Salary is never a reimbursement. */
  isSalary: boolean;
  /** Income only: the expense this pays you back for. */
  reimbursesId?: string;
  /** Expenses only: how much was paid back, by whom, and what's left as your own spending. */
  reimbursed: number;
  paidBackBy: string[];
  /** Expenses only: the part you said is yours, when you paid for others too (no transfer to link). */
  share?: number;
  net: number;
};

export type CardView = {
  account: string;
  /** Purchases on the card this cycle. */
  spent: number;
  /** Last cycle's purchases: the bill due this cycle. */
  lastBill: number;
  /** Bill payments to the card this cycle. */
  paid: number;
  paidOn: Date | null;
  carriedOver: number;
  owed: number;
  paidInFull: boolean;
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
  cards: CardView[];
  /** Spending not on a credit card (bank, cash, e-wallet). */
  nonCardSpent: number;
  cardBillsPaid: number;
  /** Money that actually left your accounts: non-card spending + card bills paid. */
  cashOut: number;
  /** Moved to the Investing pocket this cycle. */
  invested: number;
};

/** Budget categories (built-in and yours) count as spending. */
const SPENDING = { has: (name: string) => !!categoryByName(name) };

/** Per card: what was spent, what last cycle's bill was, and how much of it is paid. */
export function cardViews(txs: TxView[], prev: CardCycle[]): CardView[] {
  const names = new Set([
    ...prev.map(p => p.account),
    ...txs.filter(t => isCard(t.account) && SPENDING.has(t.cat)).map(t => t.account),
    ...txs.flatMap(t => (t.isCcPayment && t.toAccount ? [t.toAccount] : [])),
  ]);
  return [...names].sort().map(account => {
    const spent = sum(txs.filter(t => t.account === account && SPENDING.has(t.cat)).map(t => t.amount));
    const payments = txs.filter(t => t.isCcPayment && t.toAccount === account);
    const paid = sum(payments.map(t => t.amount));
    const lastBill = prev.find(p => p.account === account)?.prevCycleSpend ?? 0;
    const carriedOver = Math.max(0, lastBill - paid);
    return { account, spent, lastBill, paid, paidOn: payments[0]?.date ?? null, carriedOver, owed: carriedOver + spent, paidInFull: carriedOver < 1 };
  });
}

export const isSalary = (t: Pick<Transaction, 'title' | 'source'>) => t.source === 'Payroll email' || /\b(salary|gaji|payroll|payslip|thr)\b/i.test(t.title);

/** "Transfer from Rangga" → "Rangga". */
export const payerName = (title: string) => title.replace(/^transfer from\s+/i, '').trim() || title;

/**
 * Valid reimbursement links (income → expense) and what each expense got back.
 * A link only counts while the income is still non-salary income.
 */
function reimbursements(all: Transaction[], recat: Record<string, string>, links: Record<string, string>) {
  const byId = new Map(all.map(t => [t.id, t]));
  const valid = new Map<string, string>();
  const back = new Map<string, { amount: number; names: string[] }>();
  for (const [incomeId, expenseId] of Object.entries(links)) {
    const inc = byId.get(incomeId);
    if (!inc || (recat[inc.id] ?? inc.category) !== INCOME_CATEGORY || isSalary(inc)) continue;
    valid.set(incomeId, expenseId);
    const r = back.get(expenseId) ?? { amount: 0, names: [] };
    r.amount += Math.abs(inc.amount);
    const name = payerName(inc.title);
    if (!r.names.includes(name)) r.names.push(name);
    back.set(expenseId, r);
  }
  return { valid, back };
}

export function computeBudget(args: {
  transactions: Transaction[];
  /** Last cycle's transactions, for the comparisons. */
  prevTransactions: Transaction[];
  prevCycle: Cycle;
  bills: Bill[];
  recat: Record<string, string>;
  /** Reimbursements: { incomeId: expenseId }. */
  links: Record<string, string>;
  /** Your share of an expense as a fraction of its amount: { txId: 0–1 }. */
  shares: Record<string, number>;
  cycle: Cycle;
  income: number;
  warnAt: number;
}): Budget {
  const { transactions, prevTransactions, prevCycle, bills, recat, links, shares, cycle, income, warnAt } = args;
  const ofIncome = (p: number) => (p / 100) * income;
  const { valid, back } = reimbursements([...transactions, ...prevTransactions], recat, links);
  const shareOf = (t: Transaction) => (shares[t.id] == null ? undefined : Math.round(shares[t.id] * t.amount * 100) / 100);
  /** What counts as your spending: your share if you set one, less what others paid back. */
  const netOf = (t: Transaction) => Math.max(0, Math.min(shareOf(t) ?? t.amount, t.amount - (back.get(t.id)?.amount ?? 0)));

  const txs: TxView[] = transactions
    .map(t => {
      // Card bill payments can't be re-categorised: they'd count the card's purchases twice.
      const isCcPayment = t.category === CC_PAYMENT_CATEGORY;
      const cat = isCcPayment ? t.category : (recat[t.id] ?? t.category);
      const offset = cycle.offsetOf(t.date);
      return {
        ...t,
        cat,
        offset,
        week: weekOf(offset),
        edited: cat !== t.category,
        isIncome: cat === INCOME_CATEGORY,
        isTransfer: isCcPayment || cat === TRANSFER_CATEGORY || cat === INVESTMENT_CATEGORY,
        isInvestment: cat === INVESTMENT_CATEGORY,
        isCcPayment,
        isSalary: isSalary(t),
        reimbursesId: valid.get(t.id),
        reimbursed: back.get(t.id)?.amount ?? 0,
        paidBackBy: back.get(t.id)?.names ?? [],
        share: shareOf(t),
        net: netOf(t),
      };
    })
    .sort((a, b) => b.date.getTime() - a.date.getTime() || b.time.localeCompare(a.time));

  const weekFrac = Math.min(1, (cycle.dayIdx - cycle.weekIdx * 7 + 1) / 7);
  const cats: CatView[] = CATEGORIES.map(c => {
    const mine = txs.filter(t => t.cat === c.name);
    const cur = [0, 1, 2, 3].map(w => sum(mine.filter(t => t.week === w).map(t => t.net)));
    const prevMine = prevTransactions.filter(t => (recat[t.id] ?? t.category) === c.name);
    const prev = [0, 1, 2, 3].map(w => sum(prevMine.filter(t => weekOf(prevCycle.offsetOf(t.date)) === w).map(netOf)));
    const spent = sum(cur);
    const limit = ofIncome(c.limitPct);
    const used = limit ? (spent / limit) * 100 : 0;
    const lastSameDays = sum(prev.slice(0, cycle.weekIdx)) + prev[cycle.weekIdx] * weekFrac;
    return { ...c, limit, cur, prev, spent, lastSameDays, remaining: limit - spent, used, status: categoryStatus(used, c, warnAt) };
  });

  const fixedSpent = sum(cats.filter(c => c.type === 'fixed').map(c => c.spent));
  const varSpent = sum(cats.filter(c => c.type === 'variable').map(c => c.spent));
  const spent = fixedSpent + varSpent;
  const budget = sum(cats.map(c => c.limit));
  const varBudget = sum(cats.filter(c => c.type === 'variable').map(c => c.limit));
  const fixedDue = sum(bills.map(b => b.amount));
  const velDay = varSpent / cycle.dayN;
  const projTotal = spent + velDay * cycle.daysLeft + fixedDue;

  const prevCards = new Map<string, number>();
  for (const t of prevTransactions)
    if (isCard(t.account) && SPENDING.has(recat[t.id] ?? t.category)) prevCards.set(t.account, (prevCards.get(t.account) ?? 0) + t.amount);
  const cards = cardViews(txs, [...prevCards].map(([account, prevCycleSpend]) => ({ account, prevCycleSpend })));
  const nonCardSpent = sum(txs.filter(t => SPENDING.has(t.cat) && !isCard(t.account)).map(t => t.amount));
  const cardBillsPaid = sum(txs.filter(t => t.isCcPayment).map(t => t.amount));

  return {
    txs,
    bills,
    cats,
    income,
    incomeReceived: sum(txs.filter(t => t.isIncome && !t.reimbursesId).map(t => t.amount)),
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
    cards,
    nonCardSpent,
    cardBillsPaid,
    cashOut: nonCardSpent + cardBillsPaid,
    invested: sum(txs.filter(t => t.isInvestment).map(t => t.amount)),
  };
}

/**
 * What a transaction adds to a day's total: incomes count in, expenses count out at their net (after
 * reimbursements and your share). Transfers, card payments, investments and paid-back incomes count 0.
 */
export const dayAmount = (t: TxView) => (t.isIncome ? (t.reimbursesId ? 0 : t.amount) : t.isTransfer ? 0 : -t.net);
/** Whether a transaction is part of a day's total at all (a day of only transfers gets no total). */
export const inDayTotal = (t: TxView) => !t.isTransfer && !(t.isIncome && t.reimbursesId);

/** A day total as rows show it: spending as "Rp X", a day with more income than spending as "+ Rp X". */
export const dayTotalLabel = (total: number, full: (v: number) => string) => (total > 0 ? '+ ' + full(total) : full(-total));

/** Change-vs-last badge: ↓ good (mint), ↑ bad (red). */
export function changeBadge(cur: number, last: number) {
  const ch = last ? ((cur - last) / last) * 100 : 0;
  const r = Math.round(Math.abs(ch));
  if (r === 0) return { label: '0%', bg: C.divider, ink: C.textMuted };
  return ch < 0 ? { label: '↓ ' + r + '%', bg: C.accentTint, ink: C.accent800 } : { label: '↑ ' + r + '%', bg: C.redTint, ink: C.redInk };
}

/** Icon chip colours for a category; anything else (income, savings, transfers) uses the accent. */
export function iconColors(category?: string) {
  const c = category ? categoryByName(category) : undefined;
  return c ? { bg: c.tint, ink: c.ink } : { bg: C.accentTint, ink: C.accent800 };
}
