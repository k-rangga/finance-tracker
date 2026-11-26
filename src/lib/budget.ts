import { CATEGORIES, CC_PAYMENT_CATEGORY, categoryByName, INCOME_CATEGORY, INSTALLMENT_CATEGORY, INVESTMENT_CATEGORY, SAVINGS_CATEGORY, SAVINGS_TARGET_PCT, TRANSFER_CATEGORY, type Category } from '../data/categories';
import { isCard, type Bill, type CardCycle, type Transaction } from '../data/transactions';
import { weekOf, type Cycle } from './cycle';
import { sum } from './format';
import { projectCycleSpend, type PaceResult } from './pace';
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
  if (used >= 100.5) return { key: 'over', label: 'Over limit', bg: C.redTint, ink: C.redInk, bar: C.red, rowBg: 'var(--red-row)', rank: 0 };
  if (c.type === 'fixed')
    return { key: 'ok', label: used >= 99 ? 'Bill paid' : 'On plan', bg: C.goodTint, ink: C.good, bar: c.color, rowBg: 'transparent', rank: 2 };
  if (used >= warnAt) return { key: 'near', label: 'Near limit', bg: C.amberTint, ink: C.amberInk, bar: C.amber, rowBg: 'var(--amber-row)', rank: 1 };
  return { key: 'ok', label: 'On track', bg: C.goodTint, ink: C.good, bar: c.color, rowBg: 'transparent', rank: 2 };
}

