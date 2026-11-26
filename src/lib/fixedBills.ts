import type { TxView } from './budget';
import type { Cycle } from './cycle';
import { addDays, sum, tidyName } from './format';
import { merchantKey, type Bill, type Transaction } from '../data/transactions';
import { CATEGORIES, categoryByName } from '../data/categories';
import type { Subscription } from './subscriptions';

export type BillEvery = 'month' | 'quarter' | 'year';

/** One individual recurring fixed bill (rent, PLN, Wi-Fi, insurance, etc.) with a fixed currency amount. */
export type FixedBill = {
  id: string;
  name: string;
  /** Budget category this bill belongs to (e.g. Housing, Utilities, Insurance). */
  category: string;
  /** Expected amount in display currency (never drifts when income changes). */
  amount: number;
  /** Day of month due (1–31; clamped to shorter months). */
  dueDay: number;
  /** How often it repeats (default 'month'). */
  every?: BillEvery;
  /** 1–12 anchor month for quarterly / yearly bills. */
  anchorMonth?: number;
  /** Optional merchant keyword for matching imported Gmail receipts (defaults to bill name). */
  merchant?: string;
  /** True for utilities whose actual charge fluctuates month to month (±45% match window). */
  varies?: boolean;
  /** Temporarily paused until resumed. */
  paused?: boolean;
};

/** Per-cycle overrides and verifications for fixed bills, keyed by cycle start ISO (YYYY-MM-DD). */
export type FixedBillCycleState = {
  /** User-confirmed transaction link: { billId: txId }. */
  linked?: Record<string, string>;
  /** Manually ticked off (paid in cash / no receipt): billIds. */
  paid?: string[];
  /** Waived / skipped for this cycle only: billIds. */
  skipped?: string[];
  /** One-cycle amount overrides: { billId: amount }. */
  amounts?: Record<string, number>;
  /** Dismissed possible-match transaction IDs: { billId: txId[] }. */
  notMatch?: Record<string, string[]>;
};

export type FixedBillMatchKind = 'linked' | 'auto' | 'manual';

export type FixedBillStatus = {
  bill: FixedBill;
  /** Due date falling inside this cycle, or null if paused / not due this cycle (e.g. yearly in another month). */
  dueDate: Date | null;
  /** Expected amount for this cycle (per-cycle override or bill default). */
  expected: number;
  status: 'paid' | 'due' | 'overdue' | 'skipped' | 'inactive';
  matchKind?: FixedBillMatchKind;
  matchedTx?: TxView;
  /** Actual amount paid (matched transaction net, or expected when marked paid manually). */
  actual: number;
  /** actual - expected when matched to a real transaction. */
  variance: number;
  /** Likely matching transaction found in Buffer / Transfer / another category for 1-tap confirmation. */
  possibleTx?: TxView;
};

export type FixedBillPreset = {
  label: string;
  name: string;
  category: string;
  dueDay: number;
  merchant?: string;
  varies?: boolean;
};

export const FIXED_BILL_PRESETS: FixedBillPreset[] = [
  { label: 'Rent / Kos', name: 'Rent', category: 'Housing', dueDay: 1 },
  { label: 'Electricity (PLN)', name: 'Electricity (PLN)', category: 'Utilities', dueDay: 5, merchant: 'pln', varies: true },
  { label: 'Internet / Wi-Fi', name: 'Internet', category: 'Utilities', dueDay: 15 },
  { label: 'Water / IPL', name: 'Water & IPL', category: 'Utilities', dueDay: 10, varies: true },
  { label: 'Insurance', name: 'Insurance', category: 'Insurance', dueDay: 10 },
  { label: 'Phone plan', name: 'Phone plan', category: 'Utilities', dueDay: 1 },
  { label: 'Family', name: 'Family support', category: 'Housing', dueDay: 25 },
];

