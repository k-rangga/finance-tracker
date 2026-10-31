import type { Cycle } from '../lib/cycle';
import { parseISO, type Currency } from '../lib/format';
import { CATEGORIES, CC_PAYMENT_CATEGORY, categoryByName, INCOME_CATEGORY, INTEREST_CATEGORY, INVESTMENT_CATEGORY, OTHER_CATEGORIES, SAVINGS_CATEGORY, TRANSFER_CATEGORY } from './categories';

export type Transaction = {
  id: string;
  date: Date;
  time: string;
  title: string;
  /** Category as read from the Gmail receipt (before user overrides). */
  category: string;
  /** Positive number in the display currency. Income uses category `Income`. */
  amount: number;
  source: string;
  /** Where the money came from: 'Bank' | 'Cash' | 'E-wallet' | 'CC BCA' | 'CC Mandiri'… */
  account: string;
  type: 'expense' | 'income' | 'transfer';
  /** Transfers only, e.g. 'CC BCA' for a card bill payment. */
  toAccount?: string;
  /** Installment payments only: the purchase it pays for, which month (1-based) of how many, and which part. */
  plan?: { of: string; month: number; months: number; part: 'price' | 'interest' };
};

/** A card purchase paid in monthly installments: first payment date (YYYY-MM-DD) and each month's amount, interest included. */
export type InstallmentPlan = { start: string; amounts: number[] };

/** Same day `n` months later, kept inside the month: 31 Jan + 1 month is 28 (or 29) Feb. */
export function addMonths(d: Date, n: number): Date {
  const last = new Date(d.getFullYear(), d.getMonth() + n + 1, 0).getDate();
  return new Date(d.getFullYear(), d.getMonth() + n, Math.min(d.getDate(), last));
}

/**
 * Each month's share of the price: equal parts, the last one absorbing rounding so they add up exactly.
 * Whole amounts (rupiah) split into whole amounts; others into cents.
 */
export function priceParts(price: number, months: number): number[] {
  const unit = Number.isInteger(price) ? 1 : 0.01;
  const each = Math.floor(price / months / unit) * unit;
  const round = (v: number) => Math.round(v / unit) * unit;
  return Array.from({ length: months }, (_, i) => round(i < months - 1 ? each : price - each * (months - 1)));
}

/**
 * The monthly payments of each installment plan, as transactions on their due dates (on the same card), so each
 * counts as spending in the cycle it's billed. A payment above its share of the price is split: the share stays
 * in the purchase's category, the rest goes to Interest & fees. `cat` is the purchase's category after your fixes.
 */
export function installmentPayments(purchases: Transaction[], plans: Record<string, InstallmentPlan>, cat: (t: Transaction) => string): Transaction[] {
  return purchases.flatMap(t => {
    const p = plans[t.id];
    if (!p || !p.amounts.length) return [];
    const months = p.amounts.length;
    const share = priceParts(t.amount, months);
    const first = parseISO(p.start);
    return p.amounts.flatMap((amount, i) => {
      const price = Math.min(amount, share[i]);
      const interest = Math.round((amount - price) * 100) / 100;
      // Less than one rupiah (or cent) above the share is rounding, not interest.
      const base = { date: addMonths(first, i), time: t.time, source: 'Installment', account: t.account, type: 'expense' as const };
      const label = `${t.title} · ${i + 1}/${months}`;
      const rows: Transaction[] = [
        { ...base, id: `${t.id}~${i + 1}`, title: label, category: cat(t), amount: price, plan: { of: t.id, month: i + 1, months, part: 'price' } },
      ];
      if (interest >= (Number.isInteger(t.amount) ? 1 : 0.01))
        rows.push({ ...base, id: `${t.id}~${i + 1}i`, title: `${label} interest`, category: INTEREST_CATEGORY, amount: interest, plan: { of: t.id, month: i + 1, months, part: 'interest' } });
      return rows;
    });
  });
}

/** Installment payments due later this cycle, as bills (price and interest together), so they're planned for. */
export function installmentBills(payments: Transaction[], cycle: Cycle): Bill[] {
  const due = new Map<string, Bill>();
  for (const t of payments) {
    if (!t.plan || t.date <= cycle.today || t.date > cycle.end) continue;
    const key = `${t.plan.of}~${t.plan.month}`;
    const b = due.get(key);
    if (b) b.amount += t.amount;
    else due.set(key, { date: t.date, title: t.title.replace(/ interest$/, ''), category: t.category === INTEREST_CATEGORY ? INTEREST_CATEGORY : t.category, amount: t.amount, source: 'Installment' });
  }
  return [...due.values()];
}

