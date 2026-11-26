import { categoryByName } from '../data/categories';
import type { Bill } from '../data/transactions';
import type { TxView } from './budget';
import { cycleKey, nextCycleOf, type CyclePlan } from './cyclePlans';
import { getCycle, paydaysFrom, type Cycle } from './cycle';
import { fixedBillsForNextCycle, type FixedBill, type FixedBillStatus } from './fixedBills';
import { addDays, dayMonth, fmtFull, parseISO, sum, tidyName, toISO, type Currency } from './format';
import type { PlanView } from './installments';
import type { Settings } from './settings';
import { addEvery, type Subscription } from './subscriptions';

export type CalendarEventKind =
  | 'payday'
  | 'inflow'
  | 'fixed'
  | 'subscription'
  | 'installment'
  | 'planned'
  | 'card_statement'
  | 'card_due';

export type CalendarLayer = 'all' | 'bills' | 'inflows' | 'spending';

export type CalendarEvent = {
  id: string;
  date: string;
  kind: CalendarEventKind;
  title: string;
  amount?: number;
  category?: string;
  paid?: boolean;
  overdue?: boolean;
  note?: string;
  bill?: Bill;
  costId?: string;
  extraId?: string;
  cycleKeyStr?: string;
};

export type CalendarDay = {
  iso: string;
  date: Date;
  inMonth: boolean;
  isToday: boolean;
  isPast: boolean;
  spend: number;
  txs: TxView[];
  events: CalendarEvent[];
  zeroSpend: boolean;
};

export type CalendarWeekSummary = {
  label: string;
  days: CalendarDay[];
  commitments: number;
  inflows: number;
  spend: number;
};

export type CalendarMonthData = {
  year: number;
  month: number;
  label: string;
  days: CalendarDay[];
  weeks: CalendarWeekSummary[];
  totalInflows: number;
  totalCommitments: number;
  clearDays: number;
  maxSpend: number;
  allEvents: CalendarEvent[];
};

const isCommitment = (k: CalendarEventKind) => k === 'fixed' || k === 'subscription' || k === 'installment' || k === 'planned';
const isInflow = (k: CalendarEventKind) => k === 'payday' || k === 'inflow';

/** Clamp a 1..31 day-of-month to a real date inside `(year, month)`. */
function clampedDay(year: number, month: number, day: number): Date {
  const last = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.max(1, Math.min(day, last)));
}

/**
 * Build a complete Mon–Sun calendar month combining past spending, paydays, fixed bills, subscriptions,
 * installments, credit-card dates, and planned one-offs/bonuses from `settings.cyclePlans`.
 */
