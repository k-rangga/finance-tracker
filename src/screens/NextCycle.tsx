import { useEffect, useMemo, useRef, useState } from 'react';
import s from '../styles/ui.module.css';
import { Card, Dot, Toast } from '../components/ui';
import { Celebrate } from '../components/Delight';
import { IC, Icon } from '../components/Icon';
import { Select } from '../components/Select';
import { builtInCategory, CATEGORIES, categoryByName, type Category } from '../data/categories';
import type { Bill } from '../data/transactions';
import { perMonth, type Suggestion } from '../lib/subscriptions';
import { useData } from '../lib/data';
import { newSubId } from './Subscriptions';
import { MaxieNote } from './categoryCards';
import type { Budget } from '../lib/budget';
import type { Cycle } from '../lib/cycle';
import {
  autoBalancePlan,
  buildPresetAmounts,
  checkPlan,
  cycleIncomeOf,
  cycleKey,
  matchCosts,
  roundStep,
  spendingProfile,
  type CyclePlan,
  type ModelPreset,
  type PlanCheck,
  type PlannedCost,
  type PlannedInflow,
} from '../lib/cyclePlans';
import { fixedBillsForNextCycle } from '../lib/fixedBills';
import { Logo, type MaxieMood } from '../components/Logo';
import { ThinkingArcs, thinkingLabel } from '../components/Chat';
import { dayLabel, dayMonth, sum, tidyName, toISO } from '../lib/format';
import { useSettings } from '../lib/settings';
import { C } from '../lib/tokens';
import { AmountEditor } from './Categories';
import { ProjectionCard } from './ProjectionCard';

type Props = {
  cycle: Cycle;
  next: Cycle;
  budget: Budget;
  /** Installment payments and subscription charges already due in the next cycle. */
  known: { installments: Bill[]; subscriptions: Bill[]; notAdded: Suggestion[] };
};

const SAVE_INK = 'var(--category-1)';
const FIXED_INK = 'var(--category-4)';
const VAR_INK = 'var(--category-3)';
const FREE_INK = 'var(--good)';
const EXTRA_PRESETS = ['Bonus', 'THR', 'Freelance', 'Dividend', 'Reimbursement'];

/**
 * Next Cycle as an interactive zero-based financial model: live allocation waterfall with reactive Maxie,
 * per-cycle income & extra inflows, scenario presets, interactive savings/investing & category sliders,
 * committed bills/installments, one-off costs, and Maxie's AI plan check. Automatically activates on payday.
 */
