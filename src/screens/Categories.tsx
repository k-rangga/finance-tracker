import { useEffect, useState } from 'react';
import s from '../styles/ui.module.css';
import { Badge, IconChip, Pills } from '../components/ui';
import { IC, Icon } from '../components/Icon';
import { Select } from '../components/Select';
import { categoryStatus, changeBadge, iconChip, type Budget, type CatView } from '../lib/budget';
import type { Cycle } from '../lib/cycle';
import { dayMonth, pc, sum } from '../lib/format';
import { useSettings } from '../lib/settings';
import { C } from '../lib/tokens';

type Mode = 'cycle' | 'week';
/** `new` is the dropdown's "New category…" action, not a filter. */
type Group = 'all' | 'fixed' | 'variable' | 'new';

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

/** This period's numbers for one category: spent, the same span last time, its limit and status. */
const makeView = (mode: Mode, wi: number, warnAt: number) => (c: CatView) => {
  const isCycle = mode === 'cycle';
  const cur = isCycle ? c.spent : c.cur[wi];
  const last = isCycle ? c.lastSameDays : wi > 0 ? c.cur[wi - 1] : c.prev[3];
  const lim = isCycle ? c.limit : c.limit / 4;
  const used = lim ? (cur / lim) * 100 : 0;
  const st = isCycle ? c.status : categoryStatus(used, c, warnAt);
  return { c, cur, last, lim, used, st, scale: Math.max(lim, cur, last, 1) * 1.08 };
};

