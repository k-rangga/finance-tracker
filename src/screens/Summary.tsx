import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import s from '../styles/ui.module.css';
import { Badge, Card, CardHead, DismissBill, Dot, DueChip, IconChip } from '../components/ui';
import { IC, Icon } from '../components/Icon';
import { Celebrate, useCountUp } from '../components/Delight';
import { changeBadge, dayAmount, dayTotalLabel, iconChip, type Budget, type TxView } from '../lib/budget';
import type { Cycle } from '../lib/cycle';
import { dayLabel, dayMonth, pc, sum, tidyName, toISO } from '../lib/format';
import { useSettings } from '../lib/settings';
import { useData } from '../lib/data';
import { useIsPhone } from '../lib/media';
import { C } from '../lib/tokens';
import { categoryByName, SAVINGS_TARGET_PCT, TRANSFER_CATEGORY } from '../data/categories';
import { canDismissBill, type Bill } from '../data/transactions';

type Props = { cycle: Cycle; budget: Budget; onOpenCategory: (name: string) => void };

type Item = {
  key: string;
  title: string;
  sub: string;
  value: string;
  ink: string;
  icon: string;
  cat?: string;
  /** Transactions only: grouped under a day header. */
  date?: Date;
  /** Transactions only: what it adds to its day's total (see dayAmount). */
  dayAmount?: number;
  /** Gross amount, struck through under the net when part of it was paid back or isn't yours. */
  struck?: string;
  /** Bills only: when it's due, shown as a chip. */
  due?: { date: Date; inDays: number };
  /** Predicted bills only: "not a bill this cycle". */
  onDismiss?: () => void;
};

type SummaryProps = Props & {
  onOpenSettings: () => void;
  /** Hide a predicted bill for this cycle. */
  onDismissBill: (b: Bill) => void;
  /** Open Transactions on a range, optionally filtered to one category. */
  onShowTransactions: (range: 'today' | 'cycle', cat?: string) => void;
  /** Ask Gemini this question. */
  onAsk: (question: string) => void;
};

/**
 * Wide screens: the cycle and breakdowns on the left, a pinned glance panel on the right.
 * Phones: one column read top to bottom (spend today → today and what's coming → savings → where it went),
 * with the comparisons folded under More.
 */
export function Summary({ cycle, budget, onOpenCategory, onOpenSettings, onDismissBill, onShowTransactions, onAsk }: SummaryProps) {
  const { ofIncome } = useSettings();
  const phone = useIsPhone();
  const [more, setMore] = useState(false);
  const target = ofIncome(SAVINGS_TARGET_PCT);
  const id = toISO(cycle.start);
  const thisCycle = (
    <ThisCycle cycle={cycle} budget={budget} onOpenSettings={onOpenSettings} onShowCycle={() => onShowTransactions('cycle')} onDismissBill={onDismissBill} />
  );
  const savings = <SavingsCard cycle={cycle} budget={budget} compact={phone} onMark={() => onShowTransactions('cycle', TRANSFER_CATEGORY)} />;
  const today = <TodayCard cycle={cycle} budget={budget} compact={phone} onSeeAll={() => onShowTransactions('today')} />;
  const comingUp = (
    <ComingUpCard cycle={cycle} budget={budget} onDismissBill={onDismissBill} limit={phone ? 1 : 4} onSeeAll={() => onShowTransactions('today')} />
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Small wins, once per cycle on this device. */}
      <Celebrate id={id + '.saved'} when={target > 0 && budget.saved >= target} />
      <Celebrate id={id + '.under'} when={cycle.daysLeft <= 1 && budget.spent <= budget.budget} />
      {phone ? (
        <>
          {thisCycle}
          <section className={s.summarySide} style={{ alignSelf: 'stretch' }} aria-label="At a glance">
            {today}
            {comingUp}
            {savings}
          </section>
          <WhereItWent cycle={cycle} budget={budget} onOpenCategory={onOpenCategory} />
          {budget.cards.length > 0 && <CreditCards budget={budget} />}
          <section className={s.summarySide} style={{ alignSelf: 'stretch' }}>
            <button type="button" className={s.rowBtn} aria-expanded={more} onClick={() => setMore(!more)} style={{ padding: '14px 16px', minHeight: 48 }}>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, marginRight: 'auto' }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>More</span>
                <span style={{ fontSize: 13, color: C.textMuted }}>Compared with last cycle · spending pace</span>
              </span>
              <Icon d={IC.chevDown} size={16} color={C.textMuted} style={{ transform: more ? 'rotate(180deg)' : 'none' }} />
            </button>
            {more && (
              <div className="fade-in" style={{ borderTop: `1px solid ${C.divider}` }}>
                <VsLastCycleCard cycle={cycle} budget={budget} />
              </div>
            )}
          </section>
          {more && <SpendingPace cycle={cycle} budget={budget} onAsk={onAsk} />}
        </>
      ) : (
        <div className={s.summaryGrid}>
          <div className={s.summaryCycle}>{thisCycle}</div>
          <aside className={s.summarySide} aria-label="At a glance">
            {savings}
            {today}
            {comingUp}
            <VsLastCycleCard cycle={cycle} budget={budget} />
          </aside>
          <div className={s.summaryRest}>
            {budget.cards.length > 0 && <CreditCards budget={budget} />}
            <WhereItWent cycle={cycle} budget={budget} onOpenCategory={onOpenCategory} />
            <SpendingPace cycle={cycle} budget={budget} onAsk={onAsk} />
          </div>
        </div>
      )}
    </div>
  );
}

/** Days in a row, back from today, where variable spending stayed within its even daily share. */
export function underBudgetStreak(cycle: Cycle, b: Budget) {
  const perDay = b.varBudget / cycle.cycleDays;
  const byDay = new Map<number, number>();
  for (const t of b.txs) if (categoryByName(t.cat)?.type === 'variable') byDay.set(t.offset, (byDay.get(t.offset) ?? 0) + t.net);
  let days = 0;
  for (let o = cycle.dayIdx; o >= 0 && (byDay.get(o) ?? 0) <= perDay; o--) days++;
  return { days, perDay };
}

/** "Good evening, Rangga" and the streak: the small line above today's number. */
function Greeting({ cycle, budget: b }: { cycle: Cycle; budget: Budget }) {
  const { short, settings } = useSettings();
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const name = settings.name.trim().split(/\s+/)[0];
  const streak = underBudgetStreak(cycle, b);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px 12px', flexWrap: 'wrap' }}>
      <span style={{ fontSize: 15, fontWeight: 500, color: C.textSoft }}>
        {hello}
        {name ? `, ${name}` : ''}
      </span>
      {streak.days >= 2 && (
        <span className={s.streak} title={`Variable spending at or under ${short(streak.perDay)} a day`}>
          🔥 {streak.days} days under budget
        </span>
      )}
    </div>
  );
}

