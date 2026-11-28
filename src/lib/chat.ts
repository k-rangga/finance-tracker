import { run } from './gas';
import type { Budget } from './budget';
import type { Cycle } from './cycle';
import type { Settings } from './settings';
import { tidyName, toISO } from './format';
import { CATEGORIES, OTHER_CATEGORIES } from '../data/categories';
import { merchantKey } from '../data/transactions';
import type { FixedBillStatus } from './fixedBills';
import { paceInsight, weekendSafeSplit } from './pace';
import type { FortAssetsAlert, ImpulseSummary, LifestyleCreepSignal, WealthSnapshot } from './wealth';
import type { WhatIfResult, WhatIfSpec } from './whatIf';

/** A change Gemini suggests; shown as a card you apply yourself (see askGemini_ in apps-script/Gemini.js). */
export type ChatAction =
  | { type: 'rule'; merchant: string; category: string; sub?: string | null; why?: string }
  | { type: 'recategorize'; txIds: string[]; category: string; sub?: string | null; why?: string }
  | { type: 'move_limit'; from: string; to: string; amount: number; why?: string }
  | { type: 'challenge'; category: string; why?: string }
  | { type: 'wishlist'; name: string; amount: number; coolDays?: number; why?: string }
  | { type: 'pay_yourself_first'; savingsPct?: number; investPct?: number; why?: string };

/** Serializable undo payload so applied suggestion cards stay applied and undoable across page refreshes. */
export type AppliedActionUndo =
  | { type: 'rule'; key: string; prev?: [string, string]; prevSub: string | null }
  | { type: 'recategorize'; items: Array<{ id: string; rawCat: string; planOf: string | null; prevCat: string; prevSub: string | null }> }
  | { type: 'move_limit'; from: string; fromPct: number; to: string; toPct: number }
  | { type: 'challenge'; category: string; prev?: { category: string; start: string; days?: number; kind?: 'nospend' | 'beat_last'; target?: number } | null }
  | { type: 'wishlist'; id: string }
  | { type: 'pay_yourself_first'; prevSave: number; prevInv: number };

export type AppliedActionState = {
  appliedAt: string;
  preview?: string;
  undo?: AppliedActionUndo;
};

/** Serializable undo payload for applied What-If projections (spending pockets, wishlist, PYF, challenge). */
export type AppliedScenarioUndo =
  | { type: 'pockets'; prevPcts: Record<string, number> }
  | { type: 'wishlist'; id: string }
  | { type: 'pyf'; prevSave: number; prevInv: number }
  | { type: 'challenge'; category: string; prev?: { category: string; start: string; days?: number; kind?: 'nospend' | 'beat_last'; target?: number } | null };

export type AppliedScenarioState = {
  appliedAt: string;
  summary: string;
  celebration: string;
  spec: WhatIfSpec;
  undo?: AppliedScenarioUndo;
};

/** A reply also carries the model that wrote it, suggested next questions, husky mood, and your thumbs up or down once rated. */
export type ChatMessage = {
  role: 'user' | 'model';
  text: string;
  actions?: ChatAction[];
  appliedActions?: Record<number, AppliedActionState>;
  scenario?: WhatIfSpec;
  appliedScenario?: AppliedScenarioState;
  followUps?: string[];
  mood?: 'happy' | 'curious' | 'steady';
  model?: string;
  rating?: 'up' | 'down';
};

export type ChatAnswer =
  | { reply: string; actions: ChatAction[]; followUps?: string[]; mood?: 'happy' | 'curious' | 'steady'; model?: string; promptTokens?: number; scenario?: WhatIfSpec }
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

/** Conversation context budget and auto-compaction thresholds. */
export const CHAT_CONTEXT_BUDGET_TOKENS = 12_000;
export const AUTO_COMPACT_THRESHOLD_PCT = 60;
export const COMPACT_KEEP_RECENT = 4;
export const COMPACT_MIN_ACTIVE = 6;
export const SYSTEM_PROMPT_EST_TOKENS = 1_150;

export const estimateTokens = (text: string): number => Math.ceil((text?.length ?? 0) / 4);

export function estimateChatContextUsage({
  context,
  summary,
  activeMessages,
  reportedPromptTokens,
}: {
  context: object;
  summary: string;
  activeMessages: ChatMessage[];
  reportedPromptTokens?: number | null;
}): { tokens: number; budget: number; pct: number; canCompact: boolean } {
  const tokens =
    reportedPromptTokens != null && reportedPromptTokens > 0
      ? Math.round(reportedPromptTokens)
      : SYSTEM_PROMPT_EST_TOKENS +
        estimateTokens(JSON.stringify(context)) +
        estimateTokens(summary) +
        activeMessages.reduce((acc, m) => acc + estimateTokens(m.text) + 12, 0);
  const pct = Math.min(100, Math.round((tokens / CHAT_CONTEXT_BUDGET_TOKENS) * 100));
  return {
    tokens,
    budget: CHAT_CONTEXT_BUDGET_TOKENS,
    pct,
    canCompact: activeMessages.length >= COMPACT_MIN_ACTIVE,
  };
}