export type TxView = Transaction & {
  /** Effective category after the user's re-categorisation. */
  cat: string;
  /** Sub-category inside `cat`, when it has one (see resolveSubs). */
  sub?: string;
  offset: number;
  week: number;
  edited: boolean;
  isIncome: boolean;
  /** Any move between your own accounts: card bill payments and investments included. */
  isTransfer: boolean;
  /** Moved to the Investing pocket (brokers): not spending. */
  isInvestment: boolean;
  /** Moved to your savings account ("Transfer (savings)"): what counts as saved. */
  isSavings: boolean;
  /** A purchase paid in installments: not spending itself; its monthly payments are. */
  isInstallment: boolean;
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
  /** Installment payments in `spent` (the same payments as the plan schedule). */
  installments: number;
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
  /** Projected total spend by payday (see projectCycleSpend). */
  projTotal: number;
  /** How the projection was built: one-offs, rhythm basis, and the day-by-day path for the chart. */
  proj: PaceResult;
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
  /** Moved to savings this cycle: transactions you put in "Transfer (savings)". */
  saved: number;
  /** `saved` as % of income: what the savings ring and plan show. */
  savedPct: number;
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
    const installments = sum(txs.filter(t => t.account === account && t.plan && SPENDING.has(t.cat)).map(t => t.amount));
    return { account, spent, installments, lastBill, paid, paidOn: payments[0]?.date ?? null, carriedOver, owed: carriedOver + spent, paidInFull: carriedOver < 1 };
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

const OWN_NAME_NOISE = /^(mr|mrs|ms|bp|bpk|ibu|sdr|sdri|pt|cv|tbk|bank|bca|blu|mandiri|bni|bri|cimb|permata|jenius|jago|seabank|superbank|danamon|ocbc|uob|hsbc|gopay|ovo|dana|shopeepay|linkaja|rekening|account|tabungan|bluaccount)$/;
const MERCHANT_HINT = /\b(warung|toko|cafe|caf[eé]|kopi|coffee|resto|restoran|restaurant|mart|shop|store|bakery|pt|cv|tbk|grab|gojek|tokopedia|shopee|lazada|blibli|klinik|apotek|hotel|salon|barber|laundry|spbu|pertamina|shell|parkir|tol)\b/i;

/** True when a bank/e-wallet counterparty title clearly matches one of the user's own account names. */
export function isOwnAccountName(title: string, ownNames: string[]): boolean {
  if (!ownNames.length || !title || MERCHANT_HINT.test(title)) return false;
  const letters = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
  const tokens = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(w => w && /^[a-z]+$/.test(w) && !OWN_NAME_NOISE.test(w));
  const n = letters(title);
  if (n.length < 4) return false;
  const nt = tokens(title);
  if (!nt.length) return false;
  return ownNames.some(raw => {
    const h = raw.trim();
    if (!h || !/[a-z]/i.test(h)) return false;
    const x = letters(h);
    if (x.length >= 4 && (n === x || n.startsWith(x) || x.startsWith(n))) return true;
    const ht = tokens(h);
    if (!ht.length) return false;
    if (ht.length === 1) return ht[0].length >= 4 && nt.includes(ht[0]);
    const shared = ht.filter(w => w.length >= 3 && nt.includes(w));
    if (shared.length >= 2) return true;
    if (shared.length === 1 && shared[0].length >= 4) {
      const restH = ht.filter(w => w !== shared[0]);
      const restN = nt.filter(w => w !== shared[0]);
      if (restH.some(w => restN.some(t => w[0] === t[0] && (w.length === 1 || t.length === 1 || t.startsWith(w) || w.startsWith(t))))) return true;
    }
    return false;
  });
}

function effectiveCategory(t: Transaction, recat: Record<string, string>, ownNames: string[]): string {
  if (t.category === CC_PAYMENT_CATEGORY) return t.category;
  if (t.id in recat) return recat[t.id];
  if (
    ownNames.length > 0 &&
    (t.source === 'Bank email' || t.source === 'E-wallet email') &&
    (t.category === 'Buffer' || t.category === INCOME_CATEGORY) &&
    !isSalary(t) &&
    isOwnAccountName(t.title, ownNames)
  ) {
    return TRANSFER_CATEGORY;
  }
  return t.category;
}

/**
 * Transactions as the screens show them: effective category, reimbursements and your share applied.
 * `context` is every transaction a reimbursement may link across (at least `transactions` itself).
 */
export function txViews(
  transactions: Transaction[],
  context: Transaction[],
  { recat, links, shares, cycle, subs = {}, ownNames = [] }: { recat: Record<string, string>; links: Record<string, string>; shares: Record<string, number>; cycle: Cycle; subs?: Record<string, string>; ownNames?: string[] },
) {
  const { valid, back } = reimbursements(context, recat, links);
  const shareOf = (t: Transaction) => (shares[t.id] == null ? undefined : Math.round(shares[t.id] * t.amount * 100) / 100);
  /** What counts as your spending: your share if you set one, less what others paid back. */
  const netOf = (t: Transaction) => Math.max(0, Math.min(shareOf(t) ?? t.amount, t.amount - (back.get(t.id)?.amount ?? 0)));

  const txs: TxView[] = transactions
    .map(t => {
      // Card bill payments can't be re-categorised: they'd count the card's purchases twice.
      const isCcPayment = t.category === CC_PAYMENT_CATEGORY;
      const cat = effectiveCategory(t, recat, ownNames);
      const offset = cycle.offsetOf(t.date);
      return {
        ...t,
        cat,
        sub: subs[t.id],
        offset,
        week: weekOf(offset),
        edited: cat !== t.category,
        isIncome: cat === INCOME_CATEGORY,
        // Installment purchases sit with transfers: kept out of spending, like money that hasn't really left yet.
        isTransfer: isCcPayment || cat === TRANSFER_CATEGORY || cat === SAVINGS_CATEGORY || cat === INVESTMENT_CATEGORY || cat === INSTALLMENT_CATEGORY,
        isInstallment: cat === INSTALLMENT_CATEGORY,
        isInvestment: cat === INVESTMENT_CATEGORY,
        isSavings: cat === SAVINGS_CATEGORY,
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
  return { txs, netOf };
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
  /** Each transaction's sub-category (see resolveSubs). */
  subs?: Record<string, string>;
  /** Names on the user's own bank accounts, used to treat already-imported self-transfers as Transfer. */
  ownNames?: string[];
  cycle: Cycle;
  income: number;
  warnAt: number;
  /** Planned expenses this cycle by category (paid or not): each category's plan grows by them. */
  plannedCosts?: Record<string, number>;
  /** Exact totals from individual fixed bills per category (fixed currency amount, immune to income % drift). */
  fixedBillLimits?: Record<string, number>;
  /** Up to 3 past cycles (most recent first) for the projection's rhythm; defaults to just the previous cycle. */
  history?: { transactions: Transaction[]; cycle: Cycle }[];
}): Budget {
  const { transactions, prevTransactions, prevCycle, bills, recat, links, shares, subs, ownNames = [], cycle, income, warnAt, plannedCosts = {}, fixedBillLimits = {} } = args;
  const history = args.history?.length ? args.history : [{ transactions: prevTransactions, cycle: prevCycle }];
  const ofIncome = (p: number) => (p / 100) * income;
  const { txs, netOf } = txViews(transactions, [...transactions, ...prevTransactions], { recat, links, shares, cycle, subs, ownNames });

  const weekFrac = Math.min(1, (cycle.dayIdx - cycle.weekIdx * 7 + 1) / 7);
  const cats: CatView[] = CATEGORIES.map(c => {
    const mine = txs.filter(t => t.cat === c.name);
    const cur = [0, 1, 2, 3].map(w => sum(mine.filter(t => t.week === w).map(t => t.net)));
    const prevMine = prevTransactions.filter(t => effectiveCategory(t, recat, ownNames) === c.name);
    const prev = [0, 1, 2, 3].map(w => sum(prevMine.filter(t => weekOf(prevCycle.offsetOf(t.date)) === w).map(netOf)));
    const spent = sum(cur);
    // Installment payments count in their own category, and its plan grows by them (paid so far plus still due),
    // so a payment you already committed to never reads as overspending.
    const planned = sum(mine.filter(t => t.plan && cycle.offsetOf(t.date) >= 0).map(t => t.net)) + sum(bills.filter(b => b.source === 'Installment' && b.category === c.name).map(b => b.amount));
    const fixedAmt = fixedBillLimits[c.name] ?? 0;
    const base = fixedAmt > 0 ? fixedAmt : ofIncome(c.limitPct);
    const limit = c.auto ? spent + sum(bills.filter(b => b.category === c.name).map(b => b.amount)) : base + planned + (plannedCosts[c.name] ?? 0);
    const used = limit ? (spent / limit) * 100 : 0;
    const lastSameDays = sum(prev.slice(0, cycle.weekIdx)) + prev[cycle.weekIdx] * weekFrac;
    // An auto or fixed-bill-driven plan reads as its share of income too, so the plan's percentages add up.
    const limitPct = c.auto || fixedAmt > 0 ? (income ? (limit / income) * 100 : 0) : c.limitPct;
    return { ...c, limitPct, limit, cur, prev, spent, lastSameDays, remaining: limit - spent, used, status: categoryStatus(used, c, warnAt) };
  });

  const fixedSpent = sum(cats.filter(c => c.type === 'fixed').map(c => c.spent));
  const varSpent = sum(cats.filter(c => c.type === 'variable').map(c => c.spent));
  const spent = fixedSpent + varSpent;
  const budget = sum(cats.map(c => c.limit));
  const varBudget = sum(cats.filter(c => c.type === 'variable').map(c => c.limit));
  const fixedDue = sum(bills.map(b => b.amount));
  const velDay = varSpent / cycle.dayN;
  const isVariable = (cat: string) => categoryByName(cat)?.type === 'variable';
  const proj = projectCycleSpend({
    cycleDays: cycle.cycleDays,
    dayIdx: cycle.dayIdx,
    startDow: cycle.start.getDay(),
    cur: txs
      .filter(t => isVariable(t.cat) && t.offset >= 0 && t.offset <= cycle.dayIdx)
      .map(t => ({ offset: t.offset, amount: t.net, committed: !!t.plan })),
    history: history.map(h => {
      const hDays = Math.max(1, h.cycle.cycleDays);
      return {
        days: hDays,
        startDow: h.cycle.start.getDay(),
        txs: h.transactions
          .filter(t => isVariable(effectiveCategory(t, recat, ownNames)))
          .map(t => ({ offset: h.cycle.offsetOf(t.date), amount: netOf(t), committed: !!t.plan }))
          .filter(t => t.offset >= 0 && t.offset < hDays),
      };
    }),
    varBudget,
    varBillsDue: sum(bills.filter(b => isVariable(b.category)).map(b => b.amount)),
    bills: bills.map(b => ({ offset: cycle.offsetOf(b.date), amount: b.amount })),
  });
  const projTotal = spent + proj.remainingVar + fixedDue;

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
    proj,
    projSavePct: income > 0 ? 100 - (projTotal / income) * 100 : 0,
    paceToday: fixedSpent + (varBudget * cycle.dayN) / cycle.cycleDays,
    // Days remaining including today (matches "N days to payday" on Summary and Categories).
    safeDay: Math.max(0, (budget - spent - fixedDue) / Math.max(1, cycle.daysLeft + 1)),
    weekTotal: w => sum(cats.map(c => c.cur[w])),
    cards,
    nonCardSpent,
    cardBillsPaid,
    cashOut: nonCardSpent + cardBillsPaid,
    invested: sum(txs.filter(t => t.isInvestment).map(t => t.amount)),
    saved: sum(txs.filter(t => t.isSavings).map(t => t.amount)),
    savedPct: income > 0 ? (sum(txs.filter(t => t.isSavings).map(t => t.amount)) / income) * 100 : 0,
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
  return ch < 0 ? { label: '↓ ' + r + '%', bg: C.goodTint, ink: C.good } : { label: '↑ ' + r + '%', bg: C.redTint, ink: C.redInk };
}

/** Icon chip colours: the category's soft tint with primary ink; transfers, income and the like stay neutral. */
export function iconChip(category?: string) {
  const c = category ? categoryByName(category) : undefined;
  return c ? { bg: c.tint, ink: 'var(--ink)' } : { bg: 'var(--surface-200)', ink: 'var(--ink)' };
}
