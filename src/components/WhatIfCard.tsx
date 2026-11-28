/**
 * Interactive What-If Scenario Card inside Ask Maxie: renders 5 interactive chart views (Line, Bar, Treemap,
 * Bubble, Table), live parameter sliders/steppers, an editable Category Spending Pocket adjuster, persistent
 * Apply/Undo, and warm celebratory feedback when a plan is tucked into the user's pockets.
 */
import { useEffect, useMemo, useState } from 'react';
import s from '../styles/ui.module.css';
import { IC, Icon } from './Icon';
import { Logo } from './Logo';
import type { Budget } from '../lib/budget';
import type { Cycle } from '../lib/cycle';
import type { AppliedScenarioState, AppliedScenarioUndo } from '../lib/chat';
import { sum, toISO } from '../lib/format';
import { useSetLimits } from '../lib/limits';
import { useSettings } from '../lib/settings';
import { C } from '../lib/tokens';
import type { WealthSnapshot } from '../lib/wealth';
import {
  simulateWhatIf,
  type ChartKind,
  type PocketAdjustment,
  type WhatIfBubbleItem,
  type WhatIfLineData,
  type WhatIfSpec,
  type WhatIfTreemapItem,
} from '../lib/whatIf';

const CHART_LABELS: Record<ChartKind, string> = {
  line: 'Line',
  bar: 'Bar',
  treemap: 'Treemap',
  bubble: 'Bubble',
  table: 'Table',
};

const CELEBRATIONS_EN = [
  (delta: string) => `Tucked neatly into your pockets! You just carved out ${delta} of extra breathing room — future you is already smiling.`,
  (delta: string) => `All set! Your spending pockets are tuned and ready, freeing up ${delta} to play with calmly.`,
  (delta: string) => `Nice move! That ${delta} cushion is now safely protected inside your pockets.`,
];

const CELEBRATIONS_ID = [
  (delta: string) => `Sudah rapi masuk ke pos belanjamu! Kamu baru saja mengamankan ${delta} ruang lega tambahan — tenang sampai gajian.`,
  (delta: string) => `Sip, beres! Pos kategori sudah disesuaikan dengan santai, ada ekstra ${delta} yang aman.`,
  (delta: string) => `Langkah manis! Bantalan ${delta} sekarang sudah tersimpan rapi di pos belanjamu.`,
];

type Props = {
  initialSpec: WhatIfSpec;
  cycle: Cycle;
  budget: Budget;
  wealth?: WealthSnapshot;
  applied?: AppliedScenarioState;
  onAppliedChange: (next?: AppliedScenarioState) => void;
};

