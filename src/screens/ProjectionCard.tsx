import { useMemo, useState } from 'react';
import s from '../styles/ui.module.css';
import { Card } from '../components/ui';
import { IC, Icon } from '../components/Icon';
import { Logo, type MaxieMood } from '../components/Logo';
import { usePlans } from '../components/Plans';
import { useData } from '../lib/data';
import { useSettings } from '../lib/settings';
import type { Cycle } from '../lib/cycle';
import type { CyclePlan } from '../lib/cyclePlans';
import { projectCycles, type ProjectedCycle, type WhatIfPurchase } from '../lib/projection';
import { dayMonth, toISO } from '../lib/format';
import { C } from '../lib/tokens';

type Props = {
  next: Cycle;
  regularIncome: number;
  legacyFixedTotal: number;
  regularEverydayTotal: number;
  regularSavings: number;
  regularInvest: number;
  firstCycleOverride: {
    inflow: number;
    fixedTotal: number;
    everydayTotal: number;
    savings: number;
    invest: number;
  };
  onAddNextCost: (name: string, amount: number) => void;
};

const HORIZONS = [3, 6, 12] as const;
const RETURNS: [number, string][] = [
  [0, '0% cash'],
  [0.05, '5% steady'],
  [0.08, '8% growth'],
];
const SPLIT_OPTIONS = [1, 3, 6, 12] as const;

const CW = 360;
const CH = 136;

/**
 * Multi-cycle Financial Projection Card (3 / 6 / 12 pay cycles): scrubbable trajectory chart, Base vs Lean or
 * "Can I Afford It?" What-If simulation, installment drop-off & yearly bill callouts, and an interactive
 * cycle-by-cycle ledger where you can drop future one-off costs or bonuses onto any upcoming payday.
 */