export function buildLocalCompactedSummary(previousSummary: string, dropped: ChatMessage[]): string {
  const prevLines = previousSummary
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
  const nextLines = dropped
    .filter(m => m.text.trim())
    .map(m => {
      const clean = m.text.replace(/\s+/g, ' ').trim();
      return `- ${m.role === 'user' ? 'User' : 'Maxie'}: ${clean.slice(0, 110)}${clean.length > 110 ? '…' : ''}`;
    });
  const combined = [...prevLines, ...nextLines];
  while (combined.join('\n').length > 1100 && combined.length > 2) combined.shift();
  return combined.join('\n').slice(0, 1100);
}

/** `deep`: deeper reasoning + local price context (Free Tier: 3.6 Flash → 3.5 Flash-Lite → 3.8 Flash). */
export const askGemini = (messages: ChatMessage[], context: object, deep = false, summary?: string) =>
  run<ChatAnswer>('askGemini', {
    messages: messages.map(m => ({ role: m.role, text: m.text })),
    context,
    ...(deep ? { deep: true } : {}),
    ...(summary ? { summary } : {}),
  });

export const compactChat = (messages: ChatMessage[], previousSummary: string, language: string) =>
  run<{ summary: string; model?: string } | { error: string; detail?: string }>('compactChat', {
    messages: messages.map(m => ({ role: m.role, text: m.text })),
    previousSummary,
    language,
  });

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

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

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
  wealth,
  impulse,
  fortDip,
  lifestyleCreep,
  pyfStreak,
  whatIf,
  now,
}: {
  cycle: Cycle;
  budget: Budget;
  settings: Settings;
  notes: Record<string, string>;
  withNotes: boolean;
  fixedBills?: FixedBillStatus[];
  wealth?: WealthSnapshot;
  impulse?: ImpulseSummary;
  fortDip?: FortAssetsAlert | null;
  lifestyleCreep?: LifestyleCreepSignal | null;
  pyfStreak?: number;
  whatIf?: WhatIfResult | null;
  now?: Date;
}) {
  const r = Math.round;
  const name = settings.name.trim();
  const clock = now ?? new Date();
  const dow = cycle.today.getDay();
  const weekday = WEEKDAYS[dow];
  const isWeekend = dow === 0 || dow === 6;
  const dayType = isWeekend ? 'weekend' : 'weekday';
  const hr = clock.getHours();
  const localTime = `${String(hr).padStart(2, '0')}:${String(clock.getMinutes()).padStart(2, '0')}`;
  const timeOfDay =
    hr < 5 ? 'late night' : hr < 11 ? 'morning' : hr < 14 ? 'midday' : hr < 18 ? 'afternoon' : hr < 21 ? 'evening' : 'night';
  let timeZone = 'Asia/Jakarta';
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Jakarta';
  } catch {
    // Keep default timezone fallback
  }
  const todayISO = toISO(cycle.today);
  const formattedNow = `${weekday}, ${cycle.today.getDate()} ${MONTHS_SHORT[cycle.today.getMonth()]} ${cycle.today.getFullYear()}, ${localTime} (${dayType})`;

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

  const insight = paceInsight({
    budget: b.budget,
    projTotal: b.projTotal,
    oneOffs: b.proj.oneOffs,
    remainingVar: b.proj.remainingVar,
    daysLeft: cycle.daysLeft,
    dayN: cycle.dayN,
    cycleDays: cycle.cycleDays,
    cats: b.cats,
  });
  const left = b.budget - b.spent - b.fixedDue;
  const wkSplit = weekendSafeSplit(left, cycle.daysLeft + 1, dow, b.proj.weekendRatio);
  const spentToday = r(
    b.txs
      .filter(t => !t.isIncome && !t.isTransfer && t.net > 0 && toISO(t.date) === todayISO)
      .reduce((acc, t) => acc + t.net, 0),
  );
  const todaySafeSpend = wkSplit ? r(isWeekend ? wkSplit.weekendSafe : wkSplit.weekdaySafe) : r(b.safeDay);
  const todayRemaining = r(Math.max(0, todaySafeSpend - spentToday));

  return {
    today: todayISO,
    now: {
      date: todayISO,
      weekday,
      isWeekend,
      dayType,
      localTime,
      timeOfDay,
      timeZone,
      formatted: formattedNow,
    },
    todaySafeSpend,
    spentToday,
    todayRemaining,
    cycle: {
      start: toISO(cycle.start),
      end: toISO(cycle.dateOf(cycle.cycleDays - 1)),
      nextPayday: toISO(cycle.next),
      nextPaydayWeekday: WEEKDAYS[cycle.next.getDay()],
      weekOfCycle: cycle.weekIdx + 1,
      day: cycle.dayN,
      days: cycle.cycleDays,
      daysLeft: cycle.daysLeft,
      daysToPayday: cycle.daysLeft + 1,
    },
    currency: settings.currency,
    ...(name ? { name } : {}),
    ...(settings.city ? { city: settings.city } : {}),
    language: settings.maxieLanguage === 'id' ? 'Indonesian' : 'English',
    income: r(settings.income),
    savingsTargetPct: settings.savingsPct,
    investTargetPct: settings.investPct,
    savingsTarget: r(b.savingsTarget),
    saved: r(b.saved),
    savedPct: Math.round(b.savedPct),
    budget: r(b.budget),
    spent: r(b.spent),
    billsStillDue: r(b.fixedDue),
    left: r(left),
    variableAveragePerDay: r(b.velDay),
    projectedSpendByPayday: r(b.projTotal),
    ...(b.proj.oneOffs > 0 ? { oneOffsCountedOnce: r(b.proj.oneOffs) } : {}),
    perDayToFinishOnBudget: r(b.safeDay),
    projectionInsight: {
      tier: insight.tier,
      oneOffExplains: insight.oneOffExplains,
      ...(insight.overBy > 0 ? { overBy: r(insight.overBy), trimPerDay: r(insight.trimPerDay), zeroDaysToFix: insight.zeroDaysToFix } : {}),
      ...(insight.spareBy > 0 ? { spareBy: r(insight.spareBy) } : {}),
      ...(insight.topDriver ? { topDriver: { name: insight.topDriver.name, ahead: r(insight.topDriver.ahead) } } : {}),
      ...(wkSplit ? { weekdaySafe: r(wkSplit.weekdaySafe), weekendSafe: r(wkSplit.weekendSafe), weekendsLeft: wkSplit.weekendsLeft } : {}),
    },
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
      weekday: WEEKDAYS_SHORT[t.date.getDay()],
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
    // Holistic Rich Dad + Jakarta behavioral snapshot: Balance Sheet, Runway, Freedom Ratio, Wishlist & Impulse lures.
    ...(wealth
      ? {
          wealth: {
            emergencyFund: r(wealth.emergencyFund),
            emergencyTargetMonths: wealth.emergencyTargetMonths,
            runwayMonths: Math.round(wealth.runwayMonths * 10) / 10,
            runwayDays: wealth.runwayDays,
            portfolioValue: r(wealth.portfolioValue),
            assetsTotal: r(wealth.assetsTotal),
            liabilitiesTotal: r(wealth.liabilitiesTotal),
            cardLiabilities: r(wealth.cardLiabilities),
            installmentLiabilities: r(wealth.installmentLiabilities),
            netProductiveWealth: r(wealth.netProductiveWealth),
            passiveMonthlyCashflow: r(wealth.passiveMonthly),
            freedomPct: Math.round(wealth.freedomPct * 10) / 10,
            freedomStage: wealth.freedomStage,
            cashflowPattern: wealth.cashflowPattern,
            investedThisCycle: r(b.invested),
            ...(pyfStreak != null ? { payYourselfFirstStreak: pyfStreak } : {}),
            ...(fortDip?.dipped ? { fortAssetsDip: { amount: r(fortDip.amount), reason: fortDip.reason } } : {}),
            ...(lifestyleCreep?.detected ? { lifestyleCreep: { expenseCapturePct: lifestyleCreep.expenseCapturePct, message: lifestyleCreep.message } } : {}),
          },
        }
      : {}),
    ...(impulse && impulse.skipCount > 0
      ? {
          impulseLeaks: {
            skipCount: impulse.skipCount,
            skipTotal: r(impulse.skipTotal),
            topTrigger: impulse.topTrigger ? { label: impulse.topTrigger.label, count: impulse.topTrigger.count, total: r(impulse.topTrigger.total) } : null,
          },
        }
      : {}),
    ...(settings.wishlist?.length
      ? {
          wishlist: settings.wishlist
            .filter(w => w.status === 'cooling' || w.status === 'ready')
            .slice(0, 6)
            .map(w => ({ name: w.name, amount: r(w.amount), status: w.status, fundingMode: w.fundingMode })),
        }
      : {}),
    ...(whatIf ? { whatIfSimulation: whatIf.summaryForPrompt } : {}),
  };
}
