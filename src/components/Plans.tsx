/**
 * Installment plans on screen, all from one schedule (lib/installments): the plans found in your charges to
 * confirm, each plan's line in Fixed bills, and a plan's full schedule.
 */
import { createContext, useContext, useState, type ReactNode } from 'react';
import s from '../styles/ui.module.css';
import { Modal } from './ui';
import { IC, Icon } from './Icon';
import { Logo } from './Logo';
import { dayMonth, fullDate } from '../lib/format';
import { useSettings } from '../lib/settings';
import { C } from '../lib/tokens';
import { leftAfter, monthly, planEnd, type FoundInstallment, type PlanView } from '../lib/installments';
import type { Cycle } from '../lib/cycle';

type Ctx = {
  views: PlanView[];
  today: Date;
  found: FoundInstallment[];
  confirm: (f: FoundInstallment, payment: number, months: number) => void;
  dismiss: (key: string) => void;
  /** Stop tracking a detected plan (it goes back to being ordinary charges). */
  untrack: (key: string) => void;
  openSchedule: (key: string) => void;
};

export const PlansCtx = createContext<Ctx | null>(null);
export function usePlans(): Ctx {
  const c = useContext(PlansCtx);
  if (!c) throw new Error('usePlans outside PlansCtx');
  return c;
}
export const planOf = (views: PlanView[], key?: string | null) => (key ? views.find(p => p.key === key) : undefined);

const monthYear = (d: Date) => d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });

/** "12 × Rp1.250.000, ends Oct 2027": a plan on one line. */
export function planSummary(p: PlanView, full: (v: number) => string) {
  const end = planEnd(p);
  return `${p.months} × ${full(monthly(p))}${end ? `, ends ${monthYear(end)}` : ''}`;
}

/** Plans Maxie found in your charges: confirm each (and say which payment it's at), or say it isn't one. */
export function FoundInstallments() {
  const { found, confirm, dismiss } = usePlans();
  const { full } = useSettings();
  if (!found.length) return null;
  return (
    <aside className={s.insightCard} aria-label="Maxie found installments">
      <span className={s.insightHead}>
        <Logo size={28} /> Maxie noticed
      </span>
      <p className={s.insightBody} style={{ fontSize: 17, lineHeight: '26px' }}>
        {found.length === 1 ? 'This looks like an installment you pay every month.' : `These ${found.length} look like installments you pay every month.`} Confirm them and I'll
        plan each payment as a fixed bill.
      </p>
      {found.map(f => (
        <FoundRow key={f.key} f={f} full={full} onConfirm={(p, m) => confirm(f, p, m)} onDismiss={() => dismiss(f.key)} />
      ))}
    </aside>
  );
}

function FoundRow({ f, full, onConfirm, onDismiss }: { f: FoundInstallment; full: (v: number) => string; onConfirm: (payment: number, months: number) => void; onDismiss: () => void }) {
  const [payment, setPayment] = useState(String(f.payment));
  const [months, setMonths] = useState(f.months ? String(f.months) : '');
  const p = Number(payment);
  const m = Number(months);
  const ok = p >= 1 && m >= 2 && m <= 60 && p <= m;
  return (
    <div className={s.foundRow}>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ fontWeight: 600 }}>{f.name}</span>
        <span style={{ fontSize: 13, color: C.textMuted }}>
          {full(f.amount)} a month, {f.account}, last charged {dayMonth(new Date(f.latestDate + 'T00:00:00'))}
        </span>
      </span>
      <span className={s.foundFields}>
        <span style={{ fontSize: 13, color: C.textMuted }}>Latest is payment</span>
        <input className={s.input} inputMode="numeric" value={payment} onChange={e => setPayment(e.target.value.replace(/\D/g, ''))} aria-label="Which payment" style={{ width: 56, textAlign: 'center' }} />
        <span style={{ fontSize: 13, color: C.textMuted }}>of</span>
        <input className={s.input} inputMode="numeric" placeholder="12" value={months} onChange={e => setMonths(e.target.value.replace(/\D/g, ''))} aria-label="How many payments" style={{ width: 56, textAlign: 'center' }} />
      </span>
      <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className={s.btnPrimarySm} disabled={!ok} onClick={() => onConfirm(p, m)}>
          Confirm
        </button>
        <button type="button" className={s.btnGhost} onClick={onDismiss} style={{ fontSize: 14, minHeight: 36, padding: '6px 12px' }}>
          Not an installment
        </button>
      </span>
    </div>
  );
}

