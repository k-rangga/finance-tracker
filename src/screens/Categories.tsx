import { useEffect, useMemo, useState } from 'react';
import s from '../styles/ui.module.css';
import { FoundInstallments } from '../components/Plans';
import { BillItem, BudgetCard, InstallmentsGroup, useInstallmentTotals } from './categoryCards';
import { Badge, Toast } from '../components/ui';
import { Celebrate } from '../components/Delight';
import { Logo } from '../components/Logo';
import { IC, Icon } from '../components/Icon';
import { categoryStatus, changeBadge, type Budget, type CatView, type TxView } from '../lib/budget';
import type { Cycle } from '../lib/cycle';
import { sum, toISO } from '../lib/format';
import { useSettings } from '../lib/settings';
import { useIsPhone } from '../lib/media';
import { C } from '../lib/tokens';
import { useSetLimits } from '../lib/limits';
import type { FixedBillStatus } from '../lib/fixedBills';
import type { Transaction } from '../data/transactions';
import { ChallengeBox, challengeState, SectionHead, startChallenge, streaks, Summary, TargetIcon, TrophyIcon } from './categoriesExtras';
import { FixedBillsList } from './FixedBills';

type Mode = 'cycle' | 'week';
type CatFilter = 'all' | 'watch' | 'smooth' | 'challenges';
type CatSort = 'attention' | 'spent' | 'room';

type Props = {
  cycle: Cycle;
  budget: Budget;
  /** Every transaction, for streaks across cycles and no-spend challenges. */
  allTxs: TxView[];
  /** Every raw transaction, for suggesting recurring fixed bills. */
  allRaw: Transaction[];
  /** Individual fixed bills with verification statuses for this cycle. */
  fixedBillStatuses: FixedBillStatus[];
  catOf: (t: Transaction) => string;
  open: string | null;
  setOpen: (n: string | null) => void;
  onShowTransactions: (cat: string, extra?: { q?: string; date?: string }) => void;
  /** Open the edit dialog for a category (built-in: limit and colour only). */
  onEditCategory: (name: string) => void;
  onNewCategory: () => void;
  /** Open Ask Maxie with a category-focused question. */
  onAskMaxie?: (ask?: string) => void;
};

type Row = ReturnType<ReturnType<typeof makeView>>;

/** Gmail import puts what it can't place here: the transactions to sort. */
const UNSORTED = 'Buffer';

/** This period's numbers for one category: spent, the same span last time, its limit, status and transactions. */
const makeView = (mode: Mode, wi: number, warnAt: number, txs: TxView[]) => (c: CatView) => {
  const isCycle = mode === 'cycle';
  const cur = isCycle ? c.spent : c.cur[wi];
  const last = isCycle ? c.lastSameDays : wi > 0 ? c.cur[wi - 1] : c.prev[3];
  const lim = isCycle ? c.limit : c.limit / 4;
  const used = lim ? (cur / lim) * 100 : 0;
  const st = isCycle ? c.status : categoryStatus(used, c, warnAt);
  const mine = txs.filter(t => t.cat === c.name && !t.isIncome && !t.isTransfer && (isCycle || t.week === wi));
  return { c, cur, last, lim, used, st, mine, scale: Math.max(lim, cur, 1) };
};

