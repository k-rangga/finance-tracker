import { useState } from 'react';
import s from '../styles/ui.module.css';
import { Modal, Options } from './ui';
import { addMonths, priceParts, type InstallmentPlan } from '../data/transactions';
import { dayMonth, fullDate, parseISO, sum, tidyName, toISO } from '../lib/format';
import { useSettings } from '../lib/settings';
import { C } from '../lib/tokens';
import type { TxView } from '../lib/budget';

const MONTH_CHOICES = [3, 6, 12] as const;

type Props = {
  /** The card purchase being paid in installments. */
  tx: TxView;
  /** The plan it already has, when editing. */
  plan?: InstallmentPlan;
  onSave: (plan: InstallmentPlan) => void;
  /** Make it one purchase again. */
  onUndo?: () => void;
  onClose: () => void;
};

/**
 * Turn a purchase into monthly payments. Amounts start as equal shares of the price; type the real ones from
 * your card statement (interest makes them differ), or fill them all at once with the same amount or a total.
 */
export function InstallmentDialog({ tx, plan, onSave, onUndo, onClose }: Props) {
  const { full, settings } = useSettings();
  const idr = settings.currency === 'IDR';
  const fmt = (v: number) => (idr ? Math.round(v).toLocaleString('id-ID') : String(Math.round(v * 100) / 100));
  const parse = (text: string) => (idr ? Number(text.replace(/\D/g, '')) : Number(text.replace(/[^\d.]/g, '')));
  const price = tx.amount;
  /** Exact amounts here (Rp 82.500, not Rp 83.000): this is where you match your statement. */
  const exact = (v: number) => (idr ? 'Rp ' + Math.round(v).toLocaleString('id-ID') : full(v));

  const [months, setMonths] = useState(plan?.amounts.length ?? 6);
  const [monthsText, setMonthsText] = useState(String(plan?.amounts.length ?? 6));
  // The first payment is usually on the next statement after the purchase.
  const [start, setStart] = useState(plan?.start ?? toISO(addMonths(tx.date, 1)));
  const [amounts, setAmounts] = useState<string[]>(() => (plan?.amounts ?? priceParts(price, 6)).map(fmt));
  const [same, setSame] = useState('');
  const [total, setTotal] = useState('');

  /** A new number of months starts again from equal shares of the price. */
  const changeMonths = (n: number) => {
    setMonths(n);
    setMonthsText(String(n));
    setAmounts(priceParts(price, n).map(fmt));
    setSame('');
    setTotal('');
  };
  const values = amounts.map(parse);
  const paid = sum(values);
  const interest = paid - price;
  /** Differences below one rupiah (or cent) are rounding. */
  const tiny = idr ? 1 : 0.01;
  const valid = months >= 1 && months <= 60 && !!start && values.every(v => Number.isFinite(v) && v >= 0) && paid > 0;
  const first = start ? parseISO(start) : tx.date;

  return (
    <Modal title="Pay in installments" onClose={onClose} width={560}>
      <span style={{ fontSize: 14, color: C.textSoft }}>
        <strong style={{ fontWeight: 600, color: C.text }}>{tidyName(tx.title)}</strong> · {full(price)} on {tx.account} · {fullDate(tx.date)}
      </span>
      <span style={{ fontSize: 13, color: C.textMuted }}>
        The purchase stops counting at once; each payment counts in the cycle it's billed. Anything above your share of the price goes to Interest &amp; fees.
      </span>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className={s.label}>Months</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Options<number> label="Months" items={MONTH_CHOICES} value={months} onChange={changeMonths} render={n => `${n} months`} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.textMuted }}>
            or
            <input
              className={s.input}
              inputMode="numeric"
              aria-label="Number of months"
              value={monthsText}
              onChange={e => {
                setMonthsText(e.target.value);
                const n = Number(e.target.value);
                if (Number.isInteger(n) && n >= 1 && n <= 60) changeMonths(n);
              }}
              style={{ width: 72 }}
            />
          </label>
        </div>
      </div>

      <label className={s.field}>
        First payment
        <input className={s.input} type="date" value={start} onChange={e => setStart(e.target.value)} style={{ maxWidth: 220 }} />
      </label>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: 12 }}>
        <label className={s.field}>
          Same amount every month
          <input
            className={s.input}
            inputMode="decimal"
            placeholder={fmt(price / months)}
            value={same}
            onChange={e => {
              setSame(e.target.value);
              setTotal('');
              const v = parse(e.target.value);
              if (e.target.value.trim() && Number.isFinite(v)) setAmounts(Array(months).fill(fmt(v)));
            }}
          />
        </label>
        <label className={s.field}>
          Or a total, interest included
          <input
            className={s.input}
            inputMode="decimal"
            placeholder={fmt(price)}
            value={total}
            onChange={e => {
              setTotal(e.target.value);
              setSame('');
              const v = parse(e.target.value);
              if (e.target.value.trim() && Number.isFinite(v)) setAmounts(priceParts(v, months).map(fmt));
            }}
          />
        </label>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className={s.label}>Each month · change any to match your statement</span>
        <div className={s.planList}>
          {amounts.map((a, i) => (
            <label key={i} className={s.planRow}>
              <span style={{ fontSize: 13, color: C.textMuted, minWidth: 0 }}>
                {i + 1}/{months} · {dayMonth(addMonths(first, i))}
              </span>
              <input
                className={s.input}
                inputMode="decimal"
                aria-label={`Payment ${i + 1} of ${months}`}
                value={a}
                onChange={e => {
                  setSame('');
                  setTotal('');
                  setAmounts(amounts.map((x, j) => (j === i ? e.target.value : x)));
                }}
                style={{ textAlign: 'right' }}
              />
            </label>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', fontSize: 14, padding: '10px 0', borderTop: `1px solid ${C.divider}` }}>
        <span style={{ color: C.textSoft }}>
          Total {exact(paid)} · price {exact(price)}
        </span>
        <span style={{ fontWeight: 600, color: interest <= -tiny ? C.redInk : interest >= tiny ? C.amberInk : C.accent800 }}>
          {interest <= -tiny ? `${exact(-interest)} less than the price` : interest >= tiny ? `${exact(interest)} interest` : 'No interest'}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        {onUndo && (
          <button type="button" className={s.btnGhost} onClick={onUndo} style={{ marginRight: 'auto', color: C.redInk }}>
            Make it one purchase again
          </button>
        )}
        <button type="button" className={s.btnOutline} onClick={onClose}>
          Cancel
        </button>
        <button type="button" className={s.btnPrimary} disabled={!valid} onClick={() => onSave({ start, amounts: values })}>
          {plan ? 'Save plan' : 'Pay in installments'}
        </button>
      </div>
    </Modal>
  );
}
