import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import s from '../styles/ui.module.css';
import { DismissBill, DueChip, IconChip } from '../components/ui';
import { Logo } from '../components/Logo';
import { IC, Icon } from '../components/Icon';
import { CategoryDialog } from '../components/CategoryDialog';
import { DateRangePicker } from '../components/DateRangePicker';
import { Select } from '../components/Select';
import { InstallmentDialog } from '../components/InstallmentDialog';
import { useData } from '../lib/data';
import { dayAmount, dayTotalLabel, iconChip, inDayTotal, type Budget, type TxView } from '../lib/budget';
import type { Cycle } from '../lib/cycle';
import { dayLabel, dayMonth, parseISO, sum, tidyName, toISO } from '../lib/format';
import { useSettings } from '../lib/settings';
import { useIsPhone } from '../lib/media';
import { C } from '../lib/tokens';
import { CATEGORIES, categoryByName, categoryLabel, CC_PAYMENT_CATEGORY, OTHER_CATEGORIES } from '../data/categories';
import { canDismissBill, isCard, merchantKey, type Bill } from '../data/transactions';

export type Range = 'today' | 'week' | 'last' | 'cycle' | 'custom';
/** `from` / `to` (YYYY-MM-DD, inclusive) are the dates picked for the `custom` range. */
export type ActivityFilter = { range: Range; cat: string; q: string; from?: string; to?: string; hideTransfers?: boolean };

type Props = {
  cycle: Cycle;
  budget: Budget;
  /** Every synced transaction, not only this cycle's: what a picked date range lists. */
  allTxs: TxView[];
  /** Transactions you removed by hand, so they can be restored. */
  removedTxs: TxView[];
  /** Hide a transaction everywhere (`true`) or bring it back. */
  onRemove: (txId: string, removed: boolean) => void;
  filter: ActivityFilter;
  setFilter: (f: ActivityFilter) => void;
  onRecat: (id: string, orig: string, cat: string) => void;
  /** Link an income to the expense it pays back; `null` unlinks. */
  onLink: (incomeId: string, expenseId: string | null) => void;
  /** Your share of an expense as a fraction (0–1); `null` counts the full amount. */
  onShare: (txId: string, ratio: number | null) => void;
  /** Hide a predicted bill for this cycle. */
  onDismissBill: (b: Bill) => void;
};

type Popover = 'link' | 'share' | 'cat' | 'more' | 'note';

/**
 * A row popover that would end behind the phone tab bar (or below the window) opens upward instead.
 * Spread `ref` and `style` onto the popover.
 */
function useFlipUp<T extends HTMLElement>(style?: CSSProperties) {
  const ref = useRef<T>(null);
  const [up, setUp] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Room the bottom tab bar takes on phones.
    const bottom = window.innerHeight - (window.innerWidth < 760 ? 104 : 16);
    if (r.bottom > bottom && r.top - r.height - 48 > 0) setUp(true);
  }, []);
  return { ref, style: up ? { ...style, top: 'auto', bottom: '100%', marginTop: 0, marginBottom: 6 } : style };
}

/** Square icon button in the phone filter row. */
const iconPill = { flex: 'none', width: 44, height: 44, minHeight: 44, padding: 0, display: 'grid', placeItems: 'center' } as const;