export function Categories({ cycle, budget, allTxs, allRaw, fixedBillStatuses, catOf, open, setOpen, onShowTransactions, onEditCategory, onNewCategory, onAskMaxie }: Props) {
  const { settings, update, full, short, ofIncome } = useSettings();
  const phone = useIsPhone();
  const fit = phone ? short : full;
  const setLimits = useSetLimits();
  const [mode, setMode] = useState<Mode>('cycle');
  const [filter, setFilter] = useState<CatFilter>('all');
  const [sort, setSort] = useState<CatSort>('attention');
  const [showUnused, setShowUnused] = useState(false);
  /** The last limit or bill change, with a way to take it back, for a few seconds. */
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const wi = cycle.weekIdx;

  useEffect(() => {
    if (open) document.getElementById('cat-' + open)?.scrollIntoView({ block: 'center' });
    // Only on arrival, so a category opened from Summary scrolls into view.
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(timer);
  }, [toast]);

  const view = makeView(mode, wi, settings.warnAt, budget.txs);
  const sorter = (a: Row, b: Row) => {
    if (sort === 'spent') return b.cur - a.cur || a.c.name.localeCompare(b.c.name);
    if (sort === 'room') return b.lim - b.cur - (a.lim - a.cur) || a.c.name.localeCompare(b.c.name);
    return a.st.rank - b.st.rank || b.used - a.used;
  };
  const variable = budget.cats.filter(c => c.type === 'variable').map(view).sort(sorter);
  const usedAll = variable.filter(r => r.cur > 0 || r.st.key !== 'ok');
  const unused = variable.filter(r => !usedAll.includes(r));
  const fixedAll = mode === 'cycle' ? budget.cats.filter(c => c.type === 'fixed').map(view) : [];
  /** Categories already covered by individual FixedBill items don't also show as legacy category buckets. */
  const managedFixedCats = new Set((settings.fixedBills ?? []).filter(b => !b.paused).map(b => b.category));
  /** A legacy fixed category shows once it has an amount, a payment or a bill coming (unless covered by individual bills). */
  const isSet = (r: Row) => !managedFixedCats.has(r.c.name) && (r.lim > 0 || r.cur > 0 || budget.bills.some(b => b.category === r.c.name));
  // Installments are a group of plans (InstallmentsGroup), their payments counted in their own categories.
  const fixed = fixedAll.filter(r => isSet(r) && !r.c.auto);
  /** A fixed bill's monthly amount, as its limit (% of income); 0 hides it again. */
  const setAmount = (name: string, amount: number, before: number) => {
    setLimits({ [name]: settings.income > 0 ? (amount / settings.income) * 100 : 0 });
    setToast({
      text: amount > 0 ? `${name}: ${full(amount)} a month` : `${name} removed from fixed bills`,
      undo: () => setLimits({ [name]: settings.income > 0 ? (before / settings.income) * 100 : 0 }),
    });
  };
  const varSpent = sum(variable.map(r => r.cur));
  const varLimit = sum(variable.map(r => r.lim));

  /** Where spending should be by today, as a share of a limit: days gone in the cycle, or in the week. */
  const todayFrac = mode === 'cycle' ? cycle.dayN / cycle.cycleDays : Math.min(1, (cycle.dayIdx - wi * 7 + 1) / 7);
  const challenges = settings.challenges ?? [];
  const challengeOf = (name: string) => {
    const ch = challenges.find(x => x.category === name);
    return ch ? challengeState(ch, allTxs, cycle.today) : null;
  };
  const activeChallenges = challenges
    .map(ch => ({ ch, st: challengeState(ch, allTxs, cycle.today) }))
    .filter(x => x.st.key === 'running' || x.st.key === 'done');
  const setChallenge = (name: string, on: boolean) => {
    update({ challenges: [...challenges.filter(x => x.category !== name), ...(on ? [startChallenge(name, cycle.today)] : [])] });
    if (on) setToast({ text: `7-day no-spend challenge started for ${name} — you've got this!` });
  };

  /** Consecutive past cycles kept within limit per variable category (shown as warm flame badges). */
  const catStreaks = useMemo(() => {
    const limits: Record<string, number> = {};
    for (const c of budget.cats) if (c.type === 'variable' && c.limit > 0) limits[c.name] = c.limit;
    return streaks(allTxs, cycle, limits);
  }, [allTxs, cycle, budget.cats]);

  /** Move part of one variable category's limit to another; the total stays the same. */
  const move = (from: string, to: string, amount: number) => {
    const f = budget.cats.find(c => c.name === from)!;
    const t = budget.cats.find(c => c.name === to)!;
    const pct = amount / ofIncome(1);
    setLimits({ [to]: t.limitPct + pct, [from]: Math.max(0, f.limitPct - pct) });
    setToast({ text: `Moved ${short(amount)} from ${from} to ${to} — total plan stays the same.`, undo: () => setLimits({ [to]: t.limitPct, [from]: f.limitPct }) });
  };
  /** Nudge a variable category's monthly limit up or down by a fixed currency step, with Undo. */
  const nudgeLimit = (name: string, delta: number) => {
    const c = budget.cats.find(x => x.name === name);
    const onePct = ofIncome(1);
    if (!c || !(onePct > 0)) return;
    const beforePct = c.limitPct;
    const nextPct = Math.max(0, beforePct + delta / onePct);
    const nextAmt = Math.max(0, c.limit + delta);
    setLimits({ [name]: nextPct });
    setToast({
      text: `${name} limit updated to ${full(nextAmt)}`,
      undo: () => setLimits({ [name]: beforePct }),
    });
  };
  const donorsFor = (name: string) =>
    variable
      .filter(x => x.c.name !== name && x.lim - x.cur > 0)
      .map(x => ({ name: x.c.name, room: x.lim - x.cur }))
      .sort((a, b) => b.room - a.room);
  const shareTargetsFor = (name: string) =>
    variable
      .filter(x => x.c.name !== name && x.c.name !== UNSORTED)
      .map(x => ({ name: x.c.name, room: Math.max(0, x.lim - x.cur), over: Math.max(0, x.cur - x.lim) }))
      .sort((a, b) => b.over - a.over || a.room - b.room);

  const watchCount = variable.filter(r => r.st.key !== 'ok').length;
  const filteredUsed =
    filter === 'watch'
      ? variable.filter(r => r.st.key !== 'ok')
      : filter === 'smooth'
        ? variable.filter(r => r.st.key === 'ok' && r.cur > 0)
        : filter === 'challenges'
          ? variable.filter(r => !!challengeOf(r.c.name))
          : usedAll;

  // Fixed bills you ticked off by hand this cycle.
  const cycleKey = toISO(cycle.start);
  const marked = new Set((settings.paidBills ?? []).filter(k => k.startsWith(cycleKey + '|')).map(k => k.slice(cycleKey.length + 1)));
  const toggleMarked = (name: string) => {
    const key = cycleKey + '|' + name;
    const kept = (settings.paidBills ?? []).filter(k => k.startsWith(cycleKey + '|') && k !== key);
    update({ paidBills: marked.has(name) ? kept : [...kept, key] });
  };
  const isPaid = (r: Row) => r.cur > 0 || marked.has(r.c.name);

  const toggle = (name: string) => setOpen(open === name ? null : name);

  /** An everyday category as a card (Maxie's budget detail design). */
  const card = (r: Row) => (
    <BudgetCard
      key={r.c.name}
      r={r}
      cycle={cycle}
      open={open === r.c.name}
      onToggle={() => toggle(r.c.name)}
      streak={mode === 'cycle' ? catStreaks[r.c.name] ?? 0 : 0}
      todayFrac={todayFrac}
      donors={mode === 'cycle' && r.c.type === 'variable' ? donorsFor(r.c.name) : []}
      shareTargets={mode === 'cycle' && r.c.type === 'variable' ? shareTargetsFor(r.c.name) : []}
      onMove={(from, amount) => move(from, r.c.name, amount)}
      onShareRoom={mode === 'cycle' && r.c.type === 'variable' ? (to, amount) => move(r.c.name, to, amount) : undefined}
      onNudgeLimit={mode === 'cycle' && r.c.type === 'variable' ? delta => nudgeLimit(r.c.name, delta) : undefined}
      onShowTransactions={onShowTransactions}
      onEditCategory={onEditCategory}
      extra={
        r.c.name === UNSORTED && r.mine.length > 0 ? (
          <button type="button" className={s.btnOutlineSm} style={{ alignSelf: 'flex-start' }} onClick={() => onShowTransactions(r.c.name)}>
            Sort {r.mine.length} {r.mine.length === 1 ? 'transaction' : 'transactions'}
          </button>
        ) : mode === 'cycle' && r.c.type === 'variable' ? (
          <div style={{ alignSelf: 'flex-start' }}>
            <ChallengeBox name={r.c.name} state={challengeOf(r.c.name)} onStart={() => setChallenge(r.c.name, true)} onClear={() => setChallenge(r.c.name, false)} />
          </div>
        ) : undefined
      }
    />
  );
  const inst = useInstallmentTotals(cycle);
  const [instOpen, setInstOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);

  return (
    <div className={s.splitGrid}>
      <div className={s.splitMain} style={{ gap: 16 }}>
        {(() => {
          const rows = mode === 'cycle' ? [...variable, ...fixed] : variable;
          const spent = sum(rows.map(r => r.cur));
          const limit = sum(rows.map(r => r.lim));
          const frac = mode === 'cycle' && budget.budget > 0 ? budget.paceToday / budget.budget : todayFrac;
          const days = cycle.daysLeft + 1;
          const topWatch = variable.find(r => r.st.key !== 'ok');
          const footnote =
            mode === 'week'
              ? spent > limit
                ? `${short(spent - limit)} over this week's share — easy to ease back next week.`
                : `${short(limit - spent)} left for the rest of this week.`
              : spent > limit
                ? `${short(spent - limit)} over plan — let's trim or rebalance together.`
                : `${short(budget.safeDay)} a day keeps you smoothly on track for the next ${days} ${days === 1 ? 'day' : 'days'}.`;
          return (
            <Summary
              spent={spent}
              limit={limit}
              todayFrac={frac}
              period={mode === 'cycle' ? 'this cycle' : `in week ${wi + 1}`}
              footnote={footnote}
              onAskMaxie={
                onAskMaxie
                  ? () =>
                      onAskMaxie(
                        topWatch
                          ? `How should I rebalance ${topWatch.c.name} and my other categories this cycle?`
                          : 'How are my spending categories looking this cycle?',
                      )
                  : undefined
              }
              switcher={
                <div className={s.segment} role="group" aria-label="Compare">
                  {(['cycle', 'week'] as const).map(m => (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={mode === m}
                      onClick={() => {
                        setMode(m);
                        setOpen(null);
                      }}
                    >
                      {m === 'cycle' ? 'Cycle' : 'Week'}
                    </button>
                  ))}
                </div>
              }
            />
          );
        })()}

        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SectionHead
            title={mode === 'cycle' ? 'Everyday spending' : `Everyday, week ${wi + 1}`}
            right={
              varLimit > 0 ? (
                <span style={{ color: varSpent > varLimit ? C.redInk : C.textMuted }}>
                  {varSpent > varLimit ? `${fit(varSpent - varLimit)} over` : `${fit(varLimit - varSpent)} left`}
                </span>
              ) : undefined
            }
          />
          {variable.length > 0 && (
            <div className={s.catToolbar}>
              <div className={s.catFilterPills} role="tablist" aria-label="Filter categories">
                {(
                  [
                    { key: 'all', label: 'All' },
                    { key: 'watch', label: 'Watch', count: watchCount },
                    { key: 'smooth', label: 'Smooth' },
                    ...(activeChallenges.length > 0 ? [{ key: 'challenges' as const, label: 'Challenges', count: activeChallenges.length }] : []),
                  ] as { key: CatFilter; label: string; count?: number }[]
                ).map(item => (
                  <button
                    key={item.key}
                    type="button"
                    role="tab"
                    aria-selected={filter === item.key}
                    className={s.catFilterPill}
                    onClick={() => setFilter(item.key)}
                  >
                    {item.label}
                    {item.count != null && item.count > 0 && <span className={s.catFilterCount}>{item.count}</span>}
                  </button>
                ))}
              </div>
              <select className={s.catSortSelect} value={sort} onChange={e => setSort(e.target.value as CatSort)} aria-label="Sort categories">
                <option value="attention">Sort: Attention</option>
                <option value="spent">Sort: Most spent</option>
                <option value="room">Sort: Most room</option>
              </select>
            </div>
          )}
          <div className={s.mxCards}>
            {filteredUsed.length === 0 && (
              <div className={s.mxCard} style={{ padding: '16px 20px' }}>
                <div className={s.mxEmptyInline} style={{ padding: 0 }}>
                  <Logo size={28} mood="happy" interactive cheer="Looking good!" />
                  <span>
                    {filter === 'watch'
                      ? 'Nothing on the watch list — every category is comfortably within its limit!'
                      : filter === 'smooth'
                        ? 'No spending logged yet to track here — clean slate.'
                        : filter === 'challenges'
                          ? 'No active challenges yet — open any category to start a 7-day no-spend week.'
                          : `Nothing spent yet ${mode === 'cycle' ? 'this cycle' : 'this week'} — clean slate!`}
                  </span>
                </div>
              </div>
            )}
            {filteredUsed.map(card)}
            {filter === 'all' && showUnused && unused.map(card)}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {filter === 'all' && unused.length > 0 && (
              <button type="button" className={s.catFold} style={{ border: 'none' }} aria-expanded={showUnused} onClick={() => setShowUnused(!showUnused)}>
                <Icon d={IC.chevDown} size={14} style={{ transform: showUnused ? 'rotate(180deg)' : 'none' }} />
                {showUnused ? 'Hide unused' : `Not used yet (${unused.length}): ${unused.map(r => r.c.name).join(', ')}`}
              </button>
            )}
            <button type="button" className={s.catFold} onClick={onNewCategory} style={{ color: C.clayInk, fontWeight: 600, border: 'none' }}>
              <Icon d={IC.plus} size={14} />
              New category
            </button>
          </div>
        </section>

        {mode === 'cycle' && <FoundInstallments />}
        {mode === 'cycle' && (() => {
          const activeIndividual = fixedBillStatuses.filter(x => x.status !== 'inactive' && x.status !== 'skipped');
          const paidIndividual = activeIndividual.filter(x => x.status === 'paid');
          const overdueCount = activeIndividual.filter(x => x.status === 'overdue').length;
          const indivPaidAmt = sum(paidIndividual.map(x => x.actual));
          const indivTotalAmt = sum(activeIndividual.map(x => (x.status === 'paid' ? Math.max(x.actual, x.expected) : x.expected)));
          const totalItems = activeIndividual.length + fixed.length;
          const allBillsPaid = totalItems > 0 && paidIndividual.length === activeIndividual.length && fixed.every(isPaid) && inst.paid >= inst.planned;
          const hasAny = fixedBillStatuses.length > 0 || fixed.length > 0 || inst.planned > 0;
          const totalPaidAmt = indivPaidAmt + sum(fixed.filter(isPaid).map(r => r.cur || r.lim)) + inst.paid;
          const totalPlannedAmt = indivTotalAmt + sum(fixed.map(r => Math.max(r.lim, r.cur))) + inst.planned;

          return (
            <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <SectionHead
                title="Fixed bills"
                right={
                  hasAny ? (
                    allBillsPaid ? (
                      <span style={{ color: C.good, fontWeight: 600 }}>All paid</span>
                    ) : (
                      <span>
                        {overdueCount > 0 && (
                          <span style={{ color: C.redInk, fontWeight: 600, marginRight: 8 }}>
                            {overdueCount} overdue
                          </span>
                        )}
                        {activeIndividual.length > 0
                          ? `${paidIndividual.length} of ${activeIndividual.length} paid · ${short(totalPaidAmt)} / ${short(totalPlannedAmt)}`
                          : `${short(totalPaidAmt)} of ${short(totalPlannedAmt)} paid`}
                      </span>
                    )
                  ) : undefined
                }
              />
              <Celebrate id={'bills-' + cycleKey} when={allBillsPaid} />
              {activeChallenges.map(({ ch, st }) => (
                <Celebrate key={ch.category + ch.start} id={`challenge-${ch.category}-${ch.start}`} when={st.key === 'done'} />
              ))}
              {allBillsPaid && (
                <div className={s.mxGreeting}>
                  <Logo size={32} mood="happy" interactive cheer="All bills handled!" />
                  <p className={s.mxGreetingText}>Every fixed bill is taken care of this cycle — everything left is yours to spend or save!</p>
                </div>
              )}
              <div className={s.mxBills}>
                {!hasAny && (
                  <div style={{ padding: '16px 20px', fontSize: 14, color: C.textMuted, lineHeight: 1.5 }}>
                    No fixed bills yet. Add what you pay every month (rent, electricity, internet, insurance) so Maxie checks when each receipt lands.
                  </div>
                )}
                <FixedBillsList
                  cycle={cycle}
                  budget={budget}
                  allRaw={allRaw}
                  statuses={fixedBillStatuses}
                  catOf={catOf}
                  onShowTransactions={onShowTransactions}
                  onToast={setToast}
                />
                {billOrder(fixed, budget, isPaid).map(r => (
                  <BillItem
                    key={r.c.name}
                    r={r}
                    cycle={cycle}
                    due={budget.bills.filter(x => x.category === r.c.name).sort((x, y) => x.date.getTime() - y.date.getTime())}
                    open={open === r.c.name}
                    onToggle={() => toggle(r.c.name)}
                    marked={marked.has(r.c.name)}
                    onMark={() => toggleMarked(r.c.name)}
                    onAmount={amount => setAmount(r.c.name, amount, r.lim)}
                    editor={<AmountEditor key={r.lim} label="Each month" initial={r.lim} onSave={amount => setAmount(r.c.name, amount, r.lim)} onRemove={() => setAmount(r.c.name, 0, r.lim)} />}
                    onShowTransactions={onShowTransactions}
                  />
                ))}
                <InstallmentsGroup cycle={cycle} open={instOpen} onToggle={() => setInstOpen(!instOpen)} />
              </div>
            </section>
          );
        })()}
        {mode === 'week' && <span style={{ fontSize: 13, color: C.textMuted, padding: '0 4px' }}>Fixed bills are monthly, so they're only in the cycle view.</span>}
      </div>

      {phone ? (
        <section className={s.splitSide}>
          <button type="button" className={s.rowBtn} aria-expanded={insightsOpen} onClick={() => setInsightsOpen(v => !v)} style={{ padding: '14px 16px', minHeight: 48 }}>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, marginRight: 'auto', textAlign: 'left' }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>Highlights &amp; changes</span>
              <span style={{ fontSize: 13, color: C.textMuted }}>Watch list, biggest win, and changes vs last {mode === 'cycle' ? 'cycle' : 'week'}</span>
            </span>
            <Icon d={IC.chevDown} size={16} color={C.textMuted} style={{ transform: insightsOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.16s ease' }} />
          </button>
          {insightsOpen && (
            <div className="fade-in" style={{ borderTop: `1px solid ${C.divider}` }}>
              <CategoriesPanel
                bare
                cycle={cycle}
                mode={mode}
                rows={[...variable, ...fixed]}
                challenges={activeChallenges}
                onPick={name => {
                  setFilter('all');
                  setOpen(name);
                  requestAnimationFrame(() => document.getElementById('cat-' + name)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
                }}
              />
            </div>
          )}
        </section>
      ) : (
        <CategoriesPanel
          cycle={cycle}
          mode={mode}
          rows={[...variable, ...fixed]}
          challenges={activeChallenges}
          onPick={name => {
            setFilter('all');
            setOpen(name);
            requestAnimationFrame(() => document.getElementById('cat-' + name)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
          }}
        />
      )}
      {toast && (
        <Toast
          text={toast.text}
          action={toast.undo ? 'Undo' : undefined}
          onAction={
            toast.undo
              ? () => {
                  toast.undo?.();
                  setToast(null);
                }
              : undefined
          }
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}

/** Fixed bills sorted for a checklist: due soonest first, then not seen yet, then paid. */
function billOrder(rows: Row[], b: Budget, isPaid: (r: Row) => boolean) {
  const due = (r: Row) => b.bills.filter(x => x.category === r.c.name).sort((x, y) => x.date.getTime() - y.date.getTime())[0];
  const key = (r: Row) => (isPaid(r) ? 2 : due(r) ? 0 : 1);
  return [...rows].sort((x, y) => key(x) - key(y) || (due(x)?.date.getTime() ?? 0) - (due(y)?.date.getTime() ?? 0) || x.c.name.localeCompare(y.c.name));
}

/** A monthly amount typed in rupiah (or dollars), saved as the bill's plan. */
export function AmountEditor({ label, initial, onSave, onCancel, onRemove }: { label: string; initial: number; onSave: (v: number) => void; onCancel?: () => void; onRemove?: () => void }) {
  const { settings } = useSettings();
  const idr = settings.currency === 'IDR';
  const show = (v: number) => (v > 0 ? (idr ? Math.round(v).toLocaleString('id-ID') : String(Math.round(v * 100) / 100)) : '');
  const [text, setText] = useState(show(initial));
  const value = idr ? Number(text.replace(/\D/g, '')) : Number(text.replace(/[^\d.]/g, ''));
  const changed = value > 0 && Math.abs(value - initial) >= (idr ? 1 : 0.01);
  return (
    <form
      className={s.amountEdit}
      onSubmit={e => {
        e.preventDefault();
        if (changed) onSave(value);
      }}
    >
      <label className={s.field} style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontWeight: 500 }}>{label}</span>
        <input
          className={s.input}
          inputMode="decimal"
          autoFocus
          value={text}
          placeholder={idr ? 'e.g. 4.200.000' : 'e.g. 1200'}
          onChange={e => setText(idr ? (Number(e.target.value.replace(/\D/g, '')) || '').toLocaleString('id-ID') : e.target.value)}
          aria-label={label}
        />
      </label>
      <button type="submit" className={s.btnPrimary} disabled={!changed}>
        Save
      </button>
      {onCancel && (
        <button type="button" className={s.btnGhost} onClick={onCancel}>
          Cancel
        </button>
      )}
      {onRemove && initial > 0 && (
        <button type="button" className={s.btnGhost} onClick={onRemove} style={{ color: C.redInk }}>
          Remove
        </button>
      )}
    </form>
  );
}

/** Side panel (wide screens) or collapsible section (phones): Watch list, active no-spend challenges, Biggest win, and Biggest changes. */
function CategoriesPanel({
  bare,
  cycle,
  mode,
  rows,
  challenges,
  onPick,
}: {
  bare?: boolean;
  cycle: Cycle;
  mode: Mode;
  rows: Row[];
  challenges: { ch: { category: string; start: string }; st: { key: 'running' | 'done' | 'missed'; day: number; text: string } }[];
  onPick: (name: string) => void;
}) {
  const { short } = useSettings();
  const watch = rows.filter(r => r.st.key !== 'ok').sort((x, y) => x.st.rank - y.st.rank || y.used - x.used);
  const biggestWin = rows
    .filter(r => r.c.type === 'variable' && r.last > 0 && r.cur < r.last)
    .sort((x, y) => y.last - y.cur - (x.last - x.cur))[0];
  const changes = rows
    .filter(r => r.c.type === 'variable' && r.last > 0 && Math.abs(r.cur - r.last) > 0)
    .sort((x, y) => Math.abs(y.cur - y.last) - Math.abs(x.cur - x.last))
    .slice(0, 3);
  return (
    <aside className={bare ? undefined : s.splitSide} aria-label="Categories at a glance">
      <section className={s.sideCard}>
        <h3 className={s.sideTitle}>Watch list</h3>
        {watch.length === 0 ? (
          <div className={s.catSideEmpty}>
            <Logo size={30} mood="happy" interactive cheer="Every budget looks great!" />
            <span>Every single category is inside its limit — smooth sailing!</span>
          </div>
        ) : (
          <div className={s.sideList} style={{ gap: 6 }}>
            {watch.map(r => (
              <button key={r.c.name} type="button" className={s.recapRow} onClick={() => onPick(r.c.name)}>
                <span style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 14 }}>
                  <Badge ink={r.st.ink}>{r.c.name}</Badge>
                  <span style={{ whiteSpace: 'nowrap', color: r.st.key === 'over' ? C.redInk : C.amberInk }}>
                    {r.lim - r.cur >= 0 ? `${short(r.lim - r.cur)} left` : `${short(r.cur - r.lim)} over`}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {challenges.length > 0 && (
        <section className={s.sideCard}>
          <h3 className={s.sideTitle}>Active challenges</h3>
          <div className={s.sideList} style={{ gap: 8 }}>
            {challenges.map(({ ch, st }) => (
              <button key={ch.category} type="button" className={s.catChalRow} onClick={() => onPick(ch.category)}>
                <span className={s.catChalHead}>
                  {st.key === 'done' ? <TrophyIcon size={15} /> : <TargetIcon size={15} />}
                  <span style={{ marginRight: 'auto' }}>{ch.category}</span>
                  <span style={{ fontSize: 12, fontWeight: 500, color: st.key === 'done' ? C.good : C.textMuted }}>
                    {st.key === 'done' ? 'Completed!' : `Day ${st.day}/7`}
                  </span>
                </span>
                <span className={s.catChalDots} aria-hidden="true">
                  {Array.from({ length: 7 }, (_, i) => (
                    <span key={i} className={s.catChalDot} data-done={st.key === 'done' || i < st.day ? true : undefined} />
                  ))}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {biggestWin && (
        <section className={s.sideCard} style={{ paddingTop: bare ? 12 : undefined }}>
          <button type="button" className={s.catSideWin} onClick={() => onPick(biggestWin.c.name)}>
            <span className={s.catSideWinLabel}>Biggest win</span>
            <span style={{ fontSize: 14, fontWeight: 600 }}>
              {biggestWin.c.name} is {short(biggestWin.last - biggestWin.cur)} lower
            </span>
            <span style={{ fontSize: 12.5, color: C.textMuted }}>
              vs {mode === 'cycle' ? `last cycle by day ${cycle.dayN}` : 'last week'}
            </span>
          </button>
        </section>
      )}

      {/* Only once there's a last time to compare with. */}
      {changes.length > 0 && (
        <section className={s.sideCard}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <h3 className={s.sideTitle}>Biggest changes</h3>
            <span style={{ fontSize: 13, color: C.textMuted }}>vs {mode === 'cycle' ? `last cycle by day ${cycle.dayN}` : 'last week'}</span>
          </div>
          <div className={s.sideList} style={{ gap: 6 }}>
            {changes.map(r => (
              <button key={r.c.name} type="button" className={s.recapRow} onClick={() => onPick(r.c.name)}>
                <span style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 14 }}>
                  <span>{r.c.name}</span>
                  <span style={{ whiteSpace: 'nowrap', color: changeBadge(r.cur, r.last).ink }}>
                    {r.cur >= r.last ? '+' : '−'}
                    {short(Math.abs(r.cur - r.last))} ({changeBadge(r.cur, r.last).label})
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </aside>
  );
}
