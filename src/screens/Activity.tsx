import { useEffect, useRef, useState } from 'react';
import s from '../styles/ui.module.css';
import { IconChip, Pills } from '../components/ui';
import { IC, Icon } from '../components/Icon';
import { iconColors, type Budget, type TxView } from '../lib/budget';
import type { Cycle } from '../lib/cycle';
import { dayLabel, dayMonth } from '../lib/format';
import { useSettings } from '../lib/settings';
import { C } from '../lib/tokens';
import { CATEGORIES, categoryByName, CC_PAYMENT_CATEGORY, OTHER_CATEGORIES } from '../data/categories';

export type Range = 'today' | 'week' | 'last' | 'cycle';
export type ActivityFilter = { range: Range; cat: string; q: string };

type Props = {
  cycle: Cycle;
  budget: Budget;
  filter: ActivityFilter;
  setFilter: (f: ActivityFilter) => void;
  onRecat: (id: string, orig: string, cat: string) => void;
  /** Link an income to the expense it pays back; `null` unlinks. */
  onLink: (incomeId: string, expenseId: string | null) => void;
  /** Your share of an expense as a fraction (0–1); `null` counts the full amount. */
  onShare: (txId: string, ratio: number | null) => void;
};

type Popover = 'link' | 'share';

export function Activity({ cycle, budget, filter, setFilter, onRecat, onLink, onShare }: Props) {
  const { full } = useSettings();
  /** The row with an open popover: an income's "paid back for" picker or an expense's "my share" editor. */
  const [open, setOpen] = useState<{ id: string; kind: Popover } | null>(null);
  const expenses = budget.txs.filter(t => !t.isIncome && !t.isTransfer);
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
    t => t.offset >= lo && t.offset <= hi && (!cat || t.cat === cat) && (!needle || `${t.title} ${t.account} ${t.source} ${t.cat}`.toLowerCase().includes(needle)),
  );

  const groups: { label: string; items: TxView[] }[] = [];
  for (const t of txs) {
    const label = dayLabel(t.date) + (t.offset === cycle.dayIdx ? ' (Today)' : '');
    let g = groups.find(x => x.label === label);
    if (!g) groups.push((g = { label, items: [] }));
    g.items.push(t);
  }
  const out = txs.filter(t => !t.isIncome && !t.isTransfer).reduce((a, t) => a + t.net, 0);
  const paidBack = txs.filter(t => !t.isIncome && !t.isTransfer).reduce((a, t) => a + Math.min(t.reimbursed, t.amount), 0);
  const moved = txs.filter(t => t.isTransfer && !t.isCcPayment).reduce((a, t) => a + t.amount, 0);
  const cardBills = txs.filter(t => t.isCcPayment).reduce((a, t) => a + t.amount, 0);
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
          {[...OTHER_CATEGORIES, CC_PAYMENT_CATEGORY].map(c => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', fontSize: 13, color: C.textMuted }}>
        <span aria-live="polite">
          {txs.length} {txs.length === 1 ? 'transaction' : 'transactions'} · {full(out)} spent{paidBack ? ` after ${full(paidBack)} reimbursed` : ''}{cardBills ? ` · ${full(cardBills)} card bills paid` : ''}
          {moved ? ` · ${full(moved)} moved between your accounts` : ''}
        </span>
        <span>Change a category to fix a Gmail mis-read · totals update everywhere</span>
      </div>

      {/* overflow visible: the "paid back for" picker floats past the card's edge. */}
      <div className={s.cardFlush} style={{ padding: '6px 0 10px', overflow: 'visible' }}>
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
              <TxRow
                key={t.id}
                t={t}
                onRecat={onRecat}
                onLink={onLink}
                onShare={onShare}
                expenses={expenses}
                popover={open?.id === t.id ? open.kind : null}
                setPopover={kind => setOpen(kind ? { id: t.id, kind } : null)}
              />
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
          const ic = iconColors(b.category);
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

type RowProps = {
  t: TxView;
  onRecat: Props['onRecat'];
  onLink: Props['onLink'];
  onShare: Props['onShare'];
  /** This cycle's expenses, newest first: what an income can pay back. */
  expenses: TxView[];
  popover: Popover | null;
  setPopover: (kind: Popover | null) => void;
};

function TxRow({ t, onRecat, onLink, onShare, expenses, popover, setPopover }: RowProps) {
  const { full } = useSettings();
  const c = categoryByName(t.cat);
  const ic = iconColors(t.cat);
  const textCol = useRef<HTMLDivElement>(null);
  const linked = t.reimbursesId ? expenses.find(e => e.id === t.reimbursesId) : undefined;
  const canLink = t.isIncome && !t.isSalary;
  const isExpense = !t.isIncome && !t.isTransfer;
  const picking = popover === 'link';
  const setPicking = (on: boolean) => setPopover(on ? 'link' : null);
  const toggleShare = () => setPopover(popover === 'share' ? null : 'share');

  // Close a popover on Escape or a click outside this row's text column (which holds the toggles and the popover).
  useEffect(() => {
    if (!popover) return;
    const onDown = (e: MouseEvent) => !textCol.current?.contains(e.target as Node) && setPopover(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPopover(null);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [popover, setPopover]);

  const paidBy = t.paidBackBy.join(', ');
  const shareNote = t.share != null ? `your share of ${full(t.amount)}` : '';
  const amount = t.isIncome
    ? { text: '+ ' + full(t.amount), ink: t.reimbursesId ? C.textMuted : C.accent800 }
    : t.isTransfer
      ? { text: full(t.amount), ink: C.textMuted }
      : t.reimbursed && t.net === 0
        ? { text: full(0), ink: C.textMuted, note: 'paid back by ' + paidBy }
        : t.reimbursed
          ? { text: '- ' + full(t.net), ink: C.redInk, note: `${full(t.reimbursed)} paid back by ${paidBy}` }
          : t.share != null
            ? { text: t.net === 0 ? full(0) : '- ' + full(t.net), ink: t.net === 0 ? C.textMuted : C.redInk, note: shareNote }
            : { text: '- ' + full(t.amount), ink: C.redInk };

  return (
    <div className={s.hoverRow} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 24px' }}>
      <IconChip d={c ? c.icon : t.isCcPayment ? IC.card : t.isTransfer ? IC.transfer : IC.coins} bg={ic.bg} ink={ic.ink} />
      <div ref={textCol} style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 5, marginRight: 'auto', minWidth: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 700 }}>{t.title}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12, color: C.textMuted }}>
          {t.isCcPayment ? (
            <span style={{ fontSize: 12, fontWeight: 700, color: C.text, background: C.divider, borderRadius: 999, padding: '4px 10px' }}>
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
          ) : (
            <CategorySelect t={t} onRecat={onRecat} />
          )}
          {canLink && !t.reimbursesId && (
            <button type="button" className={s.textBtnSm} aria-expanded={picking} onClick={() => setPicking(!picking)}>
              Paid back for…
            </button>
          )}
          {isExpense && (
            <button type="button" className={s.textBtnSm} aria-expanded={popover === 'share'} onClick={toggleShare}>
              {t.share != null ? 'Edit my share' : 'My share…'}
            </button>
          )}
          <span>{t.type === 'expense' ? `${t.account} · ${t.source}` : t.source}</span>
          {t.edited && <span style={{ fontWeight: 700, color: C.accent600 }}>✎ Recategorised from {t.category}</span>}
        </div>
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
        <span style={{ fontSize: 15, fontWeight: 700, color: amount.ink }}>{amount.text}</span>
        {amount.note && <span style={{ fontSize: 12, fontWeight: 700, color: C.accent800 }}>{amount.note}</span>}
        <span style={{ fontSize: 12, color: C.textMuted }}>{t.time}</span>
      </div>
    </div>
  );
}

