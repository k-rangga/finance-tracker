import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import s from '../styles/ui.module.css';
import { Badge, Bar, Card, CardHead, Dot, IconChip } from '../components/ui';
import { IC, Icon } from '../components/Icon';
import { changeBadge, dayAmount, dayTotalLabel, ICON_CHIP, type Budget, type TxView } from '../lib/budget';
import type { Cycle } from '../lib/cycle';
import { dayLabel, dayMonth, pc, sum, tidyName } from '../lib/format';
import { useSettings } from '../lib/settings';
import { C } from '../lib/tokens';
import { categoryByName, SAVINGS_TARGET_PCT, TRANSFER_CATEGORY } from '../data/categories';

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
};

type SummaryProps = Props & {
  onOpenSettings: () => void;
  /** Open Transactions on a range, optionally filtered to one category. */
  onShowTransactions: (range: 'today' | 'cycle', cat?: string) => void;
};

/** Wide screens: the cycle and breakdowns on the left, a pinned glance panel on the right. Phones: one column. */
export function Summary({ cycle, budget, onOpenCategory, onOpenSettings, onShowTransactions }: SummaryProps) {
  return (
    <div className={s.summaryGrid}>
      <div className={s.summaryCycle}>
        <ThisCycle cycle={cycle} budget={budget} onOpenSettings={onOpenSettings} />
      </div>
      <aside className={s.summarySide} aria-label="At a glance">
        <SavingsCard cycle={cycle} budget={budget} onMark={() => onShowTransactions('cycle', TRANSFER_CATEGORY)} />
        <TodayCard cycle={cycle} budget={budget} onSeeAll={() => onShowTransactions('today')} />
        <ComingUpCard cycle={cycle} budget={budget} />
        <VsLastCycleCard cycle={cycle} budget={budget} />
      </aside>
      <div className={s.summaryRest}>
        {budget.cards.length > 0 && <CreditCards budget={budget} />}
        <WhereItWent cycle={cycle} budget={budget} onOpenCategory={onOpenCategory} />
        <WeeklyPace cycle={cycle} budget={budget} />
      </div>
    </div>
  );
}

type Row = {
  id: string;
  label: string;
  value?: string;
  items: Item[];
  note?: string;
  strong?: boolean;
  /** Shown above the items when the row opens (e.g. the savings breakdown). */
  summary?: ReactNode;
  /** List the items under collapsible category groups instead of straight by day. */
  byCategory?: boolean;
  /** A one-line row with nothing to open and no amount (e.g. "No more bills before payday"). */
  quiet?: boolean;
};