export function WhatIfCard({ initialSpec, cycle, budget, wealth, applied, onAppliedChange }: Props) {
  const { settings, update, short, full, compact } = useSettings();
  const setLimits = useSetLimits();
  const isId = settings.maxieLanguage === 'id';
  const cur = settings.currency;
  const daysRem = Math.max(1, cycle.daysLeft + 1);

  const [spec, setSpec] = useState<WhatIfSpec>(() => applied?.spec ?? initialSpec);
  useEffect(() => {
    if (!applied) setSpec(initialSpec);
  }, [initialSpec, applied]);

  const result = useMemo(
    () => simulateWhatIf(spec, { cycle, budget, settings, wealth }),
    [spec, cycle, budget, settings, wealth],
  );

  const [chart, setChart] = useState<ChartKind>(result.primaryChart);
  useEffect(() => {
    if (!result.availableCharts.includes(chart)) {
      setChart(result.primaryChart);
    }
  }, [result.primaryChart, result.availableCharts, chart]);

  // Editable category spending pockets state
  const [pocketsOpen, setPocketsOpen] = useState(spec.kind === 'category_trim');
  const [pockets, setPockets] = useState<PocketAdjustment[]>(() => result.suggestedPockets ?? []);
  useEffect(() => {
    setPockets(result.suggestedPockets ?? []);
  }, [result.suggestedPockets]);

  const changedPockets = useMemo(
    () => pockets.filter(p => Math.abs(p.nextLimit - p.currentLimit) >= (cur === 'IDR' ? 1_000 : 1)),
    [pockets, cur],
  );
  const totalCurrentPockets = useMemo(() => sum(pockets.map(p => p.currentLimit)), [pockets]);
  const totalNextPockets = useMemo(() => sum(pockets.map(p => p.nextLimit)), [pockets]);
  const pocketDelta = totalCurrentPockets - totalNextPockets;

  const nudgePocket = (category: string, delta: number) => {
    const step = cur === 'IDR' ? 10_000 : 1;
    setPockets(prev =>
      prev.map(p => {
        if (p.category !== category) return p;
        const floor = Math.ceil(p.spent / step) * step;
        const maxCap = Math.max(p.currentLimit * 2, settings.income * 0.8);
        const nextLimit = Math.min(Math.round(maxCap), Math.max(floor, Math.round((p.nextLimit + delta) / step) * step));
        const nextPct = settings.income > 0 ? Math.round(((nextLimit / settings.income) * 100) * 1e4) / 1e4 : p.currentPct;
        return { ...p, nextLimit, nextPct };
      }),
    );
  };

  const applyPockets = () => {
    const targets = changedPockets.length ? changedPockets : pockets.filter(p => p.nextPct !== p.currentPct);
    if (!targets.length) return;
    const prevPcts: Record<string, number> = {};
    const patch: Record<string, number> = {};
    for (const p of targets) {
      prevPcts[p.category] = p.currentPct;
      patch[p.category] = p.nextPct;
    }
    setLimits(patch);
    const savedAmt = Math.max(0, totalCurrentPockets - totalNextPockets);
    const deltaText = savedAmt > 0 ? short(savedAmt) : short(Math.abs(result.deltaSpare));
    const pool = isId ? CELEBRATIONS_ID : CELEBRATIONS_EN;
    const pick = pool[targets.length % pool.length](deltaText);
    const summary = targets
      .slice(0, 3)
      .map(p => `${p.category}: ${short(p.currentLimit)} → ${short(p.nextLimit)}`)
      .join(' · ');

    onAppliedChange({
      appliedAt: new Date().toISOString(),
      summary: targets.length > 3 ? `${summary} (+${targets.length - 3} more)` : summary,
      celebration: pick,
      spec,
      undo: { type: 'pockets', prevPcts },
    });
  };

  const applyWishlistFromScenario = () => {
    if (result.recommendedAction?.kind !== 'wishlist') return;
    const { name, amount, coolDays } = result.recommendedAction;
    const id = 'wl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const prev = settings.wishlist ?? [];
    update({
      wishlist: [{ id, name, amount, addedAt: toISO(new Date()), coolDays, fundingMode: 'assets', status: 'cooling' }, ...prev],
    });
    onAppliedChange({
      appliedAt: new Date().toISOString(),
      summary: `${name} (${short(amount)}) · ${coolDays}-day cooling pause`,
      celebration: isId
        ? `${name} sudah masuk daftar jeda ${coolDays} hari — biar aset bekerja dulu sebelum beli.`
        : `Tucked ${name} into your ${coolDays}-day cooling vault — calm, zero-impulse decision!`,
      spec,
      undo: { type: 'wishlist', id },
    });
  };

  const applyPyfFromScenario = () => {
    if (result.recommendedAction?.kind !== 'pyf') return;
    const { savingsPct, investPct } = result.recommendedAction;
    const prevSave = settings.savingsPct;
    const prevInv = settings.investPct;
    update({
      ...(savingsPct != null ? { savingsPct } : {}),
      ...(investPct != null ? { investPct } : {}),
    });
    onAppliedChange({
      appliedAt: new Date().toISOString(),
      summary: `Invest ${prevInv}% → ${investPct ?? prevInv}% of income`,
      celebration: isId
        ? 'Target Pay-Yourself-First naik pelan-pelan — makin cepat menuju Fast Track!'
        : 'Pay-Yourself-First target nudged higher — quiet progress toward asset freedom!',
      spec,
      undo: { type: 'pyf', prevSave, prevInv },
    });
  };

  const undoScenario = (u?: AppliedScenarioUndo) => {
    if (u?.type === 'pockets') {
      setLimits(u.prevPcts);
    } else if (u?.type === 'wishlist') {
      update({ wishlist: (settings.wishlist ?? []).filter(w => w.id !== u.id) });
    } else if (u?.type === 'pyf') {
      update({ savingsPct: u.prevSave, investPct: u.prevInv });
    }
    onAppliedChange(undefined);
  };

  return (
    <div className={s.wiCard}>
      {/* Header + 5-chart switcher */}
      <div className={s.wiHead}>
        <div style={{ minWidth: 0 }}>
          <span className={s.chatWidgetEyebrow}>{isId ? 'Simulasi What-If' : 'Interactive What-If'}</span>
          <div className={s.wiTitle}>{result.title}</div>
          <div className={s.caption}>{result.subtitle}</div>
        </div>
        {result.availableCharts.length > 1 && (
          <div className={s.wiTabs} role="tablist" aria-label="Chart view">
            {result.availableCharts.map(k => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={chart === k}
                className={s.wiTab}
                onClick={() => setChart(k)}
              >
                {CHART_LABELS[k]}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Headline Metrics */}
      <div className={s.wiMetrics}>
        {result.metrics.map(m => (
          <div key={m.label} className={s.wiMetric}>
            <span className={s.caption}>{m.label}</span>
            <strong
              style={{
                color: m.tone === 'good' ? C.good : m.tone === 'warn' ? C.amberInk : m.tone === 'bad' ? C.redInk : undefined,
              }}
            >
              {m.after}
            </strong>
            {(m.before || m.delta) && (
              <span className={s.wiMetricSub}>
                {m.before ? `vs ${m.before}` : ''}
                {m.before && m.delta ? ' · ' : ''}
                {m.delta ? <b>{m.delta}</b> : ''}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Interactive Chart Stage */}
      <div className={s.wiChartWrap}>
        {chart === 'line' && result.line && (
          <LineChartView data={result.line} formatShort={compact} unit={result.line.unit} />
        )}
        {chart === 'bar' && result.bar && (
          <BarChartView
            items={result.bar.items}
            formatShort={compact}
            onPick={patch => patch && setSpec(prev => ({ ...prev, ...patch } as WhatIfSpec))}
          />
        )}
        {chart === 'treemap' && result.treemap && (
          <TreemapView
            items={result.treemap.items}
            formatShort={short}
            onPick={catId => {
              if (spec.kind === 'category_trim') setSpec({ ...spec, category: catId });
              else setPocketsOpen(true);
            }}
          />
        )}
        {chart === 'bubble' && result.bubble && (
          <BubbleChartView
            items={result.bubble.items}
            formatShort={compact}
            onPick={id => {
              if (spec.kind === 'category_trim') setSpec({ ...spec, category: id });
            }}
          />
        )}
        {chart === 'table' && result.table && (
          <TableView
            columns={result.table.columns}
            rows={result.table.rows}
            onPick={patch => patch && setSpec(prev => ({ ...prev, ...patch } as WhatIfSpec))}
          />
        )}
      </div>

      {result.breakdown && <div className={s.wiBreakdown}>{result.breakdown}</div>}

      {/* Scenario-specific Interactive Controls */}
      {!applied && (
        <ScenarioControls
          spec={spec}
          budget={budget}
          daysRem={daysRem}
          currency={cur}
          short={short}
          isId={isId}
          onChange={setSpec}
        />
      )}

      {/* Celebratory Applied Banner OR Interactive Pocket Adjuster */}
      {applied ? (
        <div className={`${s.wiCelebrate} ${!settings.quietMode ? s.mxPopIn : ''}`}>
          <Logo size={28} mood="happy" interactive cheer={isId ? 'Mantap!' : 'Looking cozy!'} />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <strong style={{ fontSize: 13.5, color: C.good }}>{applied.celebration}</strong>
            <span className={s.caption}>{applied.summary}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 2 }}>
              <span className={s.mxTag} data-tone="success">
                {isId ? 'Terpasang di pos belanja' : 'Applied to pockets'}
              </span>
              {applied.undo && (
                <button type="button" className={s.textBtnSm} style={{ padding: 0 }} onClick={() => undoScenario(applied.undo)}>
                  Undo
                </button>
              )}
            </div>
          </div>
        </div>
      ) : pockets.length > 0 ? (
        <div className={s.wiPocketsBox}>
          <button
            type="button"
            className={s.wiPocketsToggle}
            aria-expanded={pocketsOpen}
            onClick={() => setPocketsOpen(v => !v)}
          >
            <span>
              <strong>{isId ? 'Sesuaikan pos kategori' : 'Tune spending pockets'}</strong>
              <span className={s.caption} style={{ marginLeft: 8 }}>
                {changedPockets.length > 0
                  ? `${changedPockets.length} adjusted · ${pocketDelta >= 0 ? `+${short(pocketDelta)} spare` : `-${short(-pocketDelta)}`}`
                  : isId
                    ? 'Sesuaikan batas tiap kategori'
                    : 'Adjust category limits to match'}
              </span>
            </span>
            <Icon d={IC.chevDown} size={14} style={{ transform: pocketsOpen ? 'rotate(180deg)' : undefined, transition: 'transform 160ms ease' }} />
          </button>

          {pocketsOpen && (
            <div className={s.wiPocketsList}>
              {pockets.map(p => {
                const diff = p.nextLimit - p.currentLimit;
                const step = cur === 'IDR' ? 50_000 : 5;
                return (
                  <div key={p.category} className={s.wiPocketRow}>
                    <span className={s.wiPocketLabel}>
                      <span className={s.wiDot} style={{ background: p.color }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.category}</span>
                    </span>
                    <span className={s.wiPocketNums}>
                      <span className={s.caption}>{compact(p.currentLimit)}</span>
                      <span>→</span>
                      <strong style={{ color: diff < 0 ? C.good : diff > 0 ? C.amberInk : C.text }}>{compact(p.nextLimit)}</strong>
                    </span>
                    <div className={s.wiStepGroup}>
                      <button
                        type="button"
                        className={s.wiStepBtn}
                        disabled={p.nextLimit - step < p.spent}
                        onClick={() => nudgePocket(p.category, -step)}
                        aria-label={`Decrease ${p.category}`}
                      >
                        −
                      </button>
                      <button
                        type="button"
                        className={s.wiStepBtn}
                        onClick={() => nudgePocket(p.category, step)}
                        aria-label={`Increase ${p.category}`}
                      >
                        +
                      </button>
                    </div>
                  </div>
                );
              })}

              <div className={s.wiPocketFoot}>
                <span className={s.caption}>
                  {isId ? 'Total variabel:' : 'Variable total:'} <b>{full(totalNextPockets)}</b>
                </span>
                <button
                  type="button"
                  className={s.btnPrimarySm}
                  disabled={!changedPockets.length}
                  onClick={applyPockets}
                >
                  {isId ? 'Terapkan ke pos belanja' : 'Apply to my spending pockets'}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : result.recommendedAction?.kind === 'wishlist' ? (
        <div className={s.wiQuickAction}>
          <span className={s.caption}>
            {isId ? 'Simpan ke Wishlist 14 hari dulu?' : 'Try a 14-day cooling-off pause before deciding?'}
          </span>
          <button type="button" className={s.btnPrimarySm} onClick={applyWishlistFromScenario}>
            {isId ? 'Masukkan ke Wishlist' : 'Pause in Wishlist'}
          </button>
        </div>
      ) : result.recommendedAction?.kind === 'pyf' ? (
        <div className={s.wiQuickAction}>
          <span className={s.caption}>
            {isId ? 'Naikkan porsi Invest otomatis tiap gajian?' : 'Bump your payday Invest % target slightly?'}
          </span>
          <button type="button" className={s.btnPrimarySm} onClick={applyPyfFromScenario}>
            {isId ? 'Perbarui target' : 'Update Pay-Yourself-First'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/* ---- Interactive Controls per Scenario ---- */

function ScenarioControls({
  spec,
  budget,
  daysRem,
  currency,
  short,
  isId,
  onChange,
}: {
  spec: WhatIfSpec;
  budget: Budget;
  daysRem: number;
  currency: 'IDR' | 'USD';
  short: (v: number) => string;
  isId: boolean;
  onChange: (next: WhatIfSpec) => void;
}) {
  const stepDay = currency === 'IDR' ? 25_000 : 5;
  const maxDay = Math.max(stepDay * 8, Math.round((budget.safeDay * 2.2) / stepDay) * stepDay || stepDay * 20);

  if (spec.kind === 'daily_cap') {
    return (
      <div className={s.wiControls}>
        <div className={s.wiCtrlTop}>
          <span>{isId ? 'Atur batas harian' : 'Daily spend cap'}</span>
          <strong>{short(spec.dailyAmount)}/day</strong>
        </div>
        <input
          type="range"
          className={s.wiSlider}
          min={0}
          max={maxDay}
          step={stepDay}
          value={Math.min(maxDay, spec.dailyAmount)}
          onChange={e => onChange({ kind: 'daily_cap', dailyAmount: Number(e.target.value) })}
        />
      </div>
    );
  }

  if (spec.kind === 'weekday_weekend_cap') {
    return (
      <div className={s.wiControls}>
        <div className={s.wiCtrlTop}>
          <span>{isId ? 'Hari kerja' : 'Weekday cap'}</span>
          <strong>{short(spec.weekdayAmount)}/d</strong>
        </div>
        <input
          type="range"
          className={s.wiSlider}
          min={0}
          max={maxDay}
          step={stepDay}
          value={Math.min(maxDay, spec.weekdayAmount)}
          onChange={e => onChange({ ...spec, weekdayAmount: Number(e.target.value) })}
        />
        <div className={s.wiCtrlTop} style={{ marginTop: 4 }}>
          <span>{isId ? 'Akhir pekan' : 'Weekend cap'}</span>
          <strong>{short(spec.weekendAmount)}/d</strong>
        </div>
        <input
          type="range"
          className={s.wiSlider}
          min={0}
          max={maxDay * 1.5}
          step={stepDay}
          value={Math.min(maxDay * 1.5, spec.weekendAmount)}
          onChange={e => onChange({ ...spec, weekendAmount: Number(e.target.value) })}
        />
      </div>
    );
  }

  if (spec.kind === 'zero_spend_days') {
    return (
      <div className={s.wiControls}>
        <div className={s.wiCtrlTop}>
          <span>{isId ? 'Jumlah hari tanpa belanja' : 'Zero-spend days'}</span>
          <strong>
            {spec.zeroDays} / {daysRem}d
          </strong>
        </div>
        <input
          type="range"
          className={s.wiSlider}
          min={1}
          max={Math.min(14, daysRem)}
          step={1}
          value={Math.min(Math.min(14, daysRem), spec.zeroDays)}
          onChange={e => onChange({ kind: 'zero_spend_days', zeroDays: Number(e.target.value) })}
        />
      </div>
    );
  }

  if (spec.kind === 'category_trim') {
    const vars = budget.cats.filter(c => c.type === 'variable' && !c.auto).slice(0, 6);
    return (
      <div className={s.wiControls}>
        <div className={s.wiPillRow}>
          {vars.map(c => (
            <button
              key={c.name}
              type="button"
              className={s.wiPill}
              data-active={c.name === spec.category || undefined}
              onClick={() => onChange({ ...spec, category: c.name })}
            >
              {c.name}
            </button>
          ))}
        </div>
        <div className={s.wiCtrlTop}>
          <span>{isId ? 'Kurangi sisa batas' : 'Trim remaining limit'}</span>
          <strong>{spec.trimPct}%</strong>
        </div>
        <input
          type="range"
          className={s.wiSlider}
          min={10}
          max={100}
          step={5}
          value={spec.trimPct}
          onChange={e => onChange({ ...spec, trimPct: Number(e.target.value) })}
        />
      </div>
    );
  }

  if (spec.kind === 'big_purchase') {
    return (
      <div className={s.wiControls}>
        <div className={s.wiPillRow}>
          {[1, 3, 6, 12].map(m => (
            <button
              key={m}
              type="button"
              className={s.wiPill}
              data-active={spec.months === m || undefined}
              onClick={() => onChange({ ...spec, months: m })}
            >
              {m === 1 ? 'Cash (1×)' : `${m}× cicilan`}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (spec.kind === 'runway_eta') {
    const step = currency === 'IDR' ? 500_000 : 100;
    const max = Math.max(step * 12, Math.round((budget.income * 0.6) / step) * step);
    return (
      <div className={s.wiControls}>
        <div className={s.wiCtrlTop}>
          <span>{isId ? 'Setoran darurat/bulan' : 'Monthly emergency boost'}</span>
          <strong>{short(spec.monthlyAdd)}/mo</strong>
        </div>
        <input
          type="range"
          className={s.wiSlider}
          min={step}
          max={max}
          step={step}
          value={Math.min(max, spec.monthlyAdd)}
          onChange={e => onChange({ ...spec, monthlyAdd: Number(e.target.value) })}
        />
      </div>
    );
  }

  if (spec.kind === 'income_drop') {
    return (
      <div className={s.wiControls}>
        <div className={s.wiCtrlTop}>
          <span>{isId ? 'Penurunan penghasilan' : 'Income drop simulation'}</span>
          <strong>-{spec.dropPct}%</strong>
        </div>
        <input
          type="range"
          className={s.wiSlider}
          min={10}
          max={100}
          step={5}
          value={spec.dropPct}
          onChange={e => onChange({ kind: 'income_drop', dropPct: Number(e.target.value) })}
        />
      </div>
    );
  }

  if (spec.kind === 'windfall_split') {
    return (
      <div className={s.wiControls}>
        <div className={s.wiCtrlTop}>
          <span>Asset-First ratio</span>
          <strong>
            {spec.assetPct}% assets · {100 - spec.assetPct}% enjoy
          </strong>
        </div>
        <input
          type="range"
          className={s.wiSlider}
          min={50}
          max={90}
          step={5}
          value={spec.assetPct}
          onChange={e => onChange({ ...spec, assetPct: Number(e.target.value) })}
        />
      </div>
    );
  }

  if (spec.kind === 'habit_compound') {
    const step = currency === 'IDR' ? 25_000 : 5;
    const max = step * 20;
    return (
      <div className={s.wiControls}>
        <div className={s.wiCtrlTop}>
          <span>{isId ? 'Dialihkan per minggu' : 'Weekly habit shifted'}</span>
          <strong>{short(spec.weeklyAmount)}/wk</strong>
        </div>
        <input
          type="range"
          className={s.wiSlider}
          min={step}
          max={max}
          step={step}
          value={Math.min(max, spec.weeklyAmount)}
          onChange={e => onChange({ ...spec, weeklyAmount: Number(e.target.value) })}
        />
      </div>
    );
  }

  const step = currency === 'IDR' ? 500_000 : 100;
  const max = Math.max(step * 12, Math.round((budget.income * 0.6) / step) * step);
  return (
    <div className={s.wiControls}>
      <div className={s.wiCtrlTop}>
        <span>{isId ? 'Investasi bulanan' : 'Monthly invest pace'}</span>
        <strong>{short(spec.monthlyInvest)}/mo</strong>
      </div>
      <input
        type="range"
        className={s.wiSlider}
        min={step}
        max={max}
        step={step}
        value={Math.min(max, spec.monthlyInvest)}
        onChange={e => onChange({ ...spec, monthlyInvest: Number(e.target.value) })}
      />
    </div>
  );
}

/* ---- 5 Interactive Chart Views ---- */

function LineChartView({
  data,
  formatShort,
  unit,
}: {
  data: WhatIfLineData;
  formatShort: (v: number) => string;
  unit: 'currency' | 'months';
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 320;
  const H = 126;
  const padX = 10;
  const padTop = 14;
  const padBot = 20;
  const allVals = [...data.baseline, ...data.scenario, ...(data.targetLine ? [data.targetLine.value] : [])];
  const maxV = Math.max(1, ...allVals) * 1.1;
  const xAt = (i: number) => padX + (data.xLabels.length > 1 ? (i / (data.xLabels.length - 1)) * (W - padX * 2) : (W - padX * 2) / 2);
  const yAt = (v: number) => padTop + (1 - Math.max(0, v) / maxV) * (H - padTop - padBot);
  const pathFor = (arr: number[]) => arr.map((v, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)} ${yAt(v).toFixed(1)}`).join(' ');
  const fmt = (v: number) => (unit === 'months' ? `${v.toFixed(1)} mo` : formatShort(v));
  const idx = hover != null && hover < data.xLabels.length ? hover : data.xLabels.length - 1;

  return (
    <div>
      <div className={s.wiLegend}>
        <span>
          <i className={s.wiLegendDash} /> Current: <b>{fmt(data.baseline[idx])}</b>
        </span>
        <span>
          <i className={s.wiLegendSolid} /> What-If: <b style={{ color: C.good }}>{fmt(data.scenario[idx])}</b>
        </span>
        <span style={{ marginLeft: 'auto', color: C.textMuted }}>{data.xLabels[idx]}</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={s.wiSvg}
        onPointerMove={e => {
          const r = e.currentTarget.getBoundingClientRect();
          const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
          setHover(Math.round(frac * (data.xLabels.length - 1)));
        }}
        onPointerLeave={() => setHover(null)}
      >
        {data.targetLine && (
          <>
            <line
              x1={padX}
              x2={W - padX}
              y1={yAt(data.targetLine.value)}
              y2={yAt(data.targetLine.value)}
              stroke="var(--amber)"
              strokeDasharray="3 3"
              strokeWidth={1.1}
              opacity={0.75}
            />
            <text x={W - padX} y={Math.max(10, yAt(data.targetLine.value) - 4)} textAnchor="end" fontSize={9.5} fill="var(--amber-ink)">
              {data.targetLine.label}
            </text>
          </>
        )}
        <path d={pathFor(data.baseline)} fill="none" stroke="var(--text-faint)" strokeWidth={1.6} strokeDasharray="4 3" />
        <path d={`${pathFor(data.scenario)} L${xAt(data.xLabels.length - 1)} ${H - padBot} L${xAt(0)} ${H - padBot} Z`} fill="var(--clay)" opacity={0.1} />
        <path d={pathFor(data.scenario)} fill="none" stroke="var(--clay)" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
        <line x1={xAt(idx)} x2={xAt(idx)} y1={padTop} y2={H - padBot} stroke="var(--border-strong)" strokeWidth={1} />
        <circle cx={xAt(idx)} cy={yAt(data.baseline[idx])} r={3} fill="var(--text-faint)" />
        <circle cx={xAt(idx)} cy={yAt(data.scenario[idx])} r={4} fill="var(--clay)" stroke="var(--surface)" strokeWidth={1.5} />
        <text x={padX} y={H - 5} fontSize={9.5} fill="var(--text-faint)">
          {data.xLabels[0]}
        </text>
        <text x={W - padX} y={H - 5} textAnchor="end" fontSize={9.5} fill="var(--text-faint)">
          {data.xLabels[data.xLabels.length - 1]}
        </text>
      </svg>
    </div>
  );
}

function BarChartView({
  items,
  formatShort,
  onPick,
}: {
  items: NonNullable<ReturnType<typeof simulateWhatIf>['bar']>['items'];
  formatShort: (v: number) => string;
  onPick: (patch?: Partial<WhatIfSpec>) => void;
}) {
  const max = Math.max(1, ...items.map(i => i.value));
  return (
    <div className={s.wiBars}>
      {items.map(it => {
        const pct = Math.max(6, Math.round((it.value / max) * 100));
        const clickable = !!it.specPatch;
        return (
          <button
            key={it.id}
            type="button"
            disabled={!clickable}
            className={s.wiBarBtn}
            data-active={it.active || undefined}
            onClick={() => onPick(it.specPatch)}
          >
            <div className={s.wiBarTop}>
              <span>{it.label}</span>
              <span>
                <strong>{formatShort(it.value)}</strong>
                {it.detail ? <span className={s.caption}> · {it.detail}</span> : null}
              </span>
            </div>
            <span className={s.chatWidgetTrack} style={{ height: 7 }}>
              <span
                className={s.chatWidgetFill}
                style={{
                  width: `${pct}%`,
                  background:
                    it.tone === 'good'
                      ? 'var(--good)'
                      : it.tone === 'clay'
                        ? 'var(--clay)'
                        : it.tone === 'amber'
                          ? 'var(--amber)'
                          : it.tone === 'bad'
                            ? 'var(--danger)'
                            : 'var(--border-strong)',
                }}
              />
            </span>
          </button>
        );
      })}
    </div>
  );
}

type TMBox = WhatIfTreemapItem & { x: number; y: number; w: number; h: number };

function squarifyBoxes(items: WhatIfTreemapItem[], W: number, H: number): TMBox[] {
  const clean = items.filter(i => i.value > 0).sort((a, z) => z.value - a.value);
  const total = sum(clean.map(i => i.value));
  if (!total || !clean.length) return [];
  const out: TMBox[] = [];
  let x = 0;
  let y = 0;
  let w = W;
  let h = H;
  const rest = clean.map(d => ({ d, a: (d.value * W * H) / total }));
  const worst = (row: { a: number }[], side: number) => {
    const t = sum(row.map(r => r.a));
    const mx = Math.max(...row.map(r => r.a));
    const mn = Math.min(...row.map(r => r.a));
    return Math.max((side * side * mx) / (t * t), (t * t) / (side * side * mn));
  };
  while (rest.length) {
    const side = Math.min(w, h);
    const row = [rest.shift()!];
    while (rest.length && worst([...row, rest[0]], side) <= worst(row, side)) row.push(rest.shift()!);
    const t = sum(row.map(r => r.a));
    if (w >= h) {
      const cw = t / h;
      let yy = y;
      for (const r of row) {
        out.push({ ...r.d, x, y: yy, w: cw, h: r.a / cw });
        yy += r.a / cw;
      }
      x += cw;
      w -= cw;
    } else {
      const rh = t / w;
      let xx = x;
      for (const r of row) {
        out.push({ ...r.d, x: xx, y, w: r.a / rh, h: rh });
        xx += r.a / rh;
      }
      y += rh;
      h -= rh;
    }
  }
  return out;
}

function TreemapView({
  items,
  formatShort,
  onPick,
}: {
  items: WhatIfTreemapItem[];
  formatShort: (v: number) => string;
  onPick: (id: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const W = 320;
  const H = 152;
  const boxes = useMemo(() => squarifyBoxes(items, W, H), [items]);
  const active = boxes.find(b => b.id === selected) ?? boxes[0];

  return (
    <div>
      {active && (
        <div className={s.wiLegend}>
          <span>
            <i className={s.wiDot} style={{ background: active.color, display: 'inline-block', marginRight: 5 }} />
            <strong>{active.label}</strong>: {formatShort(active.value)}
            {active.note ? <span style={{ color: C.good }}> ({active.note})</span> : null}
          </span>
        </div>
      )}
      <div className={s.wiTreemap}>
        {boxes.map(b => (
          <button
            key={b.id}
            type="button"
            className={s.wiTile}
            data-active={active?.id === b.id || undefined}
            style={{
              left: `${(b.x / W) * 100}%`,
              top: `${(b.y / H) * 100}%`,
              width: `${(b.w / W) * 100}%`,
              height: `${(b.h / H) * 100}%`,
              background: b.tint,
              borderColor: active?.id === b.id ? b.color : `color-mix(in srgb, ${b.color} 45%, transparent)`,
            }}
            onClick={() => {
              setSelected(b.id);
              onPick(b.id);
            }}
          >
            {b.w >= 54 && b.h >= 34 && (
              <>
                <span className={s.wiTileName}>{b.label}</span>
                {b.h >= 48 && <span className={s.wiTileVal}>{formatShort(b.value)}</span>}
              </>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function BubbleChartView({
  items,
  formatShort,
  onPick,
}: {
  items: WhatIfBubbleItem[];
  formatShort: (v: number) => string;
  onPick: (id: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(items[items.length - 1]?.id ?? null);
  const W = 320;
  const H = 148;
  const clean = items.slice(0, 6);
  const maxV = Math.max(1, ...clean.map(i => i.value));

  // Lay bubbles in clean non-overlapping packed circles along balanced coordinates.
  const n = clean.length;
  const placed = clean.map((it, idx) => {
    const norm = Math.sqrt(Math.max(0.12, it.value / maxV));
    const r = Math.max(18, Math.min(n <= 3 ? 44 : 38, norm * (n <= 3 ? 44 : 38)));
    const stepX = (W - 44) / Math.max(1, n);
    const cx = 22 + stepX * idx + stepX / 2;
    const cy = n <= 3 ? H / 2 : idx % 2 === 0 ? H * 0.44 : H * 0.58;
    return { ...it, r, cx, cy };
  });

  const active = placed.find(b => b.id === selected) ?? placed[placed.length - 1];

  return (
    <div>
      {active && (
        <div className={s.wiLegend}>
          <span>
            <i className={s.wiDot} style={{ background: active.color, display: 'inline-block', marginRight: 5 }} />
            <strong>{active.label}</strong>: {formatShort(active.value)}
            {active.sub ? <span className={s.caption}> ({active.sub})</span> : null}
          </span>
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} className={s.wiSvg} role="img" aria-label="Bubble comparison">
        {placed.map(b => {
          const isSel = active?.id === b.id;
          return (
            <g
              key={b.id}
              style={{ cursor: 'pointer' }}
              onClick={() => {
                setSelected(b.id);
                onPick(b.id);
              }}
            >
              <circle
                cx={b.cx}
                cy={b.cy}
                r={b.r}
                fill={b.tint}
                stroke={b.color}
                strokeWidth={isSel ? 2.2 : 1.2}
              />
              <text x={b.cx} y={b.cy - 2} textAnchor="middle" fontSize={b.r > 28 ? 10.5 : 9} fontWeight={600} fill="var(--ink)">
                {b.label.slice(0, 10)}
              </text>
              <text x={b.cx} y={b.cy + 11} textAnchor="middle" fontSize={b.r > 28 ? 10 : 8.5} fill="var(--text-soft)">
                {formatShort(b.value)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function TableView({
  columns,
  rows,
  onPick,
}: {
  columns: string[];
  rows: NonNullable<ReturnType<typeof simulateWhatIf>['table']>['rows'];
  onPick: (patch?: Partial<WhatIfSpec>) => void;
}) {
  return (
    <div className={s.wiTableWrap}>
      <table className={s.wiTable}>
        <thead>
          <tr>
            {columns.map(c => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const clickable = !!r.specPatch;
            return (
              <tr
                key={r.id}
                data-active={r.active || undefined}
                data-tone={r.tone}
                style={{ cursor: clickable ? 'pointer' : undefined }}
                onClick={() => clickable && onPick(r.specPatch)}
              >
                {r.cells.map((cell, ci) => (
                  <td key={ci}>{cell}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
