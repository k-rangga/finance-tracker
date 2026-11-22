import { useEffect, useMemo, useState, type ReactNode } from 'react';
import s from '../styles/ui.module.css';
import { Badge, IconChip } from '../components/ui';
import { Celebrate } from '../components/Delight';
import { IC, Icon } from '../components/Icon';
import { categoryStatus, changeBadge, iconChip, type Budget, type CatView, type TxView } from '../lib/budget';
import type { Cycle } from '../lib/cycle';
import { dayMonth, pc, sum, tidyName, toISO } from '../lib/format';
import { useSettings } from '../lib/settings';
import { useIsPhone } from '../lib/media';
import { C } from '../lib/tokens';
import { catFilter } from '../data/categories';
import { useSetLimits } from '../lib/limits';
import {
  ChallengeBox,
  ChallengeChip,
  challengeState,
  MoveBudget,
  SectionHead,
  startChallenge,
  StreakChip,
  streaks,
  Summary,
  TopMerchants,
  useSwipeRight,
  WeekBars,
} from './categoriesExtras';

type Mode = 'cycle' | 'week';

type Props = {
  cycle: Cycle;
  budget: Budget;
  /** Every transaction, for streaks across cycles and no-spend challenges. */
  allTxs: TxView[];
  open: string | null;
  setOpen: (n: string | null) => void;
  onShowTransactions: (cat: string) => void;
  /** Open the edit dialog for a category (built-in: limit and colour only). */
  onEditCategory: (name: string) => void;
  onNewCategory: () => void;
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


export function Categories({ cycle, budget, allTxs, open, setOpen, onShowTransactions, onEditCategory, onNewCategory }: Props) {
  const { settings, update, full, short, ofIncome } = useSettings();
  const phone = useIsPhone();
  const fit = phone ? short : full;
  const setLimits = useSetLimits();
  const [mode, setMode] = useState<Mode>('cycle');
  const [showUnused, setShowUnused] = useState(false);
  /** The last limit change, with a way to take it back, for a few seconds. */
  const [toast, setToast] = useState<{ text: string; undo: () => void } | null>(null);
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
  // Most attention first: over the limit, then near it, then by share of the limit used.
  const rank = (a: Row, b: Row) => a.st.rank - b.st.rank || b.used - a.used;
  const variable = budget.cats.filter(c => c.type === 'variable').map(view).sort(rank);
  const used = variable.filter(r => r.cur > 0 || r.st.key !== 'ok');
  const unused = variable.filter(r => !used.includes(r));
  const fixedAll = mode === 'cycle' ? budget.cats.filter(c => c.type === 'fixed').map(view) : [];
  /** A fixed bill shows once it has an amount, a payment or a bill coming; the rest wait under "Add a fixed bill". */
  const isSet = (r: Row) => r.lim > 0 || r.cur > 0 || budget.bills.some(b => b.category === r.c.name);
  const fixed = fixedAll.filter(isSet);
  // Installments plan themselves from your plans, so they're never added by hand.
  const addable = fixedAll.filter(r => !isSet(r) && !r.c.auto);
  const [adding, setAdding] = useState<string | null>(null);
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
  const streakOf = useMemo(
    () => streaks(allTxs, cycle, Object.fromEntries(budget.cats.filter(c => c.type === 'variable').map(c => [c.name, c.limit]))),
    [allTxs, cycle, budget.cats],
  );
  const challenges = settings.challenges ?? [];
  const challengeOf = (name: string) => {
    const ch = challenges.find(x => x.category === name);
    return ch ? challengeState(ch, allTxs, cycle.today) : null;
  };
  const setChallenge = (name: string, on: boolean) =>
    update({ challenges: [...challenges.filter(x => x.category !== name), ...(on ? [startChallenge(name, cycle.today)] : [])] });
  /** Move part of one variable category's limit to another; the total stays the same. */
  const move = (from: string, to: string, amount: number) => {
    const f = budget.cats.find(c => c.name === from)!;
    const t = budget.cats.find(c => c.name === to)!;
    // ofIncome(1) is 1% of income, so this is the amount as a % of income.
    const pct = amount / ofIncome(1);
    setLimits({ [to]: t.limitPct + pct, [from]: Math.max(0, f.limitPct - pct) });
    setToast({ text: `${short(amount)} moved from ${from} to ${to}`, undo: () => setLimits({ [to]: t.limitPct, [from]: f.limitPct }) });
  };
  const donorsFor = (name: string) =>
    variable
      .filter(x => x.c.name !== name && x.lim - x.cur > 0)
      .map(x => ({ name: x.c.name, room: x.lim - x.cur }))
      .sort((a, b) => b.room - a.room);

  // Fixed bills you ticked off by hand this cycle.
  const cycleKey = toISO(cycle.start);
  const marked = new Set((settings.paidBills ?? []).filter(k => k.startsWith(cycleKey + '|')).map(k => k.slice(cycleKey.length + 1)));
  const toggleMarked = (name: string) => {
    const key = cycleKey + '|' + name;
    // Only this cycle's ticks are kept.
    const kept = (settings.paidBills ?? []).filter(k => k.startsWith(cycleKey + '|') && k !== key);
    update({ paidBills: marked.has(name) ? kept : [...kept, key] });
  };
  const isPaid = (r: Row) => r.cur > 0 || marked.has(r.c.name);

  const toggle = (name: string) => setOpen(open === name ? null : name);
  const row = (r: Row) => (
    <CategoryRow
      key={r.c.name}
      r={r}
      mode={mode}
      cycle={cycle}
      open={open === r.c.name}
      onToggle={() => toggle(r.c.name)}
      todayFrac={todayFrac}
      streak={streakOf[r.c.name]}
      challenge={mode === 'cycle' ? challengeOf(r.c.name) : null}
      onChallenge={on => setChallenge(r.c.name, on)}
      donors={mode === 'cycle' && r.c.type === 'variable' ? donorsFor(r.c.name) : []}
      onMove={(from, amount) => move(from, r.c.name, amount)}
      onShowTransactions={onShowTransactions}
      onEditCategory={onEditCategory}
    />
  );

  return (
    <div className={s.splitGrid}>
      <div className={s.splitMain} style={{ gap: 16 }}>
        {(() => {
          const rows = mode === 'cycle' ? [...variable, ...fixed] : variable;
          const spent = sum(rows.map(r => r.cur));
          const limit = sum(rows.map(r => r.lim));
          const frac = mode === 'cycle' && budget.budget > 0 ? budget.paceToday / budget.budget : todayFrac;
          const days = cycle.daysLeft + 1;
          const footnote =
            mode === 'week'
              ? spent > limit
                ? `${short(spent - limit)} over this week's share`
                : `${short(limit - spent)} left for the rest of this week`
              : spent > limit
                ? `${short(spent - limit)} over the plan this cycle`
                : `${short(budget.safeDay)} a day is safe for the next ${days} ${days === 1 ? 'day' : 'days'}`;
          return (
            <Summary
              spent={spent}
              limit={limit}
              todayFrac={frac}
              period={mode === 'cycle' ? 'this cycle' : `in week ${wi + 1}`}
              footnote={footnote}
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

        <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
          <div className={s.cardFlush} style={{ padding: '4px 0' }}>
            {used.length === 0 && <div style={{ padding: '16px 20px', fontSize: 14, color: C.textMuted }}>Nothing spent yet {mode === 'cycle' ? 'this cycle' : 'this week'}.</div>}
            {used.map(row)}
            {unused.length > 0 && (
              <>
                <button type="button" className={s.catFold} aria-expanded={showUnused} onClick={() => setShowUnused(!showUnused)}>
                  <Icon d={IC.chevDown} size={14} style={{ transform: showUnused ? 'rotate(180deg)' : 'none' }} />
                  Not used yet ({unused.length}), {unused.map(r => r.c.name).join(', ')}
                </button>
                {showUnused && unused.map(row)}
              </>
            )}
            <button type="button" className={s.catFold} onClick={onNewCategory} style={{ color: C.accent800, fontWeight: 600 }}>
              <Icon d={IC.plus} size={14} />
              New category
            </button>
          </div>
        </section>

        {mode === 'cycle' && (
          <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <SectionHead
              title="Fixed bills"
              right={
                fixed.length > 0 ? (
                  fixed.every(isPaid) ? (
                    <span style={{ color: C.accent800, fontWeight: 600 }}>All paid ✓</span>
                  ) : (
                    `${short(sum(fixed.filter(isPaid).map(r => r.cur || r.lim)))} of ${short(sum(fixed.map(r => Math.max(r.lim, r.cur))))} paid`
                  )
                ) : undefined
              }
            />
            <Celebrate id={'bills-' + cycleKey} when={fixed.length > 0 && fixed.every(isPaid)} />
            <div className={s.cardFlush} style={{ padding: '4px 0' }}>
              {fixed.length === 0 && (
                <div style={{ padding: '16px 20px', fontSize: 14, color: C.textMuted, lineHeight: 1.5 }}>
                  No fixed bills yet. Add what you pay every month (rent, electricity, insurance) so your plan sets it aside.
                </div>
              )}
              {billOrder(fixed, budget, isPaid).map(r => (
                <BillRow
                  key={r.c.name}
                  r={r}
                  budget={budget}
                  cycle={cycle}
                  open={open === r.c.name}
                  onToggle={() => toggle(r.c.name)}
                  onShowTransactions={onShowTransactions}
                  onEditCategory={onEditCategory}
                  onAmount={amount => setAmount(r.c.name, amount, r.lim)}
                  marked={marked.has(r.c.name)}
                  onMark={() => toggleMarked(r.c.name)}
                />
              ))}
              <button
                type="button"
                className={s.catFold}
                aria-expanded={adding != null}
                onClick={() => setAdding(adding == null ? '' : null)}
                style={{ color: C.accent800, fontWeight: 600 }}
              >
                <Icon d={IC.plus} size={14} />
                Add a fixed bill
              </button>
              {adding != null && (
                <div className={s.billAdd}>
                  <div className={s.tplGrid}>
                    {addable.map(r => (
                      <button key={r.c.name} type="button" className={s.tplOpt} aria-pressed={adding === r.c.name} onClick={() => setAdding(r.c.name)}>
                        <Icon d={r.c.icon} size={14} />
                        {r.c.name}
                      </button>
                    ))}
                    <button type="button" className={s.tplOpt} onClick={onNewCategory}>
                      <Icon d={IC.plus} size={14} />
                      Other…
                    </button>
                  </div>
                  {adding && (
                    <AmountEditor
                      key={adding}
                      label={`${adding} each month`}
                      initial={0}
                      onSave={amount => {
                        setAmount(adding, amount, 0);
                        setAdding(null);
                      }}
                      onCancel={() => setAdding('')}
                    />
                  )}
                  {!adding && <span style={{ fontSize: 13, color: C.textMuted }}>Pick one, or Other… to name your own (choose Fixed bill as its type).</span>}
                </div>
              )}
            </div>
          </section>
        )}
        {mode === 'week' && <span style={{ fontSize: 13, color: C.textMuted, padding: '0 4px' }}>Fixed bills are monthly, so they're only in the cycle view.</span>}
      </div>

      {/* Phones: Summary already has the totals, and the rows above say what's over. */}
      {!phone && <CategoriesPanel cycle={cycle} mode={mode} rows={[...variable, ...fixed]} onPick={name => setOpen(name)} />}
      {toast && (
        <div className={s.toast} role="status">
          <span style={{ marginRight: 'auto', minWidth: 0 }}>{toast.text}</span>
          <button
            type="button"
            className={s.toastBtn}
            onClick={() => {
              toast.undo();
              setToast(null);
            }}
          >
            Undo
          </button>
        </div>
      )}
    </div>
  );
}

/** "↑ 12%" against last time, only when there is a last time. */
function ChangeChip({ cur, last }: { cur: number; last: number }) {
  if (last <= 0 || cur === last) return null;
  const ch = changeBadge(cur, last);
  return <span style={{ fontSize: 12, fontWeight: 600, color: ch.ink, whiteSpace: 'nowrap' }}>{ch.label}</span>;
}

/** One line per category: name, how much of its limit, and a bar with where you should be by today. */
function CategoryRow({
  r,
  mode,
  cycle,
  open,
  onToggle,
  todayFrac,
  streak,
  challenge,
  onChallenge,
  donors,
  onMove,
  onShowTransactions,
  onEditCategory,
}: {
  r: Row;
  mode: Mode;
  cycle: Cycle;
  open: boolean;
  onToggle: () => void;
  todayFrac: number;
  streak?: number;
  challenge: ReturnType<typeof challengeState> | null;
  onChallenge: (on: boolean) => void;
  donors: { name: string; room: number }[];
  onMove: (from: string, amount: number) => void;
  onShowTransactions: (cat: string) => void;
  onEditCategory: (name: string) => void;
}) {
  const { full, short } = useSettings();
  const phone = useIsPhone();
  // Short amounts in the list ("1,8 jt / 2,1 jt" on phones, so the name keeps its room); exact ones when opened.
  const fit = (v: number) => (phone ? short(v).replace(/^Rp\s?/, '') : short(v));
  const { c, cur, last, lim, scale, mine } = r;
  const toSort = c.name === UNSORTED ? mine.length : 0;
  const expected = lim * todayFrac;
  // One quiet colour while on pace; amber when running ahead of today's mark, red past the limit.
  const bar = lim > 0 && cur > lim ? C.red : expected > 0 && cur > expected * 1.1 ? C.amber : C.accent500;
  return (
    <div id={'cat-' + c.name}>
      <button type="button" className={s.catRow} aria-expanded={open} onClick={onToggle}>
        <span className={s.catIcon}>
          <IconChip d={c.icon} bg={iconChip(c.name).bg} ink={iconChip(c.name).ink} size={32} iconSize={15} />
        </span>
        <span className={s.catName}>
          <span className={s.ellipsis} style={{ fontSize: 14, fontWeight: 500 }}>
            {c.name}
          </span>
          {/* Phones: the change against last time is in the opened row, so the name keeps its room. */}
          {!phone && <ChangeChip cur={cur} last={last} />}
          {cur <= lim && <StreakChip n={streak} />}
          {challenge && <ChallengeChip text={challenge.text} kind={challenge.key} />}
        </span>
        <span className={s.catBar} title={last > 0 ? `Last ${mode === 'cycle' ? 'cycle by now' : 'week'}: ${full(last)}` : undefined}>
          <span className={s.track} style={{ display: 'block', height: 6 }}>
            <span className={s.fill} style={{ width: pc((cur / scale) * 100), background: bar }} />
            {/* The limit only needs marking once you're past it. */}
            {cur > lim && <span className={s.tick} style={{ left: pc((lim / scale) * 100) }} />}
            {lim > 0 && todayFrac > 0 && todayFrac < 1 && cur <= lim && <span className={s.todayMark} style={{ left: pc((expected / scale) * 100) }} />}
          </span>
        </span>
        <span className={s.catAmount}>
          <span style={{ fontWeight: 600, color: C.text }}>{fit(cur)}</span> / {fit(lim)}
        </span>
        <Icon d={IC.chevDown} size={16} color={C.textMuted} style={{ gridArea: 'chev', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {toSort > 0 && !open && (
        <button type="button" className={s.catSortLink} onClick={() => onShowTransactions(c.name)}>
          {toSort} {toSort === 1 ? 'transaction' : 'transactions'} to sort <Icon d={IC.arrowRight} size={13} />
        </button>
      )}
      {open && (
        <CategoryDetail r={r} mode={mode} cycle={cycle} toSort={toSort} onShowTransactions={onShowTransactions} onEditCategory={onEditCategory}>
          {donors.length > 0 && <MoveBudget name={c.name} need={Math.max(0, cur - lim)} donors={donors} onMove={onMove} />}
          {mode === 'cycle' && c.type === 'variable' && <ChallengeBox name={c.name} state={challenge} onStart={() => onChallenge(true)} onClear={() => onChallenge(false)} />}
        </CategoryDetail>
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

/** A fixed bill: paid (✓, from a payment or ticked by hand), due on a date (from last cycle's charge), or not paid yet. */
function BillRow({
  r,
  budget: b,
  cycle,
  open,
  onToggle,
  onShowTransactions,
  onEditCategory,
  onAmount,
  marked,
  onMark,
}: {
  r: Row;
  budget: Budget;
  cycle: Cycle;
  open: boolean;
  onToggle: () => void;
  onShowTransactions: (cat: string) => void;
  onEditCategory: (name: string) => void;
  /** Set the monthly amount (0 removes it from fixed bills). */
  onAmount: (amount: number) => void;
  /** Ticked off by hand this cycle. */
  marked: boolean;
  onMark: () => void;
}) {
  const { short } = useSettings();
  const { c, cur, lim } = r;
  const due = b.bills.filter(x => x.category === c.name).sort((x, y) => x.date.getTime() - y.date.getTime());
  const dueTotal = sum(due.map(x => x.amount));
  const inDays = due[0] ? cycle.offsetOf(due[0].date) - cycle.dayIdx : 0;
  const state = cur > 0 || marked ? 'paid' : due.length ? 'due' : 'none';
  // Swipe right on a phone to tick it off (or untick one you ticked); a payment ticks it by itself.
  const canMark = cur === 0 && !c.auto;
  const swipe = useSwipeRight(() => canMark && onMark());
  // One fact per line: paid, what's left to pay, over plan, or when it's due.
  const over = lim > 0 && cur > lim ? cur - lim : 0;
  const line =
    state === 'paid'
      ? over
        ? `${short(over)} over plan`
        : due.length
          ? `${short(dueTotal)} left to pay`
          : cur > 0
            ? lim > 0
              ? 'Paid'
              : 'Paid, no amount planned'
            : 'Ticked off by you'
      : state === 'due'
        ? inDays <= 0
          ? 'Due today'
          : inDays === 1
            ? 'Due tomorrow'
            : `Due ${dayMonth(due[0].date)}`
        : 'Not paid yet';
  return (
    <div id={'cat-' + c.name} className={s.billWrap}>
      {swipe.swiping && (
        <span className={s.billSwipeHint} aria-hidden="true">
          {marked ? 'Untick' : 'Paid ✓'}
        </span>
      )}
      <button
        type="button"
        className={s.billRow}
        aria-expanded={open}
        onClick={() => !swipe.swiping && onToggle()}
        {...swipe.handlers}
        style={swipe.dx ? { transform: `translateX(${swipe.dx}px)` } : undefined}
      >
        <span className={s.billMark} data-state={state} aria-hidden="true">
          <Icon d={state === 'paid' ? 'M20 6 9 17l-5-5' : IC.calendar} size={15} strokeWidth={state === 'paid' ? 3 : 2} />
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, marginRight: 'auto' }}>
          <span style={{ fontSize: 14, fontWeight: 500 }}>{c.name}</span>
          <span style={{ fontSize: 13, whiteSpace: 'nowrap', color: over ? C.redInk : state === 'due' && inDays <= 3 ? C.amberInk : C.textMuted }}>{line}</span>
        </span>
        <span style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', color: state === 'none' ? C.textMuted : C.text }}>
          {state === 'paid' ? short(cur || lim) : state === 'due' ? short(dueTotal) : short(lim)}
        </span>
        <Icon d={IC.chevDown} size={16} color={C.textMuted} style={{ flex: 'none', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && !c.auto && (
        <div className={s.billAdd} style={{ borderTop: 'none', paddingTop: 0 }}>
          <AmountEditor label="Each month" initial={lim} onSave={onAmount} onRemove={() => onAmount(0)} />
          {canMark && (
            <button type="button" className={s.btnOutlineSm} style={{ alignSelf: 'flex-start' }} onClick={onMark}>
              {marked ? 'Mark as not paid' : '✓ Mark as paid'}
            </button>
          )}
        </div>
      )}
      {open && <CategoryDetail r={r} mode="cycle" cycle={cycle} toSort={0} onShowTransactions={onShowTransactions} onEditCategory={onEditCategory} />}
    </div>
  );
}

/** A monthly amount typed in rupiah (or dollars), saved as the bill's plan. */
function AmountEditor({ label, initial, onSave, onCancel, onRemove }: { label: string; initial: number; onSave: (v: number) => void; onCancel?: () => void; onRemove?: () => void }) {
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

/** Opened row: the last 7 days, where the money went, against last time, and what you can do about it. */
function CategoryDetail({
  r,
  mode,
  cycle,
  toSort,
  onShowTransactions,
  onEditCategory,
  children,
}: {
  r: Row;
  mode: Mode;
  cycle: Cycle;
  toSort: number;
  onShowTransactions: (cat: string) => void;
  onEditCategory: (name: string) => void;
  /** Extra actions (moving budget, a challenge). */
  children?: ReactNode;
}) {
  const { full, short, settings } = useSettings();
  const { c, cur, last, mine } = r;
  // What it went on inside the category, biggest first; untagged spending is "Other".
  const subNames = settings.subcategories[c.name] ?? [];
  const bySub = subNames.length
    ? [...subNames, null]
        .map(sub => ({ sub, total: sum(mine.filter(t => (t.sub ?? null) === sub).map(t => t.net)) }))
        .filter(x => x.total > 0)
        .sort((x, y) => y.total - x.total)
    : [];
  return (
    <div className={`fade-in ${s.catDetail}`}>
      {c.type === 'variable' && mine.length > 0 && <WeekBars mine={mine} today={cycle.today} color={c.color} />}
      {bySub.length > 0 && cur > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className={s.statLabel}>By sub-category</span>
          {bySub.map(x => (
            <button key={x.sub ?? ''} type="button" className={s.subRow} onClick={() => onShowTransactions(catFilter(c.name, x.sub))} title={`See ${x.sub ?? 'other ' + c.name.toLowerCase()} transactions`}>
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 10, fontSize: 14 }}>
                <span className={s.ellipsis} style={{ marginRight: 'auto', minWidth: 0, color: x.sub ? C.text : C.textMuted }}>
                  {x.sub ?? 'Other'}
                </span>
                <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{short(x.total)}</span>
                <span style={{ fontSize: 13, color: C.textMuted, minWidth: 36, textAlign: 'right' }}>{Math.round((x.total / cur) * 100)}%</span>
              </span>
              <span className={s.track} style={{ display: 'block', height: 4 }}>
                <span className={s.fill} style={{ width: pc((x.total / cur) * 100), background: x.sub ? c.color : C.textFaint }} />
              </span>
            </button>
          ))}
        </div>
      )}
      {mine.length === 0 ? (
        <span style={{ fontSize: 13, color: C.textMuted }}>Nothing spent here {mode === 'cycle' ? 'this cycle' : 'this week'}.</span>
      ) : c.auto ? (
        <PlanPayments mine={mine} />
      ) : (
        <TopMerchants mine={mine} />
      )}
      {last > 0 && (
        <span style={{ fontSize: 13, color: C.textMuted }}>
          {mode === 'cycle' ? `Last cycle by day ${cycle.dayN}` : 'Last week'}: {full(last)}{' '}
          <span style={{ color: changeBadge(cur, last).ink, fontWeight: 600 }}>({changeBadge(cur, last).label})</span>
        </span>
      )}
      {children && <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>{children}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className={s.btnOutlineSm} onClick={() => onShowTransactions(c.name)}>
          {toSort > 0 ? `Sort ${toSort} ${toSort === 1 ? 'transaction' : 'transactions'}` : 'Transactions'}
        </button>
        <button type="button" className={s.btnOutlineSm} onClick={() => onEditCategory(c.name)}>
          {c.custom ? 'Edit category' : 'Adjust limit'}
        </button>
      </div>
    </div>
  );
}

/** Installments, opened: each payment this cycle on two lines (the plan, then which payment and when). */
function PlanPayments({ mine }: { mine: TxView[] }) {
  const { full } = useSettings();
  const by = new Map<string, { title: string; month: number; months: number; date: Date; total: number }>();
  for (const t of mine) {
    if (!t.plan) continue;
    const k = t.plan.of + '~' + t.plan.month;
    const x = by.get(k) ?? { title: tidyName(t.title.replace(/ \(\d+\/\d+\)( interest)?$/, '')), month: t.plan.month, months: t.plan.months, date: t.date, total: 0 };
    x.total += t.net;
    by.set(k, x);
  }
  const list = [...by.values()].sort((a, b) => b.total - a.total);
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {list.map(p => (
        <div key={p.title + p.month} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, marginRight: 'auto' }}>
            <span className={s.ellipsis} style={{ fontSize: 14 }}>
              {p.title}
            </span>
            <span style={{ fontSize: 13, color: C.textMuted }}>
              Payment {p.month} of {p.months}, {dayMonth(p.date)}
            </span>
          </span>
          <span style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap' }}>{full(p.total)}</span>
        </div>
      ))}
    </div>
  );
}

/** Side panel (wide screens): what needs watching, and the biggest changes against last time. */
function CategoriesPanel({ cycle, mode, rows, onPick }: { cycle: Cycle; mode: Mode; rows: Row[]; onPick: (name: string) => void }) {
  const { short } = useSettings();
  const watch = rows.filter(r => r.st.key !== 'ok').sort((x, y) => x.st.rank - y.st.rank || y.used - x.used);
  const changes = rows
    .filter(r => r.c.type === 'variable' && r.last > 0 && Math.abs(r.cur - r.last) > 0)
    .sort((x, y) => Math.abs(y.cur - y.last) - Math.abs(x.cur - x.last))
    .slice(0, 3);
  return (
    <aside className={s.splitSide} aria-label="Categories at a glance">
      <section className={s.sideCard}>
        <h3 className={s.sideTitle}>Watch list</h3>
        {watch.length === 0 ? (
          <span style={{ fontSize: 14, color: C.textMuted }}>Every category is within its limit.</span>
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