type Row = {
  id: string;
  label: string;
  value?: string;
  items: Item[];
  strong?: boolean;
  /** Shown above the items when the row opens (e.g. the savings breakdown). */
  summary?: ReactNode;
  /** List the items under collapsible category groups instead of straight by day. */
  byCategory?: boolean;
  /** A one-line row with nothing to open and no amount (e.g. "No more bills before payday"). */
  quiet?: boolean;
};

function ThisCycle({
  cycle,
  budget: b,
  onOpenSettings,
  onShowCycle,
  onDismissBill,
}: {
  cycle: Cycle;
  budget: Budget;
  onOpenSettings: () => void;
  onShowCycle: () => void;
  onDismissBill: (b: Bill) => void;
}) {
  const { full, short, ofIncome, settings } = useSettings();
  const { notes } = useData();
  const phone = useIsPhone();
  /** Phones: short amounts (Rp 4.0M) wherever a full one would wrap. */
  const fit = phone ? short : full;
  // Everything starts collapsed; on phones the whole breakdown too.
  const [open, setOpen] = useState<string | null>(null);
  const [breakdown, setBreakdown] = useState(false);
  const budgetPct = Math.round((b.budget / b.income) * 100);

  const txItem = (t: TxView): Item => {
    const c = categoryByName(t.cat);
    return {
      key: t.id,
      title: tidyName(t.title),
      sub:
        `${t.time} · ${t.cat}` +
        (notes[t.id] ? ` · “${notes[t.id]}”` : '') +
        (t.reimbursed ? ` · ${full(t.reimbursed)} reimbursed` : '') +
        (t.share != null ? ` · your share of ${full(t.amount)}` : ''),
      value: (t.isIncome ? '+ ' : '- ') + full(t.isIncome ? t.amount : t.net),
      // The section already says it's spending: only incomes get a colour.
      ink: t.isIncome ? C.accent800 : C.text,
      icon: c ? c.icon : t.isSavings ? IC.piggy : t.isInvestment ? IC.trend : IC.coins,
      cat: t.cat,
      date: t.date,
      // The Savings list totals what it shows (money moved out), though it isn't spending.
      dayAmount: t.isInvestment || t.isSavings ? -t.amount : dayAmount(t),
      struck: !t.isIncome && t.net !== t.amount ? full(t.amount) : undefined,
    };
  };
  const typeOf = (n: string) => categoryByName(n)?.type;
  const billItems: Item[] = b.bills.map(bill => ({
    key: `${bill.title}|${bill.amount}|${bill.date.getTime()}`,
    title: tidyName(bill.title),
    sub: bill.category,
    due: { date: bill.date, inDays: cycle.offsetOf(bill.date) - cycle.dayIdx },
    value: '- ' + full(bill.amount),
    ink: C.text,
    icon: IC.calendar,
    cat: bill.category,
    onDismiss: canDismissBill(bill) ? () => onDismissBill(bill) : undefined,
  }));
  const savings = ofIncome(SAVINGS_TARGET_PCT);
  const investPlan = ofIncome(settings.investPct);
  const count = (n: number) => (n ? n + (n === 1 ? ' transaction' : ' transactions') : '');
  const fixedItems = b.txs.filter(t => typeOf(t.cat) === 'fixed').map(txItem);
  const varItems = b.txs.filter(t => typeOf(t.cat) === 'variable').map(txItem);

  // Savings and investing are one pocket. Only what you moved there counts ("Transfer (savings)" transactions),
  // not the plan; investing comes out of it.
  const aboveInvestPlan = b.invested - investPlan;
  const leftInSavings = b.saved - b.invested;
  const savingsSummary = (
    <div style={{ display: 'flex', flexDirection: 'column', padding: '6px 0 4px' }}>
      <BreakdownLine
        label="Moved to savings this cycle"
        sub={
          `Plan ${full(savings)} (${SAVINGS_TARGET_PCT}% of income)` +
          (b.saved >= savings ? ' · plan reached' : ` · ${full(savings - b.saved)} to go`) +
          (b.saved ? '' : ' · set a transfer\'s category to Transfer (savings) to count it')
        }
        value={full(b.saved)}
      />
      <BreakdownLine
        label="Invested this cycle"
        sub={`Plan ${full(investPlan)} (${settings.investPct}% of income)` + (aboveInvestPlan > 0 ? ` · ${full(aboveInvestPlan)} above plan` : '')}
        value={full(b.invested)}
        ink={aboveInvestPlan > 0 ? C.amberInk : C.text}
      />
      <BreakdownLine
        label={leftInSavings >= 0 ? 'Left in savings' : 'Invested beyond your savings'}
        value={full(Math.abs(leftInSavings))}
        ink={leftInSavings >= 0 ? C.accent800 : C.redInk}
        strong
      />
    </div>
  );

  const rows: Row[] = [
    { id: 'inc', label: 'Income', value: full(b.income), items: b.txs.filter(t => t.isIncome && !t.reimbursesId).map(txItem) },
    {
      id: 'save',
      label: 'Savings',
      value: `${fit(b.saved)} / ${fit(savings)}`,
      items: b.txs.filter(t => t.isSavings || t.isInvestment).map(txItem),
      summary: savingsSummary,
    },
    { id: 'fixed', label: 'Fixed bills paid', value: full(b.fixedSpent), items: fixedItems },
    { id: 'var', label: 'Variable spending', value: full(b.varSpent), items: varItems, byCategory: true },
    billItems.length
      ? { id: 'due', label: 'Bills still due', value: full(b.fixedDue), items: billItems }
      : { id: 'due', label: 'No more bills before payday', items: [], quiet: true },
    // Same figure as "After bills" above: bills still due are already spoken for.
    { id: 'left', label: 'Left after bills', value: full(Math.max(0, b.budget - b.spent - b.fixedDue)), items: [], strong: true },
  ].filter((r: Row) => r.quiet || r.strong || r.id === 'inc' || r.items.length > 0 || r.summary || r.value !== full(0));

  const safeShown = useCountUp(b.safeDay);
  // Budget and savings both come out of income: together they can't be more than all of it.
  const plannedPct = budgetPct + SAVINGS_TARGET_PCT;
  const overPace = b.spent - b.paceToday;
  const ending = cycle.daysLeft <= 2;
  const statusInk = b.spent > b.budget ? C.redInk : ending ? C.textMuted : overPace > 0 ? C.amberInk : C.accent800;
  // The bar is the spending budget, coloured by what it went on (largest first).
  const segs = b.cats.filter(c => c.spent > 0).sort((x, y) => y.spent - x.spent);
  const scale = Math.max(b.budget, b.spent);

  return (
    <Card style={{ gap: phone ? 20 : 24, overflow: 'hidden' }}>
      <Greeting cycle={cycle} budget={b} />
      {plannedPct > 100 && (
        <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: '8px 12px', flexWrap: 'wrap', background: C.amberTint, color: C.amberInk, borderRadius: 10, padding: '10px 14px', fontSize: 14 }}>
          <span style={{ marginRight: 'auto' }}>
            Budget {budgetPct}% + savings {SAVINGS_TARGET_PCT}% = <strong>{plannedPct}% of income</strong>. Lower a category limit or the savings target so they fit.
          </span>
          <button type="button" className={s.btnOutline} onClick={onOpenSettings} style={{ flex: 'none' }}>
            Adjust
          </button>
        </div>
      )}
      {ending && <CycleWrapUp cycle={cycle} budget={b} />}
      <div style={{ display: 'flex' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, flex: 1, minWidth: 0 }}>
          {/* One number first: what you can spend today and stay on budget. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className={s.statLabel}>Safe today</span>
            <span style={{ fontWeight: 600, letterSpacing: '-0.02em', fontSize: 36, lineHeight: 1.05, color: b.safeDay > 0 ? C.text : C.redInk }}>{full(safeShown)}</span>
          </div>
          {/* Then three figures, label over number. */}
          <div className={s.statRow}>
            <div className={s.stat}>
              <span className={s.statLabel}>After bills</span>
              <span className={s.statValue}>{fit(Math.max(0, b.budget - b.spent - b.fixedDue))}</span>
            </div>
            <div className={s.stat} title={`Next payday ${dayLabel(cycle.next)}`}>
              <span className={s.statLabel}>Payday</span>
              <span className={s.statValue}>
                {cycle.daysLeft} {cycle.daysLeft === 1 ? 'day' : 'days'}
              </span>
            </div>
            <button type="button" className={`${s.stat} ${s.statBtn}`} onClick={onShowCycle} title={`See this cycle's transactions · budget is ${budgetPct}% of income`}>
              <span className={s.statLabel}>
                Spent <Icon d={IC.arrowRight} size={11} />
              </span>
              <span className={s.statValue}>
                {fit(b.spent)}
                <span style={{ color: C.textMuted, fontWeight: 500 }}> / {fit(b.budget).replace(/^Rp /, '')}</span>
              </span>
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div
              className={s.track}
              style={{ height: 14, display: 'flex', overflow: 'visible' }}
              role="img"
              aria-label={'Spent by category: ' + segs.map(c => `${c.name} ${full(c.spent)}`).join(', ')}
            >
              <div style={{ display: 'flex', width: '100%', height: '100%', borderRadius: 999, overflow: 'hidden', gap: 2 }}>
                {segs.map(c => (
                  <div key={c.name} title={`${c.name} ${full(c.spent)}`} style={{ flex: 'none', width: pc((c.spent / scale) * 100), background: c.color }} />
                ))}
              </div>
              <div className={s.tick} style={{ top: -5, bottom: -5, width: 4, left: pc((b.paceToday / scale) * 100) }} />
            </div>
            {/* One status: over budget, else what's left at the end of the cycle, else the pace. */}
            <span
              title={`${Math.round((b.spent / b.budget) * 100)}% of the budget used · pace target today ${full(b.paceToday)}`}
              style={{ fontSize: 13, fontWeight: 600, color: statusInk }}
            >
              {b.spent > b.budget
                ? `+${short(b.spent - b.budget)} over budget`
                : ending
                  ? `${short(Math.max(0, b.budget - b.spent))} left until payday`
                  : overPace > 0
                    ? `+${short(overPace)} over pace`
                    : `${short(-overPace)} under pace`}
            </span>
          </div>
        </div>
      </div>
      <div className={s.bleed}>
        {phone && (
          <button type="button" className={s.rowBtn} aria-expanded={breakdown} onClick={() => setBreakdown(!breakdown)} style={{ padding: '10px var(--pad)', minHeight: 46 }}>
            <span style={{ fontSize: 15, fontWeight: 500, marginRight: 'auto' }}>Breakdown</span>
            <span style={{ fontSize: 13, color: C.textMuted }}>Income, savings, bills</span>
            <Icon d={IC.chevDown} size={16} color={C.textMuted} style={{ transform: breakdown ? 'rotate(180deg)' : 'none' }} />
          </button>
        )}
        {(!phone || breakdown) && rows.map(r => {
          const has = r.items.length > 0 || !!r.summary;
          const isOpen = open === r.id && has;
          if (r.quiet)
            return (
              <div key={r.id} style={{ padding: '12px var(--pad)', fontSize: 13, color: C.textMuted, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon d={IC.calendar} size={15} />
                {r.label}
              </div>
            );
          return (
            <div key={r.id} style={{}}>
              <button
                type="button"
                className={s.rowBtn}
                disabled={!has}
                aria-expanded={has ? isOpen : undefined}
                onClick={() => has && setOpen(isOpen ? null : r.id)}
                title={has ? (r.items.length ? count(r.items.length) : undefined) : undefined}
                style={{ padding: '10px var(--pad)', fontWeight: r.strong ? 600 : 500, background: r.strong ? 'color-mix(in srgb, var(--accent-500) 9%, transparent)' : undefined, minHeight: 46 }}
              >
                <span style={{ fontSize: 15, marginRight: 'auto', minWidth: 0 }}>{r.label}</span>
                <span style={{ fontSize: 15, color: r.strong ? C.accent800 : C.text, whiteSpace: 'nowrap', flex: 'none' }}>{r.value}</span>
                <Icon d={IC.chevDown} size={16} color={C.textMuted} style={{ opacity: has ? 1 : 0, transform: isOpen ? 'rotate(180deg)' : 'none' }} />
              </button>
              {isOpen && (
                <div className="fade-in" style={{ padding: '0 var(--pad) 8px' }}>
                  {r.summary}
                  {r.byCategory ? <ByCategory key={r.id} items={r.items} /> : <ByDay items={r.items} />}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/** Header shared by the side cards: title with an optional action on the right, one summary line below. */
function SideHead({ title, sub, action }: { title: string; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <h3 className={s.sideTitle}>{title}</h3>
        {action}
      </div>
      {sub && <span style={{ fontSize: 13, color: C.textMuted }}>{sub}</span>}
    </div>
  );
}

/** One line in a side card: marker, name over a detail line, amount. */
function SideRow({ mark, title, sub, value, ink = C.text, action }: { mark: ReactNode; title: string; sub: ReactNode; value: string; ink?: string; action?: ReactNode }) {
  return (
    <div className={s.sideRow}>
      <span className={s.sideMark}>{mark}</span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, marginRight: 'auto' }}>
        <span className={s.ellipsis} style={{ fontSize: 14, fontWeight: 500 }}>
          {title}
        </span>
        <span style={{ fontSize: 13, color: C.textMuted }}>{sub}</span>
      </span>
      <span style={{ fontSize: 14, fontWeight: 600, flex: 'none', whiteSpace: 'nowrap', color: ink }}>{value}</span>
      {action}
    </div>
  );
}

/** Savings ring: what you moved with "Transfer (savings)" against the target. `compact` (phones) puts it beside the text. */
function SavingsCard({ cycle, budget: b, compact, onMark }: { cycle: Cycle; budget: Budget; compact?: boolean; onMark: () => void }) {
  const { full, short, ofIncome } = useSettings();
  const target = ofIncome(SAVINGS_TARGET_PCT);
  const onTarget = b.saved >= target && target > 0;
  const none = b.saved <= 0;
  // Grey until something is saved; amber only when the cycle is nearly over and you're still short.
  const ink = onTarget ? C.accent800 : none ? C.textMuted : cycle.daysLeft <= 7 ? C.amberInk : C.accent700;
  const ring = onTarget ? C.mint[5] : cycle.daysLeft <= 7 && !none ? C.amber : C.accent600;
  const deg = Math.max(0, Math.min(100, (b.saved / Math.max(1, target)) * 100)) * 3.6;
  const size = compact ? 64 : 136;
  const hole = compact ? 50 : 106;
  const pct = none ? '0%' : b.savedPct.toFixed(compact ? 0 : 1) + '%';
  const ringStyle = (px: number) => ({
    flex: 'none',
    width: px,
    height: px,
    borderRadius: '50%',
    background: `conic-gradient(${ring} 0deg ${deg}deg, ${C.divider} ${deg}deg 360deg)`,
    display: 'grid',
    placeItems: 'center',
  });
  // Phones: one row (small ring, saved / target, and the button when nothing is marked yet).
  if (compact)
    return (
      <section className={s.sideCard} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <div role="img" aria-label={`Saved ${b.savedPct.toFixed(1)}% of income this cycle against a ${SAVINGS_TARGET_PCT}% target`} style={ringStyle(32)}>
          <div style={{ width: 22, height: 22, borderRadius: '50%', background: C.surface }} />
        </div>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 1, marginRight: 'auto', minWidth: 0 }}>
          <h3 className={s.sideTitle}>Savings</h3>
          <span style={{ fontSize: 13, color: C.textMuted, whiteSpace: 'nowrap' }}>
            <strong style={{ color: ink, fontWeight: 600 }}>{short(b.saved)}</strong> / {short(target)}
            {onTarget ? ' ✓' : ''}
          </span>
        </span>
        {none ? (
          <button type="button" className={s.btnOutline} onClick={onMark} title="Set a transfer's category to Transfer (savings)" style={{ flex: 'none' }}>
            Mark transfer
          </button>
        ) : (
          <span style={{ fontSize: 15, fontWeight: 600, color: ink }}>{pct}</span>
        )}
      </section>
    );
  return (
    <section className={s.sideCard}>
      <SideHead title="Savings" sub={`Target ${SAVINGS_TARGET_PCT}% of income · ${compact ? short(target) : full(target)}`} />
      <div
        style={
          compact
            ? { display: 'flex', alignItems: 'center', gap: 14 }
            : { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }
        }
      >
        <div
          role="img"
          aria-label={`Saved ${b.savedPct.toFixed(1)}% of income this cycle against a ${SAVINGS_TARGET_PCT}% target`}
          style={{ flex: 'none', width: size, height: size, borderRadius: '50%', background: `conic-gradient(${ring} 0deg ${deg}deg, ${C.divider} ${deg}deg 360deg)`, display: 'grid', placeItems: 'center' }}
        >
          <div style={{ width: hole, height: hole, borderRadius: '50%', background: C.surface, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontWeight: 600, letterSpacing: '-0.02em', fontSize: compact ? 15 : 24, color: ink }}>{pct}</span>
            {!compact && <span style={{ fontSize: 12, color: C.textMuted }}>of income saved</span>}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: compact ? 'flex-start' : 'center', gap: 8, minWidth: 0 }}>
          {none ? (
            <>
              <span style={{ fontSize: 13, color: C.textSoft }}>No savings transfer yet this cycle.</span>
              <button type="button" className={s.btnOutline} onClick={onMark}>
                Mark your savings transfer
              </button>
            </>
          ) : (
            <span style={{ fontSize: 13, color: C.textSoft }}>
              {full(b.saved)} saved · {onTarget ? 'target reached ✓' : `${short(target - b.saved)} to go`}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}

/** Today's spending and income, newest first. Moves between your own accounts aren't spending, so they're only counted. */
function TodayCard({ cycle, budget: b, compact, onSeeAll }: { cycle: Cycle; budget: Budget; compact?: boolean; onSeeAll: () => void }) {
  const { full } = useSettings();
  const { notes } = useData();
  const all = b.txs.filter(t => t.offset === cycle.dayIdx);
  const today = all.filter(t => !t.isTransfer);
  const transfers = all.filter(t => t.isTransfer && !t.isInstallment).length;
  const spent = today.filter(t => !t.isIncome).reduce((a, t) => a + t.net, 0);
  // Phones, nothing yet: one line instead of a card.
  if (compact && today.length === 0)
    return (
      <section className={s.sideCard} style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <h3 className={s.sideTitle}>Today</h3>
        <span style={{ fontSize: 14, color: C.textMuted }}>Nothing spent yet 🌿</span>
      </section>
    );
  return (
    <section className={s.sideCard}>
      <SideHead
        title="Today"
        sub={today.length ? `${full(spent)} spent` : undefined}
        action={
          all.length > 0 && (
            <button type="button" className={s.textBtnSm} onClick={onSeeAll}>
              See all
            </button>
          )
        }
      />
      {today.length === 0 && <span style={{ fontSize: 14, color: C.textMuted }}>No spending yet today — nice! 🌿</span>}
      {today.length > 0 && (
        <div className={s.sideList}>
          {today.slice(0, 5).map(t => (
            <button key={t.id} type="button" className={s.recapRow} onClick={onSeeAll} title="See today's transactions">
              <SideRow
                mark={<Dot color={categoryByName(t.cat)?.color ?? C.accent500} />}
                title={tidyName(t.title)}
                sub={`${t.cat} · ${t.time}` + (notes[t.id] ? ` · “${notes[t.id]}”` : '')}
                value={t.isIncome ? '+ ' + full(t.amount) : full(t.net)}
                ink={t.isIncome ? C.accent800 : C.text}
              />
            </button>
          ))}
        </div>
      )}
      {(today.length > 5 || transfers > 0) && (
        <span style={{ fontSize: 13, color: C.textMuted }}>
          {[today.length > 5 && `+${today.length - 5} more`, transfers > 0 && `${transfers} ${transfers === 1 ? 'transfer' : 'transfers'} between your accounts`].filter(Boolean).join(' · ')}
        </span>
      )}
    </section>
  );
}

/** Fixed bills expected before payday, soonest first. */
function ComingUpCard({
  cycle,
  budget: b,
  onDismissBill,
  limit,
  onSeeAll,
}: {
  cycle: Cycle;
  budget: Budget;
  onDismissBill: (b: Bill) => void;
  /** How many to list (phones: just the next one); the rest are on Transactions. */
  limit: number;
  onSeeAll: () => void;
}) {
  const { full } = useSettings();
  const bills = [...b.bills].sort((x, y) => x.date.getTime() - y.date.getTime());
  return (
    <section className={s.sideCard}>
      <SideHead title="Coming up" sub={bills.length ? `${full(b.fixedDue)} in bills before payday` : undefined} />
      {bills.length === 0 && <span style={{ fontSize: 14, color: C.textMuted }}>No more bills before payday.</span>}
      {bills.length > 0 && (
        <div className={s.sideList}>
          {bills.slice(0, limit).map(bill => {
            const inDays = cycle.offsetOf(bill.date) - cycle.dayIdx;
            return (
              <SideRow
                key={`${bill.title}|${bill.amount}|${bill.date.getTime()}`}
                mark={<Icon d={IC.calendar} size={15} color={C.textMuted} />}
                title={tidyName(bill.title)}
                sub={<DueChip date={bill.date} inDays={inDays} />}
                value={full(bill.amount)}
                action={canDismissBill(bill) ? <DismissBill title={tidyName(bill.title)} onClick={() => onDismissBill(bill)} /> : undefined}
              />
            );
          })}
        </div>
      )}
      {bills.length > limit && (
        <button type="button" className={s.textBtnSm} onClick={onSeeAll} style={{ alignSelf: 'flex-start' }}>
          +{bills.length - limit} more on Transactions →
        </button>
      )}
    </section>
  );
}

/** Variable spending so far against last cycle's by the same day. */
function VsLastCycleCard({ cycle, budget: b }: { cycle: Cycle; budget: Budget }) {
  const { full } = useSettings();
  const vari = b.cats.filter(c => c.type === 'variable');
  const cur = sum(vari.map(c => c.spent));
  const last = sum(vari.map(c => c.lastSameDays));
  const ch = changeBadge(cur, last);
  return (
    <section className={s.sideCard}>
      <SideHead title="Compared with last cycle" sub={`Variable spending by day ${cycle.dayN}`} />
      {last <= 0 ? (
        <span style={{ fontSize: 14, color: C.textMuted }}>No spending from last cycle to compare yet.</span>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2, marginRight: 'auto' }}>
            <span style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.01em' }}>{full(cur)}</span>
            <span style={{ fontSize: 13, color: C.textMuted }}>Last cycle {full(last)}</span>
          </span>
          <Badge ink={ch.ink}>
            {ch.label}
          </Badge>
        </div>
      )}
    </section>
  );
}

/** Last days of the cycle: how it's ending, instead of how it's pacing. */
function CycleWrapUp({ cycle, budget: b }: { cycle: Cycle; budget: Budget }) {
  const { full } = useSettings();
  const when = cycle.daysLeft === 0 ? 'today' : cycle.daysLeft === 1 ? 'tomorrow' : `in ${cycle.daysLeft} days`;
  const over = b.cats.filter(c => c.spent > c.limit).sort((x, y) => y.spent - y.limit - (x.spent - x.limit))[0];
  const usedPct = Math.round((b.spent / b.budget) * 100);
  const onTarget = b.savedPct >= SAVINGS_TARGET_PCT;
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', background: C.accentSoft, borderRadius: 10, padding: '14px 16px' }}>
      <IconChip d={IC.calendar} bg={C.accentTint} ink={C.accent800} size={34} iconSize={16} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>
          Cycle closes {when} · payday {dayLabel(cycle.next)}
        </span>
        <span style={{ fontSize: 13, color: C.textSoft, lineHeight: 1.5 }}>
          Spent {usedPct}% of your budget · saved {b.savedPct.toFixed(1)}% ({full(b.saved)}) vs your {SAVINGS_TARGET_PCT}% target{onTarget ? ' ✓' : ''} ·{' '}
          {over ? (
            <>
              biggest overspend: <strong style={{ color: C.redInk, whiteSpace: 'nowrap' }}>{over.name} +{full(over.spent - over.limit)}</strong>
            </>
          ) : (
            'every category within its limit'
          )}
        </span>
      </div>
    </div>
  );
}

function BreakdownLine({ label, sub, value, ink = C.text, strong }: { label: string; sub?: string; value: string; ink?: string; strong?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: `1px solid ${C.divider}` }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginRight: 'auto', minWidth: 0 }}>
        <span style={{ fontSize: 14, fontWeight: strong ? 700 : 600 }}>{label}</span>
        {sub && <span style={{ fontSize: 13, color: C.textMuted }}>{sub}</span>}
      </div>
      <span style={{ fontSize: 14, fontWeight: strong ? 700 : 600, color: ink, whiteSpace: 'nowrap' }}>{value}</span>
    </div>
  );
}