function ThisCycle({ cycle, budget: b, onOpenSettings }: { cycle: Cycle; budget: Budget; onOpenSettings: () => void }) {
  const { full, short, ofIncome, settings } = useSettings();
  // Everything starts collapsed.
  const [open, setOpen] = useState<string | null>(null);
  const budgetPct = Math.round((b.budget / b.income) * 100);

  const txItem = (t: TxView): Item => {
    const c = categoryByName(t.cat);
    return {
      key: t.id,
      title: t.title,
      sub:
        `${t.time} · ${t.cat} · ${t.source}` +
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
    key: bill.title,
    title: bill.title,
    sub: `Due ${dayLabel(bill.date)} · in ${cycle.offsetOf(bill.date) - cycle.dayIdx} days · ${bill.category} · ${bill.source}`,
    value: '- ' + full(bill.amount),
    ink: C.text,
    icon: IC.calendar,
    cat: bill.category,
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
  const savingsNote =
    `Saved ${full(b.saved)} of ${full(savings)} planned · Invested ${full(b.invested)}` +
    (leftInSavings >= 0 ? ` · ${full(leftInSavings)} left in savings` : ` · ${full(-leftInSavings)} more than you saved`);
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
      label: `Savings (${SAVINGS_TARGET_PCT}%)`,
      value: full(b.saved),
      items: b.txs.filter(t => t.isSavings || t.isInvestment).map(txItem),
      note: savingsNote,
      summary: savingsSummary,
    },
    { id: 'fixed', label: 'Fixed bills paid', value: full(b.fixedSpent), items: fixedItems },
    { id: 'var', label: 'Variable spending', value: full(b.varSpent), items: varItems, byCategory: true },
    billItems.length
      ? { id: 'due', label: 'Bills still due', value: full(b.fixedDue), items: billItems, note: `${billItems.length} upcoming before ${dayMonth(cycle.end)}` }
      : { id: 'due', label: 'No more bills before payday', items: [], quiet: true },
    { id: 'left', label: 'Left to spend', value: full(b.budget - b.spent), items: [], strong: true },
  ].filter((r: Row) => r.quiet || r.strong || r.id === 'inc' || r.items.length > 0 || r.summary || r.value !== full(0));

  // Budget and savings both come out of income: together they can't be more than all of it.
  const plannedPct = budgetPct + SAVINGS_TARGET_PCT;
  const overPace = b.spent - b.paceToday;
  const usedInk = b.spent > b.budget ? C.redInk : b.spent > b.paceToday ? C.amberInk : C.textMuted;
  // The bar is the spending budget, coloured by what it went on (largest first).
  const segs = b.cats.filter(c => c.spent > 0).sort((x, y) => y.spent - x.spent);
  const scale = Math.max(b.budget, b.spent);
  const ending = cycle.daysLeft <= 2;

  return (
    <Card style={{ gap: 24, overflow: 'hidden' }}>
      <CardHead title="This cycle" />
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
            <span style={{ fontSize: 14, color: C.textMuted }}>Safe to spend today</span>
            <span style={{ fontWeight: 600, letterSpacing: '-0.02em', fontSize: 36, lineHeight: 1.05, color: b.safeDay > 0 ? C.text : C.redInk }}>{full(b.safeDay)}</span>
            <span style={{ fontSize: 14, color: C.textSoft }}>
              {full(Math.max(0, b.budget - b.spent - b.fixedDue))} left after bills · {cycle.daysLeft} {cycle.daysLeft === 1 ? 'day' : 'days'} to payday
            </span>
          </div>
          <span style={{ fontSize: 14, color: C.textMuted }}>
            Spent <strong style={{ color: C.text }}>{full(b.spent)}</strong> of your {full(b.budget)} budget ({budgetPct}% of income)
          </span>
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
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, color: C.textMuted }}>
              <span style={{ color: usedInk, fontWeight: usedInk === C.textMuted ? 400 : 700 }}>
                {Math.round((b.spent / b.budget) * 100)}% used{b.spent > b.budget ? ` · ${full(b.spent - b.budget)} over` : ''}
              </span>
              {ending ? (
                <span>{full(Math.max(0, b.budget - b.spent))} left until payday</span>
              ) : (
                <span title={`Pace target today ${full(b.paceToday)}`} style={{ fontWeight: 600, color: overPace > 0 ? C.redInk : C.accent800 }}>
                  {overPace > 0 ? `${short(overPace)} over pace` : `${short(-overPace)} under pace`}
                </span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '6px 14px', flexWrap: 'wrap', fontSize: 13, color: C.textMuted }}>
            {segs.slice(0, 5).map(c => (
              <span key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Dot color={c.color} /> {c.name} {short(c.spent)}
              </span>
            ))}
            {segs.length > 5 && <span>+{segs.length - 5} more</span>}
          </div>
        </div>
      </div>
      <div className={s.bleed}>
        {rows.map(r => {
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
                style={{ padding: '12px var(--pad)', fontWeight: r.strong ? 800 : 600, background: r.strong ? C.accentSoft : undefined, minHeight: 48 }}
              >
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, marginRight: 'auto', minWidth: 0 }}>
                  <span style={{ fontSize: 15 }}>{r.label}</span>
                  {(r.note ?? count(r.items.length)) && <span style={{ fontSize: 13, fontWeight: 500, color: C.textMuted }}>{r.note ?? count(r.items.length)}</span>}
                </span>
                <span style={{ fontSize: 15, color: r.strong ? C.accent800 : C.text }}>{r.value}</span>
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
function SideRow({ mark, title, sub, value, ink = C.text }: { mark: ReactNode; title: string; sub: string; value: string; ink?: string }) {
  return (
    <div className={s.sideRow}>
      <span className={s.sideMark}>{mark}</span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, marginRight: 'auto' }}>
        <span className={s.ellipsis} style={{ fontSize: 14, fontWeight: 500 }}>
          {title}
        </span>
        <span style={{ fontSize: 13, color: C.textMuted }}>{sub}</span>
      </span>
      <span style={{ fontSize: 14, fontWeight: 600, flex: 'none', color: ink }}>{value}</span>
    </div>
  );
}

