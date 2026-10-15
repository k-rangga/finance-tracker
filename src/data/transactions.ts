import type { Cycle } from '../lib/cycle';
import type { Currency } from '../lib/format';
import { CC_PAYMENT_CATEGORY, categoryByName, INCOME_CATEGORY, INVESTMENT_CATEGORY, TRANSFER_CATEGORY } from './categories';

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
};

/** Last cycle's spend on one credit card (the bill paid this cycle). */
export type CardCycle = { account: string; prevCycleSpend: number };

export const isCard = (account: string) => account.startsWith('CC ');

export type Bill = { date: Date; title: string; category: string; amount: number; source: string };

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
    type: [CC_PAYMENT_CATEGORY, TRANSFER_CATEGORY, INVESTMENT_CATEGORY].includes(r.category) ? 'transfer' : r.category === INCOME_CATEGORY ? 'income' : 'expense',
    toAccount: r.to_account || undefined,
  };
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
