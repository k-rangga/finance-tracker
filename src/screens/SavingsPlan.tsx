import { useState, type ReactNode } from 'react';
import s from '../styles/ui.module.css';
import { Card } from '../components/ui';
import { MonthlyPlan } from './MonthlyPlan';
import { ActionPlan } from './ActionPlan';
import { IC, Icon } from '../components/Icon';
import type { Budget } from '../lib/budget';
import { paydaysFrom, type Cycle } from '../lib/cycle';
import { dayLabel, dayMonth, diffDays } from '../lib/format';
import { C } from '../lib/tokens';

/** `children` sit under the monthly plan (Subscriptions). */
type Props = { cycle: Cycle; budget: Budget; onOpenInvest: () => void; onShowTransactions: (cat: string) => void; children?: ReactNode };

export function SavingsPlan({ cycle, budget: b, onOpenInvest, onShowTransactions, children }: Props) {
  return (
    <div className={s.stack}>
      <ActionPlan cycle={cycle} budget={b} onShowTransactions={onShowTransactions} />

      <MonthlyPlan budget={b} onOpenInvest={onOpenInvest} />

      {children}

      <Paydays cycle={cycle} />
    </div>
  );
}

/** When the next pay lands, and (on request) the paydays after it, with the ones a weekend moves. */
function Paydays({ cycle }: { cycle: Cycle }) {
  const [all, setAll] = useState(false);
  const paydays = paydaysFrom(cycle.start, 7);
  const next = paydays[1];
  return (
    <Card style={{ gap: 12 }}>
      <div className={s.paydayLine}>
        <Icon d={IC.calendar} size={18} color={C.textMuted} />
        <span style={{ marginRight: 'auto', minWidth: 0 }}>
          Next payday <strong style={{ fontWeight: 600 }}>{dayLabel(next)}</strong>, in {diffDays(cycle.today, next)} days
          <span style={{ color: C.textMuted }}>
            {' '}
            · this cycle is {cycle.cycleDays} days, {dayMonth(cycle.start)} – {dayMonth(cycle.end)}
          </span>
        </span>
        <button type="button" className={s.textBtnSm} aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? 'Hide paydays' : 'Upcoming paydays'}
        </button>
      </div>
      {all && (
        <>
          <p style={{ fontSize: 13, lineHeight: 1.5, color: C.textMuted }}>
            Pay lands on the 25th. A Saturday 25th moves to Friday the 24th; a Sunday 25th moves to Friday the 23rd. Each cycle ends the day before the next payday.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {paydays.slice(1, 7).map(p => {
              const n = paydaysFrom(p, 2)[1];
              const adj = p.getDate() !== 25;
              return (
                <div key={p.toISOString()} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0', borderBottom: `1px solid ${C.divider}`, fontSize: 14 }}>
                  <span style={{ marginRight: 'auto' }}>
                    {dayLabel(p)} {p.getFullYear()}
                  </span>
                  {adj && (
                    <span className={s.badge} style={{ padding: '3px 10px', background: C.amberTint, color: C.amberInk }}>
                      25th is {new Date(p.getFullYear(), p.getMonth(), 25).toLocaleDateString('en-GB', { weekday: 'short' })} · moved
                    </span>
                  )}
                  <span style={{ minWidth: 64, textAlign: 'right', color: C.textMuted }}>{diffDays(p, n)} days</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}