export const newBillId = () => 'bill_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** The date this bill falls due within `cycle`, or null if paused or not due in this cycle (quarterly/yearly). */
export function dueDateInCycle(bill: FixedBill, cycle: Cycle): Date | null {
  if (bill.paused) return null;
  const day = Math.max(1, Math.min(31, Math.round(bill.dueDay || 1)));
  const every = bill.every ?? 'month';
  const anchor = bill.anchorMonth ?? cycle.start.getMonth() + 1;
  // A pay cycle spans at most 2 calendar months (e.g. 25 Oct – 24 Nov).
  const months: [number, number][] = [[cycle.start.getFullYear(), cycle.start.getMonth()]];
  if (cycle.end.getFullYear() !== cycle.start.getFullYear() || cycle.end.getMonth() !== cycle.start.getMonth()) {
    months.push([cycle.end.getFullYear(), cycle.end.getMonth()]);
  }
  for (const [y, m] of months) {
    const m1 = m + 1;
    if (every === 'year' && m1 !== anchor) continue;
    if (every === 'quarter' && ((m1 - anchor) % 3 + 3) % 3 !== 0) continue;
    const last = new Date(y, m + 1, 0).getDate();
    const d = new Date(y, m, Math.min(day, last));
    if (d >= cycle.start && d <= cycle.end) return d;
  }
  return null;
}

/** True when a transaction title matches a bill's merchant keyword (word-level or substring match). */
function keywordMatches(title: string, keyword: string): boolean {
  const tk = merchantKey(title);
  const bk = merchantKey(keyword);
  if (!tk || !bk || bk.length < 2) return false;
  if (tk === bk || ` ${tk} `.includes(` ${bk} `) || ` ${bk} `.includes(` ${tk} `)) return true;
  // Multi-word bill names like "Electricity (PLN)" → match any distinctive token (>= 3 chars) like "pln".
  const tokens = bk.split(' ').filter(w => w.length >= 3 && !/^(the|and|for|pay|bill|monthly|plan|payment|support)$/.test(w));
  return tokens.some(tok => ` ${tk} `.includes(` ${tok} `));
}

function amountClose(actual: number, expected: number, tolerance: number): boolean {
  if (!(expected > 0) || !(actual > 0)) return false;
  const diff = Math.abs(actual - expected);
  return diff <= Math.max(expected * tolerance, expected >= 50_000 ? 15_000 : 2);
}

/**
 * Verify every fixed bill against actual imported transactions in `cycle`.
 * Checks manual links first, then auto-matches in-category / keyword transactions, then manual cash ticks,
 * and finally scans Buffer / Transfer / other rows for likely unlinked matches.
 */
