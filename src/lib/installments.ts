/**
 * Every installment plan in one schedule, so Fixed bills, Next cycle, each transaction and the card bill all show
 * the same payments on the same dates.
 *
 * Two kinds of plan:
 * - purchase: a purchase you split ("Pay in installments…"); its monthly payments are generated (installmentPayments).
 * - detected: a plan the bank already bills monthly (e.g. "CICILAN IPHONE 03/12"), found in your charges and
 *   confirmed by you. Its real charges count as they come; the rest are projected a month apart.
 */
import { addMonths, isCard, merchantKey, type Bill, type Transaction } from '../data/transactions';
import { INTEREST_CATEGORY } from '../data/categories';
import type { Cycle } from './cycle';
import { parseISO, tidyName, toISO } from './format';

/** An installment the bank bills monthly, confirmed by you: `firstPayment` is the payment number charged on `firstDate`. */
export type TrackedInstallment = {
  id: string;
  name: string;
  /** merchantKey of the charge, without the "03/12" part. */
  merchant: string;
  account: string;
  amount: number;
  months: number;
  firstPayment: number;
  /** YYYY-MM-DD */
  firstDate: string;
};

/** `amount` is the whole payment; `interest` the part of it that's interest (in Interest & fees). */
export type PlanPayment = { n: number; date: Date; amount: number; interest: number; paid: boolean };
export type PlanView = {
  /** Purchase id, or "tracked:<id>". */
  key: string;
  kind: 'purchase' | 'detected';
  title: string;
  account: string;
  /** Where its payments count: the purchase's category (or the charges'), never a separate Installments one. */
  category: string;
  months: number;
  /** Payments from the first one known (a detected plan starts at the payment it was found at). */
  payments: PlanPayment[];
};

const DAY = 864e5;
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

/** The "03/12" in a bank's installment line: payment 3 of 12. */
const PART = /\b(\d{1,2})\s*\/\s*(\d{1,2})\b/;
/** Words banks and paylater apps use for installments. */
const WORDS = /\b(cicilan|angsuran|installment|instalment|cicil)\b/i;
/** Paylater providers: monthly charges from them are installments, not bills. */
const PAYLATER = /\b(kredivo|akulaku|atome|spaylater|shopee ?paylater|gopaylater|home ?credit|indodana|kredit ?pintar|traveloka ?paylater)\b/i;

/** A charge's merchant without its "03/12" and installment words, so every month of one plan matches. */
export const planMerchant = (title: string) => merchantKey(title.replace(PART, ' ').replace(WORDS, ' '));

const matches = (t: Transaction, x: TrackedInstallment) =>
  t.type === 'expense' &&
  t.account === x.account &&
  ` ${planMerchant(t.title)} `.includes(` ${x.merchant} `) &&
  Math.abs(t.amount - x.amount) <= Math.max(1, x.amount * 0.02) &&
  t.date.getTime() >= parseISO(x.firstDate).getTime() - 3 * DAY;

/** Each tracked plan's real charges, oldest first, at most one per remaining payment. */
export function matchTracked(txs: Transaction[], tracked: TrackedInstallment[]): Map<string, Transaction[]> {
  const used = new Set<string>();
  const out = new Map<string, Transaction[]>();
  for (const x of tracked) {
    const list = txs
      .filter(t => !used.has(t.id) && matches(t, x))
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .slice(0, Math.max(0, x.months - x.firstPayment + 1));
    list.forEach(t => used.add(t.id));
    out.set(x.id, list);
  }
  return out;
}

/** Tracked plans' real charges marked as installment payments (which payment of how many); they keep their category. */
export function withTrackedPlans(txs: Transaction[], tracked: TrackedInstallment[], matched: Map<string, Transaction[]>): Transaction[] {
  const plan = new Map<string, Transaction['plan']>();
  for (const x of tracked)
    (matched.get(x.id) ?? []).forEach((t, i) => plan.set(t.id, { of: 'tracked:' + x.id, month: x.firstPayment + i, months: x.months, part: 'price', for: t.category }));
  return txs.map(t => (plan.has(t.id) ? { ...t, plan: plan.get(t.id) } : t));
}

