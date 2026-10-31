import type { Cycle } from './cycle';
import { addDays, diffDays, parseISO, tidyName, toISO } from './format';
import { addMonths, merchantKey, type Bill, type Transaction } from '../data/transactions';

export type Every = 'month' | 'year' | 'week';

/**
 * Something you pay for on repeat. `merchant` is the receipt name its charges are matched by; `next` (YYYY-MM-DD)
 * is a billing date you set, which each matching charge moves on by one period. A trial's `next` is when it ends
 * and the first charge comes.
 */
export type Subscription = {
  name: string;
  merchant: string;
  amount: number;
  every: Every;
  next: string;
  account: string;
  status: 'active' | 'trial' | 'cancelled';
};

export const EVERY: Every[] = ['month', 'year', 'week'];
export const everyLabel = (e: Every) => ({ month: 'Monthly', year: 'Yearly', week: 'Weekly' })[e];

/** Days after a billing date before a charge that hasn't come counts as missed (cards post a day or two late). */
const GRACE_DAYS = 3;

export function addEvery(d: Date, every: Every, n = 1): Date {
  if (every === 'week') return addDays(d, 7 * n);
  return addMonths(d, every === 'year' ? 12 * n : n);
}

/** What it costs a month: yearly plans spread over 12 months, weekly ones over the weeks in a month. */
export const perMonth = (s: Pick<Subscription, 'amount' | 'every'>) => (s.every === 'month' ? s.amount : s.every === 'year' ? s.amount / 12 : (s.amount * 52) / 12);

/** A spending charge that could be a subscription's (not an installment payment, transfer or income). */
const isCharge = (t: Transaction) => t.type === 'expense' && !t.plan;

/**
 * Each subscription's charges, newest first. A receipt matches when the subscription's merchant appears in its name
 * as whole words; when two subscriptions share a merchant (Apple, Google), the one with the nearest amount gets it.
 */
export function chargesBySub(subs: Record<string, Subscription>, txs: Transaction[]): Map<string, Transaction[]> {
  const list = Object.entries(subs)
    .map(([id, s]) => ({ id, key: merchantKey(s.merchant), amount: s.amount }))
    .filter(x => x.key);
  const out = new Map<string, Transaction[]>();
  for (const t of txs) {
    if (!isCharge(t)) continue;
    const name = ` ${merchantKey(t.title)} `;
    const hits = list.filter(x => name.includes(` ${x.key} `));
    if (!hits.length) continue;
    const best = hits.reduce((a, b) => (Math.abs(b.amount - t.amount) < Math.abs(a.amount - t.amount) ? b : a));
    const charges = out.get(best.id) ?? [];
    charges.push(t);
    out.set(best.id, charges);
  }
  for (const v of out.values()) v.sort((a, b) => b.date.getTime() - a.date.getTime());
  return out;
}

export type SubState = {
  /** The next billing date; null once cancelled. */
  next: Date | null;
  /** Days from today to `next` (negative once it has passed). */
  inDays: number;
  /** The latest matching charge. */
  last?: Transaction;
  /** `late`: the billing date passed a few days ago with no charge (cancelled, failed, or billed under another name). */
  state: 'ok' | 'soon' | 'late' | 'cancelled';
  /** Still in its free trial: `next` is when it ends. */
  trial: boolean;
  /** The last charge differs from the amount you set by more than rounding (a price change, or exchange rate). */
  charged?: number;
};

/**
 * Where a subscription stands today. A charge from shortly before the set billing date onwards pays that date, so
 * the next one is a period after the charge; otherwise the date you set stands.
 */
export function subState(s: Subscription, charges: Transaction[], today: Date): SubState {
  const last = charges[0];
  const charged = last && Math.abs(last.amount - s.amount) > Math.max(1, s.amount * 0.02) ? last.amount : undefined;
  if (s.status === 'cancelled') return { next: null, inDays: 0, last, state: 'cancelled', trial: false, charged };
  const set = parseISO(s.next);
  const early = s.every === 'week' ? 2 : 7;
  const paid = !!last && last.date >= addDays(set, -early);
  const next = paid ? addEvery(last.date, s.every) : set;
  const inDays = diffDays(today, next);
  const state = inDays < -GRACE_DAYS ? 'late' : inDays <= 3 ? 'soon' : 'ok';
  return { next, inDays, last, state, trial: s.status === 'trial' && !paid, charged };
}