/** Savings ring: what you moved with "Transfer (savings)" against the target. */
function SavingsCard({ cycle, budget: b, onMark }: { cycle: Cycle; budget: Budget; onMark: () => void }) {
  const { full, short, ofIncome } = useSettings();
  const target = ofIncome(SAVINGS_TARGET_PCT);
  const onTarget = b.saved >= target && target > 0;
  const none = b.saved <= 0;
  // Grey until something is saved; amber only when the cycle is nearly over and you're still short.
  const ink = onTarget ? C.accent800 : none ? C.textMuted : cycle.daysLeft <= 7 ? C.amberInk : C.accent700;
  const ring = onTarget ? C.mint[5] : cycle.daysLeft <= 7 && !none ? C.amber : C.accent600;
  const deg = Math.max(0, Math.min(100, (b.saved / Math.max(1, target)) * 100)) * 3.6;
  return (
    <section className={s.sideCard}>
      <SideHead title="Savings" sub={`Target ${SAVINGS_TARGET_PCT}% of income · ${full(target)}`} />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}>
        <div
          role="img"
          aria-label={`Saved ${b.savedPct.toFixed(1)}% of income this cycle against a ${SAVINGS_TARGET_PCT}% target`}
          style={{ width: 136, height: 136, borderRadius: '50%', background: `conic-gradient(${ring} 0deg ${deg}deg, ${C.divider} ${deg}deg 360deg)`, display: 'grid', placeItems: 'center' }}
        >
          <div style={{ width: 106, height: 106, borderRadius: '50%', background: C.surface, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontWeight: 600, letterSpacing: '-0.02em', fontSize: 24, color: ink }}>{none ? '0%' : b.savedPct.toFixed(1) + '%'}</span>
            <span style={{ fontSize: 12, color: C.textMuted }}>of income saved</span>
          </div>
        </div>
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
    </section>
  );
}