/** Every plan with its payments. `payments`: generated purchase payments; `today` decides what's paid. */
export function planViews(payments: Transaction[], purchases: Transaction[], tracked: TrackedInstallment[], matched: Map<string, Transaction[]>, today: Date, catOf: (t: Transaction) => string = t => t.category): PlanView[] {
  const views: PlanView[] = [];
  const by = new Map<string, Transaction[]>();
  for (const t of payments) if (t.plan) by.set(t.plan.of, [...(by.get(t.plan.of) ?? []), t]);
  for (const [of, list] of by) {
    const purchase = purchases.find(t => t.id === of);
    const months = list[0].plan!.months;
    const per = new Map<number, PlanPayment>();
    for (const t of list) {
      const p = per.get(t.plan!.month) ?? { n: t.plan!.month, date: t.date, amount: 0, interest: 0, paid: t.date <= today };
      p.amount += t.amount;
      if (t.plan!.part === 'interest') p.interest += t.amount;
      per.set(t.plan!.month, p);
    }
    views.push({
      key: of,
      kind: 'purchase',
      title: tidyName(purchase?.title ?? list[0].title.replace(/ \(\d+\/\d+\)( interest)?$/, '')),
      account: list[0].account,
      category: list.find(t => t.plan!.part === 'price')?.category ?? list[0].category,
      months,
      payments: [...per.values()].sort((a, b) => a.n - b.n),
    });
  }
  for (const x of tracked) {
    const real = matched.get(x.id) ?? [];
    const first = parseISO(x.firstDate);
    const list: PlanPayment[] = [];
    for (let n = x.firstPayment; n <= x.months; n++) {
      const t = real[n - x.firstPayment];
      // After the last real charge, the rest follow a month apart from it.
      const lastReal = real[real.length - 1];
      const date = t ? t.date : lastReal ? addMonths(lastReal.date, n - (x.firstPayment + real.length - 1)) : addMonths(first, n - x.firstPayment);
      list.push({ n, date, amount: t ? t.amount : x.amount, interest: 0, paid: !!t || date <= today });
    }
    const latest = real[real.length - 1];
    views.push({ key: 'tracked:' + x.id, kind: 'detected', title: x.name, account: x.account, category: latest ? catOf(latest) : 'Shopping', months: x.months, payments: list });
  }
  return views.sort((a, b) => a.title.localeCompare(b.title));
}