export function matchFixedBills(
  bills: FixedBill[],
  txs: TxView[],
  cycle: Cycle,
  state?: FixedBillCycleState,
): FixedBillStatus[] {
  const linked = state?.linked ?? {};
  const paidSet = new Set(state?.paid ?? []);
  const skippedSet = new Set(state?.skipped ?? []);
  const overrides = state?.amounts ?? {};
  const notMatch = state?.notMatch ?? {};

  const txById = new Map(txs.map(t => [t.id, t]));
  const claimed = new Set<string>();

  // Pass 1: reserve manually linked transactions first so auto-matching never steals them.
  for (const b of bills) {
    const id = linked[b.id];
    if (id && txById.has(id)) claimed.add(id);
  }

  const out: FixedBillStatus[] = [];

  for (const bill of bills) {
    const expected = overrides[bill.id] ?? bill.amount;
    const dueDate = dueDateInCycle(bill, cycle);
    if (!dueDate) {
      out.push({ bill, dueDate: null, expected, status: 'inactive', actual: 0, variance: 0 });
      continue;
    }
    if (skippedSet.has(bill.id)) {
      out.push({ bill, dueDate, expected, status: 'skipped', actual: 0, variance: 0 });
      continue;
    }

    // 1. Manual transaction link
    const linkedTx = linked[bill.id] ? txById.get(linked[bill.id]) : undefined;
    if (linkedTx) {
      const actual = linkedTx.isIncome || linkedTx.isTransfer ? linkedTx.amount : linkedTx.net;
      out.push({
        bill,
        dueDate,
        expected,
        status: 'paid',
        matchKind: 'linked',
        matchedTx: linkedTx,
        actual,
        variance: actual - expected,
      });
      continue;
    }

    // 2. Automatic transaction verification (spending transactions in this cycle)
    const keyword = (bill.merchant?.trim() || bill.name).trim();
    const hasExplicitMerchant = !!(bill.merchant && bill.merchant.trim().length >= 2);
    const tol = bill.varies ? 0.45 : 0.15;

    const spendingCandidates = txs.filter(t => !claimed.has(t.id) && !t.isIncome && !t.isTransfer && t.net > 0);
    const scored = spendingCandidates
      .map(t => {
        const sameCat = t.cat === bill.category;
        const kw = keywordMatches(t.title, keyword);
        const close = amountClose(t.net, expected, tol);
        let score = 0;
        if (sameCat && kw) score = 100 + (close ? 20 : 0);
        else if (sameCat && close) score = 70;
        else if (hasExplicitMerchant && kw && close) score = 65;
        if (!score) return null;
        // Prefer closest amount & closest date to dueDate
        const amtErr = expected > 0 ? Math.abs(t.net - expected) / expected : 0;
        const dayErr = Math.abs(t.date.getTime() - dueDate.getTime()) / 864e5;
        return { t, score: score - amtErr * 10 - dayErr * 0.2 };
      })
      .filter((x): x is { t: TxView; score: number } => !!x)
      .sort((a, z) => z.score - a.score);

    if (scored[0]) {
      const matchedTx = scored[0].t;
      claimed.add(matchedTx.id);
      out.push({
        bill,
        dueDate,
        expected,
        status: 'paid',
        matchKind: 'auto',
        matchedTx,
        actual: matchedTx.net,
        variance: matchedTx.net - expected,
      });
      continue;
    }

    // 3. Manually ticked off (cash / no receipt)
    if (paidSet.has(bill.id)) {
      out.push({
        bill,
        dueDate,
        expected,
        status: 'paid',
        matchKind: 'manual',
        actual: expected,
        variance: 0,
      });
      continue;
    }

    // 4. Unpaid: scan Buffer, Transfer, or uncategorized rows for a likely match to confirm in 1 tap.
    const rejected = new Set(notMatch[bill.id] ?? []);
    const possible = txs
      .filter(t => !claimed.has(t.id) && !rejected.has(t.id) && !t.isIncome && !t.isCcPayment && !t.isInstallment && (t.isTransfer ? t.amount : t.net) > 0)
      .map(t => {
        const amt = t.isTransfer ? t.amount : t.net;
        const kw = keywordMatches(t.title, keyword);
        const close = amountClose(amt, expected, 0.15);
        const loose = bill.varies && amountClose(amt, expected, 0.35);
        const inInbox = t.cat === 'Buffer' || t.isTransfer;
        let score = 0;
        if (kw && (close || loose || inInbox)) score = 90;
        else if (inInbox && close && expected >= (amt >= 1000 ? 50_000 : 10)) score = 60;
        if (!score) return null;
        const amtErr = expected > 0 ? Math.abs(amt - expected) / expected : 0;
        return { t, score: score - amtErr * 10 };
      })
      .filter((x): x is { t: TxView; score: number } => !!x)
      .sort((a, z) => z.score - a.score)[0]?.t;

    const status = dueDate < cycle.today ? 'overdue' : 'due';
    out.push({
      bill,
      dueDate,
      expected,
      status,
      actual: 0,
      variance: 0,
      possibleTx: possible,
    });
  }

  return out;
}

/**
 * Unpaid fixed bills as `Bill[]` for `computeBudget` (`fixedDue`, `safeDay`) and Summary's `Bills to come`.
 * Overdue unpaid bills are kept due tomorrow so their money stays reserved until linked, marked paid, or skipped.
 */
export function fixedBillDueItems(statuses: FixedBillStatus[], cycle: Cycle): Bill[] {
  return statuses
    .filter(x => (x.status === 'due' || x.status === 'overdue') && x.dueDate && x.expected > 0)
    .map(x => ({
      date: x.dueDate! <= cycle.today ? addDays(cycle.today, 1) : x.dueDate!,
      title: x.status === 'overdue' ? `${x.bill.name} (overdue)` : x.bill.name,
      category: x.bill.category,
      amount: x.expected,
      source: 'Fixed bill',
    }));
}

