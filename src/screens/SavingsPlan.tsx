import type { Suggestion } from '../lib/subscriptions';
import { useState, type ReactNode } from 'react';
import s from '../styles/ui.module.css';
import { Card } from '../components/ui';
import { MonthlyPlan } from './MonthlyPlan';
import { ActionPlan } from './ActionPlan';
import { IC, Icon } from '../components/Icon';
import type { Budget } from '../lib/budget';
import { paydayRule, paydaysFrom, type Cycle } from '../lib/cycle';
import { dayLabel, dayMonth, diffDays, ordinal } from '../lib/format';
import { C } from '../lib/tokens';

import { NextCycle, PlannedExpenses } from './NextCycle';
import type { Bill } from '../data/transactions';

/** `children` sit under the monthly plan (Subscriptions). `view`: this cycle, or planning the next one. */
type Props = {
  cycle: Cycle;
  budget: Budget;
  onOpenInvest: () => void;
  onShowTransactions: (cat: string) => void;
  view: 'this' | 'next';
  setView: (v: 'this' | 'next') => void;
  next: Cycle;
  nextKnown: { installments: Bill[]; subscriptions: Bill[]; notAdded: Suggestion[] };
  children?: ReactNode;
};

export function SavingsPlan({ cycle, budget: b, onOpenInvest, onShowTransactions, view, setView, next, nextKnown, children }: Props) {
  const switcher = (
    <div className={s.segment} role="group" aria-label="Which cycle" style={{ alignSelf: 'flex-start' }}>
      {(['this', 'next'] as const).map(v => (
        <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>
          {v === 'this' ? 'This cycle' : 'Next cycle'}
        </button>
      ))}
    </div>
  );
  if (view === 'next')
    return (
      <div className={s.stack}>
        {switcher}
        <NextCycle cycle={cycle} next={next} budget={b} known={nextKnown} />
      </div>
    );
  return (
    <div className={s.stack}>
      {switcher}
      <ActionPlan cycle={cycle} budget={b} onShowTransactions={onShowTransactions} />

      <PlannedExpenses cycle={cycle} budget={b} />

      <MonthlyPlan budget={b} onOpenInvest={onOpenInvest} />

      {children}

      <Paydays cycle={cycle} />
    </div>
  );
}

/** When the next pay lands, and (on request) the paydays after it, with the ones a weekend moves. */
function Paydays({ cycle }: { cycle: Cycle }) {
  const [all, setAll] = useState(false);
  const rule = paydayRule();
  const paydays = paydaysFrom(cycle.start, 7);
  const next = paydays[1];
  const dayText = rule.day === 31 ? 'the last day of the month' : `the ${ordinal(rule.day)}`;
  const weekendText =
    rule.weekend === 'before'
      ? 'If it falls on a weekend, it moves to the Friday before.'
      : rule.weekend === 'after'
        ? 'If it falls on a weekend, it moves to the Monday after.'
        : 'Weekend paydays stay on the same date.';
  return (
    <Card style={{ gap: 12 }}>
      <div className={s.paydayLine}>
        <Icon d={IC.calendar} size={18} color={C.textMuted} />
        <span style={{ marginRight: 'auto', minWidth: 0 }}>
          Next payday <strong style={{ fontWeight: 600 }}>{dayLabel(next)}</strong>, in {diffDays(cycle.today, next)} days
          <span style={{ color: C.textMuted }}>
            {', '}
            this cycle is {cycle.cycleDays} days, {dayMonth(cycle.start)} – {dayMonth(cycle.end)}
          </span>
        </span>
        <button type="button" className={s.textBtnSm} aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? 'Hide paydays' : 'Upcoming paydays'}
        </button>
      </div>
      {all && (
        <>
          <p style={{ fontSize: 13, lineHeight: 1.5, color: C.textMuted }}>
            Pay lands on {dayText}. {weekendText} Each cycle ends the day before the next payday.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {paydays.slice(1, 7).map(p => {
              const n = paydaysFrom(p, 2)[1];
              const lastOfMonth = new Date(p.getFullYear(), p.getMonth() + 1, 0).getDate();
              const targetDay = Math.min(rule.day, lastOfMonth);
              const adj = p.getDate() !== targetDay;
              return (
                <div key={p.toISOString()} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0', borderBottom: `1px solid ${C.divider}`, fontSize: 14 }}>
                  <span style={{ marginRight: 'auto' }}>
                    {dayLabel(p)} {p.getFullYear()}
                  </span>
                  {adj && (
                    <span className={s.badge} style={{ padding: '3px 10px', background: C.amberTint, color: C.amberInk }}>
                      {ordinal(targetDay)} is {new Date(p.getFullYear(), p.getMonth(), targetDay).toLocaleDateString('en-GB', { weekday: 'short' })}, moved
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
