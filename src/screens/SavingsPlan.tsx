import { useState, type CSSProperties, type ReactNode } from 'react';
import s from '../styles/ui.module.css';
import { Card } from '../components/ui';
import { MonthlyPlan } from './MonthlyPlan';
import { IC, Icon } from '../components/Icon';
import type { Budget } from '../lib/budget';
import { paydaysFrom, type Cycle } from '../lib/cycle';
import { dayLabel, dayMonth, diffDays } from '../lib/format';
import { useSettings } from '../lib/settings';
import { C } from '../lib/tokens';
import { SAVINGS_TARGET_PCT } from '../data/categories';

/** `children` sit under the action plan (Subscriptions). */
type Props = { cycle: Cycle; budget: Budget; onOpenInvest: () => void; children?: ReactNode };

export function SavingsPlan({ cycle, budget: b, onOpenInvest, children }: Props) {
  const { full, short, ofIncome } = useSettings();
  const save = ofIncome(SAVINGS_TARGET_PCT);
  const gap = b.projTotal - b.budget;

  // Saved = what you moved with "Transfer (savings)"; the spending pace says how much room is left to move.
  const headline =
    b.saved >= save
      ? `Saved ${b.savedPct.toFixed(1)}% (${full(b.saved)}) this cycle. The ${SAVINGS_TARGET_PCT}% target is reached.`
      : `Saved ${b.savedPct.toFixed(1)}% (${full(b.saved)}) so far. Move ${full(save - b.saved)} more to savings to reach ${SAVINGS_TARGET_PCT}%.`;
  const summary =
    (gap > 0
      ? `At this pace spending finishes ${full(gap)} over budget, leaving room to save ${b.projSavePct.toFixed(1)}%. `
      : `At this pace you'll have room to save ${b.projSavePct.toFixed(1)}%. `) +
    `You have spent ${full(b.spent)} of your ${full(b.budget)} budget by day ${cycle.dayN} of ${cycle.cycleDays}, with ${full(b.fixedDue)} in fixed bills still due. ` +
    `Variable spending runs at ${short(b.velDay * 7)} a week; staying under ${short(b.safeDay)} a day until ${dayLabel(cycle.end)} lands the cycle on budget.`;

  const paydays = paydaysFrom(cycle.start, 7);

  // Action cards
  const actions: { title: string; body: string; over?: number }[] = [];
  b.cats
    .filter(c => c.type === 'variable' && c.name !== 'Buffer')
    .forEach(c => {
      const proj = c.spent + (c.spent / cycle.dayN) * cycle.daysLeft;
      if (proj > c.limit + 1) {
        const cap = Math.max(0, c.limit - c.spent);
        actions.push({
          title: `Cap ${c.name} at ${full(cap)}`,
          body: `${short(cap / Math.max(1, cycle.daysLeft))} a day for the last ${cycle.daysLeft} days. Your current pace would finish ${short(proj - c.limit)} over.`,
          over: proj - c.limit,
        });
      }
    });
  actions.sort((x, y) => (y.over ?? 0) - (x.over ?? 0));
  const buf = b.cats.find(c => c.name === 'Buffer');
  const bufLeft = buf ? buf.limit - buf.spent : 0;
  if (bufLeft > 0) actions.push({ title: `Keep the ${full(bufLeft)} buffer`, body: `Move whatever remains on ${dayLabel(cycle.end)} to savings and set it to Transfer (savings) to count it.` });
  actions.push({
    title: `Move ${full(save)} on ${dayLabel(cycle.next)}`,
    body: `Automate the transfer for payday morning and set it to Transfer (savings) so it counts. The remaining ${full(b.budget)} funds the next ${diffDays(paydays[1], paydays[2])}-day cycle.`,
  });

  return (
    <div className={s.stack}>
      <section style={{ background: C.accentStrong, color: C.onAccent, borderRadius: 12, padding: 32, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'rgba(255, 255, 255, 0.75)' }}>
          Action plan · {dayLabel(cycle.today)} {cycle.today.getFullYear()}
        </span>
        <h2 style={{ fontSize: 'clamp(22px, 2.6vw, 28px)', fontWeight: 600, lineHeight: 1.25, maxWidth: 820, textWrap: 'pretty' } as CSSProperties}>{headline}</h2>
        <p style={{ fontSize: 15, lineHeight: 1.5, maxWidth: 820, color: 'rgba(255, 255, 255, 0.85)' }}>{summary}</p>
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 250px), 1fr))', gap: 12 }}>
          {actions.map((a, i) => (
            <li key={a.title} style={{ background: C.surface, color: C.text, borderRadius: 10, padding: '16px 18px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <span style={{ flex: 'none', width: 30, height: 30, borderRadius: '50%', background: C.accentStrong, color: C.onAccent, display: 'grid', placeItems: 'center', fontWeight: 600, fontSize: 13 }}>
                {i + 1}
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{a.title}</span>
                <span style={{ fontSize: 13, color: C.textSoft }}>{a.body}</span>
              </div>
            </li>
          ))}
        </ol>
      </section>

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