export function ProjectionCard({
  next,
  regularIncome,
  legacyFixedTotal,
  regularEverydayTotal,
  regularSavings,
  regularInvest,
  firstCycleOverride,
  onAddNextCost,
}: Props) {
  const { settings, update, short, full } = useSettings();
  const { views: installmentPlans } = usePlans();
  const { subscriptions } = useData();
  const idr = settings.currency === 'IDR';

  const [horizon, setHorizon] = useState<(typeof HORIZONS)[number]>(6);
  const [annualReturn, setAnnualReturn] = useState<number>(0.05);
  const [compareLean, setCompareLean] = useState(false);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);

  // "Can I Afford It?" What-If simulator state
  const [simOpen, setSimOpen] = useState(false);
  const [simName, setSimName] = useState('');
  const [simAmtText, setSimAmtText] = useState('');
  const [simMonths, setSimMonths] = useState<number>(1);
  const simAmount = idr ? Number(simAmtText.replace(/\D/g, '')) : Number(simAmtText.replace(/[^\d.]/g, ''));
  const activeWhatIf: WhatIfPurchase | null = simOpen && simAmount > 0 ? { name: simName.trim() || 'Big purchase', amount: simAmount, months: simMonths } : null;

  const baseInput = useMemo(
    () => ({
      startCycle: next,
      horizon,
      regularIncome,
      legacyFixedTotal,
      regularEverydayTotal,
      regularSavings,
      regularInvest,
      firstCycleOverride,
      cyclePlans: settings.cyclePlans,
      fixedBills: settings.fixedBills,
      installmentPlans,
      subscriptions,
      bufferPct: settings.bufferPct ?? 10,
      annualReturn,
    }),
    [
      next,
      horizon,
      regularIncome,
      legacyFixedTotal,
      regularEverydayTotal,
      regularSavings,
      regularInvest,
      firstCycleOverride,
      settings.cyclePlans,
      settings.fixedBills,
      installmentPlans,
      subscriptions,
      settings.bufferPct,
      annualReturn,
    ],
  );

  const base = useMemo(() => projectCycles(baseInput), [baseInput]);
  const alt = useMemo(() => {
    if (activeWhatIf) return projectCycles({ ...baseInput, whatIf: activeWhatIf });
    if (compareLean) return projectCycles({ ...baseInput, everydayScale: 0.85 });
    return null;
  }, [baseInput, activeWhatIf, compareLean]);

  const active = activeWhatIf && alt ? alt : base;
  const maxVal = Math.max(
    1,
    ...base.cycles.map(c => c.cumTotal),
    ...(alt ? alt.cycles.map(c => c.cumTotal) : []),
  ) * 1.1;

  const xOf = (i: number) => (base.cycles.length > 1 ? (i / (base.cycles.length - 1)) * CW : CW / 2);
  const yOf = (v: number) => CH - (Math.max(0, v) / maxVal) * (CH - 14) - 6;

  const pathOf = (list: ProjectedCycle[]) =>
    list.map((c, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)} ${yOf(c.cumTotal).toFixed(1)}`).join(' ');
  const basePath = pathOf(base.cycles);
  const baseArea = `${basePath} L${CW} ${CH} L0 ${CH} Z`;
  const altPath = alt ? pathOf(alt.cycles) : '';

  const shownIdx = hoverIdx != null && hoverIdx < base.cycles.length ? hoverIdx : null;
  const shownBase = shownIdx != null ? base.cycles[shownIdx] : null;
  const shownAlt = shownIdx != null && alt ? alt.cycles[shownIdx] : null;

  const pickPoint = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    setHoverIdx(Math.round(frac * (base.cycles.length - 1)));
  };

  // Maxie's live verdict for "Can I Afford It?"
  const whatIfVerdict: { face: MaxieMood; text: string; tone: 'good' | 'warn' | 'over' } | null = (() => {
    if (!activeWhatIf || !alt) return null;
    const perCycle = activeWhatIf.amount / activeWhatIf.months;
    if (alt.shortfallCycles > 0) {
      const hint =
        activeWhatIf.months === 1
          ? `Splitting across 6 cycles (${short(activeWhatIf.amount / 6)}/mo) might fit much more comfortably.`
          : `Try a longer split or trimming everyday spend slightly.`;
      return {
        face: 'steady',
        tone: 'over',
        text: `${activeWhatIf.name} (${short(perCycle)}/cycle) creates a shortfall in ${alt.shortfallCycles} ${alt.shortfallCycles === 1 ? 'cycle' : 'cycles'}. ${hint}`,
      };
    }
    const lowestBuf = alt.lowestBuffer?.amount ?? 0;
    const targetBuf = alt.lowestBuffer?.cycle.bufferGoal ?? 0;
    if (lowestBuf < targetBuf) {
      return {
        face: 'curious',
        tone: 'warn',
        text: `Affordable without going negative, though your buffer dips to ${short(lowestBuf)} in ${dayMonth(alt.lowestBuffer!.cycle.start)}.`,
      };
    }
    return {
      face: 'happy',
      tone: 'good',
      text: `Totally doable! Every cycle stays above your buffer goal, and you still build ${short(alt.totalAdded)} over ${horizon} cycles.`,
    };
  })();

  const updateFutureCycle = (cycleKeyStr: string, patchFn: (cur: CyclePlan) => CyclePlan) => {
    const all = settings.cyclePlans ?? {};
    const cur = all[cycleKeyStr] ?? {};
    update({ cyclePlans: { ...all, [cycleKeyStr]: patchFn(cur) } });
  };

  return (
    <Card style={{ gap: 14 }}>
      <div className={s.projHead}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginRight: 'auto' }}>
          <h2 className={s.h2}>Multi-cycle projection</h2>
          <span style={{ fontSize: 13, color: C.textMuted }}>
            Includes scheduled bills, yearly spikes, installment drop-offs &amp; compounding
          </span>
        </div>
        <div className={s.sxMiniSeg} role="group" aria-label="Projection horizon">
          {HORIZONS.map(h => (
            <button key={h} type="button" aria-pressed={horizon === h} onClick={() => setHorizon(h)}>
              {h} cycles
            </button>
          ))}
        </div>
      </div>

      {/* Summary KPIs */}
      <div className={s.projKpis}>
        <div className={s.modelKpi}>
          <span className={s.modelKpiLabel}>Projected added ({horizon}×)</span>
          <span className={s.modelKpiVal} style={{ color: C.good }}>
            +{short(active.totalAdded)}
          </span>
          <span className={s.modelKpiSub}>
            {active.compoundingGain >= (idr ? 50_000 : 5)
              ? `incl. +${short(active.compoundingGain)} growth`
              : `${short(active.totalInvest)} invested · ${short(active.totalCash)} cash`}
          </span>
        </div>
        <div className={s.modelKpi}>
          <span className={s.modelKpiLabel}>Avg savings rate</span>
          <span className={s.modelKpiVal}>{Math.round(active.avgSavingsRate)}%</span>
          <span className={s.modelKpiSub}>
            {active.shortfallCycles > 0 ? `${active.shortfallCycles} tight cycle${active.shortfallCycles === 1 ? '' : 's'}` : 'Every cycle positive'}
          </span>
        </div>
        <div className={s.modelKpi}>
          <span className={s.modelKpiLabel}>{active.debtFreeCycle ? 'Installments free' : 'Lowest buffer'}</span>
          <span className={s.modelKpiVal} style={{ color: active.debtFreeCycle ? C.good : (active.lowestBuffer?.amount ?? 0) < 0 ? C.redInk : undefined }}>
            {active.debtFreeCycle
              ? dayMonth(active.debtFreeCycle.start)
              : active.lowestBuffer
                ? short(active.lowestBuffer.amount)
                : '—'}
          </span>
          <span className={s.modelKpiSub}>
            {active.debtFreeCycle
              ? `+${short(active.freedByInstallments)}/mo freed!`
              : active.lowestBuffer
                ? `in ${dayMonth(active.lowestBuffer.cycle.start)}`
                : ''}
          </span>
        </div>
      </div>

      {/* Controls: Return rate + Lean compare + What-If simulator toggle */}
      <div className={s.projToolbar}>
        <div className={s.sxMiniSeg} role="group" aria-label="Expected annual investment return">
          {RETURNS.map(([rate, label]) => (
            <button key={rate} type="button" aria-pressed={annualReturn === rate} onClick={() => setAnnualReturn(rate)}>
              {label}
            </button>
          ))}
        </div>
        {!activeWhatIf && (
          <button
            type="button"
            className={s.modelPresetChip}
            data-on={compareLean || undefined}
            aria-pressed={compareLean}
            onClick={() => setCompareLean(v => !v)}
          >
            Compare Lean (−15%)
          </button>
        )}
        <button
          type="button"
          className={simOpen ? s.btnPrimarySm : s.btnOutlineSm}
          style={{ marginLeft: 'auto' }}
          aria-expanded={simOpen}
          onClick={() => setSimOpen(v => !v)}
        >
          <Icon d={IC.sparkle} size={13} />
          {simOpen ? 'Hide simulator' : 'Can I afford it?'}
        </button>
      </div>

      {/* Interactive "Can I Afford It?" Simulator */}
      {simOpen && (
        <div className={s.projSimBox}>
          <div className={s.fbFormGrid}>
            <label className={s.field}>
              <span>Item or goal</span>
              <input className={s.input} value={simName} onChange={e => setSimName(e.target.value)} placeholder="e.g. New laptop, Japan trip" maxLength={50} />
            </label>
            <label className={s.field}>
              <span>Price ({settings.currency})</span>
              <input
                className={s.input}
                inputMode="decimal"
                value={simAmtText}
                onChange={e => setSimAmtText(idr ? (Number(e.target.value.replace(/\D/g, '')) || '').toLocaleString('id-ID') : e.target.value)}
                placeholder={idr ? 'e.g. 15.000.000' : 'e.g. 1200'}
              />
            </label>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: C.textMuted }}>Pay over:</span>
            <div className={s.sxMiniSeg} role="group" aria-label="Payment split">
              {SPLIT_OPTIONS.map(m => (
                <button key={m} type="button" aria-pressed={simMonths === m} onClick={() => setSimMonths(m)}>
                  {m === 1 ? 'Cash (1×)' : `${m} mo`}
                </button>
              ))}
            </div>
            {activeWhatIf && (
              <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                {simMonths === 1 && (
                  <button
                    type="button"
                    className={s.btnOutlineSm}
                    onClick={() => {
                      onAddNextCost(activeWhatIf.name, activeWhatIf.amount);
                      setSimAmtText('');
                      setSimName('');
                      setSimOpen(false);
                    }}
                  >
                    Add to next cycle
                  </button>
                )}
                <button type="button" className={s.textBtnSm} style={{ padding: 0 }} onClick={() => { setSimAmtText(''); setSimName(''); }}>
                  Clear
                </button>
              </span>
            )}
          </div>
          {whatIfVerdict && (
            <div className={s.projVerdict} data-tone={whatIfVerdict.tone}>
              <Logo size={28} mood={whatIfVerdict.face} interactive cheer="Testing scenarios is smart!" />
              <span>{whatIfVerdict.text}</span>
            </div>
          )}
        </div>
      )}

      {/* Interactive Scrubbable Trajectory Chart */}
      <div
        className={s.projChartWrap}
        onPointerMove={pickPoint}
        onPointerDown={pickPoint}
        onPointerLeave={() => setHoverIdx(null)}
        onPointerCancel={() => setHoverIdx(null)}
      >
        <svg viewBox={`0 0 ${CW} ${CH}`} preserveAspectRatio="none" role="img" aria-label={`Projected cumulative savings over ${horizon} cycles: ${full(active.totalAdded)}`}>
          <path d={baseArea} fill="var(--category-1)" opacity={0.1} />
          <path d={basePath} fill="none" stroke="var(--category-1)" strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {alt && (
            <path
              d={altPath}
              fill="none"
              stroke={activeWhatIf ? (alt.shortfallCycles > 0 ? 'var(--danger)' : 'var(--amber)') : 'var(--good)'}
              strokeWidth={2}
              strokeDasharray="5 4"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {shownIdx != null && (
            <line x1={xOf(shownIdx)} x2={xOf(shownIdx)} y1={0} y2={CH} stroke="var(--line-strong)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          )}
        </svg>
        {base.cycles.map((c, i) => {
          const isMilestone = c.endedInstallments.length > 0;
          const isSpike = c.spikeBills.length > 0;
          const isActive = shownIdx === i;
          return (
            <span
              key={c.key}
              className={s.projDot}
              data-active={isActive || undefined}
              data-milestone={isMilestone || undefined}
              data-spike={!isMilestone && isSpike ? true : undefined}
              style={{ left: `${(xOf(i) / CW) * 100}%`, top: `${(yOf(c.cumTotal) / CH) * 100}%` }}
            />
          );
        })}
        {alt && shownIdx != null && (
          <span
            className={s.projDotAlt}
            style={{
              left: `${(xOf(shownIdx) / CW) * 100}%`,
              top: `${(yOf(alt.cycles[shownIdx].cumTotal) / CH) * 100}%`,
              background: activeWhatIf ? (alt.shortfallCycles > 0 ? 'var(--danger)' : 'var(--amber)') : 'var(--good)',
            }}
          />
        )}
      </div>

      <div className={s.sxDayAxis} aria-hidden="true">
        <span>{dayMonth(base.cycles[0].start)}</span>
        {base.cycles.length > 2 && <span>{dayMonth(base.cycles[Math.floor(base.cycles.length / 2)].start)}</span>}
        <span>{dayMonth(base.cycles[base.cycles.length - 1].start)}</span>
      </div>

      {/* Live Hover / Legend Readout */}
      <div className={s.projFoot}>
        {shownBase ? (
          <div className={s.projHoverInfo}>
            <strong>Payday {dayMonth(shownBase.start)}</strong>
            <span>
              Base: <strong>{short(shownBase.cumTotal)}</strong> (+{short(shownBase.netSaved)})
            </span>
            {shownAlt && (
              <span style={{ color: activeWhatIf ? (shownAlt.bufferAfterPlan < 0 ? C.redInk : C.amberInk) : C.good, fontWeight: 600 }}>
                {activeWhatIf ? activeWhatIf.name : 'Lean'}: {short(shownAlt.cumTotal)} ({shownAlt.cumTotal >= shownBase.cumTotal ? '+' : '−'}
                {short(Math.abs(shownAlt.cumTotal - shownBase.cumTotal))})
              </span>
            )}
            {shownBase.endedInstallments.length > 0 && (
              <span style={{ color: C.good, fontWeight: 600 }}>
                Freed +{short(shownBase.endedInstallments.reduce((a, x) => a + x.freed, 0))}/mo
              </span>
            )}
            {shownBase.spikeBills.length > 0 && (
              <span style={{ color: C.amberInk }}>Includes {shownBase.spikeBills.join(', ')}</span>
            )}
          </div>
        ) : (
          <div className={s.projLegend}>
            <span>
              <span className={s.projSwatch} style={{ background: 'var(--category-1)' }} /> Base plan
            </span>
            {alt && (
              <span>
                <span className={s.projSwatchDash} style={{ borderColor: activeWhatIf ? (alt.shortfallCycles > 0 ? 'var(--danger)' : 'var(--amber)') : 'var(--good)' }} />
                {activeWhatIf ? `With ${activeWhatIf.name}` : `Lean −15% (+${short(alt.totalAdded - base.totalAdded)} extra)`}
              </span>
            )}
            <span style={{ marginLeft: 'auto', color: C.textMuted }}>Hover chart to inspect each payday</span>
          </div>
        )}
      </div>

      {/* Expandable Cycle-by-Cycle Financial Model Ledger */}
      <div style={{ borderTop: `1px solid ${C.divider}`, paddingTop: 8 }}>
        <button
          type="button"
          className={s.catFold}
          style={{ border: 'none', paddingLeft: 0 }}
          aria-expanded={ledgerOpen}
          onClick={() => setLedgerOpen(v => !v)}
        >
          <Icon d={IC.chevDown} size={14} style={{ transform: ledgerOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
          {ledgerOpen ? 'Hide' : 'Show'} cycle-by-cycle model ledger ({horizon} paydays) — tap any cycle to add future costs or bonuses
        </button>

        {ledgerOpen && (
          <div className={s.projLedger}>
            <div className={s.projLedgerHead}>
              <span>Payday</span>
              <span>Inflow</span>
              <span>Committed</span>
              <span>Everyday</span>
              <span>Net saved</span>
              <span>Cumulative</span>
            </div>
            {active.cycles.map(c => (
              <div key={c.key} className={s.projLedgerWrap}>
                <button
                  type="button"
                  className={s.projLedgerRow}
                  data-shortfall={c.bufferAfterPlan < -1 || undefined}
                  aria-expanded={editingKey === c.key}
                  onClick={() => setEditingKey(editingKey === c.key ? null : c.key)}
                >
                  <span className={s.projLedgerDate}>
                    <strong>{dayMonth(c.start)}</strong>
                    <span className={s.projLedgerBadges}>
                      {c.endedInstallments.length > 0 && <span className={s.projBadgeGood}>+{short(c.endedInstallments.reduce((a, x) => a + x.freed, 0))} freed</span>}
                      {c.spikeBills.length > 0 && <span className={s.projBadgeWarn}>{c.spikeBills[0]}</span>}
                      {c.extras > 0 && <span className={s.projBadgeGood}>+{short(c.extras)} extra</span>}
                      {c.oneOffs > 0 && <span className={s.projBadgeWarn}>−{short(c.oneOffs)} one-off</span>}
                    </span>
                  </span>
                  <span>{short(c.inflow)}</span>
                  <span>{short(c.committed)}</span>
                  <span>{short(c.everyday)}</span>
                  <span style={{ color: c.bufferAfterPlan < -1 ? C.redInk : C.good, fontWeight: 600 }}>+{short(c.netSaved)}</span>
                  <span style={{ fontWeight: 650 }}>{short(c.cumTotal)}</span>
                </button>
                {editingKey === c.key && (
                  <FutureCycleEditor
                    c={c}
                    plan={settings.cyclePlans?.[c.key] ?? {}}
                    onAddCost={(name, amount) =>
                      updateFutureCycle(c.key, cur => ({
                        ...cur,
                        costs: [
                          ...(cur.costs ?? []),
                          { id: 'cost_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name, amount, date: toISO(c.start), category: 'Buffer' },
                        ],
                      }))
                    }
                    onRemoveCost={id =>
                      updateFutureCycle(c.key, cur => ({ ...cur, costs: (cur.costs ?? []).filter(x => x.id !== id) }))
                    }
                    onAddExtra={(name, amount) =>
                      updateFutureCycle(c.key, cur => ({
                        ...cur,
                        extras: [...(cur.extras ?? []), { id: 'in_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name, amount }],
                      }))
                    }
                    onRemoveExtra={id =>
                      updateFutureCycle(c.key, cur => ({ ...cur, extras: (cur.extras ?? []).filter(x => x.id !== id) }))
                    }
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

/** Inline quick-editor inside any future cycle row of the projection ledger: drop a one-off cost or bonus onto that payday. */
function FutureCycleEditor({
  c,
  plan,
  onAddCost,
  onRemoveCost,
  onAddExtra,
  onRemoveExtra,
}: {
  c: ProjectedCycle;
  plan: CyclePlan;
  onAddCost: (name: string, amount: number) => void;
  onRemoveCost: (id: string) => void;
  onAddExtra: (name: string, amount: number) => void;
  onRemoveExtra: (id: string) => void;
}) {
  const { settings, full } = useSettings();
  const idr = settings.currency === 'IDR';
  const [kind, setKind] = useState<'cost' | 'extra'>('cost');
  const [name, setName] = useState('');
  const [amtText, setAmtText] = useState('');
  const amount = idr ? Number(amtText.replace(/\D/g, '')) : Number(amtText.replace(/[^\d.]/g, ''));
  const valid = name.trim().length > 0 && amount > 0;

  return (
    <div className={s.projFutureEdit}>
      <span style={{ fontSize: 12.5, color: C.textMuted }}>
        {dayMonth(c.start)} – {dayMonth(c.end)} ({c.days} days) · Buffer after plan:{' '}
        <strong style={{ color: c.bufferAfterPlan < 0 ? C.redInk : C.good }}>{full(c.bufferAfterPlan)}</strong>
      </span>
      {(plan.extras ?? []).map(x => (
        <div key={x.id} className={s.projFutureItem}>
          <span style={{ color: C.good }}>+ {x.name}</span>
          <strong style={{ marginLeft: 'auto', color: C.good }}>{full(x.amount)}</strong>
          <button type="button" className={s.iconBtnSm} aria-label={`Remove ${x.name}`} onClick={() => onRemoveExtra(x.id)}>
            <Icon d={IC.close} size={13} />
          </button>
        </div>
      ))}
      {(plan.costs ?? []).map(x => (
        <div key={x.id} className={s.projFutureItem}>
          <span>− {x.name}</span>
          <strong style={{ marginLeft: 'auto' }}>{full(x.amount)}</strong>
          <button type="button" className={s.iconBtnSm} aria-label={`Remove ${x.name}`} onClick={() => onRemoveCost(x.id)}>
            <Icon d={IC.close} size={13} />
          </button>
        </div>
      ))}
      <form
        className={s.projFutureForm}
        onSubmit={e => {
          e.preventDefault();
          if (!valid) return;
          if (kind === 'cost') onAddCost(name.trim(), amount);
          else onAddExtra(name.trim(), amount);
          setName('');
          setAmtText('');
        }}
      >
        <div className={s.sxMiniSeg} role="group" aria-label="Entry type">
          <button type="button" aria-pressed={kind === 'cost'} onClick={() => setKind('cost')}>
            One-off cost
          </button>
          <button type="button" aria-pressed={kind === 'extra'} onClick={() => setKind('extra')}>
            Extra inflow
          </button>
        </div>
        <input
          className={s.input}
          style={{ flex: '1 1 140px', minHeight: 34, padding: '5px 10px', fontSize: 13 }}
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={kind === 'cost' ? 'e.g. Holiday, car service' : 'e.g. Bonus, THR'}
          maxLength={50}
        />
        <input
          className={s.input}
          style={{ width: 120, minHeight: 34, padding: '5px 10px', fontSize: 13 }}
          inputMode="decimal"
          value={amtText}
          onChange={e => setAmtText(idr ? (Number(e.target.value.replace(/\D/g, '')) || '').toLocaleString('id-ID') : e.target.value)}
          placeholder={idr ? 'Amount (Rp)' : 'Amount ($)'}
        />
        <button type="submit" className={s.btnPrimarySm} disabled={!valid}>
          Add
        </button>
      </form>
    </div>
  );
}