/** Upcoming fixed bills scheduled for a future cycle (e.g., Next cycle planning). */
export function fixedBillsForNextCycle(bills: FixedBill[], nextCycle: Cycle): Bill[] {
  return bills
    .map(b => ({ b, date: dueDateInCycle(b, nextCycle) }))
    .filter((x): x is { b: FixedBill; date: Date } => !!x.date && x.b.amount > 0)
    .map(({ b, date }) => ({
      date,
      title: b.name,
      category: b.category,
      amount: b.amount,
      source: 'Fixed bill',
    }))
    .sort((a, z) => a.date.getTime() - z.date.getTime());
}

/**
 * Per-category planned totals from active (non-skipped) individual fixed bills in this cycle.
 * Passed into `computeBudget` so categories with fixed bills use exact Rupiah/USD totals (no % of income drift).
 */
export function fixedBillCategoryLimits(statuses: FixedBillStatus[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of statuses) {
    if (x.status === 'inactive' || x.status === 'skipped') continue;
    const amt = x.status === 'paid' ? Math.max(x.actual, x.expected) : x.expected;
    out[x.bill.category] = (out[x.bill.category] ?? 0) + amt;
  }
  return out;
}

export type FixedBillSuggestion = {
  key: string;
  name: string;
  category: string;
  amount: number;
  dueDay: number;
  merchant: string;
  count: number;
  varies: boolean;
};

/**
 * Auto-suggest individual fixed bills from imported fixed-category transactions not yet tracked as a FixedBill,
 * subscription, or installment.
 */
export function suggestFixedBills(
  allTxs: Transaction[],
  existing: FixedBill[],
  subscriptions: Record<string, Subscription>,
  dismissed: string[],
  catOf: (t: Transaction) => string,
): FixedBillSuggestion[] {
  const fixedCatNames = new Set(CATEGORIES.filter(c => c.type === 'fixed' && !c.auto && c.name !== 'Subscriptions').map(c => c.name));
  const subKeys = Object.values(subscriptions).map(x => merchantKey(x.merchant)).filter(Boolean);
  const existingKeys = existing.map(b => merchantKey(b.merchant || b.name)).filter(Boolean);
  const dismissedSet = new Set(dismissed);

  const byMerchant = new Map<string, { txs: Transaction[]; cat: string }>();
  for (const t of allTxs) {
    if (t.type !== 'expense' || t.plan) continue;
    const cat = catOf(t);
    if (!fixedCatNames.has(cat)) continue;
    const k = merchantKey(t.title);
    if (!k || dismissedSet.has(k)) continue;
    if (subKeys.some(sk => ` ${k} `.includes(` ${sk} `))) continue;
    if (existingKeys.some(ek => ` ${k} `.includes(` ${ek} `) || ` ${ek} `.includes(` ${k} `))) continue;
    const entry = byMerchant.get(k) ?? { txs: [], cat };
    entry.txs.push(t);
    byMerchant.set(k, entry);
  }

  return [...byMerchant.entries()]
    .map(([key, { txs, cat }]) => {
      const sorted = [...txs].sort((a, b) => b.date.getTime() - a.date.getTime());
      const latest = sorted[0];
      const amounts = sorted.map(t => t.amount);
      const avg = Math.round(sum(amounts) / amounts.length);
      const minA = Math.min(...amounts);
      const maxA = Math.max(...amounts);
      const varies = amounts.length >= 2 && minA > 0 && (maxA - minA) / minA > 0.1;
      return {
        key,
        name: tidyName(latest.title),
        category: categoryByName(cat)?.name ?? 'Utilities',
        amount: avg,
        dueDay: latest.date.getDate(),
        merchant: key,
        count: sorted.length,
        varies,
      };
    })
    .filter(x => x.amount > 0)
    .sort((a, b) => b.count - a.count || b.amount - a.amount)
    .slice(0, 5);
}