/** The payment due in a cycle (or the first one, when a cycle holds two). */
export const paymentIn = (p: PlanView, c: { start: Date; end: Date }) => p.payments.find(x => x.date >= c.start && x.date <= c.end);
/** Every payment due in a cycle, together. */
export const dueIn = (p: PlanView, c: { start: Date; end: Date }) => sum(p.payments.filter(x => x.date >= c.start && x.date <= c.end).map(x => x.amount));
/** What's still to pay after `date`. */
export const leftAfter = (p: PlanView, date: Date) => sum(p.payments.filter(x => x.date > date).map(x => x.amount));
/** The last payment's date. */
export const planEnd = (p: PlanView) => p.payments[p.payments.length - 1]?.date;
/** A typical month's payment (the most common amount). */
export function monthly(p: PlanView) {
  const n = new Map<number, number>();
  for (const x of p.payments) n.set(Math.round(x.amount), (n.get(Math.round(x.amount)) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
}

/**
 * Installment payments still due in a cycle (after its `today`), as bills: the same amounts and dates as the
 * schedule. The price is due in the plan's category; interest, if any, in Interest & fees.
 */
export function planBills(views: PlanView[], cycle: Cycle): Bill[] {
  return views.flatMap(p =>
    p.payments
      .filter(x => x.date > cycle.today && x.date <= cycle.end)
      .flatMap(x => {
        const base = { date: x.date, title: `${p.title} (${x.n}/${p.months})`, source: 'Installment', left: leftAfter(p, x.date) };
        return [
          { ...base, category: p.category, amount: x.amount - x.interest },
          ...(x.interest > 0 ? [{ ...base, title: base.title + ' interest', category: INTEREST_CATEGORY, amount: x.interest }] : []),
        ];
      }),
  );
}

/** For the next cycles, how much each plan bills in each (Installments ahead). */
export function plansAhead(views: PlanView[], cycles: { start: Date; end: Date }[], today: Date) {
  return views
    .map(p => ({ of: p.key, title: p.title, account: p.account, perCycle: cycles.map(c => dueIn(p, c)), last: planEnd(p), left: leftAfter(p, today) }))
    .filter(p => p.left > 0 || p.perCycle.some(v => v > 0));
}

/** An installment found in your charges, not yet confirmed. `payment`: which payment the latest charge is, when the bank says. */
export type FoundInstallment = { key: string; name: string; merchant: string; account: string; amount: number; months: number | null; payment: number; firstDate: string; latestDate: string; charges: number };

/**
 * Charges that look like an installment: a bank line saying so ("CICILAN … 03/12"), or the same amount from the
 * same merchant on a card or paylater in two different months. Bills you've set (Housing, Utilities…) and
 * subscriptions are left out, as are plans you already have or said aren't installments.
 */
export function detectInstallments(
  txs: Transaction[],
  opts: { catOf: (t: Transaction) => string; skipCats: string[]; subMerchants: string[]; tracked: TrackedInstallment[]; notInstallments: string[]; minAmount: number },
): FoundInstallment[] {
  const groups = new Map<string, Transaction[]>();
  for (const t of txs) {
    if (t.type !== 'expense' || t.plan) continue;
    const cat = opts.catOf(t);
    if (opts.skipCats.includes(cat)) continue;
    const m = planMerchant(t.title);
    if (!m) continue;
    groups.set(`${t.account}|${m}`, [...(groups.get(`${t.account}|${m}`) ?? []), t]);
  }
  const known = new Set([...opts.notInstallments, ...opts.tracked.map(x => `${x.account}|${x.merchant}`)]);
  const out: FoundInstallment[] = [];
  for (const [key, list] of groups) {
    if (known.has(key)) continue;
    const [account, merchant] = [key.slice(0, key.indexOf('|')), key.slice(key.indexOf('|') + 1)];
    if (opts.subMerchants.some(k => ` ${merchant} `.includes(` ${k} `))) continue;
    const sorted = [...list].sort((a, b) => a.date.getTime() - b.date.getTime());
    const latest = sorted[sorted.length - 1];
    const part = latest.title.match(PART);
    const n = part ? Number(part[1]) : 0;
    const of = part ? Number(part[2]) : 0;
    const said = WORDS.test(latest.title) || (part && n >= 1 && n <= of && of >= 2 && of <= 60);
    // The same amount (within 1%) in two months, at least 25 days apart, on a card or paylater.
    const same = sorted.filter(t => Math.abs(t.amount - latest.amount) <= latest.amount * 0.01);
    const repeats = same.length >= 2 && (latest.date.getTime() - same[0].date.getTime()) / DAY >= 25 && (isCard(account) || PAYLATER.test(latest.title));
    if (!said && !repeats) continue;
    if (latest.amount < opts.minAmount) continue;
    const charges = said ? sorted.filter(t => Math.abs(t.amount - latest.amount) <= latest.amount * 0.02) : same;
    out.push({
      key,
      name: tidyName(latest.title.replace(PART, '').replace(WORDS, '').replace(/\s{2,}/g, ' ').trim()) || tidyName(latest.title),
      merchant,
      account,
      amount: Math.round(latest.amount * 100) / 100,
      months: part && of >= 2 ? of : null,
      payment: part && n >= 1 ? n : charges.length,
      firstDate: toISO(charges[0].date),
      latestDate: toISO(latest.date),
      charges: charges.length,
    });
  }
  return out.sort((a, b) => b.amount - a.amount);
}

/** A confirmed find as a tracked plan: the oldest matching charge is the payment before the latest's, and so on. */
export function trackFound(f: FoundInstallment, payment: number, months: number): TrackedInstallment {
  return {
    id: Math.random().toString(36).slice(2, 10),
    name: f.name,
    merchant: f.merchant,
    account: f.account,
    amount: f.amount,
    months,
    firstPayment: Math.max(1, payment - (f.charges - 1)),
    firstDate: f.firstDate,
  };
}
