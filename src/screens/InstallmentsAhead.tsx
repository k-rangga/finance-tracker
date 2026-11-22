import s from '../styles/ui.module.css';
import { Card } from '../components/ui';
import { plansAhead } from '../lib/installments';
import { usePlans } from '../components/Plans';
import { paydaysFrom, type Cycle } from '../lib/cycle';
import { dayMonth, tidyName } from '../lib/format';
import { useSettings } from '../lib/settings';
import { C } from '../lib/tokens';

const DAY = 86_400_000;
const monthYear = (d: Date) => d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });

/**
 * Installments already promised for the next pay cycles: what each cycle owes, when it drops because a plan
 * ends, and each plan's end date and what's left. This cycle's payments are also in Fixed bills above.
 */
export function InstallmentsAhead({ cycle }: { cycle: Cycle }) {
  const { full } = useSettings();
  const { views, openSchedule } = usePlans();
  const days = paydaysFrom(cycle.start, 5);
  const cycles = days.slice(0, 4).map((start, i) => ({ start, end: new Date(days[i + 1].getTime() - DAY) }));
  const plans = plansAhead(views, cycles, cycle.today);
  if (!plans.length) return null;
  const totals = cycles.map((_, i) => plans.reduce((a, p) => a + p.perCycle[i], 0));
  const left = plans.reduce((a, p) => a + p.left, 0);

  return (
    <Card style={{ gap: 14 }}>
      <div className={s.cardHead}>
        <h2 className={s.h2}>Installments ahead</h2>
        <span className={s.caption}>
          {full(left)} left, {plans.length} {plans.length === 1 ? 'plan' : 'plans'}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {cycles.map((c, i) => {
          const ending = i > 0 ? plans.filter(p => p.perCycle[i - 1] > 0 && p.perCycle[i] === 0) : [];
          const drop = i > 0 ? totals[i - 1] - totals[i] : 0;
          return (
            <div key={c.start.getTime()} className={s.aheadRow}>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, marginRight: 'auto', minWidth: 0 }}>
                <span style={{ fontWeight: i === 0 ? 600 : 500 }}>
                  {i === 0 ? 'This cycle' : `Payday ${dayMonth(c.start)}`}
                  <span style={{ color: C.textMuted, fontWeight: 400 }}>
                    {', '}
                    {dayMonth(c.start)} – {dayMonth(c.end)}
                  </span>
                </span>
                {ending.length > 0 && drop > 0 && (
                  <span style={{ fontSize: 13, color: C.good }}>
                    ↓ {full(drop)}: {ending.map(p => tidyName(p.title)).join(', ')} {ending.length === 1 ? 'is' : 'are'} paid off
                  </span>
                )}
              </span>
              <span style={{ fontWeight: 600, whiteSpace: 'nowrap', color: totals[i] ? C.text : C.textMuted }}>{totals[i] ? full(totals[i]) : 'None'}</span>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span className={s.eyebrow}>Plans</span>
        {plans
          .sort((a, b) => (a.last?.getTime() ?? 0) - (b.last?.getTime() ?? 0))
          .map(p => (
            <button key={p.of} type="button" className={s.aheadRow} style={{ fontSize: 14, width: '100%', background: 'none', border: 'none', font: 'inherit', color: 'inherit', textAlign: 'left', cursor: 'pointer' }} onClick={() => openSchedule(p.of)}>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, marginRight: 'auto', minWidth: 0 }}>
                <span className={s.ellipsis} style={{ fontWeight: 600 }}>
                  {tidyName(p.title)}
                </span>
                <span style={{ fontSize: 13, color: C.textMuted }}>
                  {p.account}{p.last ? `, last payment ${monthYear(p.last)}` : ''}
                </span>
              </span>
              <span style={{ whiteSpace: 'nowrap', color: C.textSoft }}>{p.left ? `${full(p.left)} left` : 'Paid off'}</span>
            </button>
          ))}
      </div>
      <span style={{ fontSize: 13, color: C.textMuted }}>Already promised: each cycle's amount is planned for you under Fixed bills → Installments.</span>
    </Card>
  );
}
