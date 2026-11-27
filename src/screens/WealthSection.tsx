import { useMemo, useState } from 'react';
import s from '../styles/ui.module.css';
import { Card } from '../components/ui';
import { IC, Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import type { Budget } from '../lib/budget';
import type { Cycle } from '../lib/cycle';
import { dayLabel, sum, toISO } from '../lib/format';
import { haptic } from '../lib/haptics';
import { useSettings } from '../lib/settings';
import { C } from '../lib/tokens';
import {
  CASHFLOW_SOURCES,
  computePayYourselfFirstStreak,
  evaluateBenchmarks,
  evaluateWishlistItem,
  opportunityCost,
  type AssetCashflow,
  type CashflowEvery,
  type CashflowSource,
  type FortAssetsAlert,
  type ImpulseSummary,
  type LifestyleCreepSignal,
  type WealthSnapshot,
  type WishlistItem,
} from '../lib/wealth';

// ---------------------------------------------------------------------------
// 1. Compact Wealth Pulse Strip (for Summary screen)
// ---------------------------------------------------------------------------

export function WealthCompactStrip({
  wealth,
  impulse,
  fortDip,
  lifestyleCreep,
  pyfStreak,
  onOpenPlan,
  onOpenInvest,
  onAskMaxie,
}: {
  wealth: WealthSnapshot;
  impulse: ImpulseSummary;
  fortDip: FortAssetsAlert | null;
  lifestyleCreep: LifestyleCreepSignal | null;
  pyfStreak: number;
  onOpenPlan: () => void;
  onOpenInvest: () => void;
  onAskMaxie: (ask?: string) => void;
}) {
  const { short, settings } = useSettings();
  const isId = settings.maxieLanguage === 'id';

  return (
    <section className={s.wlStripCard} data-wide aria-label="Wealth & Financial Runway">
      <div className={s.wlStripHead}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <Icon d={IC.shield} size={15} color={C.clayInk} />
          <h2 className={s.sxChartTitle} style={{ fontSize: 17 }}>
            {isId ? 'Runway & Arus Kas Aset' : 'Runway & Asset Cash Flow'}
          </h2>
          {pyfStreak >= 1 && !settings.quietMode && (
            <span className={s.wlPillGood}>
              Pay-Yourself-First · {pyfStreak}×
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className={s.textBtnSm} style={{ padding: 0 }} onClick={onOpenPlan}>
            Cash-flow board →
          </button>
        </div>
      </div>

      <div className={s.wlStripGrid}>
        <button type="button" className={s.wlMetricBtn} onClick={onOpenPlan}>
          <span className={s.wlMetricLabel}>Survival runway</span>
          <strong className={s.wlMetricVal} style={{ color: wealth.runwayMonths >= wealth.emergencyTargetMonths ? C.good : undefined }}>
            {wealth.runwayMonths > 0 ? `${wealth.runwayMonths.toFixed(1)} mo` : 'Set fund'}
          </strong>
          <span className={s.wlMetricSub}>
            {wealth.runwayDays > 0 ? `${wealth.runwayDays} days forward · goal ${wealth.emergencyTargetMonths} mo` : `Goal: ${wealth.emergencyTargetMonths} mo emergency fund`}
          </span>
          <span className={s.wlMiniTrack}>
            <span style={{ width: `${Math.max(wealth.runwayMonths > 0 ? 4 : 0, wealth.runwayPct)}%`, background: wealth.runwayMonths >= wealth.emergencyTargetMonths ? 'var(--good)' : 'var(--clay)' }} />
          </span>
        </button>

        <button type="button" className={s.wlMetricBtn} onClick={onOpenPlan}>
          <span className={s.wlMetricLabel}>Freedom ratio</span>
          <strong className={s.wlMetricVal} style={{ color: wealth.freedomPct >= 100 ? C.good : undefined }}>
            {wealth.freedomPct.toFixed(1)}%
          </strong>
          <span className={s.wlMetricSub}>
            {wealth.passiveMonthly > 0 ? `${short(wealth.passiveMonthly)}/mo passive · ${wealth.freedomStage}` : `${wealth.freedomStage} · log passive yield`}
          </span>
          <span className={s.wlMiniTrack}>
            <span style={{ width: `${Math.min(100, Math.max(wealth.freedomPct > 0 ? 4 : 0, wealth.freedomPct))}%`, background: 'var(--good)' }} />
          </span>
        </button>

        <button type="button" className={s.wlMetricBtn} onClick={onOpenInvest}>
          <span className={s.wlMetricLabel}>Assets vs. liabilities</span>
          <strong className={s.wlMetricVal} style={{ color: wealth.netProductiveWealth >= 0 ? C.text : C.redInk }}>
            {short(wealth.assetsTotal)}
          </strong>
          <span className={s.wlMetricSub}>
            {wealth.liabilitiesTotal > 0 ? `${short(wealth.liabilitiesTotal)} liabilities · net ${short(wealth.netProductiveWealth)}` : 'Zero tracked liabilities'}
          </span>
        </button>
      </div>

      {(fortDip?.dipped || lifestyleCreep?.detected || impulse.skipCount > 0) && (
        <div className={s.wlAlertsRow}>
          {fortDip?.dipped && (
            <div className={s.wlAlertChip} data-tone="warn">
              <Icon d={IC.alert} size={13} />
              <span>
                <strong>Fort Assets:</strong> {fortDip.reason}
              </span>
            </div>
          )}
          {lifestyleCreep?.detected && (
            <div className={s.wlAlertChip} data-tone="warn">
              <Icon d={IC.trend} size={13} />
              <span>
                <strong>Lifestyle creep ({lifestyleCreep.expenseCapturePct}%):</strong> {lifestyleCreep.message}
              </span>
            </div>
          )}
          {impulse.skipCount > 0 && (
            <button
              type="button"
              className={s.wlAlertBtn}
              onClick={() =>
                onAskMaxie(
                  isId
                    ? `Siklus ini ada ${impulse.skipCount} pengeluaran impulsif (${short(impulse.skipTotal)}). Gimana cara nahan pemicu ini supaya masuk ke tabungan?`
                    : `I tagged ${impulse.skipCount} could-skip spends (${short(impulse.skipTotal)}) this cycle${impulse.topTrigger ? `, mostly from ${impulse.topTrigger.label}` : ''}. How can I curb this impulse leak?`,
                )
              }
            >
              <Icon d={IC.sparkle} size={13} />
              <span>
                Impulse leaks: <strong>{short(impulse.skipTotal)}</strong> ({impulse.skipCount}×
                {impulse.topTrigger ? ` · #1 ${impulse.topTrigger.label}` : ''}) — Ask Maxie
              </span>
            </button>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 2. Payday "Pay Yourself First" Ritual & Fort Assets Guardrail
// ---------------------------------------------------------------------------

export function PayYourselfFirstCard({
  cycle,
  budget: b,
  fortDip,
  lifestyleCreep,
  onOpenInvest,
}: {
  cycle: Cycle;
  budget: Budget;
  fortDip: FortAssetsAlert | null;
  lifestyleCreep: LifestyleCreepSignal | null;
  onOpenInvest?: () => void;
}) {
  const { settings, update, full, ofIncome } = useSettings();
  const cycleId = toISO(cycle.start);
  const rec = settings.payYourselfFirst?.[cycleId] ?? {};

  const saveGoal = ofIncome(settings.savingsPct);
  const investGoal = Math.min(saveGoal, ofIncome(settings.investPct));
  const cashSaveGoal = Math.max(0, saveGoal - investGoal);
  const giveGoal = settings.giveFirstPct ? ofIncome(settings.giveFirstPct) : 0;

  const autoSaved = saveGoal <= 0 || b.saved >= Math.max(1, cashSaveGoal * 0.95);
  const autoInvested = investGoal <= 0 || b.invested >= Math.max(1, investGoal * 0.95);
  const savedDone = !!(rec.savedDone || autoSaved);
  const investedDone = !!(rec.investedDone || autoInvested);
  const allDone = savedDone && investedDone;
  const streak = computePayYourselfFirstStreak(settings.payYourselfFirst ?? {}, cycleId, allDone);

  const toggle = (field: 'savedDone' | 'investedDone') => {
    haptic('tap', settings.quietMode);
    const prev = settings.payYourselfFirst ?? {};
    const cur = prev[cycleId] ?? {};
    const nextRec = {
      ...cur,
      [field]: !cur[field],
      completedAt: new Date().toISOString(),
    };
    update({ payYourselfFirst: { ...prev, [cycleId]: nextRec } });
  };

  return (
    <Card style={{ gap: 14 }}>
      <div className={s.cardHead}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h2 className={s.h2}>Pay Yourself First</h2>
            {streak > 0 && !settings.quietMode && (
              <span className={s.wlPillGood}>
                {streak} {streak === 1 ? 'cycle' : 'cycles'} streak
              </span>
            )}
          </div>
          <span style={{ fontSize: 13, color: C.textMuted }}>
            Allocate to your asset column right after payday ({dayLabel(cycle.start)}), before everyday spending takes over.
          </span>
        </div>
      </div>

      <div className={s.wlCheckList}>
        <button type="button" className={s.wlCheckRow} data-done={savedDone || undefined} onClick={() => toggle('savedDone')}>
          <span className={s.wlCheckBox} data-done={savedDone || undefined}>
            {savedDone && <Icon d={IC.check} size={13} strokeWidth={2.8} />}
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 1, marginRight: 'auto', textAlign: 'left' }}>
            <strong style={{ fontSize: 14.5 }}>1. Cash &amp; Emergency Cushion</strong>
            <span style={{ fontSize: 12.5, color: C.textMuted }}>
              {cashSaveGoal > 0 ? `Target ${full(cashSaveGoal)} · ${full(b.saved)} moved this cycle` : 'Covered by your investing target'}
            </span>
          </span>
          <span className={s.caption} style={{ color: savedDone ? C.good : C.textMuted, fontWeight: 600 }}>
            {savedDone ? 'Paid first' : 'Mark done'}
          </span>
        </button>

        <button type="button" className={s.wlCheckRow} data-done={investedDone || undefined} onClick={() => toggle('investedDone')}>
          <span className={s.wlCheckBox} data-done={investedDone || undefined}>
            {investedDone && <Icon d={IC.check} size={13} strokeWidth={2.8} />}
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 1, marginRight: 'auto', textAlign: 'left' }}>
            <strong style={{ fontSize: 14.5 }}>2. Asset Column ({settings.investPct}% → Investing)</strong>
            <span style={{ fontSize: 12.5, color: C.textMuted }}>
              {investGoal > 0 ? `Target ${full(investGoal)} · ${full(b.invested)} moved to brokers` : 'Set an invest % in Settings to track'}
            </span>
          </span>
          {onOpenInvest && !investedDone ? (
            <span
              className={s.caption}
              style={{ color: C.clayInk, fontWeight: 600 }}
              onClick={e => {
                e.stopPropagation();
                onOpenInvest();
              }}
            >
              Open Invest →
            </span>
          ) : (
            <span className={s.caption} style={{ color: investedDone ? C.good : C.textMuted, fontWeight: 600 }}>
              {investedDone ? 'Paid first' : 'Mark done'}
            </span>
          )}
        </button>

        {giveGoal > 0 && (
          <div className={s.wlInfoRow}>
            <Icon d={IC.heart} size={14} color={C.clayInk} />
            <span>
              <strong>Give First ({settings.giveFirstPct}%):</strong> {full(giveGoal)} earmarked for zakat / charity before lifestyle upgrades.
            </span>
          </div>
        )}
      </div>

      {fortDip?.dipped && (
        <div className={s.wlAlertChip} data-tone="warn">
          <Icon d={IC.alert} size={14} />
          <span>
            <strong>Defend Fort Assets:</strong> {fortDip.reason}
          </span>
        </div>
      )}
      {lifestyleCreep?.detected && (
        <div className={s.wlAlertChip} data-tone="warn">
          <Icon d={IC.trend} size={14} />
          <span>
            <strong>Lifestyle Creep Watch:</strong> {lifestyleCreep.message}
          </span>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 3. Survival Runway, Jakarta Benchmarks & Unified Cash-Flow Statement (Phase 2 & 3)
// ---------------------------------------------------------------------------

export function CashflowStatementCard({
  cycle,
  budget: b,
  wealth,
  impulse,
}: {
  cycle: Cycle;
  budget: Budget;
  wealth: WealthSnapshot;
  impulse: ImpulseSummary;
}) {
  const { settings, update, full, short } = useSettings();
  const idr = settings.currency === 'IDR';

  // Inline Emergency Fund quick editor
  const [editingEf, setEditingEf] = useState(false);
  const [efInput, setEfInput] = useState(() => (wealth.emergencyFund > 0 ? String(Math.round(wealth.emergencyFund)) : ''));

  // Inline Passive Cash Flow logger
  const [addingCf, setAddingCf] = useState(false);
  const [cfLabel, setCfLabel] = useState('');
  const [cfAmt, setCfAmt] = useState('');
  const [cfSource, setCfSource] = useState<CashflowSource>('dividend');
  const [cfEvery, setCfEvery] = useState<CashflowEvery>('monthly');
  const [cfTicker, setCfTicker] = useState('');

  const benchmarks = useMemo(
    () =>
      evaluateBenchmarks({
        savedPct: b.savedPct,
        runwayMonths: wealth.runwayMonths,
        emergencyFund: wealth.emergencyFund,
        targetMonths: wealth.emergencyTargetMonths,
      }),
    [b.savedPct, wealth.runwayMonths, wealth.emergencyFund, wealth.emergencyTargetMonths],
  );

  const flows = settings.assetCashflows ?? [];
  const parsedCfAmt = idr ? Number(cfAmt.replace(/\D/g, '')) : Number(cfAmt.replace(/[^\d.]/g, ''));

  const saveEmergencyFund = () => {
    const val = idr ? Number(efInput.replace(/\D/g, '')) : Number(efInput.replace(/[^\d.]/g, ''));
    update({ emergencyFund: Math.max(0, Number.isFinite(val) ? val : 0) });
    setEditingEf(false);
    haptic('success', settings.quietMode);
  };

  const addCashflow = () => {
    if (!cfLabel.trim() || !(parsedCfAmt > 0)) return;
    const next: AssetCashflow = {
      id: 'cf_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      label: cfLabel.trim().slice(0, 60),
      source: cfSource,
      amount: parsedCfAmt,
      every: cfEvery,
      date: toISO(cycle.today),
      ...(cfTicker.trim() ? { ticker: cfTicker.trim().toUpperCase().slice(0, 12) } : {}),
    };
    update({ assetCashflows: [next, ...flows] });
    setCfLabel('');
    setCfAmt('');
    setCfTicker('');
    setAddingCf(false);
    haptic('success', settings.quietMode);
  };

  const removeCashflow = (id: string) => {
    update({ assetCashflows: flows.filter(f => f.id !== id) });
  };

  const patternBadge =
    wealth.cashflowPattern === 'wealth_builder'
      ? { label: 'Wealth-builder flow', bg: C.goodTint, ink: C.good }
      : wealth.cashflowPattern === 'paycheck_to_paycheck'
        ? { label: 'Expenses > Income', bg: C.redTint, ink: C.redInk }
        : { label: 'Building asset column', bg: C.amberTint, ink: C.amberInk };

  return (
    <Card style={{ gap: 18 }}>
      <div className={s.cardHead}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <h2 className={s.h2}>Personal Cash-Flow Statement</h2>
          <span style={{ fontSize: 13, color: C.textMuted }}>
            Assets put money in your pocket · Liabilities take money out (Income Statement ↔ Balance Sheet)
          </span>
        </div>
        <span className={s.badge} style={{ background: patternBadge.bg, color: patternBadge.ink, padding: '4px 10px', fontSize: 12.5 }}>
          {patternBadge.label}
        </span>
      </div>

      {/* Survival Runway + Freedom Ratio Meters */}
      <div className={s.wlTwoCol}>
        <div className={s.wlMeterBox}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
            <span className={s.eyebrow}>Survival Runway</span>
            <button type="button" className={s.textBtnSm} style={{ padding: 0 }} onClick={() => setEditingEf(v => !v)}>
              {editingEf ? 'Cancel' : wealth.emergencyFund > 0 ? 'Update fund' : '+ Set emergency fund'}
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <strong className={s.wlBigNum} style={{ color: wealth.runwayMonths >= wealth.emergencyTargetMonths ? C.good : undefined }}>
              {wealth.runwayMonths > 0 ? `${wealth.runwayMonths.toFixed(1)} months` : '0 months'}
            </strong>
            <span style={{ fontSize: 13, color: C.textMuted }}>
              ({wealth.runwayDays} days forward · {short(wealth.emergencyFund)} liquid)
            </span>
          </div>
          <span className={s.wlTrack}>
            <span style={{ width: `${Math.max(wealth.runwayMonths > 0 ? 3 : 0, wealth.runwayPct)}%`, background: wealth.runwayMonths >= wealth.emergencyTargetMonths ? 'var(--good)' : 'var(--clay)' }} />
          </span>
          <span style={{ fontSize: 12.5, color: C.textMuted, lineHeight: 1.45 }}>{benchmarks.runwaySummary}</span>

          {editingEf && (
            <form
              style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}
              onSubmit={e => {
                e.preventDefault();
                saveEmergencyFund();
              }}
            >
              <input
                className={s.input}
                style={{ flex: '1 1 140px', minHeight: 34, padding: '5px 10px', fontSize: 13.5 }}
                inputMode="decimal"
                value={efInput}
                onChange={e => setEfInput(idr ? (Number(e.target.value.replace(/\D/g, '')) || '').toLocaleString('id-ID') : e.target.value)}
                placeholder={idr ? 'e.g. 60.000.000' : 'e.g. 15000'}
                aria-label="Liquid emergency fund balance"
              />
              <button type="submit" className={s.btnPrimarySm}>
                Save
              </button>
            </form>
          )}
        </div>

        <div className={s.wlMeterBox}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
            <span className={s.eyebrow}>Rat Race → Fast Track</span>
            <span className={s.caption} style={{ fontWeight: 600, color: wealth.freedomPct >= 100 ? C.good : C.clayInk }}>
              {wealth.freedomStage}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <strong className={s.wlBigNum} style={{ color: wealth.freedomPct >= 100 ? C.good : undefined }}>
              {wealth.freedomPct.toFixed(1)}%
            </strong>
            <span style={{ fontSize: 13, color: C.textMuted }}>
              {short(wealth.passiveMonthly)}/mo passive ÷ {short(wealth.monthlyExpenses)}/mo expenses
            </span>
          </div>
          <span className={s.wlTrack}>
            <span style={{ width: `${Math.min(100, Math.max(wealth.freedomPct > 0 ? 3 : 0, wealth.freedomPct))}%`, background: 'var(--good)' }} />
          </span>
          <span style={{ fontSize: 12.5, color: C.textMuted, lineHeight: 1.45 }}>
            {wealth.freedomPct >= 100
              ? 'Fast Track reached — passive asset cash flow covers 100% of your monthly expenses.'
              : `${short(wealth.freedomGapMonthly)}/mo more in asset cash flow reaches 100% financial freedom.`}
          </span>
        </div>
      </div>

      {/* 2x2 Kiyosaki Financial Statement */}
      <div className={s.wlQuadGrid}>
        <div className={s.wlQuadBox}>
          <span className={s.eyebrow}>Income Statement · Inflow</span>
          <div className={s.wlLine}>
            <span>Profession (active salary)</span>
            <strong>{full(wealth.activeIncome)}</strong>
          </div>
          <div className={s.wlLine}>
            <span>Asset column (passive / mo)</span>
            <strong style={{ color: wealth.passiveMonthly > 0 ? C.good : C.textMuted }}>{full(wealth.passiveMonthly)}</strong>
          </div>
        </div>

        <div className={s.wlQuadBox}>
          <span className={s.eyebrow}>Income Statement · Outflow</span>
          <div className={s.wlLine}>
            <span>Cycle expenses (projected)</span>
            <strong>{full(b.projTotal)}</strong>
          </div>
          <div className={s.wlLine}>
            <span>Debt service vs. assets added</span>
            <strong style={{ color: wealth.monthlyDebtService > wealth.monthlyAssetAdded ? C.amberInk : C.good }}>
              {short(wealth.monthlyDebtService)} / {short(wealth.monthlyAssetAdded)}
            </strong>
          </div>
        </div>

        <div className={s.wlQuadBox} data-tone="asset">
          <span className={s.eyebrow}>Balance Sheet · Assets</span>
          <div className={s.wlLine}>
            <span>Liquid emergency fund</span>
            <strong>{full(wealth.emergencyFund)}</strong>
          </div>
          <div className={s.wlLine}>
            <span>Investment portfolio (IDX/US/Crypto)</span>
            <strong>{full(wealth.portfolioValue)}</strong>
          </div>
          <div className={s.wlLineTotal}>
            <span>Total productive assets</span>
            <strong style={{ color: C.good }}>{full(wealth.assetsTotal)}</strong>
          </div>
        </div>

        <div className={s.wlQuadBox} data-tone="liability">
          <span className={s.eyebrow}>Balance Sheet · Liabilities</span>
          <div className={s.wlLine}>
            <span>Credit cards owed</span>
            <strong>{full(wealth.cardLiabilities)}</strong>
          </div>
          <div className={s.wlLine}>
            <span>Remaining installments</span>
            <strong>{full(wealth.installmentLiabilities)}</strong>
          </div>
          <div className={s.wlLineTotal}>
            <span>Net productive wealth</span>
            <strong style={{ color: wealth.netProductiveWealth >= 0 ? C.text : C.redInk }}>{full(wealth.netProductiveWealth)}</strong>
          </div>
        </div>
      </div>

      {/* Benchmarks + Impulse Leaks summary row */}
      <div className={s.wlBenchRow}>
        <Icon d={IC.info} size={14} color={C.textMuted} />
        <span>
          <strong>Indonesia Millennial Benchmark:</strong> {benchmarks.savingSummary}
          {impulse.skipCount > 0 ? ` · Tagged impulse leaks: ${short(impulse.skipTotal)} (${impulse.skipCount}×).` : ''}
        </span>
      </div>

      {/* Passive / Asset Cash Flow Logger */}
      <div style={{ borderTop: `1px solid ${C.divider}`, paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <span className={s.eyebrow}>
            Passive &amp; Asset Cash Flows ({flows.length ? `${short(wealth.passiveMonthly)}/mo · ${short(wealth.passiveAnnual)}/yr` : 'none logged yet'})
          </span>
          <button type="button" className={addingCf ? s.btnGhost : s.btnOutlineSm} onClick={() => setAddingCf(v => !v)}>
            <Icon d={addingCf ? IC.close : IC.plus} size={13} />
            {addingCf ? 'Cancel' : 'Log passive income'}
          </button>
        </div>

        {addingCf && (
          <form
            className={s.wlFormBox}
            onSubmit={e => {
              e.preventDefault();
              addCashflow();
            }}
          >
            <div className={s.fbFormGrid}>
              <label className={s.field}>
                <span>Source name</span>
                <input className={s.input} value={cfLabel} onChange={e => setCfLabel(e.target.value)} placeholder="e.g. BBCA Dividend, SBN Coupon, RDPU" maxLength={60} />
              </label>
              <label className={s.field}>
                <span>Amount ({settings.currency})</span>
                <input
                  className={s.input}
                  inputMode="decimal"
                  value={cfAmt}
                  onChange={e => setCfAmt(idr ? (Number(e.target.value.replace(/\D/g, '')) || '').toLocaleString('id-ID') : e.target.value)}
                  placeholder={idr ? 'e.g. 1.500.000' : 'e.g. 120'}
                />
              </label>
            </div>
            <div className={s.fbFormGrid}>
              <label className={s.field}>
                <span>Category</span>
                <select className={s.input} value={cfSource} onChange={e => setCfSource(e.target.value as CashflowSource)}>
                  {CASHFLOW_SOURCES.map(x => (
                    <option key={x.key} value={x.key}>
                      {x.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={s.field}>
                <span>Frequency</span>
                <select className={s.input} value={cfEvery} onChange={e => setCfEvery(e.target.value as CashflowEvery)}>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="yearly">Yearly</option>
                  <option value="once">One-off payout</option>
                </select>
              </label>
              <label className={s.field}>
                <span>Ticker (optional)</span>
                <input className={s.input} value={cfTicker} onChange={e => setCfTicker(e.target.value)} placeholder="e.g. BBCA" style={{ textTransform: 'uppercase' }} maxLength={12} />
              </label>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button type="submit" className={s.btnPrimarySm} disabled={!cfLabel.trim() || !(parsedCfAmt > 0)}>
                Add cash flow
              </button>
              <span style={{ fontSize: 12, color: C.textMuted }}>Adding a ticker credits it toward Return of Capital in Invest.</span>
            </div>
          </form>
        )}

        {flows.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {flows.slice(0, 8).map(f => (
              <div key={f.id} className={s.wlFlowRow}>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 1, marginRight: 'auto', minWidth: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>
                    {f.label}
                    {f.ticker && <span className={s.wlTinyTag}>{f.ticker}</span>}
                  </span>
                  <span style={{ fontSize: 12, color: C.textMuted }}>
                    {CASHFLOW_SOURCES.find(x => x.key === f.source)?.label ?? f.source} · {f.every}
                  </span>
                </span>
                <strong style={{ color: C.good, fontVariantNumeric: 'tabular-nums' }}>+{full(f.amount)}</strong>
                <button type="button" className={s.iconBtnSm} aria-label={`Remove ${f.label}`} onClick={() => removeCashflow(f.id)}>
                  <Icon d={IC.close} size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 4. "Assets Buy Luxuries" Cooling-Off Wishlist Card (Phase 2)
// ---------------------------------------------------------------------------

export function WishlistCard({
  cycle,
  budget: b,
  wealth,
}: {
  cycle: Cycle;
  budget: Budget;
  wealth: WealthSnapshot;
}) {
  const { settings, update, full, short } = useSettings();
  const idr = settings.currency === 'IDR';
  const todayISO = toISO(cycle.today);
  const items = settings.wishlist ?? [];

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [amtText, setAmtText] = useState('');
  const [coolDays, setCoolDays] = useState(3);
  const [mode, setMode] = useState<'assets' | 'surplus'>('assets');

  const amount = idr ? Number(amtText.replace(/\D/g, '')) : Number(amtText.replace(/[^\d.]/g, ''));
  const monthlyLeanSurplus = Math.max(0, b.varBudget * 0.15);

  const active = useMemo(
    () =>
      items
        .filter(w => w.status === 'cooling' || w.status === 'ready')
        .map(w =>
          evaluateWishlistItem(w, {
            todayISO,
            monthlyPassiveCashflow: wealth.passiveMonthly,
            monthlyLeanSurplus,
            portfolioValue: wealth.portfolioValue,
          }),
        ),
    [items, todayISO, wealth.passiveMonthly, monthlyLeanSurplus, wealth.portfolioValue],
  );

  const skippedItems = items.filter(w => w.status === 'skipped');
  const skippedTotal = sum(skippedItems.map(w => w.amount));

  const addItem = () => {
    if (!name.trim() || !(amount > 0)) return;
    const next: WishlistItem = {
      id: 'wl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      name: name.trim().slice(0, 60),
      amount,
      addedAt: todayISO,
      coolDays,
      fundingMode: mode,
      status: 'cooling',
    };
    update({ wishlist: [next, ...items] });
    setName('');
    setAmtText('');
    setAdding(false);
    haptic('success', settings.quietMode);
  };

  const setStatus = (id: string, status: WishlistItem['status']) => {
    haptic(status === 'skipped' ? 'success' : 'tap', settings.quietMode);
    update({ wishlist: items.map(x => (x.id === id ? { ...x, status } : x)) });
  };

  const removeItem = (id: string) => {
    update({ wishlist: items.filter(x => x.id !== id) });
  };

  return (
    <Card style={{ gap: 14 }}>
      <div className={s.cardHead}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h2 className={s.h2}>Cooling-Off Wishlist</h2>
            {skippedTotal > 0 && (
              <span className={s.wlPillGood}>
                Saved {short(skippedTotal)} by skipping ({skippedItems.length})
              </span>
            )}
          </div>
          <span style={{ fontSize: 13, color: C.textMuted }}>
            Beat &ldquo;I saw, I liked, I bought&rdquo; — pause wants first, then let assets or lean surplus buy luxuries debt-free.
          </span>
        </div>
        <button type="button" className={adding ? s.btnGhost : s.btnOutlineSm} onClick={() => setAdding(v => !v)}>
          <Icon d={adding ? IC.close : IC.plus} size={13} />
          {adding ? 'Cancel' : 'Pause a want'}
        </button>
      </div>

      {adding && (
        <form
          className={s.wlFormBox}
          onSubmit={e => {
            e.preventDefault();
            addItem();
          }}
        >
          <div className={s.fbFormGrid}>
            <label className={s.field}>
              <span>What do you want?</span>
              <input className={s.input} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Espresso machine, New shoes, Headphones" maxLength={60} />
            </label>
            <label className={s.field}>
              <span>Price ({settings.currency})</span>
              <input
                className={s.input}
                inputMode="decimal"
                value={amtText}
                onChange={e => setAmtText(idr ? (Number(e.target.value.replace(/\D/g, '')) || '').toLocaleString('id-ID') : e.target.value)}
                placeholder={idr ? 'e.g. 5.000.000' : 'e.g. 400'}
              />
            </label>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12.5, color: C.textMuted, fontWeight: 600 }}>Cool-off:</span>
              <div className={s.sxMiniSeg} role="group" aria-label="Cooling-off days">
                {[3, 14, 30].map(d => (
                  <button key={d} type="button" aria-pressed={coolDays === d} onClick={() => setCoolDays(d)}>
                    {d === 3 ? '72h' : `${d}d`}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12.5, color: C.textMuted, fontWeight: 600 }}>Fund via:</span>
              <div className={s.sxMiniSeg} role="group" aria-label="Funding path">
                <button type="button" aria-pressed={mode === 'assets'} onClick={() => setMode('assets')}>
                  Asset cash flow
                </button>
                <button type="button" aria-pressed={mode === 'surplus'} onClick={() => setMode('surplus')}>
                  Lean surplus
                </button>
              </div>
            </div>
            {amount > 0 && (
              <span style={{ fontSize: 12, color: C.textMuted }}>
                5-yr opportunity cost @ 8%: <strong>{short(opportunityCost(amount, 5, 0.08))}</strong>
              </span>
            )}
          </div>
          <button type="submit" className={s.btnPrimarySm} style={{ alignSelf: 'flex-start' }} disabled={!name.trim() || !(amount > 0)}>
            Park in wishlist
          </button>
        </form>
      )}

      {active.length === 0 && !adding ? (
        <div className={s.mxEmptyInline} style={{ padding: 0 }}>
          <Logo size={28} mood="happy" interactive cheer="Wait 72 hours — future you will thank you!" />
          <span>No paused wants right now. Next time a flash sale or shiny upgrade tempts you, park it here for 72 hours first.</span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {active.map(ev => (
            <div key={ev.item.id} className={s.wlWishRow}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <strong style={{ fontSize: 15 }}>{ev.item.name}</strong>
                  <span className={ev.cooledDown ? s.wlPillGood : s.wlPillWarn}>
                    {ev.cooledDown ? 'Cooled off · decide calmly' : `Cooling: ${ev.daysLeft}d left`}
                  </span>
                </span>
                <strong style={{ fontSize: 15, fontVariantNumeric: 'tabular-nums' }}>{full(ev.item.amount)}</strong>
              </div>
              <div style={{ fontSize: 12.5, color: C.textMuted, lineHeight: 1.45 }}>
                <strong>How can I afford it?</strong>{' '}
                {ev.cyclesViaAssets
                  ? `Asset yield covers it in ~${ev.cyclesViaAssets} ${ev.cyclesViaAssets === 1 ? 'cycle' : 'cycles'} without touching principal`
                  : 'Build your asset column or log passive cash flows to fund luxuries debt-free'}
                {ev.cyclesViaLean ? ` · or ${ev.cyclesViaLean} lean (−15%) cycles` : ''}
                {` · If invested @ 8% instead: ${short(ev.opportunityCost5Yr)} in 5 yrs.`}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <button type="button" className={s.btnOutlineSm} onClick={() => setStatus(ev.item.id, 'skipped')}>
                  <Icon d={IC.check} size={13} /> Skip it (save {short(ev.item.amount)})
                </button>
                {ev.cooledDown && (
                  <button type="button" className={s.textBtnSm} onClick={() => setStatus(ev.item.id, 'bought')}>
                    Mark bought
                  </button>
                )}
                <button type="button" className={s.textBtnSm} style={{ marginLeft: 'auto', color: C.textMuted }} onClick={() => removeItem(ev.item.id)}>
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
