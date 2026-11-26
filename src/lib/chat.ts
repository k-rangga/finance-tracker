import { run } from './gas';
import type { Budget } from './budget';
import type { Cycle } from './cycle';
import type { Settings } from './settings';
import { tidyName, toISO } from './format';
import { CATEGORIES, OTHER_CATEGORIES, SAVINGS_TARGET_PCT } from '../data/categories';
import { merchantKey } from '../data/transactions';

/** A change Gemini suggests; shown as a card you apply yourself (see askGemini_ in apps-script/Gemini.js). */
export type ChatAction =
  | { type: 'rule'; merchant: string; category: string; sub?: string | null; why?: string }
  | { type: 'recategorize'; txIds: string[]; category: string; sub?: string | null; why?: string }
  | { type: 'move_limit'; from: string; to: string; amount: number; why?: string };

/** A reply also carries the model that wrote it, suggested next questions, and your thumbs up or down once rated. */
export type ChatMessage = {
  role: 'user' | 'model';
  text: string;
  actions?: ChatAction[];
  followUps?: string[];
  model?: string;
  rating?: 'up' | 'down';
};

export type ChatAnswer =
  | { reply: string; actions: ChatAction[]; followUps?: string[]; model?: string }
  | { error: 'no_key' | 'api' | 'blocked' | 'quota'; detail?: string };

/** `deep`: deeper reasoning + Google Search local price checks (Gemini 4 Hydrogen → 3.8 Flash → 3.5 Flash-Lite). */
export const askGemini = (messages: ChatMessage[], context: object, deep = false) =>
  run<ChatAnswer>('askGemini', { messages: messages.map(m => ({ role: m.role, text: m.text })), context, ...(deep ? { deep: true } : {}) });

/** Friendly short name for a Gemini model id, shown quietly on Maxie's replies. */
export function modelLabel(id?: string): string {
  if (!id) return '';
  if (/4-hydrogen/i.test(id)) return 'Gemini 4 Hydrogen';
  if (/4-argon/i.test(id)) return 'Gemini 4 Argon';
  if (/4-carbon/i.test(id)) return 'Gemini 4 Carbon';
  if (/3\.8-flash/i.test(id)) return '3.8 Flash';
  if (/3\.6-flash/i.test(id)) return '3.6 Flash';
  if (/3\.5-flash-lite/i.test(id)) return '3.5 Flash-Lite';
  return id.replace(/^gemini-/, '');
}

/** Newest transactions sent along; enough for a cycle, small enough to keep each question quick. */
const MAX_TXS = 120;

/**
 * What Gemini sees with each question: this cycle's numbers, savings & card bills, pre-aggregated top merchants,
 * categories (with sub-categories and last cycle at the same point), bills still due, and recent transactions.
 * Notes only when you allow them.
 */
export function chatContext({ cycle, budget: b, settings, notes, withNotes }: { cycle: Cycle; budget: Budget; settings: Settings; notes: Record<string, string>; withNotes: boolean }) {
  const r = Math.round;
  const name = settings.name.trim();

  // Pre-aggregate spending by merchant across the whole cycle so Maxie never has to sum 120+ rows mentally.
  const merch = new Map<string, { merchant: string; category: string; count: number; total: number }>();
  let bufferCount = 0;
  for (const t of b.txs) {
    if (t.isIncome || t.isTransfer || t.net <= 0) continue;
    if (t.cat === 'Buffer') bufferCount++;
    const k = merchantKey(t.title) || t.title.toLowerCase();
    const cur = merch.get(k);
    if (cur) {
      cur.count++;
      cur.total += t.net;
    } else {
      merch.set(k, { merchant: tidyName(t.title), category: t.cat, count: 1, total: t.net });
    }
  }
  const topMerchants = [...merch.values()]
    .sort((a, z) => z.total - a.total)
    .slice(0, 15)
    .map(m => ({ ...m, total: r(m.total) }));

  const cards = b.cards
    .filter(c => c.owed > 0 || c.spent > 0 || c.lastBill > 0)
    .map(c => ({
      account: c.account,
      owed: r(Math.max(0, c.owed)),
      spent: r(c.spent),
      carriedOver: r(c.carriedOver),
      installments: r(c.installments),
    }));

  return {
    today: toISO(cycle.today),
    cycle: { start: toISO(cycle.start), end: toISO(cycle.dateOf(cycle.cycleDays - 1)), day: cycle.dayN, days: cycle.cycleDays, daysLeft: cycle.daysLeft, daysToPayday: cycle.daysLeft + 1 },
    currency: settings.currency,
    ...(name ? { name } : {}),
    ...(settings.city ? { city: settings.city } : {}),
    language: settings.maxieLanguage === 'id' ? 'Bahasa Indonesia' : 'English',
    income: r(settings.income),
    savingsTargetPct: SAVINGS_TARGET_PCT,
    savingsTarget: r(b.savingsTarget),
    saved: r(b.saved),
    savedPct: Math.round(b.savedPct),
    budget: r(b.budget),
    spent: r(b.spent),
    billsStillDue: r(b.fixedDue),
    left: r(b.budget - b.spent - b.fixedDue),
    variableAveragePerDay: r(b.velDay),
    projectedEndAtThisPace: r(b.projTotal),
    perDayToFinishOnBudget: r(b.safeDay),
    bufferCount,
    ...(cards.length ? { cards } : {}),
    ...(topMerchants.length ? { topMerchants } : {}),
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
    // Only what's needed to explain spending: no account, and empty fields left out (a smaller request answers faster).
    transactions: b.txs.slice(0, MAX_TXS).map(t => ({
      id: t.id,
      date: toISO(t.date).slice(5),
      merchant: tidyName(t.title),
      category: t.cat,
      ...(t.sub ? { sub: t.sub } : {}),
      amount: r(t.isIncome || t.isTransfer ? t.amount : t.net),
      ...(withNotes && notes[t.id] ? { note: notes[t.id] } : {}),
    })),
    // Answers you rated: write more like the liked ones, avoid what the disliked ones did.
    ...(settings.chatFeedback?.length
      ? {
          answerFeedback: {
            liked: settings.chatFeedback.filter(f => f.good).slice(-8).map(f => ({ question: f.q, answer: f.a })),
            disliked: settings.chatFeedback.filter(f => !f.good).slice(-8).map(f => ({ question: f.q, answer: f.a })),
          },
        }
      : {}),
  };
}