/**
 * Billing dates still to come this cycle, as bills, so they're planned for in Coming up and "Bills still due".
 * Weekly ones can bill more than once. `catOf` gives a subscription's category (its charges', else Subscriptions).
 */
export function subscriptionBills(subs: Record<string, Subscription>, states: Record<string, SubState>, cycle: Cycle, catOf: (id: string) => string): Bill[] {
  const out: Bill[] = [];
  for (const [id, s] of Object.entries(subs)) {
    const st = states[id];
    // Missed its last date: until a charge comes or you change it, don't plan for more.
    if (!st?.next || st.state === 'late') continue;
    for (let d = st.next; d <= cycle.end; d = addEvery(d, s.every))
      if (d > cycle.today) out.push({ date: d, title: s.name, category: catOf(id), amount: s.amount, source: 'Subscription' });
  }
  return out;
}

/** A subscription the app thinks you have, from repeating charges; you add it or say it isn't one. */
export type Suggestion = Subscription & { key: string; count: number };

/**
 * Likely subscriptions among charges no subscription claims yet: a merchant charging about the same amount at a
 * steady gap (a week, a month or a year), or anything in Subscriptions. Everyday spending (fuel, food) varies in
 * amount, so outside Subscriptions the amounts must match almost exactly. Ones that have stopped, or that you said
 * aren't subscriptions, are left out.
 */
export function suggestSubscriptions(
  txs: Transaction[],
  subs: Record<string, Subscription>,
  ignored: string[],
  catOf: (t: Transaction) => string,
  today: Date,
): Suggestion[] {
  const claimed = new Set([...chargesBySub(subs, txs).values()].flat().map(t => t.id));
  const skip = new Set(ignored);
  const groups = new Map<string, Transaction[]>();
  for (const t of txs) {
    if (!isCharge(t) || claimed.has(t.id) || t.date > today) continue;
    const key = merchantKey(t.title);
    if (!key || skip.has(key)) continue;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const out: Suggestion[] = [];
  for (const [key, list] of groups) {
    list.sort((a, b) => a.date.getTime() - b.date.getTime());
    const latest = list[list.length - 1];
    const inSubs = catOf(latest) === 'Subscriptions';
    const amounts = list.map(t => t.amount);
    const spread = Math.max(...amounts) / Math.max(1e-9, Math.min(...amounts));
    let every: Every | null = null;
    if (list.length >= 2 && spread <= (inSubs ? 1.3 : 1.05)) {
      const gaps = list.slice(1).map((t, i) => diffDays(list[i].date, t.date));
      const gap = [...gaps].sort((a, b) => a - b)[gaps.length >> 1];
      if (gap >= 25 && gap <= 35) every = 'month';
      else if (gap >= 340 && gap <= 390) every = 'year';
      // Weekly needs three charges: two a week apart is often just two shops.
      else if (gap >= 6 && gap <= 8 && list.length >= 3) every = 'week';
    }
    if (!every && inSubs) every = 'month';
    if (!every) continue;
    const next = addEvery(latest.date, every);
    // The next charge should already have come and hasn't: it has probably stopped.
    if (diffDays(today, next) < -GRACE_DAYS) continue;
    // Receipt references at the end ("Spotify P5678") aren't part of the name, nor of what later charges match on.
    const name = tidyName(latest.title).replace(/(\s+\S*\d\S*)+$/, '') || tidyName(latest.title);
    out.push({ key, count: list.length, name, merchant: merchantKey(name) || key, amount: latest.amount, every, next: toISO(next), account: latest.account, status: 'active' });
  }
  return out.sort((a, b) => perMonth(b) - perMonth(a));
}
