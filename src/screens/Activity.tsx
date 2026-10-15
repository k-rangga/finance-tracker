import s from '../styles/ui.module.css';
import { IconChip, Pills } from '../components/ui';
import { IC, Icon } from '../components/Icon';
import { iconColors, type Budget, type TxView } from '../lib/budget';
import type { Cycle } from '../lib/cycle';
import { dayLabel } from '../lib/format';
import { useSettings } from '../lib/settings';
import { C } from '../lib/tokens';
import { CATEGORIES, categoryByName, INCOME_CATEGORY } from '../data/categories';

export type Range = 'today' | 'week' | 'last' | 'cycle';
export type ActivityFilter = { range: Range; cat: string; q: string };

type Props = {
  cycle: Cycle;
  budget: Budget;
  filter: ActivityFilter;
  setFilter: (f: ActivityFilter) => void;
  onRecat: (id: string, orig: string, cat: string) => void;
};

const chevron = (hex: string) =>
  `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23${hex}' stroke-width='2.75' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`;

export function Activity({ cycle, budget, filter, setFilter, onRecat }: Props) {
  const { full } = useSettings();
  const { range, cat, q } = filter;
  const wStart = cycle.weekIdx * 7;
  const bounds: Record<Range, [number, number]> = {
    today: [cycle.dayIdx, cycle.dayIdx],
    week: [wStart, cycle.dayIdx],
    last: [Math.max(0, wStart - 7), wStart - 1],
    cycle: [0, cycle.dayIdx],
  };
  const [lo, hi] = bounds[range];
  const needle = q.trim().toLowerCase();
  const txs = budget.txs.filter(
    t => t.offset >= lo && t.offset <= hi && (!cat || t.cat === cat) && (!needle || `${t.title} ${t.source} ${t.cat}`.toLowerCase().includes(needle)),
  );

  const groups: { label: string; items: TxView[] }[] = [];
  for (const t of txs) {
    const label = dayLabel(t.date) + (t.offset === cycle.dayIdx ? ' (Today)' : '');
    let g = groups.find(x => x.label === label);
    if (!g) groups.push((g = { label, items: [] }));
    g.items.push(t);
  }
  const out = txs.filter(t => !t.isIncome).reduce((a, t) => a + t.amount, 0);
  const bills = budget.bills.filter(b => !cat || b.category === cat);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Pills
        label="Date range"
        items={[
          ['today', 'Today'],
          ['week', 'This week'],
          ['last', 'Last week'],
          ['cycle', 'This cycle'],
        ]}
        value={range}
        onChange={r => setFilter({ ...filter, range: r })}
      />
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 260px', minWidth: 0 }}>
          <Icon d={IC.search} size={16} color={C.textMuted} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
          <input
            className={s.input}
            type="search"
            value={q}
            onChange={e => setFilter({ ...filter, q: e.target.value })}
            placeholder="Search merchant, source or category"
            aria-label="Search transactions"
            style={{ borderRadius: 999, paddingLeft: 42, fontSize: 14 }}
          />
        </div>
        <select
          className={s.select}
          value={cat}
          onChange={e => setFilter({ ...filter, cat: e.target.value })}
          aria-label="Filter by category"
          style={{ width: 'auto', borderRadius: 999, fontSize: 14 }}
        >
          <option value="">All categories</option>
          {CATEGORIES.map(c => (
            <option key={c.name} value={c.name}>
              {c.name}
            </option>
          ))}
          <option value={INCOME_CATEGORY}>{INCOME_CATEGORY}</option>
        </select>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', fontSize: 13, color: C.textMuted }}>
        <span aria-live="polite">
          {txs.length} {txs.length === 1 ? 'transaction' : 'transactions'} · {full(out)} spent
        </span>
        <span>Change a category to fix a Gmail mis-read · totals update everywhere</span>
      </div>

      <div className={s.cardFlush} style={{ padding: '6px 0 10px' }}>
        {groups.length === 0 && (
          <div style={{ padding: '40px 24px', textAlign: 'center', fontSize: 14, color: C.textMuted, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <span>No transactions match these filters.</span>
            {(cat || needle || range !== 'cycle') && (
              <button type="button" className={s.btnOutline} onClick={() => setFilter({ range: 'cycle', cat: '', q: '' })}>
                Show the whole cycle
              </button>
            )}
          </div>
        )}
        {groups.map(g => (
          <div key={g.label} style={{ display: 'flex', flexDirection: 'column' }}>
            <h2 style={{ fontSize: 13, fontWeight: 700, color: C.textMuted, letterSpacing: 0, padding: '16px 24px 6px' }}>{g.label}</h2>
            {g.items.map(t => (
              <TxRow key={t.id} t={t} onRecat={onRecat} amount={(t.isIncome ? '+ ' : '- ') + full(t.amount)} />
            ))}
          </div>
        ))}
      </div>

      <section className={s.cardFlush} style={{ padding: '6px 0 10px' }}>
        <h2 className={s.h2Sm} style={{ padding: '18px 24px 8px' }}>
          Upcoming bills
        </h2>
        {bills.length === 0 && <div style={{ padding: '12px 24px 16px', fontSize: 14, color: C.textMuted }}>No more bills due before payday.</div>}
        {bills.map(b => {
          const c = categoryByName(b.category);
          const ic = iconColors(c?.type);
          const inDays = cycle.offsetOf(b.date) - cycle.dayIdx;
          return (
            <div key={b.title} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 24px' }}>
              <IconChip d={IC.calendar} bg={ic.bg} ink={ic.ink} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginRight: 'auto', minWidth: 0 }}>
                <span style={{ fontSize: 15, fontWeight: 700 }}>{b.title}</span>
                <span style={{ fontSize: 12, color: C.textMuted }}>
                  {b.category} · {b.source}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flex: 'none' }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: C.redInk }}>- {full(b.amount)}</span>
                <span style={{ fontSize: 12, color: C.textMuted }}>
                  Due {dayLabel(b.date)} · in {inDays} {inDays === 1 ? 'day' : 'days'}
                </span>
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}

function TxRow({ t, amount, onRecat }: { t: TxView; amount: string; onRecat: Props['onRecat'] }) {
  const c = categoryByName(t.cat);
  const ic = iconColors(c?.type);
  return (
    <div className={s.hoverRow} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 24px' }}>
      <IconChip d={c ? c.icon : IC.coins} bg={ic.bg} ink={ic.ink} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginRight: 'auto', minWidth: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 700 }}>{t.title}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12, color: C.textMuted }}>
          {t.isIncome ? (
            <span style={{ fontWeight: 700, color: C.accent800, background: C.accentTint, borderRadius: 999, padding: '4px 10px' }}>Income</span>
          ) : (
            <select
              value={t.cat}
              onChange={e => onRecat(t.id, t.category, e.target.value)}
              aria-label={`Category for ${t.title}`}
              title="Change category"
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: ic.ink,
                backgroundColor: ic.bg,
                backgroundImage: chevron(ic.ink.slice(1)),
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 10px center',
                appearance: 'none',
                WebkitAppearance: 'none',
                border: 'none',
                borderRadius: 999,
                padding: '6px 30px 6px 12px',
                minHeight: 30,
                cursor: 'pointer',
              }}
            >
              {CATEGORIES.map(o => (
                <option key={o.name} value={o.name}>
                  {o.name}
                </option>
              ))}
            </select>
          )}
          <span>{t.source}</span>
          {t.edited && <span style={{ fontWeight: 700, color: C.accent600 }}>✎ Recategorised from {t.category}</span>}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flex: 'none' }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: t.isIncome ? C.accent600 : C.redInk }}>{amount}</span>
        <span style={{ fontSize: 12, color: C.textMuted }}>{t.time}</span>
      </div>
    </div>
  );
}