/** Today's spending and income, newest first. Moves between your own accounts aren't spending, so they're only counted. */
function TodayCard({ cycle, budget: b, onSeeAll }: { cycle: Cycle; budget: Budget; onSeeAll: () => void }) {
  const { full } = useSettings();
  const all = b.txs.filter(t => t.offset === cycle.dayIdx);
  const today = all.filter(t => !t.isTransfer);
  const transfers = all.filter(t => t.isTransfer && !t.isInstallment).length;
  const spent = today.filter(t => !t.isIncome).reduce((a, t) => a + t.net, 0);
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
      {today.length === 0 && <span style={{ fontSize: 14, color: C.textMuted }}>No spending yet today.</span>}
      {today.length > 0 && (
        <div className={s.sideList}>
          {today.slice(0, 5).map(t => (
            <SideRow
              key={t.id}
              mark={<Dot color={categoryByName(t.cat)?.color ?? C.accent500} />}
              title={tidyName(t.title)}
              sub={`${t.cat} · ${t.time}`}
              value={t.isIncome ? '+ ' + full(t.amount) : full(t.net)}
              ink={t.isIncome ? C.accent800 : C.text}
            />
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
function ComingUpCard({ cycle, budget: b }: { cycle: Cycle; budget: Budget }) {
  const { full } = useSettings();
  const bills = [...b.bills].sort((x, y) => x.date.getTime() - y.date.getTime());
  return (
    <section className={s.sideCard}>
      <SideHead title="Coming up" sub={bills.length ? `${full(b.fixedDue)} in bills before payday` : undefined} />
      {bills.length === 0 && <span style={{ fontSize: 14, color: C.textMuted }}>No more bills before payday.</span>}
      {bills.length > 0 && (
        <div className={s.sideList}>
          {bills.slice(0, 4).map(bill => {
            const inDays = cycle.offsetOf(bill.date) - cycle.dayIdx;
            return (
              <SideRow
                key={bill.title}
                mark={<Icon d={IC.calendar} size={15} color={C.textMuted} />}
                title={tidyName(bill.title)}
                sub={`${dayMonth(bill.date)} · ${inDays === 0 ? 'today' : inDays === 1 ? 'tomorrow' : `in ${inDays} days`}`}
                value={full(bill.amount)}
              />
            );
          })}
        </div>
      )}
      {bills.length > 4 && <span style={{ fontSize: 13, color: C.textMuted }}>+{bills.length - 4} more</span>}
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
        const ic = ICON_CHIP;
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
  const ic = ICON_CHIP;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: `1px solid ${C.divider}` }}>
      <IconChip d={i.icon} bg={ic.bg} ink={ic.ink} size={34} iconSize={16} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginRight: 'auto', minWidth: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{i.title}</span>
        <span style={{ fontSize: 13, color: C.textMuted }}>{i.sub}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flex: 'none' }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: i.ink, whiteSpace: 'nowrap' }}>{i.value}</span>
        {i.struck && <span style={{ fontSize: 13, color: C.textMuted, textDecoration: 'line-through', whiteSpace: 'nowrap' }}>{i.struck}</span>}
      </div>
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
  const { full } = useSettings();
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Phones get a taller box so narrow tiles still have room for a name.
  const height = width < 520 ? 360 : 340;
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
    const cats = b.cats.filter(c => c.spent > 0).sort((x, y) => y.spent - x.spent);
    const rects = squarify(
      cats.map(c => c.spent),
      { x: 0, y: 0, w: width, h: height },
    );
    const seen = { variable: 0, fixed: 0 };
    return cats.map((c, i) => {
      const family = TREEMAP_FAMILIES[c.type === 'fixed' ? 'Fixed bills' : 'Variable'];
      const color = family[seen[c.type]++ % family.length];
      return { c, r: rects[i], color };
    });
  }, [b.cats, width, height]);
  const ranked = [...b.cats].sort((x, y) => x.status.rank - y.status.rank || y.used - x.used);
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
      <div ref={box} className={s.treemap} style={{ height: tiles.length ? height : 120 }} onMouseLeave={() => setHover(null)}>
        {!tiles.length && <span style={{ margin: 'auto', fontSize: 14, color: C.textMuted }}>Nothing spent yet this cycle.</span>}
        {tiles.map(({ c, r, color }) => {
          if (!r) return null;
          const pct = (c.spent / b.spent) * 100;
          const ink = onColor(color);
          // Label size follows the tile: big tiles read from across the room, small ones keep what fits.
          const side = Math.min(r.w, r.h);
          const big = r.w >= 220 && r.h >= 120;
          const fits = r.w >= 70 && r.h >= 40;
          const tiny = !fits && side >= 24 && r.w >= 44;
          return (
            <button
              key={c.name}
              type="button"
              className={s.tile}
              onClick={() => onOpenCategory(c.name)}
              onMouseMove={e => {
                const box2 = box.current!.getBoundingClientRect();
                setHover({ name: c.name, x: e.clientX - box2.left, y: e.clientY - box2.top });
              }}
              aria-label={`${c.name}: ${full(c.spent)}, ${pct.toFixed(1)}% of spending. Open in Categories`}
              style={{
                left: r.x,
                top: r.y,
                width: r.w,
                height: r.h,
                background: color,
                color: ink,
                opacity: hover && hover.name !== c.name ? 0.55 : 1,
                padding: big ? '12px 14px' : '8px 10px',
              }}
            >
              {(fits || tiny) && (
                <>
                  <span className={s.tileName} style={{ fontSize: big ? 16 : fits && side >= 70 ? 14 : 12 }}>
                    {c.name}
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
        <span style={{ color: C.textMuted }}>Tile size = share of spending · hover for details · click to open</span>
      </div>
      <div className={s.bleed} style={{ marginTop: 4 }}>
        {ranked.map(c => {
          const ic = ICON_CHIP;
          const ch = changeBadge(c.spent, c.lastSameDays);
          return (
            <button
              key={c.name}
              type="button"
              className={s.rowBtn}
              onClick={() => onOpenCategory(c.name)}
              style={{ padding: '12px var(--pad)', background: c.status.rowBg, flexWrap: 'wrap' }}
            >
              <IconChip d={c.icon} bg={ic.bg} ink={ic.ink} size={36} iconSize={16} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 220px', minWidth: 0 }}>
                <span style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '2px 8px', fontSize: 14 }}>
                  <span style={{ fontWeight: 600 }}>{c.name}</span>
                  <span style={{ color: C.textMuted, whiteSpace: 'nowrap', marginLeft: 'auto' }}>
                    <strong style={{ color: C.text, fontWeight: 600 }}>{full(c.spent)}</strong> / {full(c.limit)}
                  </span>
                </span>
                <Bar value={c.spent} max={Math.max(c.limit, c.spent)} tick={c.limit} color={c.status.bar} height={8} label={`${c.name} ${Math.round(c.used)}% of limit`} />
              </span>
              {/* Fixed-width badge columns, so every row's bar, limit tick and amount end at the same place. */}
              <span className={s.catBadges}>
                <Badge ink={c.status.ink}>
                  {c.status.label}
                </Badge>
                <Badge ink={ch.ink}>
                  {ch.label}
                </Badge>
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function WeeklyPace({ cycle, budget: b }: { cycle: Cycle; budget: Budget }) {
  const { full, short } = useSettings();
  const [sel, setSel] = useState(cycle.weekIdx);

  const weeks = useMemo(() => {
    const fixedNames = new Set(b.cats.filter(c => c.type === 'fixed').map(c => c.name));
    let fc = 0;
    let vc = 0;
    let pj = 0;
    return [0, 1, 2, 3].map(i => {
      const first = i * 7;
      const last = i === 3 ? cycle.cycleDays - 1 : i * 7 + 6;
      const futureDays = Math.max(0, last - Math.max(first - 1, cycle.dayIdx));
      const billsIn = sum(b.bills.filter(x => Math.min(3, Math.floor(cycle.offsetOf(x.date) / 7)) === i).map(x => x.amount));
      const proj = b.velDay * futureDays + billsIn;
      const fixedW = sum(b.cats.filter(c => fixedNames.has(c.name)).map(c => c.cur[i]));
      const varW = sum(b.cats.filter(c => !fixedNames.has(c.name)).map(c => c.cur[i]));
      fc += fixedW;
      vc += varW;
      pj += proj;
      const cum = fc + vc + pj;
      return {
        i,
        label: 'Week ' + (i + 1),
        range: dayMonth(cycle.dateOf(first)) + ' – ' + dayMonth(cycle.dateOf(last)),
        isFuture: first > cycle.dayIdx,
        hasProj: proj > 0.5,
        weekSpend: fixedW + varW,
        proj,
        fc,
        vc,
        pj,
        cum,
        ideal: fc + b.varBudget * Math.min(1, (last + 1) / cycle.cycleDays),
      };
    });
  }, [b, cycle]);

  const scale = Math.max(b.projTotal, b.budget) * 1.1;
  const w = weeks[sel];
  const diff = w.cum - w.ideal;
  const projOver = b.projTotal > b.budget;
  const thisW = b.weekTotal(cycle.weekIdx);
  const lastW = cycle.weekIdx > 0 ? b.weekTotal(cycle.weekIdx - 1) : 0;
  const wow = lastW ? ((thisW - lastW) / lastW) * 100 : 0;
  const down = wow < 0;

  return (
    <Card style={{ gap: 16 }}>
      <CardHead title="Weekly pace" caption={`Cumulative spend · dashed line = ${Math.round((b.budget / b.income) * 100)}% budget`} />
      {cycle.weekIdx > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            alignSelf: 'flex-start',
            background: down ? C.accentTint : C.redTint,
            color: down ? C.accent800 : C.redInk,
            borderRadius: 999,
            padding: '8px 16px 8px 8px',
            fontSize: 13,
          }}
        >
          <span style={{ flex: 'none', width: 28, height: 28, borderRadius: '50%', background: C.surface, display: 'grid', placeItems: 'center' }}>
            <Icon d={down ? IC.trendDown : IC.trend} size={16} />
          </span>
          <span>
            <strong>
              Week {cycle.weekIdx + 1} is {Math.abs(Math.round(wow))}% {down ? 'lower' : 'higher'} than week {cycle.weekIdx}
            </strong>{' '}
            · {full(thisW)} vs {full(lastW)}
          </span>
        </div>
      )}
      <div style={{ position: 'relative', height: 220, display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 16, alignItems: 'end' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, height: 0, borderTop: `2px dashed ${C.red}`, bottom: pc((b.budget / scale) * 100), zIndex: 2, pointerEvents: 'none' }} />
        <span
          style={{
            position: 'absolute',
            right: 0,
            fontSize: 13,
            fontWeight: 600,
            color: C.redInk,
            background: C.surface,
            padding: '0 6px',
            transform: 'translateY(50%)',
            bottom: pc((b.budget / scale) * 100),
            zIndex: 3,
          }}
        >
          {short(b.budget)}
        </span>
        {weeks.map(wk => (
          <button
            key={wk.i}
            type="button"
            aria-label={`${wk.label}, cumulative ${short(wk.cum)}`}
            aria-pressed={sel === wk.i}
            onMouseEnter={() => setSel(wk.i)}
            onClick={() => setSel(wk.i)}
            style={{
              position: 'relative',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-end',
              border: 'none',
              borderRadius: 10,
              padding: '0 12px',
              background: sel === wk.i ? C.divider : 'transparent',
            }}
          >
            <div style={{ height: pc((wk.cum / scale) * 100), display: 'flex', flexDirection: 'column-reverse', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ flex: 'none', height: pc((wk.fc / wk.cum) * 100), background: C.accent700 }} />
              <div style={{ flex: 'none', height: pc((wk.vc / wk.cum) * 100), background: C.mint[5] }} />
              <div style={{ flex: 'none', height: pc((wk.pj / wk.cum) * 100), background: `repeating-linear-gradient(135deg, ${C.mint[8]} 0 6px, ${C.accentHover} 6px 12px)` }} />
            </div>
            <div style={{ position: 'absolute', left: 6, right: 6, height: 3, borderRadius: 2, background: C.text, opacity: 0.55, bottom: pc((wk.ideal / scale) * 100) }} />
          </button>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 16 }}>
        {weeks.map(wk => (
          <div key={wk.i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', fontSize: 13, fontWeight: sel === wk.i ? 700 : 500 }}>
            <span>{wk.label}</span>
            <span style={{ color: C.textMuted, fontWeight: 500 }}>{short(wk.cum)}</span>
          </div>
        ))}
      </div>
      <div className={s.note} style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 13 }} aria-live="polite">
        <span style={{ fontWeight: 600 }}>
          {w.label} · {w.range}
          {w.isFuture ? ' · projected' : ''}
        </span>
        <span>
          {w.isFuture ? 'Projected spend ' + short(w.proj) : 'Spent ' + short(w.weekSpend) + (w.hasProj ? ' + ' + short(w.proj) + ' projected' : '')} · cumulative {short(w.cum)} · ideal{' '}
          {short(w.ideal)}
        </span>
        <span style={{ fontWeight: 600, color: (w.isFuture ? projOver : diff > 0) ? C.redInk : C.accent800 }}>
          {w.isFuture
            ? projOver
              ? `Ends ${short(b.projTotal - b.budget)} over budget at current pace`
              : `Ends ${short(b.budget - b.projTotal)} under budget at current pace`
            : diff > 0
              ? `${short(diff)} ahead of ideal pace`
              : `${short(-diff)} behind ideal pace`}
        </span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, fontSize: 13, color: C.textSoft }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Dot color={C.accent700} />
          Fixed bills
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Dot color={C.mint[5]} />
          Variable
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Dot color={C.mint[8]} />
          Projected
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 12, height: 3, borderRadius: 2, background: C.textMuted }} />
          Ideal pace
        </span>
      </div>
    </Card>
  );
}