/** Items under day headers with each day's total. */
function ByDay({ items }: { items: Item[] }) {
  const { full } = useSettings();
  return (
    <>
      {groupByDay(items).map(g => (
        <div key={g.label || 'items'}>
          {g.label && (
            <h3 style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: C.textMuted, padding: '14px 0 6px' }}>
              <span>{g.label}</span>
              <span style={{ letterSpacing: 0, textTransform: 'none' }}>{dayTotalLabel(sum(g.items.map(i => i.dayAmount ?? 0)), full)}</span>
            </h3>
          )}
          {g.items.map(i => (
            <CycleItem key={i.key} i={i} />
          ))}
        </div>
      ))}
    </>
  );
}

/** One collapsible group per category (largest first), each listing its items by day. All start collapsed. */
function ByCategory({ items }: { items: Item[] }) {
  const { full } = useSettings();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const groups = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const i of items) m.set(i.cat ?? '', [...(m.get(i.cat ?? '') ?? []), i]);
    return [...m].map(([cat, list]) => ({ cat, list, total: -sum(list.map(i => i.dayAmount ?? 0)) })).sort((x, y) => y.total - x.total);
  }, [items]);
  const toggle = (cat: string) =>
    setOpen(o => {
      const n = new Set(o);
      if (n.has(cat)) n.delete(cat);
      else n.add(cat);
      return n;
    });
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {groups.map(g => {
        const c = categoryByName(g.cat);
        const ic = iconChip(g.cat);
        const isOpen = open.has(g.cat);
        return (
          <div key={g.cat} style={{ borderTop: `1px solid ${C.divider}` }}>
            <button
              type="button"
              className={s.rowBtn}
              aria-expanded={isOpen}
              onClick={() => toggle(g.cat)}
              style={{ padding: '12px 0', gap: 12, background: 'transparent' }}
            >
              <IconChip d={c?.icon ?? IC.coins} bg={ic.bg} ink={ic.ink} size={34} iconSize={16} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, marginRight: 'auto', minWidth: 0, textAlign: 'left' }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{g.cat}</span>
                <span style={{ fontSize: 13, fontWeight: 500, color: C.textMuted }}>
                  {g.list.length} {g.list.length === 1 ? 'transaction' : 'transactions'}
                </span>
              </span>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{full(g.total)}</span>
              <Icon d={IC.chevDown} size={15} color={C.textMuted} style={{ transform: isOpen ? 'rotate(180deg)' : 'none' }} />
            </button>
            {isOpen && (
              <div className="fade-in" style={{ paddingLeft: 46, paddingBottom: 6 }}>
                {/* The group already says the category. */}
                <ByDay items={g.list.map(i => ({ ...i, sub: i.sub.replace(` · ${g.cat} · `, ' · ') }))} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Consecutive items on the same day share a header (items are already newest first); undated items get none. */
function groupByDay(items: Item[]) {
  const groups: { label: string; items: Item[] }[] = [];
  for (const i of items) {
    const label = i.date ? dayMonth(i.date) : '';
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(i);
    else groups.push({ label, items: [i] });
  }
  return groups;
}

function CycleItem({ i }: { i: Item }) {
  const ic = iconChip(i.cat);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: `1px solid ${C.divider}` }}>
      <IconChip d={i.icon} bg={ic.bg} ink={ic.ink} size={34} iconSize={16} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginRight: 'auto', minWidth: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{i.title}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 13, color: C.textMuted }}>
          {i.due && <DueChip date={i.due.date} inDays={i.due.inDays} />}
          {i.sub}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flex: 'none' }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: i.ink, whiteSpace: 'nowrap' }}>{i.value}</span>
        {i.struck && <span style={{ fontSize: 13, color: C.textMuted, textDecoration: 'line-through', whiteSpace: 'nowrap' }}>{i.struck}</span>}
      </div>
      {i.onDismiss && <DismissBill title={i.title} onClick={i.onDismiss} />}
    </div>
  );
}

