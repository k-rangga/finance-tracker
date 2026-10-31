import { useEffect, useState } from 'react';
import s from '../styles/ui.module.css';
import { Badge, IconChip, Pills } from '../components/ui';
import { IC, Icon } from '../components/Icon';
import { categoryStatus, changeBadge, iconChip, type Budget, type CatView, type TxView } from '../lib/budget';
import type { Cycle } from '../lib/cycle';
import { dayMonth, pc, sum, tidyName } from '../lib/format';
import { useSettings } from '../lib/settings';
import { useIsPhone } from '../lib/media';
import { C } from '../lib/tokens';
import { builtInCategory, catFilter } from '../data/categories';

type Mode = 'cycle' | 'week';

type Props = {
  cycle: Cycle;
  budget: Budget;
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

/** A change to category limits (% of income): built-in ones are stored as overrides, yours on the category. */
function useSetLimits() {
  const { settings, update } = useSettings();
  return (patch: Record<string, number>) => {
    const limits = { ...settings.limitOverrides };
    let customs = settings.customCategories;
    for (const [name, pct] of Object.entries(patch)) {
      const b = builtInCategory(name);
      if (!b) customs = customs.map(c => (c.name === name ? { ...c, limitPct: pct } : c));
      // Only store what differs from the default, so defaults can still change later.
      else if (Math.abs(pct - b.limitPct) < 1e-9) delete limits[name];
      else limits[name] = pct;
    }
    update({ limitOverrides: limits, customCategories: customs });
  };
}

export function Categories({ cycle, budget, open, setOpen, onShowTransactions, onEditCategory, onNewCategory }: Props) {
  const { settings, full, short, ofIncome } = useSettings();
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
  const fixed = mode === 'cycle' ? budget.cats.filter(c => c.type === 'fixed').map(view) : [];
  const varSpent = sum(variable.map(r => r.cur));
  const varLimit = sum(variable.map(r => r.lim));

  /**
   * Over its limit (cycle view only): the variable category with the most room left can cover it, moving that
   * much of its limit across, so the total budget stays the same.
   */
  const coverFor = (r: Row) => {
    if (mode !== 'cycle' || r.c.type !== 'variable' || r.cur <= r.lim) return undefined;
    const from = variable.filter(x => x !== r && x.lim - x.cur > 0).sort((x, y) => y.lim - y.cur - (x.lim - x.cur))[0];
    if (!from) return undefined;
    const amount = Math.min(r.cur - r.lim, from.lim - from.cur);
    return {
      from: from.c.name,
      amount,
      run: () => {
        // In % of income, rounded up so the category is covered in full.
        const pct = Math.ceil((amount / ofIncome(1)) * 100) / 100;
        setLimits({ [r.c.name]: r.c.limitPct + pct, [from.c.name]: Math.max(0, from.c.limitPct - pct) });
        setToast({ text: `${from.c.name} → ${r.c.name}: ${short(amount)} of its limit`, undo: () => setLimits({ [r.c.name]: r.c.limitPct, [from.c.name]: from.c.limitPct }) });
      },
    };
  };

  const toggle = (name: string) => setOpen(open === name ? null : name);
  const row = (r: Row) => (
    <CategoryRow
      key={r.c.name}
      r={r}
      mode={mode}
      cycle={cycle}
      open={open === r.c.name}
      onToggle={() => toggle(r.c.name)}
      cover={coverFor(r)}
      onShowTransactions={onShowTransactions}
      onEditCategory={onEditCategory}
    />
  );

  return (
    <div className={s.splitGrid}>
      <div className={s.splitMain} style={{ gap: 16 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Pills
            label="Compare"
            items={[
              ['cycle', 'Cycle'],
              ['week', 'Week'],
            ]}
            value={mode}
            onChange={m => {
              setMode(m);
              setOpen(null);
            }}
          />
          <button type="button" className={s.btnOutline} onClick={onNewCategory} style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon d={IC.plus} size={15} /> New category
          </button>
        </div>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2 className={s.catSection}>
            {mode === 'cycle' ? 'Variable spending' : `Variable · week ${wi + 1}`} · <span style={{ color: C.text }}>{fit(varSpent)}</span> of {fit(varLimit)}
            {varLimit > 0 && (
              <span style={{ color: varSpent > varLimit ? C.redInk : C.textMuted }}>
                {' '}
                · {varSpent > varLimit ? `${short(varSpent - varLimit)} over` : `${short(varLimit - varSpent)} left`}
              </span>
            )}
          </h2>
          <div className={s.cardFlush} style={{ padding: '4px 0' }}>
            {used.length === 0 && <div style={{ padding: '16px 20px', fontSize: 14, color: C.textMuted }}>Nothing spent yet {mode === 'cycle' ? 'this cycle' : 'this week'}.</div>}
            {used.map(row)}
            {unused.length > 0 && (
              <>
                <button type="button" className={s.catFold} aria-expanded={showUnused} onClick={() => setShowUnused(!showUnused)}>
                  <Icon d={IC.chevDown} size={14} style={{ transform: showUnused ? 'rotate(180deg)' : 'none' }} />
                  Not used yet ({unused.length}) · {unused.map(r => r.c.name).join(', ')}
                </button>
                {showUnused && unused.map(row)}
              </>
            )}
          </div>
        </section>

        {fixed.length > 0 && (
          <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h2 className={s.catSection}>
              Fixed bills · <span style={{ color: C.text }}>{fit(sum(fixed.map(r => r.cur)))}</span> paid of {fit(sum(fixed.map(r => r.lim)))}
            </h2>
            <div className={s.cardFlush} style={{ padding: '4px 0' }}>
              {billOrder(fixed, budget).map(r => (
                <BillRow key={r.c.name} r={r} budget={budget} cycle={cycle} open={open === r.c.name} onToggle={() => toggle(r.c.name)} onShowTransactions={onShowTransactions} onEditCategory={onEditCategory} />
              ))}
            </div>
          </section>
        )}
        {mode === 'week' && <span style={{ fontSize: 13, color: C.textMuted, padding: '0 4px' }}>Fixed bills are monthly, so they're only in the cycle view.</span>}
      </div>

      {/* Phones: Summary already has the totals, and the rows above say what's over. */}
      {!phone && <CategoriesPanel cycle={cycle} budget={budget} mode={mode} rows={[...variable, ...fixed]} onPick={name => setOpen(name)} />}
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

/** One line per category: name, amount of limit and the share used; the bar underneath (on phones). */
function CategoryRow({
  r,
  mode,
  cycle,
  open,
  onToggle,
  cover,
  onShowTransactions,
  onEditCategory,
}: {
  r: Row;
  mode: Mode;
  cycle: Cycle;
  open: boolean;
  onToggle: () => void;
  cover?: { from: string; amount: number; run: () => void };
  onShowTransactions: (cat: string) => void;
  onEditCategory: (name: string) => void;
}) {
  const { full, short } = useSettings();
  const phone = useIsPhone();
  // Phones: "1.0M / 300K", so the name keeps its room.
  const fit = (v: number) => (phone ? short(v).replace(/^Rp\s?/, '') : full(v));
  const { c, cur, last, lim, used, st, scale, mine } = r;
  const toSort = c.name === UNSORTED ? mine.length : 0;
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
          <ChangeChip cur={cur} last={last} />
        </span>
        <span className={s.catBar} title={last > 0 ? `Last ${mode === 'cycle' ? 'cycle by now' : 'week'}: ${full(last)}` : undefined}>
          <span className={s.track} style={{ display: 'block', height: 6 }}>
            <span className={s.fill} style={{ width: pc((cur / scale) * 100), background: st.bar }} />
            {/* The limit only needs marking once you're past it. */}
            {cur > lim && <span className={s.tick} style={{ left: pc((lim / scale) * 100) }} />}
            {last > 0 && <span className={s.lastMark} style={{ left: pc((Math.min(last, scale) / scale) * 100) }} />}
          </span>
        </span>
        <span className={s.catAmount}>
          <span style={{ fontWeight: 600, color: C.text }}>{fit(cur)}</span> / {fit(lim)}
        </span>
        <span className={s.catPct} style={{ color: st.ink }}>
          {lim ? Math.round(used) + '%' : '—'}
        </span>
        <Icon d={IC.chevDown} size={16} color={C.textMuted} style={{ gridArea: 'chev', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {toSort > 0 && !open && (
        <button type="button" className={s.catSortLink} onClick={() => onShowTransactions(c.name)}>
          {toSort} {toSort === 1 ? 'transaction' : 'transactions'} to sort <Icon d={IC.arrowRight} size={13} />
        </button>
      )}
      {open && <CategoryDetail r={r} mode={mode} cycle={cycle} cover={cover} toSort={toSort} onShowTransactions={onShowTransactions} onEditCategory={onEditCategory} />}
    </div>
  );
}

/** Fixed bills sorted for a checklist: due soonest first, then not seen yet, then paid. */
function billOrder(rows: Row[], b: Budget) {
  const due = (r: Row) => b.bills.filter(x => x.category === r.c.name).sort((x, y) => x.date.getTime() - y.date.getTime())[0];
  const key = (r: Row) => (r.cur > 0 ? 2 : due(r) ? 0 : 1);
  return [...rows].sort((x, y) => key(x) - key(y) || (due(x)?.date.getTime() ?? 0) - (due(y)?.date.getTime() ?? 0) || x.c.name.localeCompare(y.c.name));
}

/** A fixed bill: paid (✓), due on a date (from last cycle's charge), or not paid yet. */
function BillRow({
  r,
  budget: b,
  cycle,
  open,
  onToggle,
  onShowTransactions,
  onEditCategory,
}: {
  r: Row;
  budget: Budget;
  cycle: Cycle;
  open: boolean;
  onToggle: () => void;
  onShowTransactions: (cat: string) => void;
  onEditCategory: (name: string) => void;
}) {
  const { full, short } = useSettings();
  const phone = useIsPhone();
  const fit = phone ? short : full;
  const { c, cur, lim } = r;
  const due = b.bills.filter(x => x.category === c.name).sort((x, y) => x.date.getTime() - y.date.getTime());
  const dueTotal = sum(due.map(x => x.amount));
  const inDays = due[0] ? cycle.offsetOf(due[0].date) - cycle.dayIdx : 0;
  const state = cur > 0 ? 'paid' : due.length ? 'due' : 'none';
  const line =
    state === 'paid'
      ? `Paid of ${fit(lim)}` + (due.length ? ` · ${fit(dueTotal)} still due` : '')
      : state === 'due'
        ? `Due ${dayMonth(due[0].date)} · ${inDays <= 0 ? 'today' : inDays === 1 ? 'tomorrow' : `in ${inDays} days`}`
        : 'Not paid yet';
  return (
    <div id={'cat-' + c.name}>
      <button type="button" className={s.billRow} aria-expanded={open} onClick={onToggle}>
        <span className={s.billMark} data-state={state} aria-hidden="true">
          <Icon d={state === 'paid' ? 'M20 6 9 17l-5-5' : IC.calendar} size={15} strokeWidth={state === 'paid' ? 3 : 2} />
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, marginRight: 'auto' }}>
          <span style={{ fontSize: 14, fontWeight: 500 }}>{c.name}</span>
          <span style={{ fontSize: 13, whiteSpace: 'nowrap', color: state === 'paid' && cur > lim ? C.redInk : state === 'due' && inDays <= 3 ? C.amberInk : C.textMuted }}>{line}</span>
        </span>
        <span style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', color: state === 'none' ? C.textMuted : C.text }}>
          {state === 'paid' ? fit(cur) : state === 'due' ? fit(dueTotal) : fit(lim)}
        </span>
        <Icon d={IC.chevDown} size={16} color={C.textMuted} style={{ flex: 'none', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && <CategoryDetail r={r} mode="cycle" cycle={cycle} toSort={0} onShowTransactions={onShowTransactions} onEditCategory={onEditCategory} />}
    </div>
  );
}

/** Opened row: what the money went on, against last time, and what you can do about it. */
function CategoryDetail({
  r,
  mode,
  cycle,
  cover,
  toSort,
  onShowTransactions,
  onEditCategory,
}: {
  r: Row;
  mode: Mode;
  cycle: Cycle;
  cover?: { from: string; amount: number; run: () => void };
  toSort: number;
  onShowTransactions: (cat: string) => void;
  onEditCategory: (name: string) => void;
}) {
  const { full, short, settings } = useSettings();
  const { c, cur, last, mine } = r;
  const top = [...mine].sort((x, y) => y.net - x.net).slice(0, 3);
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
      {top.length === 0 ? (
        <span style={{ fontSize: 13, color: C.textMuted }}>Nothing spent here {mode === 'cycle' ? 'this cycle' : 'this week'}.</span>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span className={s.statLabel} style={{ paddingBottom: 4 }}>
            {mine.length > top.length ? `Biggest ${top.length} of ${mine.length}` : 'Spent on'}
          </span>
          {top.map(t => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '5px 0', fontSize: 14 }}>
              <span className={s.ellipsis} style={{ minWidth: 0, marginRight: 'auto' }}>
                {tidyName(t.title)}
              </span>
              <span style={{ fontSize: 13, color: C.textMuted, whiteSpace: 'nowrap' }}>{dayMonth(t.date)}</span>
              <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{full(t.net)}</span>
            </div>
          ))}
        </div>
      )}
      {last > 0 && (
        <span style={{ fontSize: 13, color: C.textMuted }}>
          {mode === 'cycle' ? `Last cycle by day ${cycle.dayN}` : 'Last week'}: {full(last)} · <span style={{ color: changeBadge(cur, last).ink, fontWeight: 600 }}>{changeBadge(cur, last).label}</span>
        </span>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {cover && (
          <button type="button" className={s.btnPrimarySm} onClick={cover.run} title={`Move ${full(cover.amount)} of ${cover.from}'s limit to ${c.name}`}>
            Cover {short(cover.amount)} from {cover.from}
          </button>
        )}
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

/** Side panel (wide screens): budget used, what needs watching, and the biggest changes against last time. */
function CategoriesPanel({ cycle, budget: b, mode, rows, onPick }: { cycle: Cycle; budget: Budget; mode: Mode; rows: Row[]; onPick: (name: string) => void }) {
  const { full, short } = useSettings();
  const spent = sum(rows.map(r => r.cur));
  const limit = sum(rows.map(r => r.lim));
  const pct = limit ? Math.round((spent / limit) * 100) : 0;
  const watch = rows.filter(r => r.st.key !== 'ok').sort((x, y) => x.st.rank - y.st.rank || y.used - x.used);
  const changes = rows
    .filter(r => r.c.type === 'variable' && r.last > 0 && Math.abs(r.cur - r.last) > 0)
    .sort((x, y) => Math.abs(y.cur - y.last) - Math.abs(x.cur - x.last))
    .slice(0, 3);
  return (
    <aside className={s.splitSide} aria-label="Categories at a glance">
      <section className={s.sideCard}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <h3 className={s.sideTitle}>Budget used</h3>
          <span style={{ fontSize: 13, color: C.textMuted }}>{mode === 'cycle' ? `Day ${cycle.dayN} of ${cycle.cycleDays}` : `Week ${cycle.weekIdx + 1}, variable only`}</span>
        </div>
        <span style={{ fontSize: 22, fontWeight: 600 }}>
          {full(spent)} <span style={{ fontSize: 14, fontWeight: 400, color: C.textMuted }}>of {full(limit)}</span>
        </span>
        <span className={s.recapTrack} style={{ height: 6 }}>
          <span style={{ width: pc(pct), background: spent > limit ? C.red : C.accent500 }} />
        </span>
        <span style={{ fontSize: 13, color: C.textMuted }}>
          {pct}% used{mode === 'cycle' && b.paceToday ? ` · pace says ${Math.round((b.paceToday / b.budget) * 100)}% by today` : ''}
        </span>
      </section>
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
