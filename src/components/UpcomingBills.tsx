import { useMemo, useState } from 'react';
import s from '../styles/ui.module.css';
import { IC, Icon } from './Icon';
import { Logo } from './Logo';
import { Select } from './Select';
import type { Cycle } from '../lib/cycle';
import { cycleKey, type PlannedCost } from '../lib/cyclePlans';
import { addDays, dayMonth, sum, tidyName, toISO } from '../lib/format';
import { useSettings } from '../lib/settings';
import { C } from '../lib/tokens';
import { CATEGORIES, categoryByName } from '../data/categories';
import type { Bill } from '../data/transactions';

type Props = {
  id?: string;
  cycle: Cycle;
  bills: Bill[];
  /** Max rows shown before "Show all" (omit to show every row). */
  limit?: number;
  /** Compact currency (e.g. Summary) vs exact currency (e.g. Transactions). */
  compact?: boolean;
  onDismiss: (b: Bill) => void;
  /** Optional 1-tap mark paid for individual fixed bills right from the list. */
  onMarkPaid?: (b: Bill) => void;
};

/**
 * Clean, consistent, minimalistic Upcoming bills card shared by Summary and Transactions:
 * vertically aligned rows, 1-tap pay / remove on bills (with Undo), and a lightweight inline "+ Add" form.
 */
export function UpcomingBills({ id, cycle, bills, limit, compact, onDismiss, onMarkPaid }: Props) {
  const { settings, update, short, full } = useSettings();
  const [showAll, setShowAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [amtText, setAmtText] = useState('');
  const defaultDate = toISO(cycle.daysLeft > 0 ? addDays(cycle.today, 1) : cycle.end);
  const [date, setDate] = useState(defaultDate);
  const [category, setCategory] = useState('Utilities');

  const idr = settings.currency === 'IDR';
  const fmt = compact ? short : full;
  const total = sum(bills.map(x => x.amount));
  const visible = limit && !showAll ? bills.slice(0, limit) : bills;

  const amount = idr ? Number(amtText.replace(/\D/g, '')) : Number(amtText.replace(/[^\d.]/g, ''));
  const valid = name.trim().length > 0 && amount > 0 && !!date;

  const catOptions = useMemo(() => {
    const fixed = CATEGORIES.filter(c => c.type === 'fixed' && !c.auto).map(c => ({ value: c.name, label: c.name }));
    const variable = CATEGORIES.filter(c => c.type === 'variable').map(c => ({ value: c.name, label: c.name }));
    return [...fixed, ...variable];
  }, []);

  const saveOneOff = () => {
    if (!valid) return;
    const key = cycleKey(cycle);
    const plans = settings.cyclePlans ?? {};
    const cur = plans[key] ?? {};
    const cost: PlannedCost = {
      id: 'cost_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      name: name.trim(),
      amount,
      date,
      category,
    };
    update({ cyclePlans: { ...plans, [key]: { ...cur, costs: [...(cur.costs ?? []), cost] } } });
    setName('');
    setAmtText('');
    setDate(defaultDate);
    setAdding(false);
  };

  return (
    <section id={id} className={s.sxChartCard} aria-label="Upcoming bills">
      <div className={s.sxChartHead}>
        <h2 className={s.sxChartTitle}>Upcoming bills</h2>
        <span className={s.ubHeadRight}>
          {bills.length > 0 && <span className={s.ubTotal}>{fmt(total)}</span>}
          <button
            type="button"
            className={s.ubAddBtn}
            aria-expanded={adding}
            onClick={() => {
              if (!adding) setDate(defaultDate);
              setAdding(v => !v);
            }}
          >
            <Icon d={adding ? IC.close : IC.plus} size={13} />
            {adding ? 'Close' : 'Add'}
          </button>
        </span>
      </div>

      {adding && (
        <form
          className={s.ubAddForm}
          onSubmit={e => {
            e.preventDefault();
            saveOneOff();
          }}
        >
          <input
            className={s.input}
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Bill name (e.g. PLN, Internet)"
            aria-label="Bill name"
            maxLength={50}
            autoFocus
          />
          <div className={s.ubAddRow}>
            <input
              className={s.input}
              inputMode="decimal"
              value={amtText}
              onChange={e => setAmtText(idr ? (Number(e.target.value.replace(/\D/g, '')) || '').toLocaleString('id-ID') : e.target.value)}
              placeholder={idr ? 'Amount (Rp)' : 'Amount ($)'}
              aria-label="Amount"
            />
            <input
              type="date"
              className={s.input}
              value={date}
              min={toISO(cycle.start)}
              max={toISO(cycle.end)}
              onChange={e => setDate(e.target.value)}
              aria-label="Due date"
            />
          </div>
          <div className={s.ubAddRow}>
            <Select ariaLabel="Category" value={category} onChange={setCategory} options={catOptions} />
            <button type="submit" className={s.btnPrimarySm} disabled={!valid} style={{ justifySelf: 'end', minHeight: 38 }}>
              Add bill
            </button>
          </div>
        </form>
      )}

      {bills.length === 0 ? (
        <div className={s.mxEmptyInline}>
          <Logo size={26} mood="happy" interactive cheer="Clear skies ahead!" />
          <span>Clear skies until payday — no bills left.</span>
        </div>
      ) : (
        <>
          <div className={s.ubList}>
            {visible.map((x, idx) => {
              const overdue = /\(overdue\)$/i.test(x.title);
              const cleanTitle = tidyName(x.title.replace(/\s*\(overdue\)$/i, ''));
              const inDays = cycle.offsetOf(x.date) - cycle.dayIdx;
              const dateLabel = overdue ? 'Overdue' : inDays <= 0 ? 'Today' : inDays === 1 ? 'Tomorrow' : dayMonth(x.date);
              return (
                <div key={`${toISO(x.date)}-${x.title}-${x.amount}-${idx}`} className={s.ubRow}>
                  <span className={s.sxLegendDot} style={{ background: categoryByName(x.category)?.color ?? C.textSoft }} />
                  <span className={s.ubTitle} title={`${cleanTitle} · ${x.category}`}>
                    {cleanTitle}
                  </span>
                  <span className={s.ubDate} data-overdue={overdue || undefined}>
                    {dateLabel}
                  </span>
                  <span className={s.ubAmt}>{fmt(x.amount)}</span>
                  {onMarkPaid && x.billId && (
                    <button
                      type="button"
                      className={s.ubPayBtn}
                      aria-label={`Mark ${cleanTitle} paid for this cycle`}
                      title="Mark paid for this cycle"
                      onClick={() => onMarkPaid(x)}
                    >
                      <Icon d={IC.check} size={13} strokeWidth={2.4} />
                    </button>
                  )}
                  <button
                    type="button"
                    className={s.ubRemove}
                    aria-label={`Remove ${cleanTitle} for this cycle`}
                    title="Skip or remove for this cycle"
                    onClick={() => onDismiss(x)}
                  >
                    <Icon d={IC.close} size={14} />
                  </button>
                </div>
              );
            })}
          </div>
          {limit != null && bills.length > limit && (
            <button type="button" className={s.textBtnSm} style={{ alignSelf: 'flex-start', padding: 0 }} onClick={() => setShowAll(v => !v)}>
              {showAll ? 'Show fewer' : `Show all ${bills.length} bills`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