export function Activity({ cycle, budget, allTxs, removedTxs, onRemove, filter, setFilter, onRecat, onLink, onShare, onDismissBill }: Props) {
  const { full, settings, update } = useSettings();
  /** The row with an open popover: an income's "paid back for" picker or an expense's "my share" editor. */
  const [open, setOpen] = useState<{ id: string; kind: Popover } | null>(null);
  /** "New category" dialog, opened from a row's category menu; the new category is applied to that row. */
  const [creating, setCreating] = useState<{ name: string; tx: TxView } | null>(null);
  const [calOpen, setCalOpen] = useState(false);
  const { installments, setInstallment, notes } = useData();
  /** The purchase whose installment plan is open in the dialog. */
  const [planFor, setPlanFor] = useState<string | null>(null);
  const planTx = planFor ? allTxs.find(x => x.id === planFor) : undefined;
  const unplan = (id: string) => {
    const before = installments[id];
    setInstallment(id, null);
    setToast({ text: 'Back to one purchase', action: 'Undo', run: () => before && setInstallment(id, before) });
  };
  /** What just changed, with a way to take it back, for a few seconds. */
  const [toast, setToast] = useState<{ text: string; action: string; run: () => void } | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);
  const phone = useIsPhone();
  /** Phones: search sits behind an icon, and the recap is folded. */
  const [searchOpen, setSearchOpen] = useState(false);
  const [recapOpen, setRecapOpen] = useState(false);
  /** Height of the pinned bar, so day headings pin just below it. */
  const bar = useRef<HTMLDivElement>(null);
  const [barH, setBarH] = useState(0);
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBarH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(timer);
  }, [toast]);
  const remove = (t: TxView) => {
    setOpen(null);
    onRemove(t.id, true);
    setToast({ text: `Removed ${t.title}`, action: 'Undo', run: () => onRemove(t.id, false) });
  };
  /** Re-categorise a row and remember it for the merchant: its other and future transactions follow. */
  const recategorise = (t: TxView, to: string) => {
    const key = merchantKey(t.title);
    onRecat(t.id, t.category, to);
    if (!key) return;
    const prev = settings.merchantRules[key];
    update({ merchantRules: { ...settings.merchantRules, [key]: to } });
    const others = allTxs.filter(x => x.id !== t.id && !x.isCcPayment && merchantKey(x.title) === key).length;
    setToast({
      text: `${t.title} → ${categoryLabel(to)}` + (others ? ` for ${others} other ${others === 1 ? 'transaction' : 'transactions'} too, and future ones` : ' from now on'),
      action: 'Just this one',
      run: () => {
        const rules = { ...settings.merchantRules };
        if (prev == null) delete rules[key];
        else rules[key] = prev;
        update({ merchantRules: rules });
      },
    });
  };
  const expenses = budget.txs.filter(t => !t.isIncome && !t.isTransfer);
  const { range, cat, q } = filter;
  const todayISO = toISO(cycle.today);
  const earliestISO = allTxs.length ? toISO(allTxs[allTxs.length - 1].date) : toISO(cycle.start);
  // Calendar weeks (Monday to Sunday), not weeks of the pay cycle, which start on payday's weekday.
  // Only this cycle's transactions are listed, so a week reaching back before payday starts at payday.
  const wStart = cycle.offsetOf(cycle.today) - ((cycle.today.getDay() + 6) % 7);
  // Named ranges come from other screens (a category's "see transactions") and the default; the picker sets `custom`.
  const bounds: Record<Exclude<Range, 'custom'>, [number, number]> = {
    today: [cycle.dayIdx, cycle.dayIdx],
    week: [Math.max(0, wStart), cycle.dayIdx],
    last: [Math.max(0, wStart - 7), wStart - 1],
    cycle: [0, cycle.dayIdx],
  };
  const [lo, hi] =
    range === 'custom' ? [cycle.offsetOf(parseISO(filter.from ?? toISO(cycle.start))), cycle.offsetOf(parseISO(filter.to ?? todayISO))] : bounds[range];
  /** The range as dates, for the picker and its button. */
  const from = toISO(cycle.dateOf(lo));
  const to = toISO(cycle.dateOf(Math.max(lo, hi)));
  const span = (a: number, b: number) => (a === b ? dayLabel(cycle.dateOf(a)) : `${dayLabel(cycle.dateOf(a))} – ${dayLabel(cycle.dateOf(b))}`);
  const rangeLabel =
    hi < lo
      ? 'Last week was before this pay cycle'
      : span(lo, hi) + ((range === 'week' || range === 'last') && lo === 0 && (range === 'last' ? wStart - 7 : wStart) < 0 ? ' (from payday)' : '');
  const needle = q.trim().toLowerCase();
  /** Everything in the range that matches the filters: what the recap adds up. */
  const inRange = (range === 'custom' ? allTxs : budget.txs).filter(
    t => t.offset >= lo && t.offset <= hi && (!cat || t.cat === cat) && (!needle || `${t.title} ${t.account} ${t.source} ${t.cat} ${notes[t.id] ?? ''}`.toLowerCase().includes(needle)),
  );
  /** What the list shows: the same, minus transfers between your accounts when you hide them. */
  const txs = filter.hideTransfers ? inRange.filter(t => !t.isTransfer) : inRange;

  const groups: { label: string; items: TxView[] }[] = [];
  for (const t of txs) {
    const label = dayLabel(t.date) + (t.offset === cycle.dayIdx ? ' (Today)' : '');
    let g = groups.find(x => x.label === label);
    if (!g) groups.push((g = { label, items: [] }));
    g.items.push(t);
  }
  const spending = inRange.filter(t => !t.isIncome && !t.isTransfer);
  const out = spending.reduce((a, t) => a + t.net, 0);
  const paidBack = spending.reduce((a, t) => a + Math.min(t.reimbursed, t.amount), 0);
  const income = inRange.filter(t => t.isIncome && !t.reimbursesId).reduce((a, t) => a + t.amount, 0);
  const moved = inRange.filter(t => t.isTransfer && !t.isCcPayment && !t.isInvestment && !t.isSavings && !t.isInstallment).reduce((a, t) => a + t.amount, 0);
  const saved = inRange.filter(t => t.isSavings).reduce((a, t) => a + t.amount, 0);
  const invested = inRange.filter(t => t.isInvestment).reduce((a, t) => a + t.amount, 0);
  const cardBills = inRange.filter(t => t.isCcPayment).reduce((a, t) => a + t.amount, 0);
  const transferCount = inRange.filter(t => t.isTransfer && !t.isInstallment).length;
  /** Spending per category in the range, biggest first, for the recap. */
  const byCat = Object.entries(
    spending.reduce<Record<string, number>>((acc, t) => ({ ...acc, [t.cat]: (acc[t.cat] ?? 0) + t.net }), {}),
  )
    .filter(([, v]) => v > 0)
    .sort((x, y) => y[1] - x[1]);
  const bills = budget.bills.filter(b => !cat || b.category === cat);
  /** The account most spending comes from: phones only name the account on rows paid from another one. */
  const usualAccount = useMemo(() => {
    const n = new Map<string, number>();
    for (const t of allTxs) if (t.type === 'expense') n.set(t.account, (n.get(t.account) ?? 0) + 1);
    return [...n].sort((x, y) => y[1] - x[1])[0]?.[0];
  }, [allTxs]);
  const fromTo = (a: Date, b: Date) =>
    // Phones: "26–29 Oct" when both ends share a month.
    phone && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear() ? `${a.getDate()}–${dayMonth(b)}` : `${dayMonth(a)} – ${dayMonth(b)}`;
  const removedHere = removedTxs.filter(t => t.offset >= lo && t.offset <= hi);

  const recap = (
    <Recap
      bare={phone}
      rangeLabel={rangeLabel}
      count={inRange.length}
      figures={[
        ['Income', income, C.accent800],
        ['Reimbursed', paidBack, C.text],
        ['Card bills paid', cardBills, C.text],
        ['Saved', saved, C.text],
        ['Invested', invested, C.text],
        ['Moved between your accounts', moved, C.textMuted],
      ]}
      spent={out}
      transfers={transferCount}
      byCat={byCat}
      cat={cat}
      onPickCat={c => setFilter({ ...filter, cat: c === cat ? '' : c })}
    />
  );

  return (
    <div className={s.splitGrid} style={{ ['--bar-h' as string]: barH + 'px' }}>
      <div className={s.splitMain}>
        {/* Dates, search and totals stay pinned while you scroll the list. */}
        <div ref={bar} className={s.stickyBar}>
          <div style={{ position: 'relative', display: 'flex', flexWrap: phone ? 'nowrap' : 'wrap', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className={s.pillActive}
              aria-label={`Date range: ${rangeLabel}. Change dates`}
              aria-haspopup="dialog"
              aria-expanded={calOpen}
              onClick={() => setCalOpen(!calOpen)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flex: 'none', whiteSpace: 'nowrap', paddingInline: phone ? 12 : 16 }}
            >
              <Icon d={IC.calendar} size={16} />
              {from === to ? dayMonth(parseISO(from)) : fromTo(parseISO(from), parseISO(to))}
              <Icon d={IC.chevDown} size={14} style={{ transform: calOpen ? 'rotate(180deg)' : undefined }} />
            </button>
            {!phone && (
              <button
                type="button"
                className={filter.hideTransfers ? s.pillActive : s.pill}
                aria-pressed={!!filter.hideTransfers}
                onClick={() => setFilter({ ...filter, hideTransfers: !filter.hideTransfers })}
                title="Transfers between your own accounts aren't spending"
                style={{ marginLeft: 'auto', flex: 'none', whiteSpace: 'nowrap', minHeight: 44, paddingInline: 14 }}
              >
                {filter.hideTransfers ? 'Transfers hidden' : 'Hide transfers'}
              </button>
            )}
            <Select
              value={cat}
              onChange={v => setFilter({ ...filter, cat: v })}
              ariaLabel="Filter by category"
              align="right"
              options={[
                { value: '', label: phone ? 'All' : 'All categories' },
                ...CATEGORIES.map(c => ({ value: c.name, label: c.name, dot: c.color, group: 'Spending' })),
                ...[...OTHER_CATEGORIES, CC_PAYMENT_CATEGORY].map(c => ({ value: c, label: categoryLabel(c), group: 'Not spending' })),
              ]}
              style={{ width: 'auto', minWidth: 0, maxWidth: phone ? 140 : 220, borderRadius: 8, fontSize: 14, padding: phone ? '9px 34px 9px 12px' : '9px 40px 9px 16px', minHeight: 44 }}
            />
            {/* Phones: search and "hide transfers" as icons on the same row. */}
            {phone && (
              <>
                <button
                  type="button"
                  className={searchOpen || q ? s.pillActive : s.pill}
                  aria-label="Search transactions"
                  aria-expanded={searchOpen || !!q}
                  onClick={() => {
                    if (searchOpen || q) setFilter({ ...filter, q: '' });
                    setSearchOpen(!(searchOpen || q));
                  }}
                  style={{ marginLeft: 'auto', ...iconPill }}
                >
                  <Icon d={searchOpen || q ? IC.close : IC.search} size={17} />
                </button>
                <button
                  type="button"
                  className={filter.hideTransfers ? s.pillActive : s.pill}
                  aria-pressed={!!filter.hideTransfers}
                  aria-label="Hide transfers between your accounts"
                  title={filter.hideTransfers ? 'Transfers hidden' : 'Hide transfers'}
                  onClick={() => setFilter({ ...filter, hideTransfers: !filter.hideTransfers })}
                  style={iconPill}
                >
                  <Icon d={IC.transfer} size={17} />
                </button>
              </>
            )}
            {calOpen && (
              <DateRangePicker
                from={from}
                to={to}
                min={earliestISO}
                max={todayISO}
                cycleStart={toISO(cycle.start)}
                onChange={(a, b) => setFilter({ ...filter, range: 'custom', from: a, to: b })}
                onClose={() => setCalOpen(false)}
              />
            )}
          </div>
          {(!phone || searchOpen || q) && (
            <div style={{ display: 'flex' }}>
              <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
                <Icon d={IC.search} size={16} color={C.textMuted} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                <input
                  className={s.input}
                  type="search"
                  value={q}
                  onChange={e => setFilter({ ...filter, q: e.target.value })}
                  placeholder="Search merchant, category or note"
                  aria-label="Search transactions"
                  autoFocus={phone}
                  style={{ borderRadius: 8, paddingLeft: 42, fontSize: 14 }}
                />
              </div>
            </div>
          )}
          {/* Narrow screens: the recap as one short line (wide screens have the recap panel instead). */}
          <div className={s.txSummaryLine} aria-live="polite">
            <strong style={{ color: C.text, fontWeight: 600 }}>{full(out)} spent</strong>
            {/* Phones: the date chip already says the dates. */}
            {phone ? '' : ` · ${rangeLabel}`} · {inRange.length} {inRange.length === 1 ? 'transaction' : 'transactions'}
            {filter.hideTransfers && phone ? ' · transfers hidden' : ''}
          </div>
        </div>

        {/* overflow visible: the "paid back for" picker floats past the card's edge. */}
        <div className={s.cardFlush} style={{ padding: '4px 0 6px', overflow: 'visible' }}>
          {groups.length === 0 && (
            <div style={{ padding: '40px 24px', textAlign: 'center', fontSize: 14, color: C.textMuted, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
              <Logo size={44} />
            <span>
              {!cat && !needle && range === 'today' ? 'No spending yet today — nice!' : !cat && !needle ? 'Nothing here for these dates.' : 'No transactions match these filters.'}
            </span>
              {(cat || needle || lo !== 0 || hi !== cycle.dayIdx) && (
                <button type="button" className={s.btnOutline} onClick={() => setFilter({ range: 'cycle', cat: '', q: '' })}>
                  Show the whole cycle
                </button>
              )}
            </div>
          )}
          {groups.map(g => (
            <div key={g.label} style={{ display: 'flex', flexDirection: 'column' }}>
              <h2 className={s.dayHead}>
                <span>{g.label}</span>
                {g.items.some(inDayTotal) && <span>{dayTotalLabel(g.items.reduce((a, t) => a + dayAmount(t), 0), full)}</span>}
              </h2>
              {g.items.map(t => (
                <TxRow
                  key={t.id}
                  t={t}
                  onRecat={recategorise}
                  onLink={onLink}
                  onShare={onShare}
                  onRemove={() => remove(t)}
                  onPlan={setPlanFor}
                  onUnplan={unplan}
                  expenses={expenses}
                  compact={phone}
                  usualAccount={usualAccount}
                  onNewCategory={name => {
                    setOpen(null);
                    setCreating({ name, tx: t });
                  }}
                  popover={open?.id === t.id ? open.kind : null}
                  setPopover={kind => setOpen(kind ? { id: t.id, kind } : null)}
                />
              ))}
            </div>
          ))}
        </div>

        {removedHere.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button type="button" className={s.textBtnSm} aria-expanded={showRemoved} onClick={() => setShowRemoved(!showRemoved)} style={{ alignSelf: 'flex-start' }}>
              {showRemoved ? 'Hide' : 'Show'} {removedHere.length} removed {removedHere.length === 1 ? 'transaction' : 'transactions'} in these dates
            </button>
            {showRemoved && (
              <div className={s.cardFlush} style={{ padding: '4px 0' }}>
                {removedHere.map(t => (
                  <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 18px', color: C.textMuted }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginRight: 'auto', minWidth: 0 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, textDecoration: 'line-through' }}>{t.title}</span>
                      <span style={{ fontSize: 13 }}>
                        {dayLabel(t.date)} · {t.cat} · {full(t.amount)}
                      </span>
                    </div>
                    <button type="button" className={s.btnOutline} onClick={() => onRemove(t.id, false)} style={{ flex: 'none' }}>
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <section className={s.cardFlush} style={{ padding: '4px 0 6px' }}>
          <h2 className={s.h2Sm} style={{ padding: '14px 18px 4px' }}>
            Upcoming bills
          </h2>
          {bills.length === 0 && <div style={{ padding: '8px 18px 12px', fontSize: 14, color: C.textMuted }}>No more bills due before payday.</div>}
          {bills.map(b => {
            const ic = iconChip(b.category);
            const inDays = cycle.offsetOf(b.date) - cycle.dayIdx;
            return (
              <div key={`${b.title}|${b.amount}|${b.date.getTime()}`} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 18px' }}>
                <span className={s.rowIcon}>
                  <IconChip d={IC.calendar} bg={ic.bg} ink={ic.ink} />
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginRight: 'auto', minWidth: 0 }}>
                  <span className={s.ellipsis} style={{ fontSize: 15, fontWeight: 600 }}>
                    {tidyName(b.title)}
                  </span>
                  <span style={{ fontSize: 13, color: C.textMuted }}>{b.category}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flex: 'none' }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: C.text }}>- {full(b.amount)}</span>
                  <DueChip date={b.date} inDays={inDays} />
                </div>
                {canDismissBill(b) && <DismissBill title={tidyName(b.title)} onClick={() => onDismissBill(b)} />}
              </div>
            );
          })}
        </section>
      </div>
      {phone ? (
        // Phones: folded under one row; the total is already in the line above the list.
        <section className={s.splitSide}>
          <button type="button" className={s.rowBtn} aria-expanded={recapOpen} onClick={() => setRecapOpen(!recapOpen)} style={{ padding: '14px 16px', minHeight: 48 }}>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, marginRight: 'auto', textAlign: 'left' }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>Recap</span>
              <span style={{ fontSize: 13, color: C.textMuted }}>Totals and spending by category</span>
            </span>
            <Icon d={IC.chevDown} size={16} color={C.textMuted} style={{ transform: recapOpen ? 'rotate(180deg)' : 'none' }} />
          </button>
          {recapOpen && (
            <div className="fade-in" style={{ borderTop: `1px solid ${C.divider}` }}>
              {recap}
            </div>
          )}
        </section>
      ) : (
        recap
      )}
      {toast && (
        <div className={s.toast} role="status">
          <span style={{ marginRight: 'auto', minWidth: 0 }}>{toast.text}</span>
          <button
            type="button"
            className={s.toastBtn}
            onClick={() => {
              toast.run();
              setToast(null);
            }}
          >
            {toast.action}
          </button>
        </div>
      )}
      {planTx && (
        <InstallmentDialog
          tx={planTx}
          plan={installments[planTx.id]}
          onClose={() => setPlanFor(null)}
          onSave={plan => {
            setInstallment(planTx.id, plan);
            setPlanFor(null);
          }}
          onUndo={
            installments[planTx.id]
              ? () => {
                  unplan(planTx.id);
                  setPlanFor(null);
                }
              : undefined
          }
        />
      )}
      {creating && (
        <CategoryDialog
          initialName={creating.name}
          onClose={() => setCreating(null)}
          onSaved={name => recategorise(creating.tx, name)}
        />
      )}
    </div>
  );
}

/**
 * Wide screens: what the picked dates add up to, beside the list. Spending first and largest, the rest only
 * when it isn't zero, then spending by category (click one to filter the list to it).
 */
function Recap({
  bare,
  rangeLabel,
  count,
  spent,
  figures,
  transfers,
  byCat,
  cat,
  onPickCat,
}: {
  rangeLabel: string;
  count: number;
  spent: number;
  figures: [string, number, string][];
  transfers: number;
  byCat: [string, number][];
  cat: string;
  onPickCat: (cat: string) => void;
  /** Phones: inside the Recap fold, without its own title and total. */
  bare?: boolean;
}) {
  const { full } = useSettings();
  const total = sum(byCat.map(([, v]) => v));
  const hasFigures = figures.some(([, v]) => v > 0) || transfers > 0;
  return (
    <aside className={bare ? undefined : s.splitSide} aria-label="Recap of these dates">
      {(!bare || hasFigures) && (
        <section className={s.sideCard}>
          {!bare && (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <h3 className={s.sideTitle}>Recap</h3>
                <span style={{ fontSize: 13, color: C.textMuted }}>
                  {rangeLabel} · {count} {count === 1 ? 'transaction' : 'transactions'}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 13, color: C.textMuted }}>Spent</span>
                <span style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.01em' }}>{full(spent)}</span>
              </div>
            </>
          )}
          {figures.some(([, v]) => v > 0) && (
            <div className={s.sideList} style={{ gap: 8 }}>
              {figures
                .filter(([, v]) => v > 0)
                .map(([label, v, ink]) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 14 }}>
                    <span style={{ color: C.textSoft }}>{label}</span>
                    <span style={{ fontWeight: 500, color: ink, whiteSpace: 'nowrap' }}>{full(v)}</span>
                  </div>
                ))}
            </div>
          )}
          {transfers > 0 && (
            <span style={{ fontSize: 13, color: C.textMuted }}>
              {transfers} {transfers === 1 ? 'transfer' : 'transfers'} aren't counted as spending.
            </span>
          )}
        </section>
      )}
      {byCat.length > 0 && (
        <section className={s.sideCard}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <h3 className={s.sideTitle}>By category</h3>
            <span style={{ fontSize: 13, color: C.textMuted }}>Click one to show only its transactions</span>
          </div>
          <div className={s.sideList} style={{ gap: 4 }}>
            {byCat.map(([name, v]) => {
              const color = categoryByName(name)?.color ?? C.textFaint;
              return (
                <button key={name} type="button" className={s.recapRow} aria-pressed={cat === name} onClick={() => onPickCat(name)}>
                  <span style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 14 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <span aria-hidden="true" style={{ flex: 'none', width: 8, height: 8, borderRadius: '50%', background: color }} />
                      <span className={s.ellipsis}>{name}</span>
                    </span>
                    <span style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>
                      {full(v)} <span style={{ color: C.textMuted, fontWeight: 400 }}>· {Math.round((v / total) * 100)}%</span>
                    </span>
                  </span>
                  <span className={s.recapTrack}>
                    <span style={{ width: `${(v / byCat[0][1]) * 100}%`, background: color }} />
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </aside>
  );
}

type RowProps = {
  t: TxView;
  onRecat: (t: TxView, cat: string) => void;
  onLink: Props['onLink'];
  onShare: Props['onShare'];
  onRemove: () => void;
  /** Open the installment dialog for a purchase (by id). */
  onPlan: (purchaseId: string) => void;
  /** Make an installment purchase one purchase again. */
  onUnplan: (purchaseId: string) => void;
  /** Open the "New category" dialog, prefilled with what was typed in the category search. */
  onNewCategory: (name: string) => void;
  /** This cycle's expenses, newest first: what an income can pay back. */
  expenses: TxView[];
  popover: Popover | null;
  setPopover: (kind: Popover | null) => void;
  /** Phones: category as plain text, the account only when it isn't the usual one, and tapping the row opens its menu. */
  compact?: boolean;
  usualAccount?: string;
};

function TxRow({ t, onRecat, onLink, onShare, onRemove, onPlan, onUnplan, onNewCategory, expenses, popover, setPopover, compact, usualAccount }: RowProps) {
  const { installments, notes, setNote } = useData();
  const { full } = useSettings();
  const note = notes[t.id];
  const c = categoryByName(t.cat);
  const ic = iconChip(t.cat);
  const row = useRef<HTMLDivElement>(null);
  const linked = t.reimbursesId ? expenses.find(e => e.id === t.reimbursesId) : undefined;
  const canLink = t.isIncome && !t.isSalary;
  const isExpense = !t.isIncome && !t.isTransfer;
  const picking = popover === 'link';
  const setPicking = (on: boolean) => setPopover(on ? 'link' : null);

  // Close a popover on Escape or a click outside this row (which holds the toggles and the popovers).
  useEffect(() => {
    if (!popover) return;
    const onDown = (e: MouseEvent) => !row.current?.contains(e.target as Node) && setPopover(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPopover(null);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [popover, setPopover]);

  /** Where the money went from and to: the account for spending, the flow for a transfer, the source for income. */
  const fullWhere = t.isTransfer && !t.isCcPayment ? `${t.account}${t.toAccount ? ' → ' + t.toAccount : ''}` : t.type === 'expense' ? t.account : t.source;
  const where = compact && t.type === 'expense' && t.account === usualAccount ? '' : fullWhere;
  const paidBy = t.paidBackBy.join(', ');
  const shareNote = t.share != null ? `your share of ${full(t.amount)}` : '';
  const amount = t.isIncome
    ? { text: '+ ' + full(t.amount), ink: t.reimbursesId ? C.textMuted : C.accent800 }
    : t.isInstallment
      ? { text: full(t.amount), ink: C.textMuted, note: `in ${installments[t.id]?.amounts.length ?? '?'} payments` }
      : t.isTransfer
      ? { text: full(t.amount), ink: C.textMuted }
      : t.reimbursed && t.net === 0
        ? { text: full(0), ink: C.textMuted, note: 'paid back by ' + paidBy }
        : t.reimbursed
          ? { text: '- ' + full(t.net), ink: C.text, note: `${full(t.reimbursed)} paid back by ${paidBy}` }
          : t.share != null
            ? { text: t.net === 0 ? full(0) : '- ' + full(t.net), ink: t.net === 0 ? C.textMuted : C.text, note: shareNote }
            : { text: '- ' + full(t.amount), ink: C.text };
  /** Less-used actions, behind the row's ⋯ button. */
  /** The installment purchase this row belongs to: itself, or the purchase a monthly payment pays for. */
  const planId = t.plan?.of ?? (t.isInstallment ? t.id : null);
  type Item = [string, () => void];
  const more: Item[] = [
    [note ? 'Edit note' : 'Add note…', () => setPopover('note')],
    ...(isExpense && !t.plan ? [[t.share != null ? 'Edit my share' : 'My share…', () => setPopover('share')] as Item] : []),
    ...(canLink && !t.reimbursesId ? [['Paid back for…', () => setPicking(true)] as Item] : []),
    // Installments: card purchases, and shopping paid any other way (paylater, store credit).
    ...(planId
      ? ([
          ['Edit installment…', () => onPlan(planId)],
          ['Make it one purchase again', () => onUnplan(planId)],
        ] as Item[])
      : isExpense && (isCard(t.account) || t.cat === 'Shopping')
        ? [['Pay in installments…', () => onPlan(t.id)] as Item]
        : []),
    // A monthly payment is part of its plan; it's removed by making the purchase one purchase again.
    ...(t.plan ? [] : [['Remove transaction', onRemove] as Item]),
  ];

  return (
    <div
      ref={row}
      className={s.hoverRow}
      // Phones: tap anywhere that isn't a control to open the row's menu.
      onClick={e => compact && !(e.target as Element).closest('button, input, a, form, [role=dialog], [role=menu], [role=listbox]') && setPopover(popover === 'more' ? null : 'more')}
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: compact ? '10px 16px' : '8px 18px', cursor: compact ? 'pointer' : undefined }}
    >
      <span className={s.rowIcon}>
        <IconChip d={c ? c.icon : t.isCcPayment || t.isInstallment ? IC.card : t.isInvestment ? IC.trend : t.isSavings ? IC.piggy : t.isTransfer ? IC.transfer : IC.coins} bg={ic.bg} ink={ic.ink} />
      </span>
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
        <span className={s.ellipsis} style={{ fontSize: 15, fontWeight: 600 }}>
          {tidyName(t.title)}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, fontSize: 13, color: C.textMuted }}>
          {t.isCcPayment ? (
            <span style={{ fontSize: 13, fontWeight: 600, color: C.text, background: C.divider, borderRadius: 999, padding: '4px 10px' }}>
              Transfer · {t.account} → {t.toAccount ?? 'card'}
            </span>
          ) : t.reimbursesId ? (
            <span className={s.paidChip}>
              <button type="button" className={s.paidChipLabel} aria-expanded={picking} onClick={() => setPicking(!picking)} title="Change the expense this pays back">
                Paid back · {linked?.title ?? 'an earlier expense'}
              </button>
              <button type="button" className={s.paidChipX} aria-label={`Unlink ${t.title}`} onClick={() => onLink(t.id, null)}>
                <Icon d={IC.close} size={12} />
              </button>
            </span>
          ) : t.isInstallment ? (
            <button type="button" className={s.catPill} onClick={() => onPlan(t.id)} title="Edit the installment plan">
              <span className={s.catPillText}>Installment · {installments[t.id]?.amounts.length} months</span>
              <Icon d={IC.chevDown} size={14} style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
            </button>
          ) : (
            <CategoryButton t={t} plain={compact} open={popover === 'cat'} onToggle={() => setPopover(popover === 'cat' ? null : 'cat')} />
          )}
          {/* Your note takes the account's place (the account moves under the time), so the row stays two lines. */}
          {note ? (
            <button type="button" className={s.txNote} onClick={() => setPopover('note')} title={`${note} · click to edit`}>
              {note}
            </button>
          ) : (
            where && <span className={s.ellipsis}>{where}</span>
          )}
        </div>
        {popover === 'note' && (
          <NoteEditor
            t={t}
            note={note ?? ''}
            onSave={text => {
              setNote(t.id, text);
              setPopover(null);
            }}
          />
        )}
        {picking && (
          <Picker
            income={t}
            expenses={expenses}
            onPick={id => {
              onLink(t.id, id);
              setPicking(false);
            }}
          />
        )}
        {popover === 'cat' && (
          <CategoryMenu
            current={t.cat}
            onPick={cat => {
              if (cat !== t.cat) onRecat(t, cat);
              setPopover(null);
            }}
            onNew={onNewCategory}
          />
        )}
        {popover === 'share' && (
          <ShareEditor
            t={t}
            onSave={ratio => {
              onShare(t.id, ratio);
              setPopover(null);
            }}
          />
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flex: 'none' }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: amount.ink }}>{amount.text}</span>
        {amount.note && <span style={{ fontSize: 13, fontWeight: 600, color: C.accent800 }}>{amount.note}</span>}
        <span style={{ fontSize: 13, color: C.textMuted, whiteSpace: 'nowrap' }}>
          {t.time}
          {note && where ? ` · ${where}` : ''}
        </span>
      </div>
      <div style={{ position: 'relative', flex: 'none' }}>
        <button
          type="button"
          className={compact ? 'sr-only' : s.rowMore}
          aria-haspopup="menu"
          aria-expanded={popover === 'more'}
          aria-label={`More for ${t.title}`}
          onClick={() => setPopover(popover === 'more' ? null : 'more')}
        >
          <Icon d={IC.more} size={18} strokeWidth={3} />
        </button>
        {popover === 'more' && (
          <MoreMenu>
            {more.map(([label, run]) => (
              <button
                key={label}
                type="button"
                role="menuitem"
                className={s.pickRow}
                onClick={() => {
                  setPopover(null);
                  run();
                }}
                style={{ fontSize: 14, fontWeight: 600, color: label.startsWith('Remove') ? C.redInk : C.text }}
              >
                {label}
              </button>
            ))}
          </MoreMenu>
        )}
      </div>
    </div>
  );
}

/** The row's ⋯ menu. */
function MoreMenu({ children }: { children: ReactNode }) {
  const flip = useFlipUp<HTMLDivElement>({ left: 'auto', right: 0, width: 210 });
  return (
    <div ref={flip.ref} className={s.picker} role="menu" style={flip.style}>
      {children}
    </div>
  );
}

/** Popover listing this cycle's expenses; the one with the same amount as the income is suggested first. */
function Picker({ income, expenses, onPick }: { income: TxView; expenses: TxView[]; onPick: (expenseId: string) => void }) {
  const { full } = useSettings();
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const suggested = needle ? undefined : expenses.find(e => e.amount === income.amount);
  const flip = useFlipUp<HTMLDivElement>();
  const list = needle
    ? expenses.filter(e => `${e.title} ${e.cat} ${e.source}`.toLowerCase().includes(needle))
    : (suggested ? [suggested, ...expenses.filter(e => e !== suggested)] : expenses).slice(0, 5);
  return (
    <div ref={flip.ref} className={s.picker} style={flip.style} role="dialog" aria-label={`Expense paid back by ${income.title}`}>
      <label className={s.pickSearch}>
        <Icon d={IC.search} size={15} color={C.textMuted} />
        <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search the expense this pays back" aria-label="Search the expense this pays back" />
      </label>
      <div className={s.pickList} style={{ maxHeight: needle ? 300 : undefined }}>
        {list.length === 0 && <div style={{ padding: '10px', fontSize: 13, color: C.textMuted }}>No expenses match.</div>}
        {list.map(e => (
          <button key={e.id} type="button" className={s.pickRow + (e.id === income.reimbursesId ? ' ' + s.pickRowOn : '')} onClick={() => onPick(e.id)}>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, marginRight: 'auto' }}>
              {e === suggested && <span className={s.pickSuggest}>Suggested · same amount</span>}
              <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{e.title}</span>
              <span style={{ fontSize: 13, color: C.textMuted }}>
                {dayMonth(e.date)} · {e.cat}
              </span>
            </span>
            <span style={{ fontSize: 13, fontWeight: 600, color: C.textMuted, whiteSpace: 'nowrap' }}>{full(e.amount)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Your own remark on a transaction: what it was for, the occasion. Saving it empty removes it. */
function NoteEditor({ t, note, onSave }: { t: TxView; note: string; onSave: (note: string) => void }) {
  const [text, setText] = useState(note);
  const flip = useFlipUp<HTMLFormElement>({ padding: 12, gap: 10 });
  return (
    <form
      ref={flip.ref}
      className={s.picker}
      role="dialog"
      aria-label={`Note on ${t.title}`}
      onSubmit={e => {
        e.preventDefault();
        onSave(text);
      }}
      style={flip.style}
    >
      <span style={{ fontSize: 13, color: C.textMuted }}>What was it for? It shows under the name, and search finds it.</span>
      <input
        autoFocus
        className={s.input}
        maxLength={200}
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="e.g. Mum's birthday dinner"
        aria-label="Note"
      />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        {note && (
          <button type="button" className={s.textBtnSm} onClick={() => onSave('')} style={{ marginRight: 'auto', color: C.redInk }}>
            Remove note
          </button>
        )}
        <button type="submit" className={s.btnPrimarySm} disabled={text.trim() === note}>
          Save
        </button>
      </div>
    </form>
  );
}

/** Set the part of an expense that's yours, for a shared payment nobody has transferred back yet. */
function ShareEditor({ t, onSave }: { t: TxView; onSave: (ratio: number | null) => void }) {
  const { full, settings } = useSettings();
  const fmt = (v: number) => (settings.currency === 'IDR' ? Math.round(v).toLocaleString('id-ID') : String(Math.round(v * 100) / 100));
  const [text, setText] = useState(fmt(t.share ?? t.amount));
  const value = settings.currency === 'IDR' ? Number(text.replace(/\D/g, '')) : Number(text.replace(/[^\d.]/g, ''));
  const valid = text.trim() !== '' && Number.isFinite(value) && value >= 0 && value <= t.amount;
  const save = () => valid && onSave(value >= t.amount ? null : value / t.amount);
  const flip = useFlipUp<HTMLFormElement>({ padding: 12, gap: 10 });
  return (
    <form
      ref={flip.ref}
      className={s.picker}
      role="dialog"
      aria-label={`Your share of ${t.title}`}
      onSubmit={e => {
        e.preventDefault();
        save();
      }}
      style={flip.style}
    >
      <span style={{ fontSize: 13, color: C.textMuted }}>
        You paid {full(t.amount)}. How much of it was yours? Only your share counts as spending.
      </span>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {[
          ['Half', 1 / 2],
          ['A third', 1 / 3],
          ['A quarter', 1 / 4],
        ].map(([label, f]) => (
          <button key={label} type="button" className={s.splitBtn} onClick={() => setText(fmt(t.amount * (f as number)))}>
            {label}
          </button>
        ))}
      </div>
      <label className={s.pickSearch}>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.textMuted }}>My share</span>
        <input autoFocus inputMode="decimal" value={text} onChange={e => setText(e.target.value)} aria-label="My share" aria-invalid={!valid} />
      </label>
      {!valid && <span style={{ fontSize: 13, fontWeight: 600, color: C.redInk }}>Enter an amount from 0 to {full(t.amount)}.</span>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        {t.share != null && (
          <button type="button" className={s.textBtnSm} onClick={() => onSave(null)} style={{ marginRight: 'auto' }}>
            Count the full amount
          </button>
        )}
        <button type="submit" className={s.btnPrimarySm} disabled={!valid}>
          Save
        </button>
      </div>
    </form>
  );
}

/** Category pill on a row: tint background, ink text, colour outline. Opens the searchable menu. */
function CategoryButton({ t, open, onToggle, plain }: { t: TxView; open: boolean; onToggle: () => void; plain?: boolean }) {
  const c = categoryByName(t.cat);
  return (
    <button
      type="button"
      className={plain ? s.catText : s.catPill}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-label={`Category for ${t.title}: ${t.cat}`}
      title={t.edited ? `Changed from ${categoryLabel(t.category)} · click to change` : 'Change category'}
      onClick={onToggle}
    >
      <span aria-hidden="true" style={{ flex: 'none', width: 7, height: 7, borderRadius: '50%', background: c?.color ?? C.textFaint, marginRight: 6 }} />
      <span className={s.catPillText}>{t.cat}</span>
      {!plain && (
        <Icon d={IC.chevDown} size={14} style={{ position: 'absolute', right: 9, top: '50%', transform: `translateY(-50%)${open ? ' rotate(180deg)' : ''}`, pointerEvents: 'none' }} />
      )}
    </button>
  );
}

type MenuItem = { key: string; label: string; value?: string; icon?: string; tint?: string; ink?: string; group: 'spend' | 'other' | 'new' };

/** Searchable category list: budget categories, then "Not spending", then "New category". Arrow keys + Enter work. */
function CategoryMenu({ current, onPick, onNew }: { current: string; onPick: (cat: string) => void; onNew: (name: string) => void }) {
  const [q, setQ] = useState('');
  // Start on the current category, so Enter right away keeps it.
  const [active, setActive] = useState(() => Math.max(0, CATEGORIES.findIndex(c => c.name === current)));
  const listRef = useRef<HTMLDivElement>(null);
  const flip = useFlipUp<HTMLDivElement>({ width: 'min(300px, 100vw - 48px)' });
  const needle = q.trim().toLowerCase();
  const match = (label: string) => !needle || label.toLowerCase().includes(needle);
  const items: MenuItem[] = [
    ...CATEGORIES.filter(c => match(c.name)).map(c => ({ key: c.name, label: c.name, value: c.name, icon: c.icon, tint: c.tint, ink: c.ink, group: 'spend' as const })),
    ...OTHER_CATEGORIES.map(o => ({ o, label: categoryLabel(o) }))
      .filter(x => match(x.label))
      .map(x => ({ key: x.o, label: x.label, value: x.o, icon: x.o === 'Transfer' ? IC.transfer : x.o === 'Savings' ? IC.piggy : x.o === 'Investment' ? IC.trend : IC.coins, group: 'other' as const })),
  ];
  const exact = items.some(i => i.label.toLowerCase() === needle || i.value?.toLowerCase() === needle);
  items.push({ key: '+new', label: needle && !exact ? `Create “${q.trim()}”` : 'New category…', group: 'new' });
  const at = Math.min(active, items.length - 1);

  const choose = (i: MenuItem) => (i.group === 'new' ? onNew(exact ? '' : q.trim()) : i.value && onPick(i.value));
  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = (at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
      setActive(next);
      listRef.current?.querySelectorAll('[role=option]')[next]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(items[at]);
    }
  };

  return (
    <div ref={flip.ref} className={s.picker} style={flip.style}>
      <label className={s.pickSearch}>
        <Icon d={IC.search} size={15} color={C.textMuted} />
        <input
          autoFocus
          value={q}
          onChange={e => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKey}
          placeholder="Search or create a category"
          aria-label="Search categories"
          role="combobox"
          aria-expanded="true"
          aria-controls="cat-menu"
          aria-activedescendant={'cat-opt-' + at}
        />
      </label>
      <div ref={listRef} id="cat-menu" role="listbox" aria-label="Categories" className={s.pickList} style={{ maxHeight: 320 }}>
        {items.map((i, n) => (
          <div key={i.key}>
            {i.group === 'other' && items[n - 1]?.group !== 'other' && <div className={s.menuGroup}>Not spending</div>}
            {i.group === 'new' && n > 0 && <div style={{ borderTop: `1px solid ${C.divider}`, margin: '6px 0' }} />}
            {i.group === 'new' && n === 0 && <div style={{ padding: '6px 10px', fontSize: 13, color: C.textMuted }}>No categories match.</div>}
            <div
              id={'cat-opt-' + n}
              role="option"
              aria-selected={i.value === current}
              className={s.pickRow + (n === at ? ' ' + s.pickRowActive : '') + (i.value === current ? ' ' + s.pickRowOn : '')}
              onMouseEnter={() => setActive(n)}
              onMouseDown={e => e.preventDefault()}
              onClick={() => choose(i)}
            >
              {i.group === 'new' ? (
                <span className={s.menuIcon} style={{ background: C.accentTint, color: C.accent800 }}>
                  <Icon d={IC.plus} size={14} />
                </span>
              ) : (
                <span className={s.menuIcon} style={{ background: i.tint ?? C.divider, color: i.ink ?? C.textSoft }}>
                  <Icon d={i.icon ?? IC.coins} size={14} />
                </span>
              )}
              <span style={{ marginRight: 'auto', fontSize: 14, fontWeight: i.group === 'new' ? 700 : 600, color: i.group === 'new' ? C.accent600 : C.text }}>{i.label}</span>
              {i.value === current && <Icon d="M20 6 9 17l-5-5" size={16} color={C.accent600} />}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