/** Popover listing this cycle's expenses; the one with the same amount as the income is suggested first. */
function Picker({ income, expenses, onPick }: { income: TxView; expenses: TxView[]; onPick: (expenseId: string) => void }) {
  const { full } = useSettings();
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const suggested = needle ? undefined : expenses.find(e => e.amount === income.amount);
  const list = needle
    ? expenses.filter(e => `${e.title} ${e.cat} ${e.source}`.toLowerCase().includes(needle))
    : (suggested ? [suggested, ...expenses.filter(e => e !== suggested)] : expenses).slice(0, 5);
  return (
    <div className={s.picker} role="dialog" aria-label={`Expense paid back by ${income.title}`}>
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
              <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{e.title}</span>
              <span style={{ fontSize: 12, color: C.textMuted }}>
                {dayMonth(e.date)} · {e.cat}
              </span>
            </span>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.textMuted, whiteSpace: 'nowrap' }}>{full(e.amount)}</span>
          </button>
        ))}
      </div>
    </div>
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
  return (
    <form
      className={s.picker}
      role="dialog"
      aria-label={`Your share of ${t.title}`}
      onSubmit={e => {
        e.preventDefault();
        save();
      }}
      style={{ padding: 12, gap: 10 }}
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
        <span style={{ fontSize: 13, fontWeight: 700, color: C.textMuted }}>My share</span>
        <input autoFocus inputMode="decimal" value={text} onChange={e => setText(e.target.value)} aria-label="My share" aria-invalid={!valid} />
      </label>
      {!valid && <span style={{ fontSize: 12, fontWeight: 700, color: C.redInk }}>Enter an amount from 0 to {full(t.amount)}.</span>}
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

/** Pill select coloured as the chosen category (tint background, ink text, colour outline). */
function CategorySelect({ t, onRecat }: { t: TxView; onRecat: Props['onRecat'] }) {
  const c = categoryByName(t.cat);
  const ic = iconColors(t.cat);
  return (
    <span style={{ position: 'relative', display: 'inline-flex', maxWidth: '100%', minWidth: 0, color: ic.ink }}>
      <select
        className={s.catSelect}
        value={t.cat}
        onChange={e => onRecat(t.id, t.category, e.target.value)}
        aria-label={`Category for ${t.title}`}
        title="Change category"
        style={{ color: ic.ink, backgroundColor: ic.bg, border: `1.5px solid ${c?.color ?? C.accent500}` }}
      >
        {CATEGORIES.map(o => (
          <option key={o.name} value={o.name} style={{ color: o.ink, backgroundColor: o.tint }}>
            ● {o.name}
          </option>
        ))}
        <optgroup label="Not spending">
          {OTHER_CATEGORIES.map(o => (
            <option key={o} value={o}>
              {o === 'Transfer' ? 'Transfer (own accounts)' : o}
            </option>
          ))}
        </optgroup>
      </select>
      <Icon d={IC.chevDown} size={14} style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
    </span>
  );
}