export function NextCycle({ cycle, next, budget, known }: Props) {
  const { settings, update, full, short } = useSettings();
  const { setSubscription } = useData();
  const [raiseGone, setRaiseGone] = useState(false);
  const [hoverSeg, setHoverSeg] = useState<string | null>(null);
  const [showFixedOverrides, setShowFixedOverrides] = useState(false);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6500);
    return () => clearTimeout(t);
  }, [toast]);

  const key = cycleKey(next);
  const plan: CyclePlan = settings.cyclePlans?.[key] ?? {};
  // Always keep the newest plan in a ref so rapid consecutive actions build on one another cleanly.
  const latest = useRef(plan);
  latest.current = plan;

  const regularIncome = settings.income;
  const baseIncome = plan.income != null && plan.income > 0 ? plan.income : regularIncome;
  const extras = plan.extras ?? [];
  const extrasTotal = sum(extras.map(x => x.amount));
  const totalInflow = cycleIncomeOf(regularIncome, plan);

  const idr = settings.currency === 'IDR';
  const step = idr ? 50_000 : 10;
  const saveStep = idr ? 100_000 : 25;

  // Category limits are stored as % of regular base income so they activate at the exact Rupiah/USD on payday.
  const pctOfReg = (amount: number) => (regularIncome > 0 ? (amount / regularIncome) * 100 : 0);
  const amtOfReg = (pct: number) => (pct / 100) * regularIncome;
  const pctOfInflow = (amount: number) => (totalInflow > 0 ? Math.round((amount / totalInflow) * 1000) / 10 : 0);

  /** Individual fixed bills due in the next cycle, grouped by category so exact amounts flow into the plan. */
  const nextFixedBills = useMemo(() => fixedBillsForNextCycle(settings.fixedBills ?? [], next), [settings.fixedBills, next]);
  const managedFixedCats = useMemo(() => new Set((settings.fixedBills ?? []).filter(b => !b.paused).map(b => b.category)), [settings.fixedBills]);
  const fixedBillAmtByCat = useMemo(() => {
    const map: Record<string, number> = {};
    for (const b of nextFixedBills) map[b.category] = (map[b.category] ?? 0) + b.amount;
    return map;
  }, [nextFixedBills]);

  /** A category's regular amount (your plan without any one-cycle changes). */
  const regularPct = (c: Category) => {
    if (managedFixedCats.has(c.name)) return pctOfReg(fixedBillAmtByCat[c.name] ?? 0);
    return settings.customCategories.find(x => x.name === c.name)?.limitPct ?? settings.limitOverrides[c.name] ?? c.defaultLimitPct ?? builtInCategory(c.name)?.limitPct ?? 0;
  };
  const nextPct = (c: Category) => plan.limits?.[c.name] ?? regularPct(c);

  const save = (p: CyclePlan) => {
    latest.current = p;
    // Only this cycle's and later plans are kept.
    const now = cycleKey(cycle);
    const kept = Object.fromEntries(Object.entries(settings.cyclePlans ?? {}).filter(([k]) => k >= now && k !== key));
    update({ cyclePlans: { ...kept, [key]: p } });
  };

  const setAmount = (c: Category, amount: number) => {
    const cur = latest.current;
    const limits = { ...(cur.limits ?? {}) };
    const clean = Math.max(0, amount);
    // Enough decimals that the amount you typed comes back exactly (Rp 1.100.000, not 1.100.010).
    const pct = Math.round(pctOfReg(clean) * 1e8) / 1e8;
    if (Math.abs(pct - regularPct(c)) < 1e-6) delete limits[c.name];
    else limits[c.name] = pct;
    save({ ...cur, limits });
  };

  const setManyEveryday = (amounts: Record<string, number>, nextSavings?: number, nextInvest?: number) => {
    const cur = latest.current;
    const limits = { ...(cur.limits ?? {}) };
    for (const c of everyday) {
      if (!(c.name in amounts)) continue;
      const pct = Math.round(pctOfReg(Math.max(0, amounts[c.name])) * 1e8) / 1e8;
      if (Math.abs(pct - regularPct(c)) < 1e-6) delete limits[c.name];
      else limits[c.name] = pct;
    }
    const patch: CyclePlan = { ...cur, limits };
    if (nextSavings !== undefined) {
      const regSav = (settings.savingsPct / 100) * regularIncome;
      if (Math.abs(nextSavings - regSav) < 1) delete patch.savings;
      else patch.savings = Math.max(0, Math.round(nextSavings));
    }
    if (nextInvest !== undefined) {
      const effSav = patch.savings ?? (settings.savingsPct / 100) * regularIncome;
      const clamped = Math.min(effSav, Math.max(0, Math.round(nextInvest)));
      const regInv = Math.min(effSav, (settings.investPct / 100) * regularIncome);
      if (Math.abs(clamped - regInv) < 1) delete patch.invest;
      else patch.invest = clamped;
    } else if (patch.invest != null) {
      const effSav = patch.savings ?? (settings.savingsPct / 100) * regularIncome;
      if (patch.invest > effSav) patch.invest = effSav;
    }
    save(patch);
  };

  const costs = plan.costs ?? [];
  const setCosts = (list: PlannedCost[]) => save({ ...latest.current, costs: list });
  const setExtras = (list: PlannedInflow[]) => save({ ...latest.current, extras: list.length ? list : undefined });
  const setCycleIncome = (val: number | undefined) => {
    const cur = { ...latest.current };
    if (val == null || Math.abs(val - regularIncome) < 1) delete cur.income;
    else cur.income = Math.max(0, Math.round(val));
    save(cur);
  };
  const setSavings = (amount: number) => {
    const cur = { ...latest.current };
    const clean = Math.max(0, Math.round(amount));
    const regSav = (settings.savingsPct / 100) * regularIncome;
    if (Math.abs(clean - regSav) < 1) delete cur.savings;
    else cur.savings = clean;
    if (cur.invest != null && cur.invest > clean) cur.invest = clean;
    save(cur);
  };
  const setInvest = (amount: number) => {
    const cur = { ...latest.current };
    const clean = Math.min(savings, Math.max(0, Math.round(amount)));
    const regInv = Math.min(savings, (settings.investPct / 100) * regularIncome);
    if (Math.abs(clean - regInv) < 1) delete cur.invest;
    else cur.invest = clean;
    save(cur);
  };

  const fixed = CATEGORIES.filter(c => c.type === 'fixed' && !c.auto);
  const everyday = CATEGORIES.filter(c => c.type === 'variable');

  const regularEverydayMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of everyday) m[c.name] = amtOfReg(regularPct(c));
    return m;
  }, [everyday, settings, fixedBillAmtByCat, managedFixedCats]);

  const currentEverydayMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of everyday) m[c.name] = amtOfReg(nextPct(c));
    return m;
  }, [everyday, plan.limits, regularEverydayMap]);

  const projectedEverydayMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of everyday) {
      const now = budget.cats.find(x => x.name === c.name);
      m[c.name] = now && now.spent > 0 ? (now.spent / Math.max(1, cycle.dayN)) * cycle.cycleDays : 0;
    }
    return m;
  }, [everyday, budget.cats, cycle.dayN, cycle.cycleDays]);

  const fixedTotal = sum(fixed.map(c => amtOfReg(nextPct(c))));
  const legacyFixedTotal = sum(fixed.filter(c => !managedFixedCats.has(c.name)).map(c => amtOfReg(regularPct(c))));
  const regularEverydayTotal = sum(everyday.map(c => regularEverydayMap[c.name] ?? 0));
  const installments = sum(known.installments.map(b => b.amount));
  const oneOffs = sum(costs.map(c => c.amount));
  const committed = fixedTotal + installments + oneOffs;

  const regularSavings = (settings.savingsPct / 100) * regularIncome;
  const savings = plan.savings ?? regularSavings;
  const regularInvest = Math.min(savings, (settings.investPct / 100) * regularIncome);
  const invest = Math.min(savings, plan.invest ?? regularInvest);
  const bigCap = totalInflow * 0.1;
  const bigBucket = Math.min(bigCap, Math.max(0, savings - invest));
  const emergencyBucket = Math.max(0, savings - invest - bigBucket);

  const free = totalInflow - committed - savings;
  const everydayTotal = sum(everyday.map(c => currentEverydayMap[c.name] ?? 0));
  const left = free - everydayTotal;

  const firstCycleOverride = useMemo(
    () => ({ inflow: totalInflow, fixedTotal, everydayTotal, savings, invest }),
    [totalInflow, fixedTotal, everydayTotal, savings, invest],
  );

  const bufferPct = settings.bufferPct ?? 10;
  const bufferGoal = (bufferPct / 100) * totalInflow;
  const spare = Math.max(0, left - bufferGoal);
  const savingsRate = pctOfInflow(savings);
  const changedCount =
    Object.keys(plan.limits ?? {}).length +
    (plan.savings != null ? 1 : 0) +
    (plan.invest != null ? 1 : 0) +
    (plan.income != null ? 1 : 0) +
    extras.length;
  const fixedChanged = fixed.filter(c => Math.abs(amtOfReg(nextPct(c)) - amtOfReg(regularPct(c))) >= 1).length;

  // Live-reacting Maxie mood & commentary as you model the cycle.
  const modelMood: { face: MaxieMood; line: string; cheer: string } = (() => {
    if (left < -1) {
      return {
        face: 'steady',
        line: `Over-allocated by ${short(-left)} — trim a slider below or tap Auto-balance to land cleanly.`,
        cheer: 'Easy fix — one tap to balance!',
      };
    }
    if (spare >= step) {
      return {
        face: 'happy',
        line: `Nice! You have ${short(spare)} spare above your ${bufferPct}% buffer — put it to work in Investing or Savings.`,
        cheer: `${short(spare)} ready to deploy!`,
      };
    }
    if (left >= bufferGoal - 1 && savingsRate >= settings.savingsPct - 0.5) {
      return {
        face: 'happy',
        line: `Dialed in! ${savingsRate}% saved (${short(savings)}) with your ${bufferPct}% buffer fully covered.`,
        cheer: 'Model looks rock solid!',
      };
    }
    if (left >= 0 && left < bufferGoal) {
      return {
        face: 'curious',
        line: `Balanced, with ${short(left)} of your ${short(bufferGoal)} buffer goal — trim a little everyday spend for extra cushion.`,
        cheer: 'Almost at your buffer goal!',
      };
    }
    return {
      face: 'happy',
      line: `Every rupiah has a job — ${savingsRate}% going to savings and ${short(everydayTotal)} for everyday life.`,
      cheer: 'Looking great!',
    };
  })();

  const applyPreset = (preset: ModelPreset) => {
    const prev = structuredClone(latest.current);
    if (preset === 'usual') {
      const nextPlan: CyclePlan = { ...latest.current };
      delete nextPlan.limits;
      delete nextPlan.savings;
      delete nextPlan.invest;
      save(nextPlan);
      setToast({ text: 'Reset assignments back to your usual plan.', undo: () => save(prev) });
      return;
    }
    const res = buildPresetAmounts(preset, {
      totalInflow,
      committed,
      regularSavings,
      regularEveryday: regularEverydayMap,
      projectedEveryday: projectedEverydayMap,
      step,
    });
    setManyEveryday(res.everyday, res.savings);
    const label =
      preset === 'actuals'
        ? "Matched everyday categories to this cycle's projected pace."
        : preset === 'lean'
          ? 'Lean mode: trimmed everyday by 15% and routed savings into your goal.'
          : 'Save-more mode: boosted savings by +10% and balanced everyday.';
    setToast({ text: label, undo: () => save(prev) });
  };

  const runAutoBalance = () => {
    const prev = structuredClone(latest.current);
    const res = autoBalancePlan({
      totalInflow,
      committed,
      savings,
      everyday: currentEverydayMap,
      step,
    });
    setManyEveryday(res.everyday, res.savings);
    const parts = [
      res.trimmedEveryday > 0 ? `trimmed ${short(res.trimmedEveryday)} from everyday` : '',
      res.trimmedSavings > 0 ? `eased savings by ${short(res.trimmedSavings)}` : '',
    ].filter(Boolean);
    setToast({ text: `Balanced! ${parts.join(' and ')}.`, undo: () => save(prev) });
  };

  const assignSpare = (target: 'invest' | 'savings') => {
    if (spare <= 0) return;
    const prev = structuredClone(latest.current);
    const add = Math.floor(spare / step) * step || Math.round(spare);
    const nextSav = savings + add;
    const nextInv = target === 'invest' ? invest + add : invest;
    setManyEveryday({}, nextSav, nextInv);
    setToast({
      text: `Assigned ${short(add)} spare to ${target === 'invest' ? 'Investing' : 'Savings'} — nice move!`,
      undo: () => save(prev),
    });
  };

  const segs = [
    { key: 'Savings', label: 'Savings & investing', amount: savings, ink: SAVE_INK },
    { key: 'Committed', label: 'Fixed, installments & one-offs', amount: committed, ink: FIXED_INK },
    { key: 'Everyday', label: 'Everyday spending', amount: everydayTotal, ink: VAR_INK },
    ...(left > 0 ? [{ key: 'Buffer', label: 'Unassigned / buffer', amount: left, ink: FREE_INK }] : []),
  ].filter(x => x.amount > 0);
  const activeSeg = segs.find(x => x.key === hoverSeg);
  const modelHealthy = totalInflow > 0 && left >= bufferGoal - 1 && savingsRate >= settings.savingsPct - 0.5 && changedCount > 0;

  return (
    <div className={s.stack}>
      <Celebrate id={`model-ready-${key}`} when={modelHealthy} />

      {/* 1. Sticky Live Model Header & Allocation Waterfall */}
      <section className={s.modelHero} aria-label="Next cycle financial model overview">
        <div className={s.modelTopRow}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginRight: 'auto', minWidth: 0 }}>
            <h2 className={s.h2}>
              {dayMonth(next.start)} – {dayMonth(next.end)}
            </h2>
            <span style={{ fontSize: 13, color: C.textMuted }}>
              Payday {dayLabel(next.start)} · {next.cycleDays} days · activates automatically on payday
            </span>
          </div>
          {changedCount > 0 && <span className={s.modelTag}>{changedCount} custom {changedCount === 1 ? 'tweak' : 'tweaks'}</span>}
        </div>

        <div className={s.modelReaction}>
          <Logo size={34} mood={modelMood.face} interactive cheer={modelMood.cheer} />
          <p className={s.mxGreetingText}>{modelMood.line}</p>
        </div>

        <div className={s.mpBar} role="group" aria-label="Next cycle cashflow allocation">
          {segs.map(seg => (
            <button
              key={seg.key}
              type="button"
              className={s.mpBarSeg}
              data-dim={hoverSeg && hoverSeg !== seg.key ? true : undefined}
              style={{ flex: seg.amount, background: seg.ink }}
              title={`${seg.label}: ${full(seg.amount)} (${pctOfInflow(seg.amount)}%)`}
              aria-label={`${seg.label}: ${full(seg.amount)} (${pctOfInflow(seg.amount)}%)`}
              onMouseEnter={() => setHoverSeg(seg.key)}
              onMouseLeave={() => setHoverSeg(null)}
              onFocus={() => setHoverSeg(seg.key)}
              onBlur={() => setHoverSeg(null)}
            />
          ))}
        </div>

        {activeSeg ? (
          <div className={s.modelSegReadout}>
            <Dot color={activeSeg.ink} />
            <strong>{activeSeg.label}</strong>
            <span>
              {full(activeSeg.amount)} ({pctOfInflow(activeSeg.amount)}% of inflow)
            </span>
          </div>
        ) : (
          <div className={s.modelKpis}>
            <Kpi label="Total inflow" value={short(totalInflow)} sub={extrasTotal > 0 ? `+${short(extrasTotal)} extra` : undefined} />
            <Kpi label="Committed" value={short(committed)} sub={`${pctOfInflow(committed)}%`} />
            <Kpi label="Savings" value={short(savings)} sub={`${savingsRate}%`} ink={SAVE_INK} />
            <Kpi label="Everyday" value={short(everydayTotal)} sub={`${pctOfInflow(everydayTotal)}%`} />
            <Kpi
              label={left < 0 ? 'Over-allocated' : 'Unassigned'}
              value={left < 0 ? `−${short(-left)}` : short(left)}
              sub={left < 0 ? 'needs trim' : `goal ${short(bufferGoal)}`}
              ink={left < 0 ? C.redInk : left >= bufferGoal ? C.good : C.amberInk}
            />
          </div>
        )}

        <div className={s.modelPresetBar}>
          <span style={{ fontSize: 12, fontWeight: 600, color: C.textMuted }}>Scenario:</span>
          {(
            [
              ['usual', 'Usual'],
              ['actuals', 'Match actuals'],
              ['lean', 'Lean −15%'],
              ['save', 'Save +10%'],
            ] as [ModelPreset, string][]
          ).map(([id, label]) => (
            <button key={id} type="button" className={s.modelPresetChip} onClick={() => applyPreset(id)}>
              {label}
            </button>
          ))}
          {left < -1 && (
            <button type="button" className={s.btnPrimarySm} style={{ marginLeft: 'auto' }} onClick={runAutoBalance}>
              Auto-balance
            </button>
          )}
          {spare >= step && (
            <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
              <button type="button" className={s.btnPrimarySm} onClick={() => assignSpare('invest')}>
                +{short(spare)} → Investing
              </button>
              <button type="button" className={s.btnOutlineSm} onClick={() => assignSpare('savings')}>
                → Savings
              </button>
            </span>
          )}
        </div>
      </section>

      {/* 2. Money Coming In: Base Income + Extra Inflows */}
      <InflowsCard
        baseIncome={baseIncome}
        regularIncome={regularIncome}
        extras={extras}
        onSetBase={setCycleIncome}
        onSetExtras={setExtras}
      />

      {/* 3. Pay Yourself First: Savings & Investing Bucket Assignment */}
      <SavingsModelCard
        totalInflow={totalInflow}
        regularSavings={regularSavings}
        savings={savings}
        invest={invest}
        emergency={emergencyBucket}
        big={bigBucket}
        maxSavings={Math.max(savings, totalInflow - committed)}
        monthlySpend={Math.max(1, fixedTotal + everydayTotal)}
        step={saveStep}
        spare={spare}
        onSetSavings={setSavings}
        onSetInvest={setInvest}
        onAssignSpare={assignSpare}
      />

      {/* 4. Interactive Everyday Category Assignment Board */}
      <Card style={{ gap: 12 }}>
        <div className={s.cardHead}>
          <h2 className={s.h2}>Assign everyday spending</h2>
          <span className={s.caption}>
            {full(everydayTotal)} ({pctOfInflow(everydayTotal)}% of inflow)
          </span>
        </div>
        <span style={{ fontSize: 13, color: C.textMuted }}>
          Drag sliders or tap any amount to dial in next cycle. Your regular plan stays untouched.
        </span>

        <div className={s.modelCatList}>
          {everyday.map(c => (
            <CategorySliderRow
              key={c.name}
              c={c}
              amount={currentEverydayMap[c.name] ?? 0}
              regular={regularEverydayMap[c.name] ?? 0}
              projected={cycle.dayN >= 3 ? projectedEverydayMap[c.name] ?? 0 : 0}
              step={step}
              onChange={v => setAmount(c, v)}
            />
          ))}
        </div>

        <div style={{ borderTop: `1px solid ${C.divider}`, paddingTop: 8 }}>
          <button
            type="button"
            className={s.catFold}
            style={{ border: 'none', paddingLeft: 0 }}
            aria-expanded={showFixedOverrides}
            onClick={() => setShowFixedOverrides(v => !v)}
          >
            <Icon d={IC.chevDown} size={14} style={{ transform: showFixedOverrides ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
            {showFixedOverrides ? 'Hide' : 'Adjust'} fixed bill categories for next cycle ({full(fixedTotal)}
            {fixedChanged > 0 ? ` · ${fixedChanged} tweaked` : ''})
          </button>
          {showFixedOverrides && (
            <div style={{ paddingTop: 4 }}>
              {fixed.map(c => (
                <AmountRow key={c.name} c={c} amount={amtOfReg(nextPct(c))} regular={amtOfReg(regularPct(c))} onSave={v => setAmount(c, v)} />
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* 5. Multi-Cycle Financial Projection & "Can I Afford It?" Simulator */}
      <ProjectionCard
        next={next}
        regularIncome={regularIncome}
        legacyFixedTotal={legacyFixedTotal}
        regularEverydayTotal={regularEverydayTotal}
        regularSavings={regularSavings}
        regularInvest={Math.min(regularSavings, (settings.investPct / 100) * regularIncome)}
        firstCycleOverride={firstCycleOverride}
        onAddNextCost={(name, amount) => {
          const prev = structuredClone(latest.current);
          setCosts([
            ...costs,
            {
              id: 'cost_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
              name,
              amount,
              date: toISO(next.start),
              category: 'Buffer',
            },
          ]);
          setToast({ text: `Added ${name} (${short(amount)}) as a one-off cost for next cycle.`, undo: () => save(prev) });
        }}
      />

      {/* 6. What's Already Promised + Buffer Goal */}
      <Card style={{ gap: 10 }}>
        <h2 className={s.h2}>What's already promised</h2>
        <div className={s.planLines}>
          <Line label="Total inflow" value={full(totalInflow)} strong note={extrasTotal > 0 ? `Base ${short(baseIncome)} + ${short(extrasTotal)} extra` : undefined} />
          <Line label="Fixed bills" value={'− ' + full(fixedTotal)} />
          {nextFixedBills.length > 0 && (
            <>
              <span className={s.planSubHead}>Tracked fixed bills</span>
              {nextFixedBills.map(b => (
                <div key={b.title + b.date.getTime()} className={s.planSubLine}>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, marginRight: 'auto' }}>
                    <span className={s.ellipsis}>{tidyName(b.title)}</span>
                    <span style={{ fontSize: 13, color: C.textMuted }}>
                      {b.category}, due {dayMonth(b.date)}
                    </span>
                  </span>
                  <span style={{ whiteSpace: 'nowrap' }}>{full(b.amount)}</span>
                </div>
              ))}
            </>
          )}
          {known.subscriptions.length > 0 && (
            <>
              <span className={s.planSubHead}>Subscriptions due</span>
              {[...known.subscriptions]
                .sort((a, b) => a.date.getTime() - b.date.getTime())
                .map(b => (
                  <div key={b.title + b.date.getTime()} className={s.planSubLine}>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, marginRight: 'auto' }}>
                      <span className={s.ellipsis}>{tidyName(b.title)}</span>
                      <span style={{ fontSize: 13, color: C.textMuted }}>
                        {b.category}, due {dayMonth(b.date)}
                      </span>
                    </span>
                    <span style={{ whiteSpace: 'nowrap' }}>{full(b.amount)}</span>
                  </div>
                ))}
            </>
          )}
          {known.notAdded.length > 0 && (
            <>
              <span className={s.planSubHead}>Charged this cycle, not added yet</span>
              {known.notAdded.map(x => (
                <div key={x.key} className={s.planSubLine}>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, marginRight: 'auto' }}>
                    <span className={s.ellipsis}>{x.name}</span>
                    <span style={{ fontSize: 13, color: C.textMuted }}>
                      {full(perMonth(x))} a month, next about {dayMonth(new Date(x.next + 'T00:00:00'))}
                    </span>
                  </span>
                  <button
                    type="button"
                    className={s.btnOutlineSm}
                    onClick={() => {
                      const { key: _k, count: _c, ...sub } = x;
                      setSubscription(newSubId(), sub);
                    }}
                  >
                    Add
                  </button>
                  <button type="button" className={s.mxLinkBtn} onClick={() => update({ notSubscriptions: [...settings.notSubscriptions, x.key] })}>
                    Not a subscription
                  </button>
                </div>
              ))}
            </>
          )}
          {(() => {
            const subsCat = CATEGORIES.find(c => c.name === 'Subscriptions');
            const due = sum(known.subscriptions.filter(b => b.category === 'Subscriptions').map(b => b.amount));
            const planned = subsCat ? amtOfReg(nextPct(subsCat)) : 0;
            if (!subsCat || raiseGone || due <= planned * 1.05 + 1) return null;
            return (
              <MaxieNote
                text={`Your subscriptions due next cycle add up to ${full(due)}, but the plan for Subscriptions is ${full(planned)}. Raise it to ${full(due)}?`}
                actions={[
                  { label: `Raise to ${full(due)}`, primary: true, onClick: () => setAmount(subsCat, due) },
                  { label: 'Not now', onClick: () => setRaiseGone(true) },
                ]}
              />
            );
          })()}
          {installments > 0 && <Line label="Installments" value={'− ' + full(installments)} />}
          {[...known.installments
            .reduce((m, b) => {
              const k = b.title.replace(/ interest$/, '');
              const x = m.get(k);
              if (x) x.amount += b.amount;
              else m.set(k, { ...b, title: k, category: b.title.endsWith(' interest') ? '' : b.category });
              if (!b.title.endsWith(' interest')) m.get(k)!.category = b.category;
              return m;
            }, new Map<string, Bill>())
            .values()]
            .sort((a, b) => a.date.getTime() - b.date.getTime())
            .map(b => {
              const m = b.title.match(/^(.*) \((\d+)\/(\d+)\)$/);
              return (
                <div key={b.title} className={s.planSubLine}>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, marginRight: 'auto' }}>
                    <span className={s.ellipsis}>{m ? m[1] : b.title}</span>
                    <span style={{ fontSize: 13, color: C.textMuted }}>
                      {b.category}, {m ? `${m[2]} of ${m[3]}${m[2] === m[3] ? ', last payment' : ''}, ` : ''}due {dayMonth(b.date)}
                      {b.left ? `, ${full(b.left)} left after` : ''}
                    </span>
                  </span>
                  <span style={{ whiteSpace: 'nowrap' }}>{full(b.amount)}</span>
                </div>
              );
            })}
          {oneOffs > 0 && <Line label="One-off costs" value={'− ' + full(oneOffs)} note={costs.map(c => c.name).join(', ')} />}
          <Line label={`Savings and investing (${savingsRate}%)`} value={'− ' + full(savings)} />
          <div className={s.planDivider} />
          <Line label="Free for everyday spending" value={full(free)} strong ink={free < 0 ? C.redInk : undefined} />
          <Line label="Everyday plan" value={'− ' + full(everydayTotal)} />
        </div>
        <BufferBar left={left} income={totalInflow} pct={bufferPct} onPct={v => update({ bufferPct: v })} />
      </Card>

      <OneOffs next={next} costs={costs} onChange={setCosts} />

      <Suggestions cycle={cycle} budget={budget} nextPct={nextPct} onApply={(c, amount) => setAmount(c, amount)} />

      <PurrCheck
        payload={() => ({
          city: settings.city || undefined,
          language: settings.maxieLanguage === 'id' ? 'Bahasa Indonesia' : 'English',
          currency: settings.currency,
          nextCycle: { start: toISO(next.start), end: toISO(next.end), days: next.cycleDays },
          today: { cycleDay: cycle.dayN, cycleDays: cycle.cycleDays },
          income: totalInflow,
          baseIncome,
          extras: extras.map(x => ({ name: x.name, amount: Math.round(x.amount) })),
          savingsTargetPct: savingsRate,
          bufferGoal,
          bufferPct,
          left,
          promised: { fixedBills: fixedTotal, installments, oneOffs, savings, invest },
          fixedBills: nextFixedBills.map(b => ({ title: tidyName(b.title), category: b.category, amount: Math.round(b.amount), date: toISO(b.date) })),
          installments: known.installments.map(b => ({ title: tidyName(b.title), amount: Math.round(b.amount), date: toISO(b.date) })),
          subscriptions: known.subscriptions.map(b => ({ title: tidyName(b.title), amount: Math.round(b.amount), date: toISO(b.date) })),
          oneOffs: costs.map(c => ({ name: c.name, amount: c.amount, date: c.date, category: c.category })),
          categories: [...everyday, ...fixed].map(c => {
            const now = budget.cats.find(x => x.name === c.name);
            return {
              name: c.name,
              type: c.type,
              next: Math.round(amtOfReg(nextPct(c))),
              usual: Math.round(amtOfReg(regularPct(c))),
              thisCycle: now ? Math.round((now.spent / Math.max(1, cycle.dayN)) * cycle.cycleDays) : 0,
              lastCycle: now ? Math.round(sum(now.prev)) : 0,
              spending: spendingProfile(cycle, budget, c.name),
            };
          }),
        })}
        amountOfCategory={name => {
          const c = CATEGORIES.find(x => x.name === name);
          return c ? amtOfReg(nextPct(c)) : 0;
        }}
        onApply={(name, amount) => {
          const c = CATEGORIES.find(x => x.name === name);
          if (c) setAmount(c, amount);
        }}
      />

      {toast && (
        <Toast
          text={toast.text}
          action={toast.undo ? 'Undo' : undefined}
          onAction={
            toast.undo
              ? () => {
                  toast.undo?.();
                  setToast(null);
                }
              : undefined
          }
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}

function Kpi({ label, value, sub, ink }: { label: string; value: string; sub?: string; ink?: string }) {
  return (
    <div className={s.modelKpi}>
      <span className={s.modelKpiLabel}>{label}</span>
      <span className={s.modelKpiVal} style={{ color: ink }}>
        {value}
      </span>
      {sub && <span className={s.modelKpiSub}>{sub}</span>}
    </div>
  );
}

/** Per-cycle base income override + extra inflows (Bonus, THR, Freelance, Dividend). */
function InflowsCard({
  baseIncome,
  regularIncome,
  extras,
  onSetBase,
  onSetExtras,
}: {
  baseIncome: number;
  regularIncome: number;
  extras: PlannedInflow[];
  onSetBase: (v: number | undefined) => void;
  onSetExtras: (list: PlannedInflow[]) => void;
}) {
  const { settings, full, short } = useSettings();
  const idr = settings.currency === 'IDR';
  const [editingBase, setEditingBase] = useState(false);
  const [addingExtra, setAddingExtra] = useState(false);
  const [name, setName] = useState('');
  const [amtText, setAmtText] = useState('');

  const amount = idr ? Number(amtText.replace(/\D/g, '')) : Number(amtText.replace(/[^\d.]/g, ''));
  const valid = name.trim().length > 0 && amount > 0;
  const baseDiffers = Math.abs(baseIncome - regularIncome) >= 1;
  const total = baseIncome + sum(extras.map(x => x.amount));

  const addExtra = () => {
    if (!valid) return;
    onSetExtras([...extras, { id: 'in_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: name.trim().slice(0, 50), amount }]);
    setName('');
    setAmtText('');
    setAddingExtra(false);
  };

  return (
    <Card style={{ gap: 10 }}>
      <div className={s.cardHead}>
        <h2 className={s.h2}>Money coming in</h2>
        <span className={s.caption}>{full(total)} total inflow</span>
      </div>

      <div className={s.planLines}>
        <div className={s.planLine}>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 1, marginRight: 'auto', minWidth: 0 }}>
            <span style={{ fontWeight: 600 }}>Base income</span>
            {baseDiffers && <span style={{ fontSize: 12, color: C.textMuted }}>Usually {short(regularIncome)}</span>}
          </span>
          <button type="button" className={s.modelAmtBtn} onClick={() => setEditingBase(v => !v)} title="Adjust base income for this cycle only">
            {full(baseIncome)}
          </button>
        </div>

        {editingBase && (
          <div style={{ padding: '6px 0 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <AmountEditor
              label="Base income next cycle"
              initial={baseIncome}
              onSave={v => {
                onSetBase(v);
                setEditingBase(false);
              }}
              onCancel={() => setEditingBase(false)}
            />
            {baseDiffers && (
              <button
                type="button"
                className={s.textBtnSm}
                style={{ alignSelf: 'flex-start', padding: 0 }}
                onClick={() => {
                  onSetBase(undefined);
                  setEditingBase(false);
                }}
              >
                Reset to usual {short(regularIncome)}
              </button>
            )}
          </div>
        )}

        {extras.map(x => (
          <div key={x.id} className={s.planLine}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 'auto', minWidth: 0 }}>
              <span className={s.badgeDot} style={{ background: C.good }} aria-hidden="true" />
              <span className={s.ellipsis}>{x.name}</span>
            </span>
            <span style={{ fontWeight: 600, color: C.good, whiteSpace: 'nowrap' }}>+ {full(x.amount)}</span>
            <button type="button" className={s.iconBtnSm} aria-label={`Remove ${x.name}`} onClick={() => onSetExtras(extras.filter(y => y.id !== x.id))}>
              <Icon d={IC.close} size={14} />
            </button>
          </div>
        ))}
      </div>

      {addingExtra ? (
        <form
          className={s.modelExtraForm}
          onSubmit={e => {
            e.preventDefault();
            addExtra();
          }}
        >
          <div className={s.tplGrid}>
            {EXTRA_PRESETS.map(p => (
              <button key={p} type="button" className={s.tplOpt} aria-pressed={name === p} onClick={() => setName(p)}>
                {p}
              </button>
            ))}
          </div>
          <div className={s.fbFormGrid}>
            <label className={s.field}>
              <span>Source</span>
              <input className={s.input} autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Bonus, Freelance" maxLength={50} />
            </label>
            <label className={s.field}>
              <span>Amount ({settings.currency})</span>
              <input
                className={s.input}
                inputMode="decimal"
                value={amtText}
                onChange={e => setAmtText(idr ? (Number(e.target.value.replace(/\D/g, '')) || '').toLocaleString('id-ID') : e.target.value)}
                placeholder={idr ? 'e.g. 5.000.000' : 'e.g. 500'}
              />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className={s.btnPrimarySm} disabled={!valid}>
              Add inflow
            </button>
            <button type="button" className={s.btnGhost} onClick={() => setAddingExtra(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className={s.catFold} style={{ color: C.clayInk, fontWeight: 600, borderTop: 'none', paddingLeft: 0 }} onClick={() => setAddingExtra(true)}>
          <Icon d={IC.plus} size={14} />
          Add extra inflow (bonus, THR, dividend, freelance)
        </button>
      )}
    </Card>
  );
}

/** Interactive Pay-Yourself-First card: live Savings slider + Investing / Emergency / Big-costs bucket split. */
function SavingsModelCard({
  totalInflow,
  regularSavings,
  savings,
  invest,
  emergency,
  big,
  maxSavings,
  monthlySpend,
  step,
  spare,
  onSetSavings,
  onSetInvest,
  onAssignSpare,
}: {
  totalInflow: number;
  regularSavings: number;
  savings: number;
  invest: number;
  emergency: number;
  big: number;
  maxSavings: number;
  monthlySpend: number;
  step: number;
  spare: number;
  onSetSavings: (v: number) => void;
  onSetInvest: (v: number) => void;
  onAssignSpare: (target: 'invest' | 'savings') => void;
}) {
  const { full, short } = useSettings();
  const [editing, setEditing] = useState(false);
  const pct = totalInflow > 0 ? Math.round((savings / totalInflow) * 1000) / 10 : 0;
  const invPct = totalInflow > 0 ? Math.round((invest / totalInflow) * 1000) / 10 : 0;
  const sliderMax = Math.max(step, Math.ceil(Math.max(maxSavings, regularSavings, savings) / step) * step);
  const differs = Math.abs(savings - regularSavings) >= 1;

  return (
    <Card style={{ gap: 14 }}>
      <div className={s.cardHead}>
        <h2 className={s.h2}>Pay yourself first</h2>
        <span className={s.caption}>
          {pct}% of inflow {differs ? `(usually ${short(regularSavings)})` : ''}
        </span>
      </div>

      <div className={s.modelSliderBlock}>
        <div className={s.modelSliderHead}>
          <span style={{ fontWeight: 600 }}>Total savings &amp; investing</span>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <button type="button" className={s.mxNudgeBtn} disabled={savings <= 0} aria-label="Decrease savings" onClick={() => onSetSavings(Math.max(0, savings - step))}>
              <Icon d={IC.minus} size={12} />
            </button>
            <button type="button" className={s.modelAmtBtn} onClick={() => setEditing(v => !v)} title="Type an exact savings amount">
              {full(savings)}
            </button>
            <button type="button" className={s.mxNudgeBtn} disabled={savings >= sliderMax} aria-label="Increase savings" onClick={() => onSetSavings(Math.min(sliderMax, savings + step))}>
              <Icon d={IC.plus} size={12} />
            </button>
          </div>
        </div>
        <input
          type="range"
          className={s.moveSlider}
          min={0}
          max={sliderMax}
          step={step}
          value={Math.min(sliderMax, Math.round(savings))}
          onChange={e => onSetSavings(Number(e.target.value))}
          aria-label="Total savings for next cycle"
        />
        {editing && (
          <AmountEditor
            label="Total savings next cycle"
            initial={savings}
            onSave={v => {
              onSetSavings(v);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        )}
      </div>

      {savings > 0 && (
        <div className={s.modelBuckets}>
          <div className={s.modelBucket}>
            <div className={s.modelSliderHead}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13.5, fontWeight: 600 }}>
                <Dot color="var(--category-1)" size={8} /> Investing
              </span>
              <span style={{ fontSize: 13.5, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                {short(invest)} <span style={{ color: C.textMuted, fontWeight: 400 }}>({invPct}%)</span>
              </span>
            </div>
            <input
              type="range"
              className={s.moveSlider}
              min={0}
              max={Math.max(step, Math.round(savings))}
              step={Math.min(step, Math.max(1, Math.round(savings)))}
              value={Math.min(Math.round(savings), Math.round(invest))}
              onChange={e => onSetInvest(Number(e.target.value))}
              aria-label="Investing share of next cycle savings"
            />
          </div>
          <div className={s.modelBucketRow}>
            <span className={s.modelMiniBucket}>
              <span className={s.modelKpiLabel}>Emergency fund</span>
              <strong>{short(emergency)}</strong>
              <span className={s.modelKpiSub}>Target 6× spend ({short(monthlySpend * 6)})</span>
            </span>
            <span className={s.modelMiniBucket}>
              <span className={s.modelKpiLabel}>Planned big costs</span>
              <strong>{short(big)}</strong>
              <span className={s.modelKpiSub}>Travel, devices, annuals</span>
            </span>
          </div>
        </div>
      )}

      {(differs || spare >= step) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {spare >= step && (
            <button type="button" className={s.btnOutlineSm} onClick={() => onAssignSpare('invest')}>
              Add {short(spare)} spare to Investing
            </button>
          )}
          {differs && (
            <button type="button" className={s.textBtnSm} style={{ padding: 0 }} onClick={() => onSetSavings(regularSavings)}>
              Reset to usual {short(regularSavings)}
            </button>
          )}
        </div>
      )}
    </Card>
  );
}

/** One Everyday category in the financial model: live slider, nudge buttons, exact editor, and projected benchmark. */
function CategorySliderRow({
  c,
  amount,
  regular,
  projected,
  step,
  onChange,
}: {
  c: Category;
  amount: number;
  regular: number;
  projected: number;
  step: number;
  onChange: (v: number) => void;
}) {
  const { short, full } = useSettings();
  const [editing, setEditing] = useState(false);
  const delta = amount - regular;
  const differs = Math.abs(delta) >= 1;
  const sliderMax = Math.max(step * 10, roundStep(Math.max(regular * 2, projected * 1.5, amount * 1.25), step));
  const showMatchProj = projected > 0 && Math.abs(roundStep(projected, step) - amount) >= step;

  return (
    <div className={s.modelCatRow}>
      <div className={s.modelCatTop}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0, marginRight: 'auto' }}>
          <Dot color={c.color} size={9} />
          <span style={{ fontWeight: 600, fontSize: 14.5 }}>{c.name}</span>
          {differs && (
            <span className={s.modelDelta} data-up={delta > 0 || undefined}>
              {delta > 0 ? `+${short(delta)}` : `−${short(-delta)}`}
            </span>
          )}
        </span>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <button
            type="button"
            className={s.mxNudgeBtn}
            disabled={amount <= 0}
            aria-label={`Decrease ${c.name} by ${short(step)}`}
            onClick={() => onChange(Math.max(0, amount - step))}
          >
            <Icon d={IC.minus} size={11} />
          </button>
          <button type="button" className={s.modelAmtBtn} onClick={() => setEditing(v => !v)} title={`Type exact amount for ${c.name}`}>
            {amount > 0 ? short(amount) : 'None'}
          </button>
          <button
            type="button"
            className={s.mxNudgeBtn}
            aria-label={`Increase ${c.name} by ${short(step)}`}
            onClick={() => onChange(amount + step)}
          >
            <Icon d={IC.plus} size={11} />
          </button>
        </div>
      </div>

      <input
        type="range"
        className={s.moveSlider}
        style={{ accentColor: c.color }}
        min={0}
        max={sliderMax}
        step={step}
        value={Math.min(sliderMax, Math.round(amount))}
        onChange={e => onChange(Number(e.target.value))}
        aria-label={`${c.name} next cycle budget`}
      />

      <div className={s.modelCatMeta}>
        <span>
          Usual {short(regular)}
          {projected > 0 ? ` · This cycle proj ${short(projected)}` : ''}
        </span>
        <span style={{ display: 'inline-flex', gap: 10 }}>
          {showMatchProj && (
            <button type="button" className={s.modelMicroLink} onClick={() => onChange(roundStep(projected, step))}>
              Match proj ({short(roundStep(projected, step))})
            </button>
          )}
          {differs && (
            <button type="button" className={s.modelMicroLink} onClick={() => onChange(regular)}>
              Reset
            </button>
          )}
        </span>
      </div>

      {editing && (
        <div style={{ paddingTop: 4 }}>
          <AmountEditor
            label={`${c.name} next cycle (${full(amount)})`}
            initial={amount}
            onSave={v => {
              onChange(v);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        </div>
      )}
    </div>
  );
}

/** What's left unplanned against the buffer goal (a share of income you keep free), with the goal adjustable. */
function BufferBar({ left, income, pct, onPct }: { left: number; income: number; pct: number; onPct: (v: number) => void }) {
  const { short } = useSettings();
  const goal = (pct / 100) * income;
  const state = left < 0 ? 'over' : left < goal ? 'short' : 'met';
  const ink = state === 'over' ? C.redInk : state === 'short' ? C.amberInk : C.good;
  const bar = state === 'over' ? C.red : state === 'short' ? C.amber : C.good;
  const fill = goal > 0 ? Math.max(0, Math.min(1, left / goal)) : left >= 0 ? 1 : 0;
  return (
    <div className={s.bufferBox}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{ fontWeight: 600, marginRight: 'auto' }}>Buffer</span>
        <span style={{ fontWeight: 650, color: ink, whiteSpace: 'nowrap' }}>
          {state === 'over' ? `${short(-left)} over income` : `${short(left)} of ${short(goal)}`}
        </span>
      </div>
      <span className={s.sumTrack} role="img" aria-label={`Buffer ${Math.round(fill * 100)}% of the goal`}>
        <span className={s.sumFill} style={{ width: fill * 100 + '%', background: bar }} />
      </span>
      <label className={s.bufferGoal}>
        <span>Goal</span>
        <input type="range" min={0} max={25} step={1} value={pct} onChange={e => onPct(Number(e.target.value))} aria-label="Buffer goal, % of income" />
        <span style={{ minWidth: 36, textAlign: 'right', fontWeight: 600 }}>{pct}%</span>
      </label>
    </div>
  );
}

/**
 * Maxie on the next cycle: "Plan it for me" sets an amount for each everyday category from your real spending,
 * "Check my plan" reviews the plan you made. Either way, each amount is applied with a tap (or all at once) and
 * can be undone.
 */
function PurrCheck({
  payload,
  amountOfCategory,
  onApply,
}: {
  payload: () => unknown;
  amountOfCategory: (name: string) => number;
  onApply: (name: string, amount: number) => void;
}) {
  const { short, settings } = useSettings();
  const city = settings.city?.trim();
  const [state, setState] = useState<'' | 'working' | 'done'>('');
  const [mode, setMode] = useState<'build' | 'check'>('build');
  const [waited, setWaited] = useState(0);
  const [result, setResult] = useState<PlanCheck | null>(null);
  const [applied, setApplied] = useState<Record<string, number>>({});
  useEffect(() => {
    if (state !== 'working') return;
    const t = setInterval(() => setWaited(w => w + 1), 1000);
    return () => clearInterval(t);
  }, [state]);
  const run = async (m: 'build' | 'check') => {
    setMode(m);
    setState('working');
    setWaited(0);
    setApplied({});
    try {
      setResult(await checkPlan({ ...(payload() as object), mode: m }));
    } catch (e) {
      setResult({ error: 'api', detail: e instanceof Error ? e.message : String(e) });
    }
    setState('done');
  };
  // Changes that would actually change something.
  const changes = (result?.changes ?? []).filter(c => applied[c.category] != null || Math.abs(amountOfCategory(c.category) - c.amount) >= 1);
  const open = changes.filter(c => applied[c.category] == null);
  const apply = (c: { category: string; amount: number }) => {
    setApplied(a => ({ ...a, [c.category]: amountOfCategory(c.category) }));
    onApply(c.category, c.amount);
  };
  return (
    <Card style={{ gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Logo size={30} mood={state === 'working' ? 'curious' : 'happy'} interactive cheer="Let's set next cycle up for a win!" />
        <span style={{ fontFamily: 'var(--font-serif)', fontSize: 19, fontWeight: 500, marginRight: 'auto' }}>Maxie</span>
      </div>
      {state === 'working' ? (
        <span className={s.thinking} role="status" aria-live="polite">
          <span className={s.thinkLabel}>
            {waited < 3
              ? 'Reading your whole plan…'
              : waited < 8
                ? 'Looking at where your money goes…'
                : city && waited < 20
                  ? `Checking prices in ${city}…`
                  : mode === 'build'
                    ? 'Setting your amounts…'
                    : thinkingLabel(waited)}
          </span>
          <ThinkingArcs />
        </span>
      ) : state === 'done' && result?.error ? (
        <span style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14, color: C.redInk }}>
          {result.error === 'no_key'
            ? "I can't plan yet: I need my Gemini API key."
            : result.error === 'quota'
              ? "I've hit my Gemini limit for now. Try again in a minute, or tomorrow if it keeps happening."
              : "Sorry, I couldn't do that just now. Try again in a minute?"}
          {result.detail && result.error !== 'quota' && <span style={{ fontSize: 12, color: C.textMuted, wordBreak: 'break-word' }}>{result.detail}</span>}
        </span>
      ) : state === 'done' && result?.verdict ? (
        <>
          <p className={s.insightBody} style={{ fontSize: 17, lineHeight: '26px' }}>
            {result.verdict}
          </p>
          {(result.notes ?? []).length > 0 && (
            <ul className={s.maxieNotes}>
              {result.notes!.map(n => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          {result.searched && city && <span style={{ fontSize: 12, color: C.textMuted }}>I compared with typical prices in {city}.</span>}
        </>
      ) : (
        <p className={s.insightBody} style={{ fontSize: 17, lineHeight: '26px' }}>
          Want me to plan next cycle from what you actually spend? I'll look over the whole model and keep your buffer covered.
        </p>
      )}
      {changes.map(c => {
        const done = applied[c.category] != null;
        const from = done ? applied[c.category] : amountOfCategory(c.category);
        return (
          <div key={c.category} className={s.changeRow}>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, marginRight: 'auto', minWidth: 0 }}>
              <span style={{ fontWeight: 600 }}>
                {c.category}{' '}
                <span style={{ fontWeight: 500, color: C.textMuted }}>
                  {short(from)} → {short(c.amount)}
                </span>
              </span>
              {c.why && <span style={{ fontSize: 13, color: C.textMuted }}>{c.why}</span>}
            </span>
            {done ? (
              <button
                type="button"
                className={s.textBtnSm}
                onClick={() => {
                  onApply(c.category, applied[c.category]);
                  setApplied(a => Object.fromEntries(Object.entries(a).filter(([k]) => k !== c.category)));
                }}
              >
                Undo
              </button>
            ) : (
              <button type="button" className={s.btnOutlineSm} onClick={() => apply(c)}>
                Apply
              </button>
            )}
          </div>
        );
      })}
      {state !== 'working' && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {open.length > 1 && (
            <button type="button" className={s.btnPrimarySm} onClick={() => open.forEach(apply)}>
              Apply all {open.length}
            </button>
          )}
          {state !== 'done' && (
            <button type="button" className={s.btnPrimarySm} onClick={() => run('build')}>
              Plan it for me
            </button>
          )}
          <button type="button" className={s.btnOutlineSm} onClick={() => run('check')}>
            {state === 'done' && mode === 'check' ? 'Check again' : 'Check my plan'}
          </button>
          {state === 'done' && (
            <button type="button" className={s.textBtnSm} onClick={() => run('build')}>
              Plan it again
            </button>
          )}
        </div>
      )}
    </Card>
  );
}

function Line({ label, value, note, strong, ink }: { label: string; value: string; note?: string; strong?: boolean; ink?: string }) {
  return (
    <div className={s.planLine}>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, marginRight: 'auto' }}>
        <span style={{ fontWeight: strong ? 600 : 400 }}>{label}</span>
        {note && <span style={{ fontSize: 13, color: C.textMuted }}>{note}</span>}
      </span>
      <span style={{ fontWeight: strong ? 650 : 500, whiteSpace: 'nowrap', color: ink ?? C.text }}>{value}</span>
    </div>
  );
}

/** A category's amount for the next cycle: tap to change it; shows the regular amount when it differs. */
function AmountRow({ c, amount, regular, onSave }: { c: Category; amount: number; regular: number; onSave: (v: number) => void }) {
  const { short } = useSettings();
  const [open, setOpen] = useState(false);
  const differs = Math.abs(amount - regular) >= 1;
  return (
    <div>
      <button type="button" className={s.planAmountRow} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 1, marginRight: 'auto', minWidth: 0 }}>
          <span>{c.name}</span>
          {differs && <span style={{ fontSize: 12, color: C.textMuted }}>Usually {short(regular)}</span>}
        </span>
        <span style={{ fontWeight: 600, whiteSpace: 'nowrap', color: amount > 0 ? C.text : C.textMuted }}>{amount > 0 ? short(amount) : 'None'}</span>
        <Icon d={IC.chevDown} size={15} color={C.textMuted} style={{ transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && (
        <div style={{ padding: '4px 0 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <AmountEditor
            label={`${c.name} next cycle`}
            initial={amount}
            onSave={v => {
              onSave(v);
              setOpen(false);
            }}
            onCancel={() => setOpen(false)}
          />
          {differs && (
            <button
              type="button"
              className={s.textBtnSm}
              style={{ alignSelf: 'flex-start', padding: 0 }}
              onClick={() => {
                onSave(regular);
                setOpen(false);
              }}
            >
              Back to the usual {short(regular)}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * From how this cycle is going (spending so far, carried to the end of the cycle): raise a category that's on
 * track to go over, or trim one that will use much less. One tap sets it for the next cycle.
 */
function Suggestions({ cycle, budget, nextPct, onApply }: { cycle: Cycle; budget: Budget; nextPct: (c: Category) => number; onApply: (c: Category, amount: number) => void }) {
  const { settings, short } = useSettings();
  if (cycle.dayN < 7) return null;
  const step = settings.currency === 'IDR' ? 50_000 : 5;
  const up = (v: number) => Math.ceil(v / step) * step;
  const list = budget.cats
    .filter(c => c.type === 'variable' && c.limit > 0)
    .map(c => {
      const projected = (c.spent / cycle.dayN) * cycle.cycleDays;
      const cat = categoryByName(c.name)!;
      const planned = (nextPct(cat) / 100) * settings.income;
      if (projected > c.limit * 1.1) {
        const to = up(projected);
        return to > planned + step / 2 ? { cat, to, text: `${c.name} is heading for ${short(projected)} this cycle, against a plan of ${short(c.limit)}.`, verb: 'Plan' } : null;
      }
      // Only categories you've actually used: nothing spent yet says nothing about next cycle.
      if (c.spent > 0 && projected < c.limit * 0.6 && c.limit - projected >= step * 4) {
        const to = up(projected * 1.15);
        return to < planned - step / 2 ? { cat, to, text: `${c.name} will likely use only ${short(projected)} of ${short(c.limit)}.`, verb: 'Plan' } : null;
      }
      return null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .slice(0, 4);
  if (!list.length) return null;
  return (
    <Card style={{ gap: 10 }}>
      <h2 className={s.h2}>From this cycle</h2>
      {list.map(x => (
        <div key={x.cat.name} className={s.suggestRow}>
          <span style={{ fontSize: 14, lineHeight: 1.45, marginRight: 'auto', minWidth: 0 }}>{x.text}</span>
          <button type="button" className={s.btnOutlineSm} style={{ flex: 'none' }} onClick={() => onApply(x.cat, x.to)}>
            {x.verb} {short(x.to)}
          </button>
        </div>
      ))}
    </Card>
  );
}

/**
 * Costs you already know are coming in a cycle (a wedding gift, a car service): each is set aside as a bill in its
 * category until a matching payment comes in. `paid`: the ones already paid (This cycle only).
 */
function OneOffs({
  next,
  costs,
  onChange,
  title = 'One-off costs',
  hint = 'Anything extra next cycle: a wedding gift, a trip, a car service.',
  from,
  paid,
}: {
  next: Cycle;
  costs: PlannedCost[];
  onChange: (list: PlannedCost[]) => void;
  title?: string;
  hint?: string;
  /** The earliest date allowed (today, for this cycle). */
  from?: Date;
  paid?: Set<string>;
}) {
  const { settings, full } = useSettings();
  const idr = settings.currency === 'IDR';
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const first = from ?? next.start;
  const [date, setDate] = useState(toISO(new Date(Math.min(first.getTime() + 7 * 864e5, next.end.getTime()))));
  const [category, setCategory] = useState('Buffer');
  const value = idr ? Number(amount.replace(/\D/g, '')) : Number(amount.replace(/[^\d.]/g, ''));
  const valid = name.trim() && value > 0 && date >= toISO(first) && date <= toISO(next.end);
  const add = () => {
    if (!valid) return;
    onChange([...costs, { id: Math.random().toString(36).slice(2, 10), name: name.trim().slice(0, 60), amount: value, date, category }]);
    setName('');
    setAmount('');
    setAdding(false);
  };
  return (
    <Card style={{ gap: 8 }}>
      <div className={s.cardHead}>
        <h2 className={s.h2}>{title}</h2>
        {costs.length > 0 && <span className={s.caption}>{full(sum(costs.map(c => c.amount)))} set aside</span>}
      </div>
      {costs.length === 0 && !adding && <span style={{ fontSize: 14, color: C.textMuted }}>{hint}</span>}
      {[...costs]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map(c => (
          <div key={c.id} className={s.planLine}>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, marginRight: 'auto' }}>
              <span>{c.name}</span>
              <span style={{ fontSize: 13, color: C.textMuted }}>
                {dayMonth(new Date(c.date + 'T00:00:00'))}, {c.category}
                {paid?.has(c.id) ? ', paid' : ''}
              </span>
            </span>
            <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{full(c.amount)}</span>
            <button type="button" className={s.iconBtnSm} aria-label={`Remove ${c.name}`} onClick={() => onChange(costs.filter(x => x.id !== c.id))}>
              <Icon d={IC.close} size={14} />
            </button>
          </div>
        ))}
      {adding ? (
        <form
          className={s.costForm}
          onSubmit={e => {
            e.preventDefault();
            add();
          }}
        >
          <label className={s.field}>
            <span>What</span>
            <input className={s.input} autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Wedding gift" maxLength={60} />
          </label>
          <label className={s.field}>
            <span>Amount</span>
            <input
              className={s.input}
              inputMode="decimal"
              value={amount}
              onChange={e => setAmount(idr ? (Number(e.target.value.replace(/\D/g, '')) || '').toLocaleString('id-ID') : e.target.value)}
              placeholder={idr ? 'e.g. 500.000' : 'e.g. 50'}
            />
          </label>
          <label className={s.field}>
            <span>When</span>
            <input className={s.input} type="date" value={date} min={toISO(first)} max={toISO(next.end)} onChange={e => setDate(e.target.value)} />
          </label>
          <label className={s.field}>
            <span>Category</span>
            <Select value={category} onChange={setCategory} ariaLabel="Category" options={CATEGORIES.filter(c => !c.auto).map(c => ({ value: c.name, label: c.name, dot: c.color }))} />
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className={s.btnPrimary} disabled={!valid}>
              Add
            </button>
            <button type="button" className={s.btnGhost} onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className={s.catFold} style={{ color: C.clayInk, fontWeight: 600, borderTop: costs.length ? undefined : 'none', paddingLeft: 0 }} onClick={() => setAdding(true)}>
          <Icon d={IC.plus} size={14} />
          {title === 'One-off costs' ? 'Add a one-off cost' : 'Add a planned expense'}
        </button>
      )}
    </Card>
  );
}

/**
 * This cycle's planned expenses (Plan tab, This cycle): costs you already know are coming before payday. Each is
 * set aside as a bill in its category until a matching payment comes in, then shows as paid.
 */
export function PlannedExpenses({ cycle, budget }: { cycle: Cycle; budget: Budget }) {
  const { settings, update } = useSettings();
  const key = cycleKey(cycle);
  const plan: CyclePlan = settings.cyclePlans?.[key] ?? {};
  const latest = useRef(plan);
  latest.current = plan;
  const costs = plan.costs ?? [];
  const spending = budget.txs.filter(t => t.type === 'expense').map(t => ({ id: t.id, date: t.date, amount: t.amount, cat: t.cat }));
  const paid = new Set(matchCosts(costs, spending).keys());
  const save = (list: PlannedCost[]) => {
    const p = { ...latest.current, costs: list };
    latest.current = p;
    update({ cyclePlans: { ...(settings.cyclePlans ?? {}), [key]: p } });
  };
  return (
    <OneOffs
      next={cycle}
      from={cycle.today}
      costs={costs}
      onChange={save}
      paid={paid}
      title="Planned expenses"
      hint="Something you already know is coming before payday? Add it and I'll set the money aside in its category."
    />
  );
}
