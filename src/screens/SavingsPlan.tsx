import type { CSSProperties } from 'react';
import s from '../styles/ui.module.css';
import { Card, CardHead, Dot } from '../components/ui';
import { IC, Icon } from '../components/Icon';
import type { Budget } from '../lib/budget';
import { paydaysFrom, type Cycle } from '../lib/cycle';
import { dayLabel, diffDays, sum } from '../lib/format';
import { useSettings } from '../lib/settings';
import { C } from '../lib/tokens';
import { SAVINGS_TARGET_PCT } from '../data/categories';

type Props = { cycle: Cycle; budget: Budget; onOpenInvest: () => void };

export function SavingsPlan({ cycle, budget: b, onOpenInvest }: Props) {
  const { full, short, ofIncome, settings } = useSettings();
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

  const fixed = b.cats.filter(c => c.type === 'fixed');
  const vari = b.cats.filter(c => c.type === 'variable');
  const fixedPct = sum(fixed.map(c => c.limitPct));
  const varPct = sum(vari.map(c => c.limitPct));

  // Savings buckets (split of the 60%)
  const investPct = Math.min(SAVINGS_TARGET_PCT, settings.investPct);
  const bigPct = Math.min(10, SAVINGS_TARGET_PCT - investPct);
  const emergencyPct = Math.max(0, SAVINGS_TARGET_PCT - investPct - bigPct);
  const buckets = [
    { name: 'Emergency fund', pct: emergencyPct, note: `Target ${full(b.budget * 6)}, six months of spending` },
    { name: 'Investing', pct: investPct, note: `${full(b.invested)} of ${full(ofIncome(investPct))} invested this cycle · moved to your brokers`, link: true },
    { name: 'Planned big costs', pct: bigPct, note: 'Travel, devices, annual fees' },
  ].filter(x => x.pct > 0);

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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))', gap: 24, alignItems: 'start' }}>
        <Card style={{ gap: 14 }}>
          <CardHead small title={`Allocation of ${full(b.income)}`} />
          <div style={{ display: 'flex', height: 20, borderRadius: 999, overflow: 'hidden', gap: 3 }} aria-hidden="true">
            <div style={{ flex: SAVINGS_TARGET_PCT, background: '#3d9a88' }} />
            <div style={{ flex: fixedPct, background: '#b4ecdf' }} />
            <div style={{ flex: varPct, background: '#6fd9c2' }} />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, fontSize: 13 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Dot color="#3d9a88" />
              Savings {SAVINGS_TARGET_PCT}%
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Dot color="#b4ecdf" />
              Fixed {fixedPct}%
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Dot color="#6fd9c2" />
              Variable {varPct}%
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <AllocRow name="Savings (moved on payday)" pct={SAVINGS_TARGET_PCT} amt={full(save)} weight={800} />
            {(
              [
                ['Fixed expenses', fixed, fixedPct],
                ['Variable expenses', vari, varPct],
              ] as const
            ).map(([label, group, pct]) => (
              <div key={label}>
                <AllocRow name={label} pct={pct} amt={full(ofIncome(pct))} weight={700} />
                {group.map(c => (
                  <AllocRow key={c.name} name={c.name} pct={c.limitPct} amt={full(c.limit)} indent />
                ))}
              </div>
            ))}
            <AllocRow name="Income" pct={100} amt={full(b.income)} weight={800} last />
          </div>
        </Card>

        <Card style={{ gap: 14 }}>
          <CardHead small title="Upcoming paydays" />
          <p style={{ fontSize: 13, lineHeight: 1.5, color: C.textMuted }}>
            Pay lands on the 25th. A Saturday 25th moves to Friday the 24th; a Sunday 25th moves to Friday the 23rd. Each cycle ends the day before the next payday.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {paydays.slice(0, 6).map((p, k) => {
              const n = paydaysFrom(p, 2)[1];
              const adj = p.getDate() !== 25;
              const isPast = k === 0;
              return (
                <div key={p.toISOString()} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderBottom: `1px solid ${C.divider}`, fontSize: 14 }}>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2, marginRight: 'auto' }}>
                    <span style={{ fontWeight: k === 1 ? 700 : 500 }}>
                      {dayLabel(p)} {p.getFullYear()}
                    </span>
                    <span style={{ fontSize: 13, color: C.textMuted }}>
                      {isPast ? 'This cycle · saved ' : 'Saves '}
                      {full(save)}
                    </span>
                  </span>
                  <span
                    className={s.badge}
                    style={{ padding: '3px 10px', background: adj ? C.amberTint : C.accentTint, color: adj ? C.amberInk : C.accent800 }}
                  >
                    {adj ? `25th is ${new Date(p.getFullYear(), p.getMonth(), 25).toLocaleDateString('en-GB', { weekday: 'short' })} · moved` : 'On the 25th'}
                  </span>
                  <span style={{ minWidth: 64, textAlign: 'right', color: C.textMuted }}>{diffDays(p, n)} days</span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <Card>
        <CardHead title="Savings buckets" caption={`How the ${SAVINGS_TARGET_PCT}% is split each payday`} />
        <div style={{ display: 'flex', height: 14, borderRadius: 999, overflow: 'hidden', gap: 3 }} aria-hidden="true">
          {buckets.map((k, i) => (
            <div key={k.name} style={{ flex: k.pct, background: [C.accent700, C.mint[5], C.mint[7]][i] }} />
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {buckets.map((k, i) => (
            <div key={k.name} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: `1px solid ${C.divider}`, flexWrap: 'wrap' }}>
              <Dot color={[C.accent700, C.mint[5], C.mint[7]][i]} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, marginRight: 'auto', minWidth: 0 }}>
                <span style={{ fontWeight: 600, fontSize: 15 }}>{k.name}</span>
                <span style={{ fontSize: 13, color: C.textMuted }}>{k.note}</span>
                {k.link && (
                  <button type="button" className={s.linkBtn} style={{ alignSelf: 'flex-start' }} onClick={onOpenInvest}>
                    Open investment journal <Icon d={IC.arrowRight} size={14} />
                  </button>
                )}
              </span>
              <span style={{ color: C.textMuted, fontSize: 14, width: 44, textAlign: 'right' }}>{k.pct}%</span>
              <span style={{ fontWeight: 600, fontSize: 14, minWidth: 120, textAlign: 'right' }}>{full(ofIncome(k.pct))}</span>
            </div>
          ))}
        </div>
        {bufLeft > 0 && (
          <div className={s.note}>
            <strong>Unspent Buffer goes to savings.</strong> {full(bufLeft)} of this cycle's buffer is still unspent; whatever remains on {dayLabel(cycle.end)} adds to the
            emergency fund.
          </div>
        )}
      </Card>
    </div>
  );
}

function AllocRow({ name, pct, amt, weight = 500, indent, last }: { name: string; pct: number; amt: string; weight?: number; indent?: boolean; last?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '9px 0', borderBottom: last ? 'none' : `1px solid ${C.divider}`, fontSize: 14, fontWeight: weight }}>
      <span style={{ marginRight: 'auto', paddingLeft: indent ? 18 : 0 }}>{name}</span>
      <span style={{ color: C.textMuted, width: 44, textAlign: 'right' }}>{pct}%</span>
      <span style={{ minWidth: 120, textAlign: 'right' }}>{amt}</span>
    </div>
  );
}