function CreditCards({ budget: b }: { budget: Budget }) {
  const { full } = useSettings();
  return (
    <Card>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <h2 className={s.h2}>Credit cards</h2>
        <span className={s.caption}>Card purchases count as spending when you buy. Bill payments are transfers.</span>
      </div>
      <div className={s.bleed}>
        {b.cards.map(c => (
          <div key={c.account} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px var(--pad)', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: '1 1 260px', minWidth: 0 }}>
              <IconChip d={IC.card} bg={C.accentTint} ink={C.accent800} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{c.account.replace(/^CC /, '')} card</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 13, color: C.textMuted }}>
                  <span>Spent this cycle {full(c.spent)}</span>
                  <span aria-hidden="true">·</span>
                  <span>Last bill {full(c.lastBill)}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    Paid {full(c.paid)}
                    {c.paidOn ? ' on ' + dayMonth(c.paidOn) : ''}
                  </span>
                  <Badge ink={c.paidInFull ? C.accent800 : C.amberInk} style={{ fontSize: 13, fontWeight: 600, padding: '4px 10px' }}>
                    {c.paidInFull ? 'Paid in full' : full(c.carriedOver) + ' carried over'}
                  </Badge>
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, marginLeft: 'auto', flex: 'none' }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>{full(c.owed)}</span>
              <span style={{ fontSize: 13, color: C.textMuted }}>owed</span>
            </div>
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px var(--pad)', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginRight: 'auto', minWidth: 0 }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>Cash out this cycle</span>
            <span style={{ fontSize: 13, color: C.textMuted }}>
              {full(b.nonCardSpent)} bank &amp; e-wallet spending + {full(b.cardBillsPaid)} card bills paid
            </span>
          </div>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{full(b.cashOut)}</span>
        </div>
      </div>
    </Card>
  );
}

