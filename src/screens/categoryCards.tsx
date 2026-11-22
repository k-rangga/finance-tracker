/**
 * Categories as Maxie's "Monthly spending dashboard" design: each everyday category as its own card (what it's
 * spent against its limit, the last 7 days, the top expenses and one Maxie suggestion), and fixed bills as a list
 * with a status tag on each, an Installments group, and Maxie's fixes inline.
 */
import { useState, type ReactNode } from 'react';
import s from '../styles/ui.module.css';
import { IC, Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { usePlans } from '../components/Plans';
import type { CatView, TxView } from '../lib/budget';
import type { Cycle } from '../lib/cycle';
import { dayMonth, sum, tidyName } from '../lib/format';
import { leftAfter } from '../lib/installments';
import { useData } from '../lib/data';
import { useSettings } from '../lib/settings';
import { storage } from '../lib/storage';
import { C } from '../lib/tokens';
import { TRANSFER_CATEGORY } from '../data/categories';
import { merchantKey } from '../data/transactions';

/** One category's numbers for this view (see Categories' makeView). */
export type CardRow = { c: CatView; cur: number; last: number; lim: number; mine: TxView[] };

const DAY_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** E-wallet and card top-ups: money moved, not spent. */
const TOPUP = /\b(top ?up|topup|isi saldo|reload|tarik tunai)\b/i;

/** Remembered "no thanks" on a Maxie suggestion (this device, this cycle). */
function useDismissed(key: string): [boolean, () => void] {
  const [gone, setGone] = useState(() => storage.getRaw('moneyTracker.dismiss.' + key) === '1');
  return [
    gone,
    () => {
      storage.setRaw('moneyTracker.dismiss.' + key, '1');
      setGone(true);
    },
  ];
}

/** Maxie's note inside a card: the mark, one or two serif sentences, a primary action and a quiet one. */
export function MaxieNote({ text, actions }: { text: ReactNode; actions: { label: ReactNode; onClick: () => void; primary?: boolean }[] }) {
  return (
    <div className={s.mxNote}>
      <Logo size={24} />
      <div className={s.mxNoteMain}>
        <p>{text}</p>
        {actions.length > 0 && (
          <div className={s.mxActions}>
            {actions.map((a, i) =>
              a.primary ? (
                <button key={i} type="button" className={s.btnPrimarySm} onClick={a.onClick}>
                  {a.label}
                </button>
              ) : (
                <button key={i} type="button" className={s.mxLinkBtn} onClick={a.onClick}>
                  {a.label}
                </button>
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Paid / Due 28 Nov / Not paid yet, as a small tag. */
export function StatusTag({ status, due }: { status: 'paid' | 'due' | 'none'; due?: Date }) {
  if (status === 'paid') return <span className={s.mxTag} data-tone="success">Paid</span>;
  return <span className={s.mxTag}>{status === 'due' && due ? `Due ${dayMonth(due)}` : 'Not paid yet'}</span>;
}

/** The top three places (merchants) in a list of spending, with how many times and how much. */
function topPlaces(mine: TxView[]) {
  const by = new Map<string, { what: string; count: number; amount: number }>();
  for (const t of mine) {
    const k = merchantKey(t.title) || t.title;
    const x = by.get(k) ?? { what: tidyName(t.title.replace(/ \(\d+\/\d+\)( interest)?$/, '')), count: 0, amount: 0 };
    x.count++;
    x.amount += t.net;
    by.set(k, x);
  }
  return [...by.values()].sort((a, b) => b.amount - a.amount).slice(0, 3);
}

function PlaceList({ places }: { places: { what: string; count: number; amount: number }[] }) {
  const { full } = useSettings();
  return (
    <ul className={s.mxList}>
      {places.map(p => (
        <li key={p.what}>
          <span className={s.mxWhat}>{p.what}</span>
          {p.count > 1 && <span className={s.mxCount}>{p.count}×</span>}
          <span className={s.mxAmt}>{full(p.amount)}</span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------------------------- everyday

/**
 * An everyday category as a card: icon, name and "spent of limit", then what's left or how much over, and a
 * meter. Opened: the last 7 days, the top expenses, and one suggestion from Maxie (move a top-up out, or cover
 * an overspend from the category with the most room).
 */
export function BudgetCard({
  r,
  cycle,
  open,
  onToggle,
  donors,
  onMove,
  onShowTransactions,
  onEditCategory,
  extra,
}: {
  r: CardRow;
  cycle: Cycle;
  open: boolean;
  onToggle: () => void;
  donors: { name: string; room: number }[];
  onMove: (from: string, amount: number) => void;
  onShowTransactions: (cat: string) => void;
  onEditCategory: (name: string) => void;
  /** Anything more for the opened card (sub-categories, the no-spend challenge). */
  extra?: ReactNode;
}) {
  const { full, short } = useSettings();
  const { setOverride } = useData();
  const { c, cur, lim, mine } = r;
  const over = lim > 0 && cur > lim ? cur - lim : 0;
  const [choosing, setChoosing] = useState(false);
  const [srcIdx, setSrc] = useState(0);

  // The last 7 days, today last.
  const days = Array.from({ length: 7 }, (_, i) => new Date(cycle.today.getFullYear(), cycle.today.getMonth(), cycle.today.getDate() - 6 + i));
  const week = days.map(d => ({ d, value: sum(mine.filter(t => t.date.getTime() === d.getTime()).map(t => t.net)) }));
  const wMax = Math.max(1, ...week.map(x => x.value));
  const spendDays = week.filter(x => x.value > 0).length;

  // A top-up that's most of the spending here is probably a transfer, not spending.
  const topup = mine.find(t => TOPUP.test(t.title) && t.net >= cur * 0.4 && t.net > 0);
  const [topupGone, dismissTopup] = useDismissed(`topup.${topup?.id ?? ''}`);
  const src = donors[srcIdx];
  const coverAmt = src ? Math.min(over, src.room) : 0;

  let suggestion: ReactNode = null;
  if (topup && !topupGone)
    suggestion = (
      <MaxieNote
        text={`${tidyName(topup.title)} (${full(topup.net)}) looks like a top-up to your e-wallet, not ${c.name.toLowerCase()}. Move it to Transfers? Transfers don't count against any budget.`}
        actions={[
          {
            label: (
              <>
                <Icon d={IC.transfer} size={15} /> Move to Transfers
              </>
            ),
            primary: true,
            onClick: () => setOverride(topup.id, topup.category, TRANSFER_CATEGORY),
          },
          { label: `Keep it in ${c.name}`, onClick: dismissTopup },
        ]}
      />
    );
  else if (over > 0 && src)
    suggestion = (
      <div className={s.mxNote}>
        <Logo size={24} />
        <div className={s.mxNoteMain}>
          <p>
            {coverAmt < over
              ? `Cover part of it from ${src.name}? It has ${full(src.room)} left, which brings you to ${full(over - coverAmt)} over.`
              : `Cover it from ${src.name}? It has ${full(src.room)} left, so you'd be back on budget.`}
          </p>
          {choosing && (
            <div className={s.mxSources} role="radiogroup" aria-label="Take budget from">
              {donors.map((x, i) => (
                <button
                  key={x.name}
                  type="button"
                  role="radio"
                  aria-checked={i === srcIdx}
                  className={s.mxSource}
                  data-selected={i === srcIdx || undefined}
                  onClick={() => {
                    setSrc(i);
                    setChoosing(false);
                  }}
                >
                  <span>{x.name}</span>
                  <span className={s.mxSourceLeft}>{short(x.room)} left</span>
                </button>
              ))}
            </div>
          )}
          <div className={s.mxActions}>
            <button type="button" className={s.btnPrimarySm} onClick={() => onMove(src.name, coverAmt)}>
              Cover {full(coverAmt)}
            </button>
            {!choosing && donors.length > 1 && (
              <button type="button" className={s.mxLinkBtn} onClick={() => setChoosing(true)}>
                Choose another budget
              </button>
            )}
          </div>
        </div>
      </div>
    );

  const places = topPlaces(mine);
  const one = mine.length === 1 ? mine[0] : null;
  return (
    <section id={'cat-' + c.name} className={s.mxCard} data-over={over > 0 || undefined} aria-label={`${c.name} budget`}>
      <button type="button" className={s.mxHead} aria-expanded={open} onClick={onToggle}>
        <span className={s.mxIcon} style={{ background: c.tint, color: c.ink }}>
          <Icon d={c.icon} size={19} />
        </span>
        <span className={s.mxTitles}>
          <span className={s.mxLabel}>{c.name}</span>
          <span className={s.mxSub}>
            {short(cur)} of {short(lim)}
          </span>
        </span>
        <span className={s.mxStatus} data-over={over > 0 || undefined}>
          {over > 0 && <Icon d={IC.alert} size={15} />}
          {over > 0 ? `${full(over)} over` : `${full(Math.max(0, lim - cur))} left`}
        </span>
        <Icon d={IC.chevDown} size={18} color={C.textMuted} style={{ flex: 'none', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.16s ease-out' }} />
      </button>
      <div className={s.mxMeter} style={{ background: over > 0 ? 'var(--danger-soft)' : c.tint }} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((cur / (lim || 1)) * 100)} aria-label={`${c.name} budget used`}>
        <span style={{ width: Math.min(100, (cur / (lim || 1)) * 100) + '%', background: over > 0 ? 'var(--danger)' : c.color }} />
      </div>
      {open && (
        <div className={s.mxBody}>
          {spendDays >= 3 && (
            <div className={s.mxWeek} aria-label="Last 7 days">
              {week.map(x => (
                <div key={x.d.getTime()} className={s.mxDay} title={`${DAY_NAME[x.d.getDay()]}: ${full(x.value)}`}>
                  <span className={s.mxDayVal} data-zero={!x.value || undefined}>
                    {x.value ? short(x.value) : '–'}
                  </span>
                  <span className={s.mxDayBar} style={{ height: Math.max(2, (x.value / wMax) * 56), background: x.value ? c.color : 'var(--line)' }} />
                  <span className={s.mxDayLabel}>{DAY_LETTER[x.d.getDay()]}</span>
                </div>
              ))}
            </div>
          )}
          {one ? (
            <p className={s.mxSummary}>
              One expense: <strong>{tidyName(one.title)}</strong>, {full(one.net)} on {DAY_NAME[one.date.getDay()]}.
            </p>
          ) : (
            places.length > 0 && <PlaceList places={places} />
          )}
          {mine.length === 0 && <p className={s.mxSummary}>Nothing spent here this cycle.</p>}
          {suggestion}
          {extra}
          <div className={s.mxLinks}>
            <button type="button" className={s.mxLink} onClick={() => onShowTransactions(c.name)}>
              {one ? 'See the expense' : 'See transactions'}
            </button>
            <button type="button" className={s.mxLink} onClick={() => onEditCategory(c.name)}>
              Adjust limit
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------- fixed bills

/**
 * One fixed bill: icon, name, a status tag (Paid, Due 28 Nov, Not paid yet) with one note, and the amount.
 * Opened: Maxie's fix when something's off (paid with no plan, charged twice), the monthly amount, top places and
 * how it compares with last cycle.
 */
export function BillItem({
  r,
  cycle,
  due,
  open,
  onToggle,
  marked,
  onMark,
  onAmount,
  editor,
  onShowTransactions,
}: {
  r: CardRow;
  cycle: Cycle;
  /** Bills still to come this cycle in this category, soonest first. */
  due: { date: Date; amount: number }[];
  open: boolean;
  onToggle: () => void;
  marked: boolean;
  onMark: () => void;
  onAmount: (amount: number) => void;
  /** The "Each month" amount editor. */
  editor: ReactNode;
  onShowTransactions: (cat: string) => void;
}) {
  const { full } = useSettings();
  const { c, cur, lim, mine, last } = r;
  const dueTotal = sum(due.map(x => x.amount));
  const status: 'paid' | 'due' | 'none' = cur > 0 || marked ? 'paid' : due.length ? 'due' : 'none';
  const over = lim > 0 && cur > lim ? cur - lim : 0;
  const cycleId = cycle.start.toISOString().slice(0, 10);

  // Charged twice: the same merchant and amount more than once this cycle (a yearly plan, or a mistake).
  const twice = (() => {
    const by = new Map<string, TxView[]>();
    for (const t of mine) {
      const k = merchantKey(t.title) + '|' + Math.round(t.net);
      by.set(k, [...(by.get(k) ?? []), t]);
    }
    return [...by.values()].find(list => list.length >= 2);
  })();
  const [twiceGone, dismissTwice] = useDismissed(`twice.${cycleId}.${c.name}`);
  const [noPlanGone, dismissNoPlan] = useDismissed(`noplan.${cycleId}.${c.name}`);

  const note = over ? (
    <span className={s.mxOver}>{full(over)} over plan</span>
  ) : status === 'paid' && lim === 0 ? (
    <span className={s.mxNoteText}>No monthly plan yet</span>
  ) : status === 'paid' && due.length ? (
    <span className={s.mxNoteText}>{full(dueTotal)} left to pay</span>
  ) : marked && cur === 0 ? (
    <span className={s.mxNoteText}>Ticked off by you</span>
  ) : null;

  let fix: ReactNode = null;
  if (twice && !twiceGone)
    fix = (
      <MaxieNote
        text={`${tidyName(twice[0].title)} charged you ${twice.length === 2 ? 'twice' : twice.length + ' times'} this cycle, ${full(twice[0].net)} each. One of them might be a yearly plan or a mistake.${lim > 0 && cur > lim ? ` Raise your plan to ${full(cur)}?` : ''}`}
        actions={[
          ...(lim > 0 && cur > lim ? [{ label: `Raise my plan to ${full(cur)}`, primary: true, onClick: () => onAmount(cur) }] : []),
          { label: 'See the charges', primary: !(lim > 0 && cur > lim), onClick: () => onShowTransactions(c.name) },
          { label: "It's right", onClick: dismissTwice },
        ]}
      />
    );
  else if (status === 'paid' && lim === 0 && cur > 0 && !noPlanGone)
    fix = (
      <MaxieNote
        text={`You paid ${full(cur)} for ${c.name.toLowerCase()} this cycle. Want me to plan that amount every month so I can remind you before it's due?`}
        actions={[
          { label: `Plan ${full(cur)} a month`, primary: true, onClick: () => onAmount(cur) },
          { label: 'Not now', onClick: dismissNoPlan },
        ]}
      />
    );

  const places = topPlaces(mine);
  return (
    <div className={s.mxBill} data-open={open || undefined}>
      <button type="button" className={s.mxHead} aria-expanded={open} onClick={onToggle}>
        <span className={s.mxIcon} style={{ background: 'var(--surface-200)', color: 'var(--ink)' }}>
          <Icon d={c.icon} size={19} />
        </span>
        <span className={s.mxTitles} style={{ gap: 4 }}>
          <span className={s.mxLabel}>{c.name}</span>
          <span className={s.mxMeta}>
            <StatusTag status={status} due={due[0]?.date} />
            {note}
          </span>
        </span>
        <span className={s.mxBillAmt} data-unpaid={status !== 'paid' || undefined}>
          {full(status === 'paid' ? cur || lim : status === 'due' ? dueTotal : lim)}
        </span>
        <Icon d={IC.chevDown} size={18} color={C.textMuted} style={{ flex: 'none', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.16s ease-out' }} />
      </button>
      {open && (
        <div className={s.mxBillBody}>
          {fix}
          {editor}
          {cur === 0 && (
            <button type="button" className={s.btnOutlineSm} style={{ alignSelf: 'flex-start' }} onClick={onMark}>
              {marked ? 'Mark as not paid' : 'Mark as paid'}
            </button>
          )}
          {places.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span className={s.mxSubHead}>Top places</span>
              <PlaceList places={places} />
            </div>
          )}
          {last > 0 && (
            <p className={s.mxCompare}>
              Last cycle at this point you'd spent {full(last)} on {c.name.toLowerCase()}.
            </p>
          )}
          <div className={s.mxLinks}>
            <button type="button" className={s.mxLink} onClick={() => onShowTransactions(c.name)}>
              See transactions
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Installments as one group in Fixed bills: every plan with a payment this cycle, from the same schedule as Next
 * cycle and the transactions. The payments count in their own categories; this is where you see them together.
 */
export function InstallmentsGroup({ cycle, open, onToggle }: { cycle: Cycle; open: boolean; onToggle: () => void }) {
  const { full } = useSettings();
  const { views, openSchedule } = usePlans();
  const rows = views
    .map(p => ({ p, pay: p.payments.find(x => x.date >= cycle.start && x.date <= cycle.end) }))
    .filter((x): x is { p: (typeof views)[number]; pay: NonNullable<(typeof x)['pay']> } => !!x.pay)
    .sort((a, b) => a.pay.date.getTime() - b.pay.date.getTime());
  if (!rows.length) return null;
  const paid = rows.filter(x => x.pay.date <= cycle.today);
  const nextDue = rows.find(x => x.pay.date > cycle.today);
  const total = sum(rows.map(x => x.pay.amount));
  return (
    <div className={s.mxBill} data-open={open || undefined}>
      <button type="button" className={s.mxHead} aria-expanded={open} onClick={onToggle}>
        <span className={s.mxIcon} style={{ background: 'var(--surface-200)', color: 'var(--ink)' }}>
          <Icon d={IC.card} size={19} />
        </span>
        <span className={s.mxTitles} style={{ gap: 4 }}>
          <span className={s.mxLabel}>Installments</span>
          <span className={s.mxMeta}>
            <StatusTag status={nextDue ? 'due' : 'paid'} due={nextDue?.pay.date} />
            <span className={s.mxNoteText}>
              {paid.length} of {rows.length} paid this cycle
            </span>
          </span>
        </span>
        <span className={s.mxBillAmt} data-unpaid={!!nextDue || undefined}>
          {full(total)}
        </span>
        <Icon d={IC.chevDown} size={18} color={C.textMuted} style={{ flex: 'none', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.16s ease-out' }} />
      </button>
      {open && (
        <div className={s.mxBillBody}>
          <ul className={s.mxItems}>
            {rows.map(({ p, pay }) => {
              const isPaid = pay.date <= cycle.today;
              return (
                <li key={p.key}>
                  <button type="button" className={s.mxItemBtn} onClick={() => openSchedule(p.key)}>
                    <span className={s.mxTitles}>
                      <span className={s.mxItemName}>{p.title}</span>
                      <span className={s.mxNoteText}>
                        {p.category}, {p.account}, {pay.n} of {p.months}, {isPaid ? 'paid' : 'due'} {dayMonth(pay.date)}, {full(leftAfter(p, pay.date))} left
                      </span>
                    </span>
                    <StatusTag status={isPaid ? 'paid' : 'due'} due={pay.date} />
                    <span className={s.mxBillAmt} data-unpaid={!isPaid || undefined}>
                      {full(pay.amount)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <span className={s.mxCompare}>Each payment counts in its own category. Tap one for its full schedule.</span>
        </div>
      )}
    </div>
  );
}

/** Paid and planned for the Installments group this cycle, for the Fixed bills total. */
export function useInstallmentTotals(cycle: Cycle) {
  const { views } = usePlans();
  const pays = views.flatMap(p => p.payments.filter(x => x.date >= cycle.start && x.date <= cycle.end));
  return { paid: sum(pays.filter(x => x.date <= cycle.today).map(x => x.amount)), planned: sum(pays.map(x => x.amount)) };
}