export function buildCalendarMonth({
  year,
  month,
  cycle,
  allTxs,
  fixedBillStatuses,
  subscriptions,
  plans,
  settings,
  filterCat,
  hideTransfers,
  searchQ,
}: {
  year: number;
  month: number;
  cycle: Cycle;
  allTxs: TxView[];
  fixedBillStatuses: FixedBillStatus[];
  subscriptions: Record<string, Subscription>;
  plans: PlanView[];
  settings: Settings;
  filterCat?: { cat: string; sub?: string };
  hideTransfers?: boolean;
  searchQ?: string;
}): CalendarMonthData {
  const todayISO = toISO(cycle.today);
  const firstOfMonth = new Date(year, month, 1);
  const lastOfMonth = new Date(year, month + 1, 0);
  // Start grid on Monday (0 = Mon ... 6 = Sun).
  const lead = (firstOfMonth.getDay() + 6) % 7;
  const gridStart = addDays(firstOfMonth, -lead);
  const totalCells = Math.ceil((lead + lastOfMonth.getDate()) / 7) * 7;
  const gridEnd = addDays(gridStart, totalCells - 1);
  const startISO = toISO(gridStart);
  const endISO = toISO(gridEnd);

  const eventsByDay = new Map<string, CalendarEvent[]>();
  const push = (e: CalendarEvent) => {
    if (e.date < startISO || e.date > endISO) return;
    const list = eventsByDay.get(e.date);
    if (list) list.push(e);
    else eventsByDay.set(e.date, [e]);
  };

  // 1. Paydays across the visible window + extra inflows attached to each cycle's payday.
  const paydays = paydaysFrom(addDays(gridStart, -35), 4);
  const seenPaydays = new Set<string>();
  const plansMap: Record<string, CyclePlan> = settings.cyclePlans ?? {};
  for (const pd of paydays) {
    const iso = toISO(pd);
    if (seenPaydays.has(iso)) continue;
    seenPaydays.add(iso);
    const cp = plansMap[iso];
    const baseAmt = cp?.income != null && cp.income > 0 ? cp.income : settings.income;
    push({
      id: `payday-${iso}`,
      date: iso,
      kind: 'payday',
      title: 'Payday',
      amount: baseAmt,
      note: 'Cycle starts',
    });
    for (const ex of cp?.extras ?? []) {
      push({
        id: `extra-${iso}-${ex.id}`,
        date: iso,
        kind: 'inflow',
        title: ex.name,
        amount: ex.amount,
        extraId: ex.id,
        cycleKeyStr: iso,
      });
    }
  }

  // 2. Planned one-off costs across all stored cycle plans.
  for (const [ck, cp] of Object.entries(plansMap)) {
    for (const cost of cp.costs ?? []) {
      if (filterCat?.cat && cost.category !== filterCat.cat) continue;
      push({
        id: `cost-${ck}-${cost.id}`,
        date: cost.date,
        kind: 'planned',
        title: cost.name,
        amount: cost.amount,
        category: cost.category,
        costId: cost.id,
        cycleKeyStr: ck,
      });
    }
  }

  // 3. Tracked fixed bills: use verified statuses for current cycle, and schedule for surrounding future cycles.
  const fixedBills: FixedBill[] = settings.fixedBills ?? [];
  const curCycleKey = cycleKey(cycle);
  for (const st of fixedBillStatuses) {
    if (st.status === 'inactive' || st.status === 'skipped' || !st.dueDate) continue;
    if (filterCat?.cat && st.bill.category !== filterCat.cat) continue;
    const iso = toISO(st.dueDate);
    push({
      id: `fixed-cur-${st.bill.id}-${iso}`,
      date: iso,
      kind: 'fixed',
      title: st.bill.name,
      amount: st.status === 'paid' && st.actual > 0 ? st.actual : st.expected,
      category: st.bill.category,
      paid: st.status === 'paid',
      overdue: st.status === 'overdue',
      note: st.status === 'paid' ? (st.matchedTx ? 'Verified paid' : 'Marked paid') : st.status === 'overdue' ? 'Overdue' : 'Scheduled bill',
      bill:
        st.status !== 'paid'
          ? { date: st.dueDate, title: st.bill.name, category: st.bill.category, amount: st.expected, source: 'Fixed bill', billId: st.bill.id }
          : undefined,
    });
  }
  // Future cycles overlapping gridEnd
  let probeCycle = nextCycleOf(cycle);
  for (let i = 0; i < 6 && probeCycle.start <= gridEnd; i++) {
    const ck = cycleKey(probeCycle);
    if (ck !== curCycleKey) {
      for (const b of fixedBillsForNextCycle(fixedBills, probeCycle)) {
        if (filterCat?.cat && b.category !== filterCat.cat) continue;
        const iso = toISO(b.date);
        push({
          id: `fixed-${ck}-${b.billId ?? b.title}-${iso}`,
          date: iso,
          kind: 'fixed',
          title: b.title,
          amount: b.amount,
          category: b.category,
          note: 'Scheduled bill',
        });
      }
    }
    probeCycle = nextCycleOf(probeCycle);
  }

  // 4. Subscriptions across the visible grid window.
  for (const [subId, sub] of Object.entries(subscriptions)) {
    if (sub.status === 'cancelled') continue;
    if (filterCat?.cat && filterCat.cat !== 'Subscriptions') continue;
    let d = parseISO(sub.next);
    let guard = 0;
    while (d < gridStart && guard < 120) {
      d = addEvery(d, sub.every);
      guard++;
    }
    while (d <= gridEnd && guard < 180) {
      const iso = toISO(d);
      push({
        id: `sub-${subId}-${iso}`,
        date: iso,
        kind: 'subscription',
        title: sub.name,
        amount: sub.amount,
        category: 'Subscriptions',
        note: sub.every === 'year' ? 'Yearly renewal' : sub.every === 'week' ? 'Weekly' : 'Monthly subscription',
      });
      d = addEvery(d, sub.every);
      guard++;
    }
  }

  // 5. Installment payments across the visible grid window.
  for (const p of plans) {
    if (filterCat?.cat && p.category !== filterCat.cat) continue;
    for (const pay of p.payments) {
      const iso = toISO(pay.date);
      if (iso < startISO || iso > endISO) continue;
      push({
        id: `inst-${p.key}-${pay.n}`,
        date: iso,
        kind: 'installment',
        title: p.title,
        amount: pay.amount,
        category: p.category,
        paid: pay.paid,
        note: `${pay.n} of ${p.months}${pay.n === p.months ? ' · final payment' : ''}`,
      });
    }
  }

  // 6. Credit card statement & due dates for every month touched by the grid.
  const touchedMonths = new Set<string>();
  for (let i = 0; i < totalCells; i++) {
    const d = addDays(gridStart, i);
    touchedMonths.add(`${d.getFullYear()}-${d.getMonth()}`);
  }
  for (const ym of touchedMonths) {
    const [yy, mm] = ym.split('-').map(Number);
    for (const [cardName, dates] of Object.entries(settings.cards ?? {})) {
      if (dates.statement > 0) {
        const d = clampedDay(yy, mm, dates.statement);
        const iso = toISO(d);
        push({
          id: `cc-stmt-${cardName}-${iso}`,
          date: iso,
          kind: 'card_statement',
          title: `${cardName} statement`,
          note: 'Billing cycle closes',
        });
      }
      if (dates.due > 0) {
        const d = clampedDay(yy, mm, dates.due);
        const iso = toISO(d);
        push({
          id: `cc-due-${cardName}-${iso}`,
          date: iso,
          kind: 'card_due',
          title: `${cardName} due`,
          note: 'Card payment due date',
        });
      }
    }
  }

  // 7. Actual transactions per day (respecting active Transactions toolbar filters).
  const needle = (searchQ ?? '').trim().toLowerCase();
  const txsByDay = new Map<string, TxView[]>();
  const spendByDay = new Map<string, number>();
  let anyTxInMonth = false;
  for (const t of allTxs) {
    const iso = toISO(t.date);
    if (iso < startISO || iso > endISO) continue;
    if (filterCat?.cat && t.cat !== filterCat.cat) continue;
    if (filterCat?.sub && t.sub !== filterCat.sub) continue;
    if (hideTransfers && t.isTransfer) continue;
    if (needle && !`${t.title} ${tidyName(t.title)} ${t.cat} ${t.sub ?? ''} ${t.account}`.toLowerCase().includes(needle)) continue;

    const list = txsByDay.get(iso);
    if (list) list.push(t);
    else txsByDay.set(iso, [t]);

    if (t.date.getFullYear() === year && t.date.getMonth() === month) anyTxInMonth = true;
    if (!t.isIncome && !t.isTransfer && categoryByName(t.cat)) {
      spendByDay.set(iso, (spendByDay.get(iso) ?? 0) + t.net);
    }
  }

  // Assemble calendar cells.
  const days: CalendarDay[] = [];
  for (let i = 0; i < totalCells; i++) {
    const date = addDays(gridStart, i);
    const iso = toISO(date);
    const inMonth = date.getFullYear() === year && date.getMonth() === month;
    const isToday = iso === todayISO;
    const isPast = iso < todayISO;
    const spend = spendByDay.get(iso) ?? 0;
    const events = eventsByDay.get(iso) ?? [];
    const txs = txsByDay.get(iso) ?? [];
    // Mark quiet zero-spend days on past days in months that have recorded activity (and not before earliest tx).
    const zeroSpend = inMonth && isPast && anyTxInMonth && spend <= 0 && !filterCat?.cat && !needle;
    days.push({ iso, date, inMonth, isToday, isPast, spend, txs, events, zeroSpend });
  }

  const inMonthDays = days.filter(d => d.inMonth);
  const maxSpend = Math.max(1, ...inMonthDays.map(d => d.spend));
  const allEvents = inMonthDays.flatMap(d => d.events);
  const totalInflows = sum(allEvents.filter(e => isInflow(e.kind)).map(e => e.amount ?? 0));
  const totalCommitments = sum(allEvents.filter(e => isCommitment(e.kind)).map(e => e.amount ?? 0));
  const clearDays = inMonthDays.filter(
    d => d.iso >= todayISO && !d.events.some(e => isCommitment(e.kind) || e.kind === 'card_due'),
  ).length;

  // Weekly rhythm breakdown.
  const weeks: CalendarWeekSummary[] = [];
  for (let w = 0; w < days.length; w += 7) {
    const slice = days.slice(w, w + 7);
    const inM = slice.filter(d => d.inMonth);
    if (!inM.length) continue;
    const wEvents = inM.flatMap(d => d.events);
    weeks.push({
      label: `${dayMonth(inM[0].date)} – ${dayMonth(inM[inM.length - 1].date)}`,
      days: slice,
      commitments: sum(wEvents.filter(e => isCommitment(e.kind)).map(e => e.amount ?? 0)),
      inflows: sum(wEvents.filter(e => isInflow(e.kind)).map(e => e.amount ?? 0)),
      spend: sum(inM.map(d => d.spend)),
    });
  }

  const label = firstOfMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  return { year, month, label, days, weeks, totalInflows, totalCommitments, clearDays, maxSpend, allEvents };
}

/** Cycle key (YYYY-MM-DD of payday) that owns a given calendar date ISO, for adding planned costs/inflows cleanly. */
export function cycleKeyForDate(iso: string): string {
  return cycleKey(getCycle(parseISO(iso)));
}

/** Generate a clean RFC 5545 `.ics` string for upcoming bills, paydays, subscriptions, installments, and card due dates. */
export function buildIcsExport(events: CalendarEvent[], currency: Currency): string {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Maxie Finance Tracker//Cashflow Calendar//EN',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:Maxie Cashflow',
  ];
  for (const e of events) {
    const dt = e.date.replace(/-/g, '');
    const nextDt = toISO(addDays(parseISO(e.date), 1)).replace(/-/g, '');
    const amt = e.amount ? ` (${fmtFull(e.amount, currency)})` : '';
    const summary = esc(`${e.title}${amt}`);
    const desc = esc([e.category, e.note].filter(Boolean).join(' · ') || 'Maxie Finance Tracker');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${esc(e.id)}@maxie-finance`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${dt}`,
      `DTEND;VALUE=DATE:${nextDt}`,
      `SUMMARY:${summary}`,
      `DESCRIPTION:${desc}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