/**
 * Treemap colours: one muted family per group (warm earth for variable spending, greens for fixed bills),
 * biggest tile first, so the map reads as two families instead of a rainbow.
 */
const TREEMAP_FAMILIES: Record<string, string[]> = {
  Variable: ['#c35f3d', '#d89a2c', '#b5431f', '#e8c47e', '#d98a68', '#a8721c', '#e0a87e', '#9c5a3c'],
  'Fixed bills': ['#1f5e4a', '#5e9a83', '#3f7f67', '#9cbfb0', '#2d6e58', '#7fae9b'],
};

/** White or dark text, whichever reads better on `hex`. */
function onColor(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const lin = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.22 ? '#16201e' : '#ffffff';
}

/** Phones: categories under this share of spending go into one "Other" tile. */
const OTHER_SHARE = 0.05;
const OTHER_COLOR = '#8b8f8a';

type Rect = { x: number; y: number; w: number; h: number };

/** Squarified treemap: tiles for `values` (largest first) in `r`, kept as close to square as the space allows. */
function squarify(values: number[], r: Rect): Rect[] {
  const total = sum(values);
  if (!total) return [];
  const areas = values.map(v => (v / total) * r.w * r.h);
  const out: Rect[] = [];
  let rest = { ...r };
  let row: number[] = [];
  // Worst aspect ratio of a row laid along a side of this length.
  const worst = (xs: number[], side: number) => {
    const s = sum(xs);
    return Math.max((side * side * Math.max(...xs)) / (s * s), (s * s) / (side * side * Math.min(...xs)));
  };
  const place = (xs: number[]) => {
    const s = sum(xs);
    if (rest.w >= rest.h) {
      // A column on the left.
      const w = s / rest.h;
      let y = rest.y;
      for (const a of xs) out.push({ x: rest.x, y, w, h: a / w }), (y += a / w);
      rest = { x: rest.x + w, y: rest.y, w: rest.w - w, h: rest.h };
    } else {
      // A row along the top.
      const h = s / rest.w;
      let x = rest.x;
      for (const a of xs) out.push({ x, y: rest.y, w: a / h, h }), (x += a / h);
      rest = { x: rest.x, y: rest.y + h, w: rest.w, h: rest.h - h };
    }
  };
  for (let i = 0; i < areas.length; ) {
    const side = Math.min(rest.w, rest.h);
    if (!row.length || worst([...row, areas[i]], side) <= worst(row, side)) row.push(areas[i++]);
    else {
      place(row);
      row = [];
    }
  }
  if (row.length) place(row);
  return out;
}