/** Last cycle's spend on one credit card (the bill paid this cycle). */
export type CardCycle = { account: string; prevCycleSpend: number };

export const isCard = (account: string) => account.startsWith('CC ');

export type Bill = { date: Date; title: string; category: string; amount: number; source: string };

/** A predicted bill's identity within one cycle (`cycleId` = the cycle's start as ISO), for dismissing it. */
export const billKey = (cycleId: string, b: Bill) => `${cycleId}|${b.title.toLowerCase()}|${b.amount}`;

/** Installment payments come from your plan; only bills predicted from last cycle can be dismissed. */
export const canDismissBill = (b: Bill) => b.source !== 'Installment';

/** A row of the `transactions` table, as imported from Gmail. */
export type TxRow = {
  id: string;
  occurred_at: string;
  title: string;
  category: string;
  amount: number;
  currency: Currency;
  source: string;
  /** Older imports have no account; the server fills in a best guess. */
  account?: string | null;
  to_account?: string | null;
};

export function toTransaction(r: TxRow, display: Currency, fxRate: number): Transaction {
  const at = new Date(r.occurred_at);
  const amount = r.currency === display ? r.amount : display === 'USD' ? r.amount / fxRate : r.amount * fxRate;
  return {
    id: r.id,
    date: new Date(at.getFullYear(), at.getMonth(), at.getDate()),
    time: String(at.getHours()).padStart(2, '0') + ':' + String(at.getMinutes()).padStart(2, '0'),
    title: r.title,
    category: r.category,
    amount,
    source: r.source,
    account: r.account || 'Bank',
    type: [CC_PAYMENT_CATEGORY, TRANSFER_CATEGORY, SAVINGS_CATEGORY, INVESTMENT_CATEGORY].includes(r.category) ? 'transfer' : r.category === INCOME_CATEGORY ? 'income' : 'expense',
    toAccount: r.to_account || undefined,
  };
}

/** One merchant across receipts: "6202-Hero Kota Wisata" and "HERO KOTA WISATA" → "hero kota wisata". */
export const merchantKey = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Overrides with your merchant rules filled in: a transaction you didn't fix by hand takes the category you
 * chose for its merchant. Card bill payments are never re-categorised.
 *
 * Rules can be typed in the sheet, so they're forgiving: a rule matches its merchant exactly, else as whole
 * words inside the name ("tunas toyota" → "Tunas Toyota Bodyrepair", longest rule first), and the category
 * is matched ignoring case. A rule naming a category the app doesn't have is skipped.
 */
export function withMerchantRules(txs: Transaction[], recat: Record<string, string>, rules: Record<string, string>): Record<string, string> {
  const names = [...CATEGORIES.map(c => c.name), ...OTHER_CATEGORIES];
  const list = Object.entries(rules)
    .map(([m, c]) => [merchantKey(m), names.find(n => n.toLowerCase() === c.trim().toLowerCase())] as const)
    .filter((r): r is readonly [string, string] => !!r[0] && !!r[1])
    .sort((a, b) => b[0].length - a[0].length);
  const exact = new Map(list);
  const ruleFor = (key: string) => exact.get(key) ?? list.find(([k]) => ` ${key} `.includes(` ${k} `))?.[1];
  const out: Record<string, string> = {};
  for (const t of txs) {
    if (t.id in recat || t.category === CC_PAYMENT_CATEGORY) continue;
    const r = ruleFor(merchantKey(t.title));
    if (r && r !== t.category) out[t.id] = r;
  }
  return { ...out, ...recat };
}

/** Transactions dated within a cycle, up to and including today. */
export const inCycle = (txs: Transaction[], c: Cycle) => txs.filter(t => t.date >= c.start && t.date <= c.today && t.date < c.next);

/**
 * Fixed bills expected later this cycle: fixed-category charges from last
 * cycle that fell after today's point in the cycle and haven't recurred yet.
 */
export function expectedBills(prev: Transaction[], prevCycle: Cycle, cur: Transaction[], cycle: Cycle, recat: Record<string, string>): Bill[] {
  const seen = new Set(cur.map(t => t.title.toLowerCase()));
  return prev
    .filter(t => categoryByName(recat[t.id] ?? t.category)?.type === 'fixed')
    .map(t => ({ t, offset: prevCycle.offsetOf(t.date) }))
    .filter(({ t, offset }) => offset > cycle.dayIdx && offset < cycle.cycleDays && !seen.has(t.title.toLowerCase()))
    .map(({ t, offset }) => ({ date: cycle.dateOf(offset), title: t.title, category: recat[t.id] ?? t.category, amount: t.amount, source: t.source }));
}