/** Fixed bills → Installments: one line per plan, with this cycle's payment (paid or due), which one it is and what's left. */
export function PlanLines({ cycle }: { cycle: Cycle }) {
  const { views, openSchedule } = usePlans();
  const { full } = useSettings();
  const rows = views
    .map(p => ({ p, pay: p.payments.find(x => x.date >= cycle.start && x.date <= cycle.end) }))
    .filter(x => x.pay)
    .sort((a, b) => a.pay!.date.getTime() - b.pay!.date.getTime());
  if (!rows.length) return <span style={{ fontSize: 13, color: C.textMuted }}>No installment payments this cycle.</span>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {rows.map(({ p, pay }) => {
        const paid = pay!.date <= cycle.today;
        return (
          <button key={p.key} type="button" className={s.planLineBtn} onClick={() => openSchedule(p.key)}>
            <span className={s.stepMark} data-done={paid || undefined} style={{ width: 22, height: 22, fontSize: 11 }}>
              {paid ? <Icon d={IC.check} size={12} strokeWidth={3} /> : pay!.n}
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, marginRight: 'auto', textAlign: 'left' }}>
              <span className={s.ellipsis} style={{ fontSize: 14, fontWeight: 500 }}>
                {p.title}
              </span>
              <span style={{ fontSize: 13, color: C.textMuted }}>
                {p.account}, {pay!.n} of {p.months}, {paid ? 'paid' : 'due'} {dayMonth(pay!.date)}, {full(leftAfter(p, pay!.date))} left
              </span>
            </span>
            <span style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap' }}>{full(pay!.amount)}</span>
          </button>
        );
      })}
    </div>
  );
}

/** A plan's whole schedule: every payment, ticked when paid, and what's left. */
export function ScheduleModal({ planKey, onClose }: { planKey: string; onClose: () => void }) {
  const { views, today, untrack } = usePlans();
  const { full } = useSettings();
  const p = planOf(views, planKey);
  if (!p) return null;
  const left = leftAfter(p, today);
  return (
    <Modal title={p.title} onClose={onClose} width={480}>
      <span style={{ fontSize: 14, color: C.textMuted }}>
        {p.account}, {planSummary(p, full)}. {left > 0 ? `${full(left)} left to pay.` : 'Paid off.'}
      </span>
      <ol className={s.scheduleList}>
        {p.payments.map(x => (
          <li key={x.n} data-paid={x.date <= today || undefined}>
            <span className={s.stepMark} data-done={x.date <= today || undefined} style={{ width: 22, height: 22, fontSize: 11 }}>
              {x.date <= today ? <Icon d={IC.check} size={12} strokeWidth={3} /> : x.n}
            </span>
            <span style={{ marginRight: 'auto' }}>
              Payment {x.n} of {p.months}
              <span style={{ color: C.textMuted }}>, {fullDate(x.date)}</span>
            </span>
            <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{full(x.amount)}</span>
          </li>
        ))}
      </ol>
      {p.kind === 'detected' && (
        <button
          type="button"
          className={s.textBtnSm}
          style={{ alignSelf: 'flex-start', padding: 0 }}
          onClick={() => {
            untrack(p.key);
            onClose();
          }}
        >
          Not an installment
        </button>
      )}
    </Modal>
  );
}

export function PlansProvider({ value, children }: { value: Ctx; children: ReactNode }) {
  return <PlansCtx.Provider value={value}>{children}</PlansCtx.Provider>;
}