function WhereItWent({ cycle, budget: b, onOpenCategory }: Props) {
  const { full, short } = useSettings();
  const phone = useIsPhone();
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Phones: a shorter box, with the small categories merged into one "Other" tile so every tile can be read.
  const height = phone ? 230 : 340;
  /** Hovered tile and where the pointer is, for the details tooltip. */
  const [hover, setHover] = useState<{ name: string; x: number; y: number } | null>(null);

  // Totals per type, for the legend.
  const groups = useMemo(() => {
    const spent = b.cats.filter(c => c.spent > 0);
    return (
      [
        ['Variable', spent.filter(c => c.type === 'variable')],
        ['Fixed bills', spent.filter(c => c.type === 'fixed')],
      ] as const
    )
      .map(([name, cats]) => ({ name, total: sum(cats.map(c => c.spent)) }))
      .filter(g => g.total > 0)
      .sort((x, y) => y.total - x.total);
  }, [b.cats]);
  // Tiles strictly by size: biggest top-left down to smallest bottom-right, whatever the type.
  // Colour still tells the type: warm shades for variable spending, greens for fixed bills, darkest first.
  const tiles = useMemo(() => {
    const all = b.cats.filter(c => c.spent > 0).sort((x, y) => y.spent - x.spent);
    const small = phone ? all.filter(c => c.spent / b.spent < OTHER_SHARE) : [];
    // Only worth merging when there's more than one.
    const cats = small.length > 1 ? all.filter(c => !small.includes(c)) : all;
    const other = small.length > 1 ? sum(small.map(c => c.spent)) : 0;
    const rects = squarify(
      [...cats.map(c => c.spent), ...(other ? [other] : [])],
      { x: 0, y: 0, w: width, h: height },
    );
    const seen = { variable: 0, fixed: 0 };
    const list = cats.map((c, i) => {
      const family = TREEMAP_FAMILIES[c.type === 'fixed' ? 'Fixed bills' : 'Variable'];
      const color = family[seen[c.type]++ % family.length];
      return { name: c.name, spent: c.spent, r: rects[i], color, others: undefined as string[] | undefined };
    });
    if (other) list.push({ name: 'Other', spent: other, r: rects[cats.length], color: OTHER_COLOR, others: small.map(c => c.name) });
    return list;
  }, [b.cats, b.spent, phone, width, height]);
  // Over or near their limit, worst first, at most three.
  const attention = b.cats
    .filter(c => c.status.key !== 'ok')
    .sort((x, y) => x.status.rank - y.status.rank || y.used - x.used)
    .slice(0, 3);
  const hovered = hover ? b.cats.find(c => c.name === hover.name) : undefined;

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '4px 16px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <h2 className={s.h2}>Where it went</h2>
          <span className={s.caption}>
            Spent {full(b.spent)} · day {cycle.dayN} of {cycle.cycleDays}
          </span>
        </div>
      </div>
      <div ref={box} data-own-gestures className={s.treemap} style={{ height: tiles.length ? height : 120 }} onMouseLeave={() => setHover(null)}>
        {!tiles.length && <span style={{ margin: 'auto', fontSize: 14, color: C.textMuted }}>Nothing spent yet this cycle.</span>}
        {tiles.map(({ name, spent, r, color, others }) => {
          if (!r) return null;
          const pct = (spent / b.spent) * 100;
          const ink = onColor(color);
          // Label size follows the tile: big tiles read from across the room, small ones keep what fits.
          const side = Math.min(r.w, r.h);
          const big = r.w >= 220 && r.h >= 120;
          const fits = r.w >= 70 && r.h >= 40;
          const tiny = !fits && side >= 24 && r.w >= 44;
          return (
            <button
              key={name}
              type="button"
              className={s.tile}
              onClick={() => onOpenCategory(others ? '' : name)}
              onMouseMove={e => {
                if (others) return;
                const box2 = box.current!.getBoundingClientRect();
                setHover({ name, x: e.clientX - box2.left, y: e.clientY - box2.top });
              }}
              title={others?.join(', ')}
              aria-label={`${others ? 'Other (' + others.join(', ') + ')' : name}: ${full(spent)}, ${pct.toFixed(1)}% of spending. Open in Categories`}
              style={{
                left: r.x,
                top: r.y,
                width: r.w,
                height: r.h,
                background: color,
                color: ink,
                opacity: hover && hover.name !== name ? 0.55 : 1,
                padding: big ? '12px 14px' : '8px 10px',
              }}
            >
              {(fits || tiny) && (
                <>
                  <span className={s.tileName} style={{ fontSize: big ? 16 : fits && side >= 70 ? 14 : 12 }}>
                    {name}
                  </span>
                  <span style={{ fontSize: big ? 22 : fits && side >= 70 ? 16 : 12, fontWeight: 600, lineHeight: 1.15, opacity: 0.92 }}>{pct.toFixed(1)}%</span>
                </>
              )}
            </button>
          );
        })}
        {hover && hovered && (
          <div
            className={s.tileTip}
            role="tooltip"
            style={{ left: Math.min(hover.x + 14, width - 220), top: Math.min(hover.y + 14, height - 96) }}
          >
            <strong style={{ fontSize: 14 }}>{hovered.name}</strong>
            <span>
              {full(hovered.spent)} · {((hovered.spent / b.spent) * 100).toFixed(1)}% of spending
            </span>
            <span style={{ color: C.textMuted }}>
              {Math.round(hovered.used)}% of its {full(hovered.limit)} limit
            </span>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '6px 20px', flexWrap: 'wrap', fontSize: 14, color: C.textSoft }}>
        <span style={{ display: 'flex', gap: '6px 20px', flexWrap: 'wrap' }}>
          {groups.map(g => (
            <span key={g.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Dot color={TREEMAP_FAMILIES[g.name][0]} />
              {g.name} {Math.round((g.total / b.spent) * 100)}%
            </span>
          ))}
        </span>
        {!phone && <span style={{ color: C.textMuted }}>Tile size = share of spending · hover for details · click to open</span>}
      </div>
      {/* Only what needs a look; the full list lives on Categories. */}
      <div className={s.bleed} style={{ marginTop: 4 }}>
        {attention.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px var(--pad)', fontSize: 14, color: C.accent800 }}>
            ✓ All categories on track
          </div>
        ) : (
          attention.map(c => {
            const ic = iconChip(c.name);
            return (
              <button
                key={c.name}
                type="button"
                className={s.rowBtn}
                onClick={() => onOpenCategory(c.name)}
                style={{ padding: '10px var(--pad)', background: c.status.rowBg, minHeight: 48 }}
              >
                <IconChip d={c.icon} bg={ic.bg} ink={ic.ink} size={28} iconSize={14} />
                <span className={s.ellipsis} style={{ fontSize: 14, fontWeight: 600, marginRight: 'auto', minWidth: 0 }}>
                  {c.name}
                </span>
                <span style={{ fontSize: 14, whiteSpace: 'nowrap', color: C.textMuted }}>
                  <strong style={{ color: C.text, fontWeight: 600 }}>{short(c.spent)}</strong> / {short(c.limit)}
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', color: c.status.ink, minWidth: 40, textAlign: 'right' }}>{Math.round(c.used)}%</span>
              </button>
            );
          })
        )}
        <button type="button" className={s.rowBtn} onClick={() => onOpenCategory('')} style={{ padding: '12px var(--pad)', fontSize: 14, fontWeight: 600, color: C.accent700 }}>
          See all categories →
        </button>
      </div>
    </Card>
  );
}

