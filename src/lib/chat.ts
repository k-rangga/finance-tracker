import { run } from './gas';
import type { Budget } from './budget';
import type { Cycle } from './cycle';
import type { Settings } from './settings';
import { tidyName, toISO } from './format';
import { CATEGORIES, OTHER_CATEGORIES, SAVINGS_TARGET_PCT } from '../data/categories';

/** A change Gemini suggests; shown as a card you apply yourself (see askGemini_ in apps-script/Gemini.js). */
export type ChatAction =
  | { type: 'rule'; merchant: string; category: string; sub?: string | null; why?: string }
  | { type: 'recategorize'; txIds: string[]; category: string; sub?: string | null; why?: string }
  | { type: 'move_limit'; from: string; to: string; amount: number; why?: string };

export type ChatMessage = { role: 'user' | 'model'; text: string; actions?: ChatAction[] };

export type ChatAnswer = { reply: string; actions: ChatAction[] } | { error: 'no_key' | 'api' | 'blocked'; detail?: string };

export const askGemini = (messages: ChatMessage[], context: object) =>
  run<ChatAnswer>('askGemini', { messages: messages.map(m => ({ role: m.role, text: m.text })), context });

/** Newest transactions sent along; enough for a cycle, small enough to keep each question quick. */
const MAX_TXS = 200;

/**
 * What Gemini sees with each question: this cycle's numbers, categories (with sub-categories and last cycle at
 * the same point), bills still due and the cycle's transactions. Notes only when you allow them.
 */
export function chatContext({ cycle, budget: b, settings, notes, withNotes }: { cycle: Cycle; budget: Budget; settings: Settings; notes: Record<string, string>; withNotes: boolean }) {
  const r = Math.round;
  const left = b.budget - b.spent - b.fixedDue;
  return {
    today: toISO(cycle.today),
    cycle: { start: toISO(cycle.start), end: toISO(cycle.dateOf(cycle.cycleDays - 1)), day: cycle.dayN, days: cycle.cycleDays, daysLeft: cycle.daysLeft },
    currency: settings.currency,
    income: r(settings.income),
    savingsTargetPct: SAVINGS_TARGET_PCT,
    budget: r(b.budget),
    spent: r(b.spent),
    billsStillDue: r(b.fixedDue),
    variableAveragePerDay: r(b.velDay),
    projectedEndAtThisPace: r(b.projTotal),
    perDayToFinishOnBudget: r(Math.max(0, left) / Math.max(1, cycle.daysLeft)),
    categoryNames: [...CATEGORIES.map(c => c.name), ...OTHER_CATEGORIES],
    categories: b.cats.map(c => ({
      name: c.name,
      type: c.type,
      limit: r(c.limit),
      spent: r(c.spent),
      lastCycleBySameDay: r(c.lastSameDays),
      subs: settings.subcategories[c.name] ?? [],
    })),
    bills: b.bills.map(x => ({ title: tidyName(x.title), category: x.category, amount: r(x.amount), date: toISO(x.date) })),
    transactions: b.txs.slice(0, MAX_TXS).map(t => ({
      id: t.id,
      date: toISO(t.date),
      merchant: tidyName(t.title),
      category: t.cat,
      ...(t.sub ? { sub: t.sub } : {}),
      amount: r(t.isIncome || t.isTransfer ? t.amount : t.net),
      account: t.account,
      ...(withNotes && notes[t.id] ? { note: notes[t.id] } : {}),
    })),
  };
}