export function Categories({ cycle, budget, open, setOpen, onShowTransactions, onEditCategory, onNewCategory }: Props) {
  const { settings, full } = useSettings();
  const [mode, setMode] = useState<Mode>('cycle');
  const [group, setGroup] = useState<Exclude<Group, 'new'>>('all');
  const [showUnused, setShowUnused] = useState(false);
  const wi = cycle.weekIdx;

  useEffect(() => {
    if (open) document.getElementById('cat-' + open)?.scrollIntoView({ block: 'center' });
    // Only on arrival, so a category opened from Summary scrolls into view.
  }, []);

  const view = makeView(mode, wi, settings.warnAt);
  // Most attention first: over the limit, then near it, then by share of the limit used.
  const rank = (a: Row, b: Row) => a.st.rank - b.st.rank || b.used - a.used;
  const variable = budget.cats.filter(c => c.type === 'variable').map(view).sort(rank);
  const used = variable.filter(r => r.cur > 0 || r.st.key !== 'ok');
  const unused = variable.filter(r => !used.includes(r));
  const fixed = mode === 'cycle' ? budget.cats.filter(c => c.type === 'fixed').map(view) : [];
  const showFixed = group !== 'variable' && fixed.length > 0;
  const showVar = group !== 'fixed';

  const toggle = (name: string) => setOpen(open === name ? null : name);

  return (
    <div className={s.splitGrid}>
      <div className={s.splitMain} style={{ gap: 16 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
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
          <span className={s.catLegend}>
            <span className={s.catLegendTick} /> limit
            <span className={s.catLegendLast} /> {mode === 'cycle' ? `last cycle by day ${cycle.dayN}` : 'last week'}
          </span>
          <span style={{ marginLeft: 'auto' }}>
            <Select<Group>
              value={group}
              onChange={g => (g === 'new' ? onNewCategory() : setGroup(g))}
              ariaLabel="Filter categories"
              align="right"
              options={[
                { value: 'all', label: 'All categories' },
                { value: 'fixed', label: 'Fixed bills' },
                { value: 'variable', label: 'Variable' },
                { value: 'new', label: '+ New category…', group: 'Actions' },
              ]}
              style={{ width: 'auto', borderRadius: 8, fontSize: 14, padding: '9px 40px 9px 14px' }}
            />
          </span>
        </div>

        {showVar && (
          <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h2 className={s.catSection}>
              {mode === 'cycle' ? 'Variable' : `Variable · week ${wi + 1}`} · {full(sum(variable.map(r => r.cur)))} of {full(sum(variable.map(r => r.lim)))}
            </h2>
            <div className={s.cardFlush} style={{ padding: '4px 0' }}>
              {used.length === 0 && <div style={{ padding: '16px 20px', fontSize: 14, color: C.textMuted }}>Nothing spent yet {mode === 'cycle' ? 'this cycle' : 'this week'}.</div>}
              {used.map(r => (
                <CategoryRow key={r.c.name} r={r} mode={mode} open={open === r.c.name} onToggle={() => toggle(r.c.name)} onShowTransactions={onShowTransactions} onEditCategory={onEditCategory} />
              ))}
              {unused.length > 0 && (
                <>
                  <button type="button" className={s.catFold} aria-expanded={showUnused} onClick={() => setShowUnused(!showUnused)}>
                    <Icon d={IC.chevDown} size={14} style={{ transform: showUnused ? 'rotate(180deg)' : 'none' }} />
                    Not used yet ({unused.length}) · {unused.map(r => r.c.name).join(', ')}
                  </button>
                  {showUnused &&
                    unused.map(r => (
                      <CategoryRow key={r.c.name} r={r} mode={mode} open={open === r.c.name} onToggle={() => toggle(r.c.name)} onShowTransactions={onShowTransactions} onEditCategory={onEditCategory} />
                    ))}
                </>
              )}
            </div>
          </section>
        )}

        {showFixed && (
          <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h2 className={s.catSection}>
              Fixed bills · {full(sum(fixed.map(r => r.cur)))} paid of {full(sum(fixed.map(r => r.lim)))}
            </h2>
            <div className={s.cardFlush} style={{ padding: '4px 0' }}>
              {billOrder(fixed, budget).map(r => (
                <BillRow key={r.c.name} r={r} budget={budget} cycle={cycle} open={open === r.c.name} onToggle={() => toggle(r.c.name)} onShowTransactions={onShowTransactions} onEditCategory={onEditCategory} />
              ))}
            </div>
          </section>
        )}
        {group === 'fixed' && mode === 'week' && (
          <div className={s.cardFlush} style={{ padding: '24px', fontSize: 14, color: C.textMuted }}>
            Fixed bills are monthly, so they only appear in the cycle view.
          </div>
        )}
      </div>

      <CategoriesPanel cycle={cycle} budget={budget} mode={mode} rows={[...variable, ...fixed]} onPick={name => setOpen(name)} />
    </div>
  );
}

/** "+Rp 45K (↑ 12%)": the change as money and share; nothing when both periods are empty. */
function ChangeText({ cur, last }: { cur: number; last: number }) {
  const { short } = useSettings();
  if (cur === 0 && last === 0) return <span />;
  if (last === 0) return <span style={{ fontSize: 13, color: C.textMuted }}>new</span>;
  const ch = changeBadge(cur, last);
  const diff = cur - last;
  return (
    <span style={{ fontSize: 13, color: ch.ink, whiteSpace: 'nowrap' }}>
      {diff >= 0 ? '+' : '−'}
      {short(Math.abs(diff))} <span style={{ opacity: 0.8 }}>({ch.label})</span>
    </span>
  );
}

/** One line per category: name, bar (with last time's marker and the limit), amount, status, change. */
function CategoryRow({
  r,
  mode,
  open,
  onToggle,
  onShowTransactions,
  onEditCategory,
}: {
  r: Row;
  mode: Mode;
  open: boolean;
  onToggle: () => void;
  onShowTransactions: (cat: string) => void;
  onEditCategory: (name: string) => void;
}) {
  const { full, short } = useSettings();
  const { c, cur, last, lim, st, scale } = r;
  const left = lim - cur;
  return (
    <div id={'cat-' + c.name} style={{ background: st.rowBg }}>
      <button type="button" className={s.catRow} aria-expanded={open} onClick={onToggle}>
        <span className={s.catIcon}>
          <IconChip d={c.icon} bg={iconChip(c.name).bg} ink={iconChip(c.name).ink} size={32} iconSize={15} />
        </span>
        <span className={s.catName}>
          <span className={s.ellipsis} style={{ fontSize: 14, fontWeight: 500 }}>
            {c.name}
          </span>
          <span style={{ fontSize: 13, whiteSpace: 'nowrap', color: left >= 0 ? C.textMuted : C.redInk }}>{left >= 0 ? `${short(left)} left` : `${short(-left)} over`}</span>
        </span>
        <span className={s.catBar} title={`Last ${mode === 'cycle' ? 'cycle by now' : 'week'}: ${full(last)}`}>
          <span className={s.track} style={{ display: 'block', height: 8 }}>
            <span className={s.fill} style={{ width: pc((cur / scale) * 100), background: st.bar }} />
            <span className={s.tick} style={{ left: pc((lim / scale) * 100) }} />
            {last > 0 && <span className={s.lastMark} style={{ left: pc((last / scale) * 100) }} />}
          </span>
        </span>
        <span className={s.catAmount}>
          <span style={{ fontWeight: 500, color: C.text }}>{full(cur)}</span> / {full(lim)}
        </span>
        <span className={s.catStatus}>
          <Badge ink={st.ink}>{st.label}</Badge>
        </span>
        <span className={s.catChange}>
          <ChangeText cur={cur} last={last} />
        </span>
        <Icon d={IC.chevDown} size={16} color={C.textMuted} style={{ gridArea: 'chev', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && <CategoryDetail c={c} bar={st.bar} onShowTransactions={onShowTransactions} onEditCategory={onEditCategory} />}
    </div>
  );
}

/** Fixed bills sorted for a checklist: due soonest first, then not seen yet, then paid. */
function billOrder(rows: Row[], b: Budget) {
  const due = (r: Row) => b.bills.filter(x => x.category === r.c.name).sort((x, y) => x.date.getTime() - y.date.getTime())[0];
  const key = (r: Row) => (r.cur > 0 ? 2 : due(r) ? 0 : 1);
  return [...rows].sort((x, y) => key(x) - key(y) || (due(x)?.date.getTime() ?? 0) - (due(y)?.date.getTime() ?? 0) || x.c.name.localeCompare(y.c.name));
}

/** A fixed bill as a checklist line: paid (with how much of its limit), due on a date, or not seen yet. */
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
  const { full } = useSettings();
  const { c, cur, lim, st } = r;
  const due = b.bills.filter(x => x.category === c.name).sort((x, y) => x.date.getTime() - y.date.getTime());
  const dueTotal = sum(due.map(x => x.amount));
  const inDays = due[0] ? cycle.offsetOf(due[0].date) - cycle.dayIdx : 0;
  const state = cur > 0 ? 'paid' : due.length ? 'due' : 'none';
  const line =
    state === 'paid'
      ? `Paid ${full(cur)} of ${full(lim)}` + (due.length ? ` · ${full(dueTotal)} still due` : '')
      : state === 'due'
        ? `Due ${dayMonth(due[0].date)} · ${inDays <= 0 ? 'today' : inDays === 1 ? 'tomorrow' : `in ${inDays} days`}`
        : 'Nothing yet this cycle';
  return (
    <div id={'cat-' + c.name} style={{ background: st.key === 'over' ? st.rowBg : undefined }}>
      <button type="button" className={s.billRow} aria-expanded={open} onClick={onToggle}>
        <span className={s.billCheck} data-state={state} aria-hidden="true">
          {state === 'paid' ? <Icon d="M20 6 9 17l-5-5" size={14} strokeWidth={3} /> : state === 'due' ? <Icon d={IC.calendar} size={13} /> : null}
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, marginRight: 'auto' }}>
          <span style={{ fontSize: 14, fontWeight: 500 }}>{c.name}</span>
          <span style={{ fontSize: 13, color: state === 'paid' && cur > lim ? C.redInk : C.textMuted }}>{line}</span>
        </span>
        <span style={{ fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap', color: state === 'none' ? C.textMuted : C.text }}>
          {state === 'paid' ? full(cur) : state === 'due' ? full(dueTotal) : full(lim)}
        </span>
        <Icon d={IC.chevDown} size={16} color={C.textMuted} style={{ flex: 'none', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && <CategoryDetail c={c} bar={st.bar} onShowTransactions={onShowTransactions} onEditCategory={onEditCategory} />}
    </div>
  );
}

/** Opened row: weekly history (this cycle vs last) and links. */
function CategoryDetail({ c, bar, onShowTransactions, onEditCategory }: { c: CatView; bar: string; onShowTransactions: (cat: string) => void; onEditCategory: (name: string) => void }) {
  const { full, short } = useSettings();
  const wmax = Math.max(...c.cur, ...c.prev, 0.01);
  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 20px 16px 66px' }}>
      <span style={{ fontSize: 13, color: C.textMuted }}>Weekly · this cycle (colour) vs last cycle (grey) · limit {short(c.limit)}</span>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12, height: 72, alignItems: 'end', maxWidth: 360 }}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'end', justifyContent: 'center', height: '100%' }} title={`W${i + 1}: ${full(c.cur[i])} vs ${full(c.prev[i])}`}>
            <div style={{ width: 12, borderRadius: 999, height: pc((c.cur[i] / wmax) * 100), background: bar }} />
            <div style={{ width: 12, borderRadius: 999, height: pc((c.prev[i] / wmax) * 100), background: C.grey }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12, fontSize: 13, textAlign: 'center', color: C.textMuted, maxWidth: 360 }}>
        {[1, 2, 3, 4].map(i => (
          <span key={i}>W{i}</span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <button type="button" className={s.linkBtn} onClick={() => onShowTransactions(c.name)}>
          See {c.name.toLowerCase()} transactions <Icon d={IC.arrowRight} size={14} />
        </button>
        <button type="button" className={s.linkBtn} onClick={() => onEditCategory(c.name)}>
          {c.custom ? 'Edit category' : 'Edit limit or colour'}
        </button>
      </div>
    </div>
  );
}

/** Side panel: budget used, what needs watching, and the biggest changes against last time. */
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
      <section className={s.sideCard}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <h3 className={s.sideTitle}>Biggest changes</h3>
          <span style={{ fontSize: 13, color: C.textMuted }}>vs {mode === 'cycle' ? `last cycle by day ${cycle.dayN}` : 'last week'}</span>
        </div>
        {changes.length === 0 ? (
          <span style={{ fontSize: 14, color: C.textMuted }}>Nothing to compare yet.</span>
        ) : (
          <div className={s.sideList} style={{ gap: 6 }}>
            {changes.map(r => (
              <button key={r.c.name} type="button" className={s.recapRow} onClick={() => onPick(r.c.name)}>
                <span style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 14 }}>
                  <span>{r.c.name}</span>
                  <ChangeText cur={r.cur} last={r.last} />
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </aside>
  );
}