/**
 * Spending so far, day by day (cumulative), and where it ends if you keep going: variable spending at your
 * daily average plus the bills still due on their dates. One line against the budget.
 */
function SpendingPace({ cycle, budget: b, onAsk }: { cycle: Cycle; budget: Budget; onAsk: (question: string) => void }) {
  const { full, short } = useSettings();
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const days = cycle.cycleDays;
  const today = cycle.dayIdx;
  const points = useMemo(() => {
    const byDay = new Array<number>(days).fill(0);
    for (const t of b.txs) if (categoryByName(t.cat) && t.offset >= 0 && t.offset <= today) byDay[t.offset] += t.net;
    for (const bill of b.bills) byDay[Math.min(days - 1, Math.max(today + 1, cycle.offsetOf(bill.date)))] += bill.amount;
    let run = 0;
    return byDay.map((v, o) => (run += v + (o > today ? b.velDay : 0)));
  }, [b, cycle, days, today]);

  const end = points[days - 1];
  const over = end - b.budget;
  const height = 170;
  const pad = { top: 22, bottom: 4 };
  const max = Math.max(end, b.budget, 1) * 1.06;
  const x = (o: number) => (days > 1 ? (o / (days - 1)) * width : 0);
  const y = (v: number) => pad.top + (1 - v / max) * (height - pad.top - pad.bottom);
  const path = (from: number, to: number) => points.slice(from, to + 1).map((v, i) => `${i ? 'L' : 'M'}${x(from + i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const area = `${path(0, today)}L${x(today).toFixed(1)},${height}L0,${height}Z`;
  const line = over > 0 ? C.redInk : C.accent600;
  const pick = (clientX: number) => {
    const r = box.current!.getBoundingClientRect();
    setHover(Math.max(0, Math.min(days - 1, Math.round(((clientX - r.left) / r.width) * (days - 1)))));
  };
  const h = hover ?? today;
  const billsLeft = sum(b.bills.map(x => x.amount));

  return (
    <Card style={{ gap: 14 }}>
      <CardHead title="Spending pace" caption="Day by day, and where this cycle ends at this pace" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span className={s.statLabel}>Ends at</span>
        <span style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em' }}>{full(end)}</span>
        <span style={{ fontSize: 14, fontWeight: 600, color: over > 0 ? C.redInk : C.accent800 }}>
          {over > 0 ? `${short(over)} over budget` : `${short(-over)} under budget`}
          <span style={{ fontWeight: 400, color: C.textMuted }}> · budget {short(b.budget)}</span>
        </span>
        <button
          type="button"
          className={s.linkBtn}
          onClick={() =>
            onAsk(
              over > 0
                ? `My spending pace ends at ${full(end)}, ${full(over)} over my ${full(b.budget)} budget. Why, and how do I finish this cycle on budget?`
                : `My spending pace ends at ${full(end)}, under my ${full(b.budget)} budget. Anything I should watch for the rest of this cycle?`,
            )
          }
          style={{ alignSelf: 'flex-start', marginTop: 4 }}
        >
          <Icon d={IC.sparkle} size={14} /> {over > 0 ? 'Why, and how to fix it?' : 'Ask Gemini about it'}
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {/* What the pointer is on (today when it isn't on the chart). */}
        <span style={{ fontSize: 13, color: C.textMuted, minHeight: 18 }} aria-live="polite">
          <strong style={{ color: C.text, fontWeight: 600 }}>{dayLabel(cycle.dateOf(h))}</strong>
          {h === today ? ' (today)' : ''} · {full(points[h])} {h > today ? 'at this pace' : 'spent so far'}
        </span>
        <div
          ref={box}
          data-own-gestures
          style={{ position: 'relative', height, touchAction: 'pan-y' }}
          onPointerMove={e => pick(e.clientX)}
          onPointerDown={e => pick(e.clientX)}
          onPointerLeave={() => setHover(null)}
        >
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={`Spent ${full(points[today])} by today; at this pace ${full(end)} by ${dayLabel(cycle.dateOf(days - 1))}, against a budget of ${full(b.budget)}.`}
            style={{ display: 'block', overflow: 'visible' }}
          >
            <path d={area} fill={C.accent500} opacity={0.12} />
            <line x1={0} x2={width} y1={y(b.budget)} y2={y(b.budget)} stroke={C.textMuted} strokeWidth={1.5} strokeDasharray="4 4" />
            <path d={path(0, today)} fill="none" stroke={C.accent600} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
            <path d={path(today, days - 1)} fill="none" stroke={line} strokeWidth={2} strokeDasharray="5 5" strokeLinejoin="round" />
            <line x1={x(h)} x2={x(h)} y1={pad.top - 6} y2={height} stroke={C.textFaint} strokeWidth={1} />
            <circle cx={x(h)} cy={y(points[h])} r={5} fill={h > today ? line : C.accent600} stroke={C.surface} strokeWidth={2} />
            <circle cx={x(days - 1)} cy={y(end)} r={4} fill={line} stroke={C.surface} strokeWidth={2} />
          </svg>
          <span className={s.paceTag} style={{ top: Math.max(0, y(b.budget) - 22), right: 0 }}>
            Budget {short(b.budget)}
          </span>
        </div>
        <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.textMuted }}>
          <span>{dayMonth(cycle.start)}</span>
          {/* Under today's point, unless it would sit on the start or end date. */}
          {x(today) > 56 && x(today) < width - 56 && <span style={{ position: 'absolute', left: x(today), transform: 'translateX(-50%)', fontWeight: 600, color: C.text }}>Today</span>}
          <span>{dayMonth(cycle.dateOf(days - 1))}</span>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', fontSize: 13, color: C.textSoft }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 16, height: 3, borderRadius: 2, background: C.accent600 }} />
          Spent
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 16, borderTop: `2px dashed ${line}` }} />
          At this pace: {short(b.velDay)}/day{billsLeft > 0 ? ` + ${short(billsLeft)} bills` : ''}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 16, borderTop: `1.5px dashed ${C.textMuted}` }} />
          Budget
        </span>
      </div>
    </Card>
  );
}
