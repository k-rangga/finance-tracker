import { run } from './gas';
import type { Budget } from './budget';
import type { Cycle } from './cycle';
import type { Settings } from './settings';
import { tidyName, toISO } from './format';
import { CATEGORIES, OTHER_CATEGORIES, SAVINGS_TARGET_PCT } from '../data/categories';
import { merchantKey } from '../data/transactions';
import type { FixedBillStatus } from './fixedBills';

/** A change Gemini suggests; shown as a card you apply yourself (see askGemini_ in apps-script/Gemini.js). */
export type ChatAction =
  | { type: 'rule'; merchant: string; category: string; sub?: string | null; why?: string }
  | { type: 'recategorize'; txIds: string[]; category: string; sub?: string | null; why?: string }
  | { type: 'move_limit'; from: string; to: string; amount: number; why?: string };

/** A reply also carries the model that wrote it, suggested next questions, husky mood, and your thumbs up or down once rated. */
export type ChatMessage = {
  role: 'user' | 'model';
  text: string;
  actions?: ChatAction[];
  followUps?: string[];
  mood?: 'happy' | 'curious' | 'steady';
  model?: string;
  rating?: 'up' | 'down';
};

export type ChatAnswer =
  | { reply: string; actions: ChatAction[]; followUps?: string[]; mood?: 'happy' | 'curious' | 'steady'; model?: string }
  | { error: 'no_key' | 'api' | 'blocked' | 'quota'; detail?: string };

/**
 * Safety net: if a model ever places follow-up questions as trailing bullet lines inside `reply`,
 * pull them out into `followUps` so they always render as tappable chips instead of plain bullets.
 */
export function extractFollowUps(rawReply: string, existing?: string[]): { reply: string; followUps: string[] } {
  const cleanChip = (s: string) => s.replace(/^[-*•]\s+|\d+[.)]\s+/, '').replace(/^["'“]|["'”]$/g, '').trim();
  const base = (existing ?? []).map(cleanChip).filter(x => x && x.length <= 75);
  const lines = String(rawReply || '').replace(/\r\n/g, '\n').split('\n');
  const pulled: string[] = [];
  let end = lines.length;
  while (end > 0 && !lines[end - 1].trim()) end--;
  while (end > 0) {
    const line = lines[end - 1].trim();
    const m = line.match(/^(?:[-*•]|\d+[.)])\s+(.+\?)$/);
    if (!m) break;
    const q = cleanChip(m[1]);
    if (!q || q.length > 75) break;
    pulled.unshift(q);
    end--;
  }
  if (pulled.length > 0 && end > 0) {
    // Drop blank lines and optional lead-in lines like "Want to check next:" directly above pulled questions.
    let probe = end;
    while (probe > 0 && !lines[probe - 1].trim()) probe--;
    if (probe > 0 && /^(?:next|follow[- ]?ups?|want to|you (?:could|might) ask|suggested|mau cek|pertanyaan)/i.test(lines[probe - 1].trim()) && lines[probe - 1].trim().length <= 60) {
      end = probe - 1;
    }
  }
  const reply = pulled.length > 0 ? lines.slice(0, end).join('\n').trim() : String(rawReply || '').trim();
  const merged: string[] = [];
  for (const q of [...base, ...pulled]) {
    if (!merged.some(x => x.toLowerCase() === q.toLowerCase())) merged.push(q);
    if (merged.length >= 3) break;
  }
  return { reply, followUps: merged };
}

/** `deep`: deeper reasoning + local price context (Free Tier: 3.6 Flash → 3.5 Flash-Lite → 3.8 Flash). */
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

/** Compact transaction slice: all Buffer items (so sorting works) plus newest 45 others, keeping prompts fast. */
const MAX_BUFFER_TXS = 30;
const MAX_OTHER_TXS = 45;

/**
 * What Gemini sees with each question: this cycle's numbers, savings & card bills, pre-aggregated top merchants,
 * categories (with sub-categories and last cycle at the same point), bills still due, and recent transactions.
 * Notes only when you allow them.
 */
export function chatContext({
  cycle,
  budget: b,
  settings,
  notes,
  withNotes,
  fixedBills,
}: {
  cycle: Cycle;
  budget: Budget;
  settings: Settings;
  notes: Record<string, string>;
  withNotes: boolean;
  fixedBills?: FixedBillStatus[];
}) {
  const r = Math.round;
  const name = settings.name.trim();

  // Pre-aggregate spending by merchant across the whole cycle so Maxie never has to sum raw rows mentally.
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
    .slice(0, 12)
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

  const bufferTxs = b.txs.filter(t => t.cat === 'Buffer' && !t.isIncome && !t.isTransfer).slice(0, MAX_BUFFER_TXS);
  const bufferIds = new Set(bufferTxs.map(t => t.id));
  const recentTxs = [...bufferTxs, ...b.txs.filter(t => !bufferIds.has(t.id)).slice(0, MAX_OTHER_TXS)];
  const trackedFixed = (fixedBills ?? [])
    .filter(x => x.status !== 'inactive')
    .map(x => ({
      name: x.bill.name,
      category: x.bill.category,
      expected: r(x.expected),
      status: x.status,
      ...(x.dueDate ? { due: toISO(x.dueDate).slice(5) } : {}),
      ...(x.status === 'paid' ? { actual: r(x.actual), verified: !!x.matchedTx } : {}),
    }));

  return {
    today: toISO(cycle.today),
    cycle: { start: toISO(cycle.start), end: toISO(cycle.dateOf(cycle.cycleDays - 1)), day: cycle.dayN, days: cycle.cycleDays, daysLeft: cycle.daysLeft, daysToPayday: cycle.daysLeft + 1 },
    currency: settings.currency,
    ...(name ? { name } : {}),
    ...(settings.city ? { city: settings.city } : {}),
    language: 'English',
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
    ...(trackedFixed.length ? { fixedBills: trackedFixed } : {}),
    ...(topMerchants.length ? { topMerchants } : {}),
    categoryNames: [...CATEGORIES.map(c => c.name), ...OTHER_CATEGORIES],
    categories: b.cats.map(c => ({
      name: c.name,
      type: c.type,
      limit: r(c.limit),
      spent: r(c.spent),
      lastCycleBySameDay: r(c.lastSameDays),
      ...(settings.subcategories[c.name]?.length ? { subs: settings.subcategories[c.name] } : {}),
    })),
    bills: b.bills.map(x => ({ title: tidyName(x.title), category: x.category, amount: r(x.amount), date: toISO(x.date) })),
    transactions: recentTxs.map(t => ({
      id: t.id,
      date: toISO(t.date).slice(5),
      merchant: tidyName(t.title),
      category: t.cat,
      ...(t.sub ? { sub: t.sub } : {}),
      amount: r(t.isIncome || t.isTransfer ? t.amount : t.net),
      ...(withNotes && notes[t.id] ? { note: notes[t.id] } : {}),
    })),
    // Compact feedback memory: enough to steer tone without inflating every request.
    ...(settings.chatFeedback?.length
      ? {
          answerFeedback: {
            liked: settings.chatFeedback.filter(f => f.good).slice(-4).map(f => ({ q: f.q.slice(0, 80), a: f.a.slice(0, 140) })),
            disliked: settings.chatFeedback.filter(f => !f.good).slice(-4).map(f => ({ q: f.q.slice(0, 80), a: f.a.slice(0, 140) })),
          },
        }
      : {}),
  };
}
