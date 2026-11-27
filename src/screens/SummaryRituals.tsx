import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type TouchEvent as ReactTouchEvent } from 'react';
import s from '../styles/ui.module.css';
import { IC, Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { categoryByName, SAVINGS_TARGET_PCT } from '../data/categories';
import type { Budget, TxView } from '../lib/budget';
import type { Cycle } from '../lib/cycle';
import { dayMonth, tidyName, toISO } from '../lib/format';
import { useSettings } from '../lib/settings';
import { storage } from '../lib/storage';
import { haptic } from '../lib/haptics';
import {
  buildShareableFlexSummary,
  evaluateBenchmarks,
  IMPULSE_TRIGGERS,
  type ImpulseTrigger,
  type JoyVote,
  type WealthSnapshot,
} from '../lib/wealth';

export type VignetteScene = 'payday' | 'bloom' | 'cozy' | 'rain' | 'steady';

/** Determine Maxie's living window scene from your real cycle state. */
export function resolveVignetteScene({
  cycle,
  budget: b,
  target,
  streak,
  todaySpend,
}: {
  cycle: Cycle;
  budget: Budget;
  target: number;
  streak: number;
  todaySpend: number;
}): { scene: VignetteScene; label: string; sub: string } {
  const left = b.budget - b.spent - b.fixedDue;
  if (cycle.dayN === 1) {
    return { scene: 'payday', label: 'Payday morning', sub: 'Fresh sunlight across a clean cycle.' };
  }
  if (left < 0) {
    return { scene: 'rain', label: 'Quiet rain outside', sub: 'Cozy indoors — easy to pace gently from here.' };
  }
  if (target > 0 && b.saved >= target) {
    return { scene: 'bloom', label: 'Window sill in bloom', sub: `Savings goal reached at ${Math.round(b.savedPct)}%.` };
  }
  if (streak >= 3 || todaySpend === 0) {
    return { scene: 'cozy', label: 'Warm lamp & tea', sub: streak >= 3 ? `${streak} calm days in a row.` : 'Zero spent so far today.' };
  }
  return { scene: 'steady', label: 'Clear afternoon', sub: 'Steady clouds and comfortable room ahead.' };
}

/** Minimalist ceramic/editorial window illustration (180×76 viewBox) adapting cleanly to Light & Dark mode. */
export function VignetteSvg({ scene }: { scene: VignetteScene }) {
  return (
    <svg viewBox="0 0 180 76" className={s.vigSvg}>
      {/* Soft room backdrop */}
      <rect x="0" y="0" width="180" height="76" rx="12" fill="var(--bg)" />
      {/* Arched window */}
      <path
        d="M16 58 V28 A26 24 0 0 1 68 28 V58 Z"
        fill={scene === 'rain' ? 'var(--sky-soft)' : scene === 'payday' ? 'var(--amber-tint)' : scene === 'bloom' ? 'var(--good-soft)' : 'var(--surface)'}
        stroke="var(--border-strong)"
        strokeWidth="1.4"
      />
      {/* Window pane crossbars */}
      <line x1="42" y1="6" x2="42" y2="58" stroke="var(--border)" strokeWidth="1.1" />
      <line x1="16" y1="35" x2="68" y2="35" stroke="var(--border)" strokeWidth="1.1" />

      {/* Outside-window weather by scene */}
      {scene === 'payday' && (
        <g>
          <circle cx="42" cy="31" r="9.5" fill="var(--amber)" opacity="0.82" />
          <path d="M42 15v3M28 21l2 2M56 21l-2 2M24 31h3M57 31h3" stroke="var(--amber)" strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
        </g>
      )}
      {scene === 'rain' && (
        <g stroke="var(--sky)" strokeWidth="1.3" strokeLinecap="round" opacity="0.72" className={s.vigRain}>
          <line x1="27" y1="18" x2="23" y2="27" />
          <line x1="39" y1="14" x2="35" y2="24" />
          <line x1="53" y1="19" x2="49" y2="29" />
          <line x1="32" y1="39" x2="28" y2="49" />
          <line x1="49" y1="40" x2="45" y2="50" />
        </g>
      )}
      {(scene === 'steady' || scene === 'bloom' || scene === 'cozy') && (
        <g opacity="0.65" className={s.vigDrift}>
          <path d="M24 24 Q28 19 33 23 Q37 19 41 24 Z" fill="var(--category-9)" opacity="0.45" />
          <path d="M46 29 Q50 25 54 28 Q57 26 60 29 Z" fill="var(--category-9)" opacity="0.35" />
        </g>
      )}

      {/* Windowsill & shelf */}
      <rect x="11" y="57" width="158" height="4" rx="2" fill="var(--border-strong)" opacity="0.65" />

      {/* Right side: cozy lamp + steaming mug (cozy / rain) or blooming botanical pot (bloom / payday / steady) */}
      {(scene === 'cozy' || scene === 'rain') ? (
        <g>
          {/* Warm desk lamp glow */}
          <ellipse cx="145" cy="40" rx="20" ry="15" fill="var(--amber)" opacity="0.16" />
          <path d="M137 32 L153 32 L157 42 L133 42 Z" fill="var(--clay)" opacity="0.9" />
          <line x1="145" y1="42" x2="145" y2="57" stroke="var(--ink-muted)" strokeWidth="1.8" />
          <line x1="138" y1="57" x2="152" y2="57" stroke="var(--ink-muted)" strokeWidth="2" strokeLinecap="round" />
          {/* Steaming ceramic mug */}
          <rect x="114" y="47" width="11" height="10" rx="2.5" fill="var(--surface)" stroke="var(--clay)" strokeWidth="1.4" />
          <path d="M125 49.5 H127 A2 2 0 0 1 127 54 H125" fill="none" stroke="var(--clay)" strokeWidth="1.3" />
          <path d="M118 44 Q119.5 41 118 39 M121.5 44 Q123 41 121.5 39" fill="none" stroke="var(--ink-muted)" strokeWidth="1.1" strokeLinecap="round" className={s.bootSteam} />
        </g>
      ) : (
        <g>
          {/* Ceramic pot + thriving botanical plant */}
          <path d="M136 46 H152 L149.5 57 H138.5 Z" fill="var(--clay)" opacity="0.88" />
          <path d="M144 46 Q144 33 136 28 Q143 32 144 38" fill="none" stroke="var(--good)" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M144 46 Q145 31 153 26 Q147 32 144 38" fill="none" stroke="var(--good)" strokeWidth="1.8" strokeLinecap="round" />
          <ellipse cx="135" cy="27" rx="4.5" ry="2.4" transform="rotate(-24 135 27)" fill="var(--good)" />
          <ellipse cx="154" cy="25" rx="4.5" ry="2.4" transform="rotate(24 154 25)" fill="var(--good)" />
          {scene === 'bloom' && (
            <>
              <circle cx="144" cy="22" r="3.4" fill="var(--amber)" />
              <circle cx="144" cy="22" r="1.4" fill="var(--surface)" />
            </>
          )}
        </g>
      )}

      {/* Calm sitting Siberian Husky Maxie on the windowsill */}
      <g transform="translate(74 26)">
        {/* Thick curled husky plume tail (wolf-grey outer, snow-white inner) */}
        <path d="M27 29 Q37 26 35 18 Q33 14 28 19" fill="none" stroke="#4F5A67" strokeWidth="4.2" strokeLinecap="round" />
        <path d="M28 28 Q35 25 34 19.5" fill="none" stroke="#F4F0E8" strokeWidth="2" strokeLinecap="round" />
        {/* Sturdy husky body (wolf-grey mantle + fluffy snow-white chest bib) */}
        <path d="M11 31 C9.5 22 13 15 20.5 14 C28 15 30 22 28.5 31 Z" fill="#4F5A67" />
        <path d="M15.5 31 C15 24 17 19 20.5 18.5 C24 19 25.5 24 24.5 31 Z" fill="#F4F0E8" />
        {/* Warm terracotta collar */}
        <path d="M15 19.5 Q20.5 22 26 19.5" fill="none" stroke="var(--clay)" strokeWidth="2" strokeLinecap="round" />
        {/* Husky head: closer upright ears, fluffy wolf cheek tufts, white forehead blaze & mask */}
        <path d="M13.5 14 L15 5.5 L19.5 10.5 Q21.5 9.8 23.5 10.5 L28 5.5 L29.5 14 L31 16.5 L28.5 18.2 C27.2 21 24.2 22.2 21.5 22.2 C18.8 22.2 15.8 21 14.5 18.2 L12 16.5 Z" fill="#4F5A67" />
        <path d="M16 8 L15.4 12.2 L18.2 11 Z M27 8 L27.6 12.2 L24.8 11 Z" fill="#F4F0E8" />
        <path d="M21.5 11.4 L22.5 14.6 C24.8 14.2 27.6 15.6 27.6 18.2 C27 20.6 24.4 21.8 21.5 21.8 C18.6 21.8 16 20.6 15.4 18.2 C15.4 15.6 18.2 14.2 20.5 14.6 Z" fill="#F4F0E8" />
        {/* White husky brow pips */}
        <circle cx="18.6" cy="13.5" r="0.85" fill="#F4F0E8" />
        <circle cx="24.4" cy="13.5" r="0.85" fill="#F4F0E8" />
        {/* Ice-blue eyes & dark dog nose */}
        <circle cx="18.8" cy="16.2" r="1.15" fill="#7AC7EE" />
        <circle cx="24.2" cy="16.2" r="1.15" fill="#7AC7EE" />
        <circle cx="18.8" cy="16.2" r="0.55" fill="#1F252C" />
        <circle cx="24.2" cy="16.2" r="0.55" fill="#1F252C" />
        <ellipse cx="21.5" cy="18.4" rx="1.5" ry="1.05" fill="#1F252C" />
      </g>
    </svg>
  );
}

/**
 * "Story of Your Cycle" — a calm, 4-card full-bleed interactive pop-up deck with unique Siberian Husky illustrations
 * (mountain ridge run, serene alpine lake trot, twilight camp lantern, and golden-hour meadow daily check-in).
 * Auto-opens once on first visit of the day (outside Quiet mode) and can be replayed anytime from Summary.
 */
export function CycleStoryModal({
  cycle,
  budget: b,
  wealth,
  pyfStreak,
  open,
  onClose,
}: {
  cycle: Cycle;
  budget: Budget;
  wealth?: WealthSnapshot;
  pyfStreak?: number;
  open: boolean;
  onClose: () => void;
}) {
  const { short, full, settings, update } = useSettings();
  const [idx, setIdx] = useState(0);
  const [dir, setDir] = useState<-1 | 0 | 1>(0);
  const [slot, setSlot] = useState(() => cycle.today.getDate() % 3);
  const [revealed, setRevealed] = useState(false);
  const [flexCopied, setFlexCopied] = useState(false);
  const [drag, setDrag] = useState<{ x: number; y: number; active: boolean }>({ x: 0, y: 0, active: false });
  const touchRef = useRef<{ x: number; y: number; axis?: 'h' | 'v'; top: number } | null>(null);
  const didGestureRef = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const goCard = (next: number) => {
    const clamped = Math.max(0, Math.min(3, next));
    if (clamped === idx) return;
    setDir(clamped > idx ? 1 : -1);
    setIdx(clamped);
    haptic('tick', settings.quietMode);
  };

  // Yesterday's biggest everyday spend (or latest everyday spend if yesterday was zero).
  const targetTx: TxView | null = useMemo(() => {
    const varSpend = b.txs.filter(t => !t.isIncome && !t.isTransfer && categoryByName(t.cat)?.type === 'variable' && t.net > 0);
    const yesterday = varSpend.filter(t => t.offset === cycle.dayIdx - 1).sort((a, z) => z.net - a.net)[0];
    if (yesterday) return yesterday;
    return varSpend[0] ?? null;
  }, [b.txs, cycle.dayIdx]);

  const voteKey = targetTx ? `moneyTracker.joy.${targetTx.id}` : '';
  const storedCheck = targetTx ? settings.joyChecks?.[targetTx.id] : undefined;
  const [vote, setVote] = useState<JoyVote | null>(() => storedCheck?.vote ?? (voteKey ? storage.get<JoyVote | null>(voteKey, null) : null));
  const [trigger, setTrigger] = useState<ImpulseTrigger | undefined>(() => storedCheck?.trigger);
  useEffect(() => {
    setVote(storedCheck?.vote ?? (voteKey ? storage.get<JoyVote | null>(voteKey, null) : null));
    setTrigger(storedCheck?.trigger);
  }, [voteKey, storedCheck?.vote, storedCheck?.trigger]);

  const castVote = (v: JoyVote) => {
    if (!voteKey || !targetTx) return;
    haptic('tap', settings.quietMode);
    storage.set(voteKey, v);
    setVote(v);
    const nextTrigger = v === 'skip' ? trigger : undefined;
    setTrigger(nextTrigger);
    update({
      joyChecks: {
        ...(settings.joyChecks ?? {}),
        [targetTx.id]: { vote: v, ...(nextTrigger ? { trigger: nextTrigger } : {}), at: toISO(cycle.today) },
      },
    });
  };

  const pickTrigger = (tr: ImpulseTrigger) => {
    if (!targetTx) return;
    haptic('tick', settings.quietMode);
    const next = trigger === tr ? undefined : tr;
    setTrigger(next);
    update({
      joyChecks: {
        ...(settings.joyChecks ?? {}),
        [targetTx.id]: { vote: 'skip', ...(next ? { trigger: next } : {}), at: toISO(cycle.today) },
      },
    });
  };

  useEffect(() => {
    if (!open) return;
    setIdx(0);
    setDir(0);
    setRevealed(false);
    setDrag({ x: 0, y: 0, active: false });
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') {
        setDir(1);
        setIdx(i => Math.min(3, i + 1));
      } else if (e.key === 'ArrowLeft') {
        setDir(-1);
        setIdx(i => Math.max(0, i - 1));
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  const stats = useMemo(() => {
    const daysSoFar = Math.min(cycle.dayIdx + 1, cycle.cycleDays);
    const byDay = new Array<number>(daysSoFar).fill(0);
    const varByDay = new Array<number>(daysSoFar).fill(0);
    const merch = new Map<string, { name: string; count: number; total: number }>();
    for (const t of b.txs) {
      if (t.isIncome || t.isTransfer || t.net <= 0) continue;
      if (t.offset >= 0 && t.offset < daysSoFar && categoryByName(t.cat)) {
        byDay[t.offset] += t.net;
        if (categoryByName(t.cat)?.type === 'variable') varByDay[t.offset] += t.net;
      }
      const nm = tidyName(t.title);
      const cur = merch.get(nm);
      if (cur) {
        cur.count++;
        cur.total += t.net;
      } else {
        merch.set(nm, { name: nm, count: 1, total: t.net });
      }
    }
    let wdSum = 0, wdDays = 0, weSum = 0, weDays = 0;
    for (let i = 0; i < daysSoFar; i++) {
      const dow = cycle.dateOf(i).getDay();
      if (dow === 0 || dow === 6) {
        weSum += varByDay[i];
        weDays++;
      } else {
        wdSum += varByDay[i];
        wdDays++;
      }
    }
    const wdAvg = wdDays > 0 ? wdSum / wdDays : 0;
    const weAvg = weDays > 0 ? weSum / weDays : 0;
    const zeroDays = byDay.filter(v => v <= 0).length;
    const peakIdx = byDay.reduce((m, v, i) => (v > byDay[m] ? i : m), 0);
    const favSpot = [...merch.values()].sort((a, z) => z.count - a.count || z.total - a.total)[0];
    const topVar = b.cats.filter(c => c.type === 'variable' && c.spent > 0).sort((a, z) => z.spent - a.spent)[0];
    const improved = b.cats
      .filter(c => c.type === 'variable' && c.lastSameDays > 0 && c.spent < c.lastSameDays * 0.88)
      .map(c => ({ name: c.name, pct: Math.round(((c.lastSameDays - c.spent) / c.lastSameDays) * 100) }))
      .sort((a, z) => z.pct - a.pct)[0];
    const left = b.budget - b.spent - b.fixedDue;
    return {
      zeroDays,
      peakIdx,
      peakVal: byDay[peakIdx] ?? 0,
      favSpot,
      topVar,
      improved,
      left,
      rhythm: { wdAvg, weAvg, hasBoth: wdDays >= 2 && weDays >= 1 && (wdAvg > 0 || weAvg > 0) },
    };
  }, [b, cycle]);

  if (!open) return null;

  const prompts: ('joy' | 'curiosity' | 'target')[] = [];
  if (targetTx) prompts.push('joy');
  if (stats.rhythm.hasBoth) prompts.push('curiosity');
  prompts.push('target');
  const activePrompt = prompts[slot % prompts.length];
  const gentleTarget = b.safeDay > 0 ? Math.round(b.safeDay * 0.85) : 0;
  const voteReply: Record<JoyVote, string> = {
    worth: 'Noted — spending on things you truly enjoy is money well spent.',
    everyday: 'Got it — part of your normal rhythm.',
    skip: 'Good catch — small awareness like this quietly saves a lot next cycle.',
  };

  const benchmark = evaluateBenchmarks({
    savedPct: b.savedPct,
    runwayMonths: wealth?.runwayMonths ?? 0,
    emergencyFund: wealth?.emergencyFund ?? 0,
    targetMonths: settings.emergencyTargetMonths,
  });

  const copyCalmFlex = () => {
    const text = buildShareableFlexSummary({
      cycleLabel: `${dayMonth(cycle.start)} – ${dayMonth(cycle.end)}`,
      savedPct: b.savedPct,
      zeroSpendDays: stats.zeroDays,
      dayN: cycle.dayN,
      cycleDays: cycle.cycleDays,
      runwayMonths: wealth?.runwayMonths,
      pyfStreak,
      freedomPct: wealth?.freedomPct,
    });
    navigator.clipboard?.writeText(text).then(() => {
      haptic('success', settings.quietMode);
      setFlexCopied(true);
      setTimeout(() => setFlexCopied(false), 2200);
    });
  };

  const cards = [
    {
      kicker: `Day ${cycle.dayN} of ${cycle.cycleDays} · Your Rhythm`,
      title: stats.zeroDays >= 2 ? `${stats.zeroDays} quiet zero-spend days so far` : 'Finding your cycle rhythm',
      art: <MountainRunSvg />,
      body:
        stats.peakVal > 0
          ? `Your calmest stretches balance out your busiest day on ${dayMonth(cycle.dateOf(stats.peakIdx))} (${short(stats.peakVal)}).`
          : 'A clean, unhurried start to the cycle — enjoy the open trail ahead.',
      chips: [
        { label: 'Zero-spend days', val: String(stats.zeroDays) },
        { label: 'Daily pace', val: `${short(b.velDay)}/day` },
      ],
      interactive: false,
      showFlex: false,
    },
    {
      kicker: 'Your Signatures',
      title: stats.favSpot ? `${stats.favSpot.name} is your go-to spot` : 'Your everyday favorites',
      art: <LakeTrotSvg />,
      body: stats.improved
        ? `${stats.improved.name} is running ${stats.improved.pct}% lighter than last cycle at this point — a quiet win worth noticing.`
        : stats.topVar
          ? `${stats.topVar.name} leads your everyday spending at ${full(stats.topVar.spent)} so far.`
          : 'Your everyday patterns will come into focus as transactions roll in.',
      chips: [
        ...(stats.favSpot ? [{ label: 'Most visited', val: `${stats.favSpot.count}× · ${short(stats.favSpot.total)}` }] : []),
        ...(stats.topVar ? [{ label: 'Top everyday', val: stats.topVar.name }] : []),
      ],
      interactive: false,
      showFlex: false,
    },
    {
      kicker: `${cycle.daysLeft + 1} ${cycle.daysLeft === 0 ? 'day' : 'days'} to payday · Your Trajectory`,
      title: stats.left >= 0 ? `${short(stats.left)} of breathing room left` : `Slightly above plan by ${short(-stats.left)}`,
      art: <TwilightCampSvg />,
      body:
        (SAVINGS_TARGET_PCT > 0 && b.savedPct >= SAVINGS_TARGET_PCT
          ? `Savings goal is already met at ${Math.round(b.savedPct)}% — cruise gently into payday ${dayMonth(cycle.next)}. `
          : stats.left >= 0
            ? `Keeping near ${short(b.safeDay)}/day carries you calmly to payday on ${dayMonth(cycle.next)}. `
            : `No stress — a couple of quiet days brings your pace smoothly back toward plan by ${dayMonth(cycle.next)}. `) +
        benchmark.savingSummary,
      chips: [
        { label: 'Saved so far', val: `${Math.round(b.savedPct)}%` },
        ...(wealth && wealth.runwayMonths > 0
          ? [{ label: 'Runway', val: `${wealth.runwayMonths.toFixed(1)} mo` }]
          : [{ label: 'Safe daily pace', val: short(b.safeDay) }]),
      ],
      interactive: false,
      showFlex: true,
    },
    {
      kicker: 'Daily Check-In',
      title:
        activePrompt === 'joy' && targetTx
          ? `How did ${tidyName(targetTx.title)} feel?`
          : activePrompt === 'curiosity'
            ? 'Weekends vs. weekdays'
            : 'A gentle target for today',
      art: <GoldenMeadowSvg />,
      body: '',
      chips: [] as { label: string; val: string }[],
      interactive: true,
      showFlex: false,
    },
  ];

  const card = cards[idx];

  const onStoryTouchStart = (e: ReactTouchEvent) => {
    if (e.touches.length !== 1) return;
    const p = e.touches[0];
    didGestureRef.current = false;
    touchRef.current = { x: p.clientX, y: p.clientY, top: contentRef.current?.scrollTop ?? 0 };
  };
  const onStoryTouchMove = (e: ReactTouchEvent) => {
    const st = touchRef.current;
    if (!st || e.touches.length !== 1) return;
    const p = e.touches[0];
    const dx = p.clientX - st.x;
    const dy = p.clientY - st.y;
    if (!st.axis) {
      if (Math.hypot(dx, dy) < 10) return;
      if (Math.abs(dx) > Math.abs(dy) * 1.15) st.axis = 'h';
      else if (dy > 0 && st.top <= 2) st.axis = 'v';
      else {
        touchRef.current = null;
        return;
      }
    }
    didGestureRef.current = true;
    if (st.axis === 'h') {
      setDrag({ x: Math.max(-96, Math.min(96, dx * 0.45)), y: 0, active: true });
    } else if (st.axis === 'v') {
      setDrag({ x: 0, y: Math.max(0, Math.min(220, dy)), active: true });
    }
  };
  const onStoryTouchEnd = () => {
    const st = touchRef.current;
    touchRef.current = null;
    if (st?.axis === 'h') {
      if (drag.x <= -22) goCard(idx + 1);
      else if (drag.x >= 22) goCard(idx - 1);
    } else if (st?.axis === 'v' && drag.y >= 78) {
      haptic('tick', settings.quietMode);
      setDrag({ x: 0, y: 0, active: false });
      onClose();
      return;
    }
    setDrag({ x: 0, y: 0, active: false });
  };
  const onStoryClick = (e: ReactMouseEvent<HTMLElement>) => {
    if (didGestureRef.current) {
      didGestureRef.current = false;
      return;
    }
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea, [role="tab"], [role="group"]')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / Math.max(1, rect.width);
    if (relX < 0.3) {
      goCard(idx - 1);
    } else if (!card.interactive) {
      goCard(idx + 1);
    }
  };

  const modalTransform =
    drag.y > 0
      ? `translateY(${drag.y.toFixed(1)}px) scale(${(1 - Math.min(0.06, drag.y / 2400)).toFixed(3)})`
      : drag.x !== 0
        ? `translateX(${drag.x.toFixed(1)}px)`
        : undefined;

  return (
    <div className={s.storyOverlay} onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <section
        className={`${s.storyModal} fade-in`}
        data-card={idx}
        data-own-gestures
        role="dialog"
        aria-modal="true"
        aria-label="Story of your cycle"
        onTouchStart={onStoryTouchStart}
        onTouchMove={onStoryTouchMove}
        onTouchEnd={onStoryTouchEnd}
        onTouchCancel={onStoryTouchEnd}
        onClick={onStoryClick}
        style={
          modalTransform
            ? {
                transform: modalTransform,
                opacity: drag.y > 0 ? Math.max(0.55, 1 - drag.y / 360) : undefined,
                transition: drag.active ? 'none' : 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1), opacity 220ms ease',
              }
            : undefined
        }
      >
        {/* Full-bleed seamless background illustration covering the entire card */}
        <div key={`art-${idx}`} className={s.storyBg} aria-hidden="true">
          {card.art}
        </div>

        {/* Floating top progress bars + frosted close button */}
        <div className={s.storyTop}>
          <div className={s.storyDots} role="tablist" aria-label="Story cards">
            {cards.map((c, i) => (
              <button
                key={c.kicker}
                type="button"
                role="tab"
                aria-selected={i === idx}
                aria-label={`Card ${i + 1} of ${cards.length}`}
                className={s.storyDot}
                data-active={i === idx || undefined}
                data-past={i < idx || undefined}
                onClick={() => goCard(i)}
              />
            ))}
          </div>
          <button type="button" className={s.storyClose} aria-label="Close story" onClick={onClose}>
            <Icon d={IC.close} size={15} />
          </button>
        </div>

        {idx === 0 && (
          <span className={`${s.storyHint} ${s.mobileOnly}`} aria-hidden="true">
            Tap edges or swipe · pull down to close
          </span>
        )}

        {/* Lower seamless editorial overlay floating over the landscape's atmospheric fade */}
        <div ref={contentRef} className={s.storyContent}>
          <div
            key={`copy-${idx}-${card.interactive ? activePrompt : 'static'}`}
            className={`${s.storyCopy} ${dir > 0 ? s.storyCopyNext : dir < 0 ? s.storyCopyPrev : ''}`}
          >
            <div className={s.storyKickerRow}>
              <span className={s.storyKicker}>{card.kicker}</span>
              {card.interactive && prompts.length > 1 && (
                <button
                  type="button"
                  className={s.storyPromptSwitch}
                  onClick={() => {
                    haptic('tick', settings.quietMode);
                    setRevealed(false);
                    setSlot(n => n + 1);
                  }}
                >
                  Another prompt
                </button>
              )}
            </div>
            <h2 className={s.storyTitle}>{card.title}</h2>

            {!card.interactive ? (
              <>
                <p className={s.storyText}>{card.body}</p>
                {card.chips.length > 0 && (
                  <div className={s.storyChips}>
                    {card.chips.map(ch => (
                      <div key={ch.label} className={s.storyChip}>
                        <span className={s.storyChipLabel}>{ch.label}</span>
                        <strong className={s.storyChipVal}>{ch.val}</strong>
                      </div>
                    ))}
                  </div>
                )}
                {card.showFlex && (
                  <div className={s.storyPillRow} style={{ marginTop: 4 }}>
                    <button type="button" className={s.storyPill} data-active={flexCopied || undefined} onClick={copyCalmFlex}>
                      <Icon d={flexCopied ? IC.check : IC.copy} size={13} />{' '}
                      {flexCopied ? 'Copied (% only, no amounts)' : 'Share calm flex (% only)'}
                    </button>
                  </div>
                )}
              </>
            ) : activePrompt === 'joy' && targetTx ? (
              <>
                <p className={s.storyText}>
                  {full(targetTx.net)} in {targetTx.cat} — quick gut check before heading into today.
                </p>
                <div className={s.storyPillRow} role="group" aria-label="Rate how this spend felt">
                  {(
                    [
                      ['worth', 'Worth it'],
                      ['everyday', 'Everyday'],
                      ['skip', 'Could skip next time'],
                    ] as [JoyVote, string][]
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      className={s.storyPill}
                      data-active={vote === k || undefined}
                      aria-pressed={vote === k}
                      onClick={() => castVote(k)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {vote === 'skip' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                    <span className={s.storyNote}>What sparked it? (spot impulse lures)</span>
                    <div className={s.storyPillRow} role="group" aria-label="Impulse trigger">
                      {IMPULSE_TRIGGERS.map(tr => (
                        <button
                          key={tr.key}
                          type="button"
                          className={s.storyPill}
                          data-active={trigger === tr.key || undefined}
                          aria-pressed={trigger === tr.key}
                          onClick={() => pickTrigger(tr.key)}
                          title={tr.hint}
                        >
                          {tr.short}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {vote && <span className={s.storyNote}>{voteReply[vote]}</span>}
              </>
            ) : activePrompt === 'curiosity' ? (
              !revealed ? (
                <>
                  <p className={s.storyText}>Curious how your weekend spending compares to your weekdays this cycle?</p>
                  <div className={s.storyPillRow}>
                    <button
                      type="button"
                      className={s.storyPill}
                      onClick={() => {
                        haptic('tap', settings.quietMode);
                        setRevealed(true);
                      }}
                    >
                      Tap to reveal
                    </button>
                  </div>
                </>
              ) : (
                <div className={s.storyReveal}>
                  <p className={s.storyText}>
                    {stats.rhythm.weAvg > stats.rhythm.wdAvg * 1.15 ? (
                      <>
                        Weekends average <strong>{(stats.rhythm.weAvg / Math.max(1, stats.rhythm.wdAvg)).toFixed(1)}×</strong> your weekdays —{' '}
                        <strong>{short(stats.rhythm.weAvg)}/day</strong> vs. <strong>{short(stats.rhythm.wdAvg)}/day</strong>.
                      </>
                    ) : stats.rhythm.wdAvg > stats.rhythm.weAvg * 1.15 ? (
                      <>
                        Weekdays run higher than weekends — <strong>{short(stats.rhythm.wdAvg)}/day</strong> vs. <strong>{short(stats.rhythm.weAvg)}/day</strong>.
                      </>
                    ) : (
                      <>
                        Super balanced — weekdays (<strong>{short(stats.rhythm.wdAvg)}/day</strong>) and weekends (<strong>{short(stats.rhythm.weAvg)}/day</strong>) are nearly identical.
                      </>
                    )}
                  </p>
                  <span className={s.storyNote}>Knowing your natural tempo makes planning effortless.</span>
                </div>
              )
            ) : (
              <>
                <p className={s.storyText}>
                  {stats.left >= 0 && gentleTarget > 0 ? (
                    <>
                      Keeping today under <strong>{short(gentleTarget)}</strong> adds an extra <strong>{short(b.safeDay - gentleTarget)}</strong> to your cushion before payday.
                    </>
                  ) : (
                    <>One quiet low-spend day today softens your cycle pace and eases you gently back toward plan.</>
                  )}
                </p>
                <span className={s.storyNote}>No pressure — small calm days carry the whole month.</span>
              </>
            )}
          </div>

          <div className={s.storyFoot}>
            <Logo size={26} mood={idx === 2 ? 'happy' : idx === 3 ? 'curious' : 'calm'} followCursor />
            <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
              {idx > 0 && (
                <button type="button" className={s.storyBtnGhost} onClick={() => goCard(idx - 1)}>
                  Back
                </button>
              )}
              {idx < cards.length - 1 ? (
                <button type="button" className={s.storyBtnPrimary} onClick={() => goCard(idx + 1)}>
                  Next
                </button>
              ) : (
                <button
                  type="button"
                  className={s.storyBtnPrimary}
                  onClick={() => {
                    haptic('success', settings.quietMode);
                    onClose();
                  }}
                >
                  Continue to Summary
                </button>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

/** Card 1 Art (Full-Card Seamless): Siberian Husky Maxie bounding cheerfully along a misty dawn mountain ridge. */
function MountainRunSvg() {
  return (
    <svg viewBox="0 0 420 560" preserveAspectRatio="xMidYMid slice" className={s.storySvg}>
      <defs>
        <linearGradient id="stMtnSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#263638" />
          <stop offset="32%" stopColor="#4F6B6B" />
          <stop offset="56%" stopColor="#C9A88C" />
          <stop offset="100%" stopColor="#1B2724" />
        </linearGradient>
        <radialGradient id="stMtnSun" cx="72%" cy="22%" r="36%">
          <stop offset="0%" stopColor="#F5D3A3" stopOpacity="0.88" />
          <stop offset="45%" stopColor="#E6B284" stopOpacity="0.32" />
          <stop offset="100%" stopColor="#E6B284" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="stMtnFade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1A2623" stopOpacity="0" />
          <stop offset="38%" stopColor="#1A2623" stopOpacity="0.06" />
          <stop offset="55%" stopColor="#1A2623" stopOpacity="0.72" />
          <stop offset="72%" stopColor="#1A2623" stopOpacity="0.96" />
          <stop offset="100%" stopColor="#16201E" stopOpacity="1" />
        </linearGradient>
      </defs>

      {/* Painterly dawn sky */}
      <rect width="420" height="560" fill="url(#stMtnSky)" />
      <rect width="420" height="340" fill="url(#stMtnSun)" />

      {/* Calm rising dawn sun */}
      <circle cx="304" cy="118" r="24" fill="#F9E3C0" opacity="0.88" />

      {/* Soft high alpine mist clouds */}
      <g fill="#F4EBE0" opacity="0.22" className={s.vigDrift}>
        <ellipse cx="104" cy="96" rx="46" ry="9" />
        <ellipse cx="130" cy="91" rx="28" ry="8" />
        <ellipse cx="264" cy="84" rx="34" ry="7" />
      </g>

      {/* Distant snow-dusted mountain range */}
      <path d="M-10 250 L74 148 L142 198 L228 118 L314 196 L382 146 L430 202 V360 H-10 Z" fill="#3B5152" />
      {/* Subtle sunlit snow ridges on peaks */}
      <path d="M228 118 L244 152 L226 144 L214 156 Z M74 148 L88 172 L75 168 L64 176 Z M382 146 L392 168 L380 164 Z" fill="#EFE7DC" opacity="0.52" />

      {/* Midground pine-covered mountain slope */}
      <path d="M-10 278 L108 186 L196 238 L296 174 L430 258 V390 H-10 Z" fill="#2D423E" />

      {/* Foreground sunlit alpine meadow ridge where Maxie runs */}
      <path d="M-10 272 Q112 232 222 252 T430 238 V560 H-10 Z" fill="#293E37" />
      <path d="M-10 276 Q116 238 228 258 T430 246 V320 H-10 Z" fill="#3E5C50" opacity="0.52" />

      {/* Minimalist alpine pines framing the trail */}
      <g fill="#1F332E" opacity="0.9">
        <path d="M36 266 L48 224 L60 266 Z" />
        <path d="M58 269 L68 238 L78 269 Z" />
        <path d="M342 252 L354 212 L366 252 Z" />
        <path d="M368 256 L376 230 L384 256 Z" />
      </g>

      {/* Soft meadow grass wisps */}
      <g stroke="#7B9B8A" strokeWidth="1.5" strokeLinecap="round" opacity="0.42">
        <path d="M98 274 Q96 265 101 260 M105 275 Q107 267 110 263 M292 268 Q290 259 295 254" fill="none" />
      </g>

      {/* Ground shadow under running husky */}
      <ellipse cx="212" cy="264" rx="46" ry="6.5" fill="#131E1B" opacity="0.38" />

      {/* Siberian Husky Maxie bounding joyously along the alpine ridge */}
      <g transform="translate(148 182)">
        <g className={s.storyMaxieRun}>
          {/* Thick, fluffy curled Siberian Husky plume tail (wolf-grey top, snow-white underside & tip) */}
          <path d="M16 42 C2 35 -4 18 8 10 C17 5 26 14 23 28" fill="#444F5C" />
          <path d="M18 40 C6 34 3 21 11 15 C16 12 22 17 20 28" fill="#F5F2EC" />

          {/* Far hind leg & far front leg (snow-white husky legs with subtle shade) */}
          <path d="M34 52 L19 72 Q16 76 20 77 L26 76 L41 56 Z" fill="#D9D5CE" />
          <path d="M74 48 L96 64 Q100 67 97 70 L91 69 L68 53 Z" fill="#D9D5CE" />

          {/* Sturdy athletic torso: wolf-charcoal saddle + generous snow-white underbelly & chest ruff */}
          <path d="M22 44 C26 27 46 22 72 26 C84 28 90 36 86 48 C81 58 64 60 44 58 C30 56 20 52 22 44 Z" fill="#444F5C" />
          {/* Silver-grey shoulder highlight */}
          <path d="M32 33 Q52 26 72 30 Q62 38 38 38 Z" fill="#637182" opacity="0.55" />
          {/* Fluffy snow-white belly & deep husky chest ruff */}
          <path d="M30 50 C42 46 58 45 70 36 C77 31 85 33 88 41 C89 50 81 59 68 60 C52 61 36 58 30 50 Z" fill="#F5F2EC" />
          {/* Cheeky fluff tufts on chest */}
          <path d="M84 42 L91 45 L85 49 L89 53 L80 54 Z" fill="#F5F2EC" />

          {/* Near hind leg & near front leg (crisp snow-white legs & paws) */}
          <path d="M39 50 L29 74 Q27 79 32 79 L38 77 L49 54 Z" fill="#F5F2EC" />
          <path d="M68 48 L88 71 Q91 75 96 73 L97 68 L77 44 Z" fill="#F5F2EC" />

          {/* Warm terracotta collar tying Maxie to the app palette */}
          <path d="M72 32 Q81 39 87 37" fill="none" stroke="#D98366" strokeWidth="4.2" strokeLinecap="round" />
          <circle cx="87" cy="40" r="2.2" fill="#E8C27A" />

          {/* Siberian Husky head (profile-3/4): closer-set upright triangular ears, snow mask, white brow pip, fluffy cheek tuft, broad snout & dark nose */}
          <g transform="translate(74 9)">
            {/* Far upright ear */}
            <path d="M18 11 L23 0 Q25 -1 27 2 L28 13 Z" fill="#3B4552" />
            <path d="M21 10 L24 3 L26 11 Z" fill="#EDE8DF" />
            {/* Main wolf-grey skull & forehead cap */}
            <path d="M4 22 C4 12 12 7 22 9 C29 10 35 15 38 20 L42 23 C43 26 40 29 35 30 L28 32 C20 34 10 31 5 26 Z" fill="#444F5C" />
            {/* Near upright husky ear with snow-white inner fur */}
            <path d="M7 14 L8 0 Q10 -2 13 1 L20 11 Z" fill="#444F5C" />
            <path d="M10 12 L11 3 L17 11 Z" fill="#F5F2EC" />
            {/* Iconic snow-white husky facial mask, muzzle & fluffy wolf cheek tuft */}
            <path d="M14 20 C19 16 27 16 34 19 L41 22 C43 25 40 29 34 30 L24 32 C15 33 8 29 6 25 L10 23 L7 20 Z" fill="#F5F2EC" />
            {/* White husky eyebrow pip above eye */}
            <ellipse cx="23.5" cy="14.5" rx="2.4" ry="1.2" transform="rotate(-12 23.5 14.5)" fill="#F5F2EC" />
            {/* Cheerful ice-blue husky eye with sparkle */}
            <ellipse cx="26.2" cy="18.6" rx="2.3" ry="2.1" fill="#7CC8EE" />
            <circle cx="26.6" cy="18.6" r="1.05" fill="#1B2128" />
            <circle cx="27.2" cy="17.9" r="0.55" fill="#FFFFFF" />
            {/* Broad dark dog nose (not a pointy fox tip) */}
            <path d="M38.5 21.2 Q42 20.8 42.5 23.5 Q41 25.5 38.2 24.4 Z" fill="#1D2229" />
            {/* Happy gentle smile + tiny warm tongue */}
            <path d="M31 26.8 Q35.5 28.5 38.8 26.2" fill="none" stroke="#2D3540" strokeWidth="1.35" strokeLinecap="round" />
            <path d="M33.5 27.5 Q35.5 31.2 37.5 27.6 Z" fill="#DF8F8B" />
          </g>
        </g>
      </g>

      {/* Seamless atmospheric veil fading the mountain meadow smoothly into the card text canvas */}
      <rect width="420" height="560" fill="url(#stMtnFade)" />
    </svg>
  );
}

/** Card 2 Art (Full-Card Seamless): Siberian Husky Maxie trotting calmly beside a mirror-still alpine lake. */
function LakeTrotSvg() {
  return (
    <svg viewBox="0 0 420 560" preserveAspectRatio="xMidYMid slice" className={s.storySvg}>
      <defs>
        <linearGradient id="stLakeSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#263B48" />
          <stop offset="30%" stopColor="#587C8D" />
          <stop offset="48%" stopColor="#B8C9CE" />
          <stop offset="100%" stopColor="#18252E" />
        </linearGradient>
        <radialGradient id="stLakeSun" cx="30%" cy="22%" r="34%">
          <stop offset="0%" stopColor="#F5E1BE" stopOpacity="0.82" />
          <stop offset="50%" stopColor="#D6D3C5" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#D6D3C5" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="stLakeWater" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6D94A2" stopOpacity="0.72" />
          <stop offset="55%" stopColor="#3B5C6B" stopOpacity="0.82" />
          <stop offset="100%" stopColor="#1A2A34" stopOpacity="1" />
        </linearGradient>
        <linearGradient id="stLakeFade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#17242D" stopOpacity="0" />
          <stop offset="40%" stopColor="#17242D" stopOpacity="0.06" />
          <stop offset="57%" stopColor="#17242D" stopOpacity="0.76" />
          <stop offset="74%" stopColor="#17242D" stopOpacity="0.97" />
          <stop offset="100%" stopColor="#141F27" stopOpacity="1" />
        </linearGradient>
      </defs>

      {/* Tranquil afternoon lake sky */}
      <rect width="420" height="560" fill="url(#stLakeSky)" />
      <rect width="420" height="300" fill="url(#stLakeSun)" />

      {/* Soft afternoon sun */}
      <circle cx="122" cy="112" r="20" fill="#FAF0DA" opacity="0.86" />

      {/* Distant rolling fjord hills */}
      <path d="M-10 198 Q84 148 188 182 T430 166 V220 H-10 Z" fill="#4A6B7A" opacity="0.72" />
      <path d="M-10 208 Q120 172 246 196 T430 184 V224 H-10 Z" fill="#355260" opacity="0.85" />

      {/* Mirror-calm sea-glass lake */}
      <rect x="0" y="206" width="420" height="160" fill="url(#stLakeWater)" />

      {/* Soft golden sun shimmer + drifting ripples on the lake */}
      <g stroke="#EFE4CE" strokeLinecap="round" opacity="0.34" className={s.vigDrift}>
        <line x1="92" y1="220" x2="152" y2="220" strokeWidth="2.4" />
        <line x1="104" y1="230" x2="142" y2="230" strokeWidth="1.8" />
        <line x1="112" y1="240" x2="134" y2="240" strokeWidth="1.4" />
        <line x1="256" y1="226" x2="322" y2="226" strokeWidth="1.4" opacity="0.6" />
        <line x1="278" y1="238" x2="314" y2="238" strokeWidth="1.2" opacity="0.5" />
      </g>

      {/* Warm pebble & grass shoreline bank */}
      <path d="M-10 274 Q140 250 284 268 T430 258 V560 H-10 Z" fill="#2A3E46" />
      <path d="M-10 274 Q142 252 284 270 T430 260 V296 H-10 Z" fill="#465D64" opacity="0.55" />

      {/* Minimalist lakeside reeds */}
      <g stroke="#6C8C87" strokeWidth="1.8" strokeLinecap="round" opacity="0.7">
        <path d="M40 286 Q36 254 44 230 M50 290 Q53 262 47 242 M372 282 Q376 252 368 228 M382 286 Q385 264 380 246" fill="none" />
      </g>

      {/* Soft shore shadow */}
      <ellipse cx="218" cy="272" rx="44" ry="6" fill="#121D23" opacity="0.4" />

      {/* Siberian Husky Maxie trotting peacefully along the lakefront */}
      <g transform="translate(158 190)">
        <g className={s.storyMaxieRun}>
          {/* High curled husky sickle tail with fluffy white inner curl */}
          <path d="M18 42 C5 34 2 14 14 7 C22 3 30 12 26 26" fill="#424D5A" />
          <path d="M20 40 C10 33 8 18 16 13 C22 10 25 16 23 26" fill="#F5F2EC" />

          {/* Far legs (trotting stride) */}
          <path d="M36 52 L28 76 Q27 80 31 80 L36 78 L44 54 Z" fill="#D5D2CB" />
          <path d="M70 50 L80 75 Q82 79 86 78 L88 73 L76 48 Z" fill="#D5D2CB" />

          {/* Sturdy wolf-grey husky body & snow-white chest/belly */}
          <path d="M22 44 C26 28 46 24 72 27 C84 29 89 37 85 48 C80 57 62 60 44 58 C30 56 20 52 22 44 Z" fill="#424D5A" />
          <path d="M34 34 Q54 28 72 32 Q62 40 38 39 Z" fill="#637284" opacity="0.52" />
          <path d="M31 50 C43 46 58 45 70 36 C77 32 85 35 87 43 C87 52 79 59 66 60 C50 61 36 58 31 50 Z" fill="#F5F2EC" />

          {/* Near legs (crisp snow-white paws) */}
          <path d="M41 52 L45 77 Q46 81 51 80 L54 76 L50 52 Z" fill="#F5F2EC" />
          <path d="M64 50 L62 77 Q62 81 67 80 L70 76 L72 50 Z" fill="#F5F2EC" />

          {/* Terracotta collar + brass tag */}
          <path d="M71 33 Q79 40 86 38" fill="none" stroke="#D98366" strokeWidth="4.2" strokeLinecap="round" />
          <circle cx="85" cy="41" r="2.2" fill="#E8C27A" />

          {/* Husky head turned warmly in cheerful trot */}
          <g transform="translate(72 10)">
            <path d="M18 11 L23 1 Q25 -1 27 2 L28 13 Z" fill="#37414D" />
            <path d="M21 10 L24 3.5 L26 11 Z" fill="#ECE7DE" />
            <path d="M4 22 C4 12 12 7 22 9 C29 10 35 15 38 20 L42 23 C43 26 40 29 35 30 L27 32 C19 34 9 31 5 26 Z" fill="#424D5A" />
            <path d="M7 14 L8 0 Q10 -2 13 1 L20 11 Z" fill="#424D5A" />
            <path d="M10 12 L11 3 L17 11 Z" fill="#F5F2EC" />
            <path d="M13 20 C19 16 27 16 34 19 L41 22 C43 25 40 29 34 30 L23 32 C14 33 8 29 6 25 L10 23 L7 20 Z" fill="#F5F2EC" />
            <ellipse cx="23.5" cy="14.5" rx="2.4" ry="1.2" transform="rotate(-10 23.5 14.5)" fill="#F5F2EC" />
            {/* Signature ice-blue husky eye */}
            <ellipse cx="26" cy="18.6" rx="2.3" ry="2.1" fill="#7CC8EE" />
            <circle cx="26.4" cy="18.6" r="1.05" fill="#1B2128" />
            <circle cx="27" cy="17.9" r="0.55" fill="#FFFFFF" />
            {/* Broad dark dog nose & content smile */}
            <path d="M38.5 21.2 Q42 20.8 42.5 23.5 Q41 25.5 38.2 24.4 Z" fill="#1D2229" />
            <path d="M30.5 26.8 Q35 28.4 38.5 26" fill="none" stroke="#2D3540" strokeWidth="1.4" strokeLinecap="round" />
          </g>
        </g>
      </g>

      {/* Seamless atmospheric veil melting the shoreline into the deep lake card base */}
      <rect width="420" height="560" fill="url(#stLakeFade)" />
    </svg>
  );
}

/** Card 3 Art (Full-Card Seamless): Siberian Husky Maxie sitting calmly beside a warm lantern under twilight peaks. */
function TwilightCampSvg() {
  return (
    <svg viewBox="0 0 420 560" preserveAspectRatio="xMidYMid slice" className={s.storySvg}>
      <defs>
        <linearGradient id="stTwSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#192033" />
          <stop offset="34%" stopColor="#2C354D" />
          <stop offset="56%" stopColor="#4A4458" />
          <stop offset="100%" stopColor="#181C28" />
        </linearGradient>
        <radialGradient id="stLanternGlow" cx="62%" cy="44%" r="28%">
          <stop offset="0%" stopColor="#F5C37A" stopOpacity="0.55" />
          <stop offset="45%" stopColor="#E6A15C" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#E6A15C" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="stTwFade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#181C28" stopOpacity="0" />
          <stop offset="40%" stopColor="#181C28" stopOpacity="0.06" />
          <stop offset="57%" stopColor="#181C28" stopOpacity="0.78" />
          <stop offset="74%" stopColor="#181C28" stopOpacity="0.97" />
          <stop offset="100%" stopColor="#151822" stopOpacity="1" />
        </linearGradient>
      </defs>

      {/* Serene twilight sky */}
      <rect width="420" height="560" fill="url(#stTwSky)" />

      {/* Crescent moon & quiet twilight stars */}
      <path d="M326 68 A16 16 0 1 0 345 87 A12.5 12.5 0 1 1 326 68 Z" fill="#F5D9A4" opacity="0.88" />
      <g fill="#ECE5D8" opacity="0.65">
        <circle cx="66" cy="78" r="1.5" />
        <circle cx="118" cy="56" r="1.2" />
        <circle cx="164" cy="88" r="1.1" />
        <circle cx="222" cy="64" r="1.6" />
        <circle cx="268" cy="96" r="1.2" />
        <circle cx="364" cy="112" r="1.3" />
      </g>

      {/* Layered dusk mountain silhouettes */}
      <path d="M-10 230 L78 152 L176 202 L284 140 L376 196 L430 166 V340 H-10 Z" fill="#2A3147" />
      <path d="M-10 256 L112 190 L216 234 L334 182 L430 232 V360 H-10 Z" fill="#22283A" />

      {/* Peaceful camp overlook hill */}
      <path d="M-10 264 Q138 236 266 254 T430 244 V560 H-10 Z" fill="#1F2433" />

      {/* Winding horizon path leading toward payday */}
      <path d="M188 308 Q224 274 268 258 T344 234" fill="none" stroke="#66708A" strokeWidth="5" strokeLinecap="round" opacity="0.34" />

      {/* Warm lantern radial halo illuminating Husky Maxie */}
      <rect width="420" height="380" fill="url(#stLanternGlow)" />

      {/* Minimalist camp lantern */}
      <g transform="translate(248 228)">
        <ellipse cx="11" cy="34" rx="14" ry="3.5" fill="#11141E" opacity="0.5" />
        <path d="M5 10 Q11 1 17 10" fill="none" stroke="#B7B0A4" strokeWidth="1.8" />
        <rect x="3" y="10" width="16" height="22" rx="4" fill="#F2BE72" opacity="0.92" />
        <rect x="6.5" y="14" width="9" height="14" rx="2.5" fill="#FFF2D6" opacity="0.9" />
        <rect x="2" y="9" width="18" height="3.2" rx="1.6" fill="#464D61" />
        <rect x="2" y="30" width="18" height="3.2" rx="1.6" fill="#464D61" />
      </g>

      {/* Ground shadow under sitting husky */}
      <ellipse cx="188" cy="266" rx="34" ry="6" fill="#10131D" opacity="0.52" />

      {/* Calm sitting Siberian Husky Maxie facing 3/4 toward the warm lantern */}
      <g transform="translate(148 168)">
        {/* Thick curled husky tail wrapped neatly beside flank (wolf-grey + snow-white tip) */}
        <path d="M22 92 C0 88 -4 66 10 56 C18 51 26 60 22 76" fill="#485362" />
        <path d="M19 88 C6 84 4 70 12 63 C16 60 21 66 19 76" fill="#F5F2EC" />

        {/* Sturdy sitting wolf-grey body & shoulders */}
        <path d="M18 96 C14 70 21 48 40 46 C59 48 66 70 62 96 Z" fill="#485362" />
        <path d="M24 54 Q40 46 56 54 Q48 62 32 62 Z" fill="#687688" opacity="0.45" />

        {/* Deep fluffy snow-white chest bib & neat sitting white front paws */}
        <path d="M27 96 C25 74 30 56 40 55 C50 56 55 74 53 96 Z" fill="#F5F2EC" />
        <ellipse cx="33" cy="96" rx="6.5" ry="3.8" fill="#F5F2EC" />
        <ellipse cx="47" cy="96" rx="6.5" ry="3.8" fill="#F5F2EC" />
        <line x1="40" y1="74" x2="40" y2="96" stroke="#D5D1C9" strokeWidth="1.2" opacity="0.6" />

        {/* Warm terracotta collar + brass tag */}
        <path d="M26 54 Q40 61 54 54" fill="none" stroke="#D98366" strokeWidth="4" strokeLinecap="round" />
        <circle cx="40" cy="60.5" r="2.3" fill="#E8C27A" />

        {/* Iconic Siberian Husky head (matching Logo.tsx traits: upright closer-set ears, wolf cheek tufts, white forehead blaze & brow pips, peaceful smile) */}
        <g transform="translate(11 6)">
          {/* Outer wolf-grey head + fluffy double cheek tufts */}
          <path d="M10 34 L7 29 L11 25 C10 18 14 13 29 12 C44 13 48 18 47 25 L51 29 L48 34 L50 39 L43 42 C39 47 34 50 29 50 C24 50 19 47 15 42 L8 39 Z" fill="#485362" />
          {/* Closer-set upright triangular husky ears with snow-white inner fur */}
          <path d="M12 20 L15 3 Q17 0 20 3 L26 14 Z" fill="#485362" />
          <path d="M46 20 L43 3 Q41 0 38 3 L32 14 Z" fill="#485362" />
          <path d="M16 17 L17.5 7 L23 15 Z" fill="#F5F2EC" />
          <path d="M42 17 L40.5 7 L35 15 Z" fill="#F5F2EC" />
          {/* Iconic snow-white trefoil husky mask + thin forehead blaze */}
          <path d="M29 15 L30.8 24 C34 22.8 39 23.4 42.5 26 C45.5 28.5 46 34 44.5 39 C42 45 36 48.5 29 48.5 C22 48.5 16 45 13.5 39 C12 34 12.5 28.5 15.5 26 C19 23.4 24 22.8 27.2 24 Z" fill="#F5F2EC" />
          {/* Iconic white husky eyebrow pips */}
          <ellipse cx="22.5" cy="21" rx="2.7" ry="1.3" transform="rotate(-14 22.5 21)" fill="#F5F2EC" />
          <ellipse cx="35.5" cy="21" rx="2.7" ry="1.3" transform="rotate(14 35.5 21)" fill="#F5F2EC" />
          {/* Peaceful serene eyes looking calmly at the lantern glow */}
          <path d="M19 30 Q22.5 26.8 26 30 M32 30 Q35.5 26.8 39 30" fill="none" stroke="#2E3642" strokeWidth="2.1" strokeLinecap="round" />
          {/* Broad dark dog nose & warm calm smile */}
          <path d="M25 36 Q29 34.8 33 36 Q32.5 39 29 40.4 Q25.5 39 25 36 Z" fill="#1D2229" />
          <path d="M29 40 V42.5 M24.8 43.2 Q27 45 29 42.6 Q31 45 33.2 43.2" fill="none" stroke="#2E3642" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </g>

      {/* Seamless atmospheric veil fading the twilight hill smoothly into the card text canvas */}
      <rect width="420" height="560" fill="url(#stTwFade)" />
    </svg>
  );
}

/** Card 4 Art (Full-Card Seamless): Golden-hour amber meadow where curious Siberian Husky Maxie tilts his head for your daily check-in. */
function GoldenMeadowSvg() {
  return (
    <svg viewBox="0 0 420 560" preserveAspectRatio="xMidYMid slice" className={s.storySvg}>
      <defs>
        <linearGradient id="stGoldSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3B312B" />
          <stop offset="32%" stopColor="#7C5E49" />
          <stop offset="56%" stopColor="#D8AF84" />
          <stop offset="100%" stopColor="#241E1A" />
        </linearGradient>
        <radialGradient id="stGoldGlow" cx="52%" cy="32%" r="42%">
          <stop offset="0%" stopColor="#FCE0B2" stopOpacity="0.72" />
          <stop offset="52%" stopColor="#DDA26A" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#DDA26A" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="stGoldFade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#211C18" stopOpacity="0" />
          <stop offset="38%" stopColor="#211C18" stopOpacity="0.06" />
          <stop offset="56%" stopColor="#211C18" stopOpacity="0.76" />
          <stop offset="73%" stopColor="#211C18" stopOpacity="0.97" />
          <stop offset="100%" stopColor="#1B1714" stopOpacity="1" />
        </linearGradient>
      </defs>

      {/* Warm golden-hour dusk sky */}
      <rect width="420" height="560" fill="url(#stGoldSky)" />
      <rect width="420" height="360" fill="url(#stGoldGlow)" />

      {/* Low golden sun sinking behind rolling hills */}
      <circle cx="212" cy="176" r="32" fill="#FCE7C4" opacity="0.78" />

      {/* Layered soft golden hills */}
      <path d="M-10 226 Q104 176 218 206 T430 186 V340 H-10 Z" fill="#5D483B" opacity="0.78" />
      <path d="M-10 252 Q128 216 254 242 T430 226 V370 H-10 Z" fill="#3E3229" />

      {/* Foreground warm meadow knoll */}
      <path d="M-10 264 Q142 242 276 258 T430 248 V560 H-10 Z" fill="#2F2620" />

      {/* Minimalist wooden meadow fence posts on far edges */}
      <g stroke="#524236" strokeWidth="2.4" strokeLinecap="round" opacity="0.65">
        <line x1="38" y1="242" x2="38" y2="270" />
        <line x1="82" y1="246" x2="82" y2="272" />
        <line x1="28" y1="252" x2="94" y2="255" />
        <line x1="344" y1="246" x2="344" y2="270" />
        <line x1="386" y1="242" x2="386" y2="268" />
        <line x1="332" y1="254" x2="396" y2="250" />
      </g>

      {/* Gentle swaying golden grass blades */}
      <g stroke="#B8946D" strokeWidth="1.5" strokeLinecap="round" opacity="0.45" className={s.vigDrift}>
        <path d="M126 270 Q124 256 129 246 M134 272 Q137 260 132 252 M296 268 Q299 254 294 244" fill="none" />
      </g>

      {/* Soft ground shadow */}
      <ellipse cx="210" cy="268" rx="36" ry="6" fill="#14100D" opacity="0.5" />

      {/* Curious Siberian Husky Maxie sitting with a warm head-tilt looking right at you */}
      <g transform="translate(170 166)">
        {/* Fluffy curled tail peeking around the side */}
        <path d="M60 92 C82 88 86 64 72 56 C64 51 56 60 60 76" fill="#465160" />
        <path d="M63 88 C76 84 78 68 70 62 C66 59 61 66 63 76" fill="#F5F2EC" />

        {/* Sturdy wolf-grey husky body */}
        <path d="M18 98 C14 70 21 48 40 46 C59 48 66 70 62 98 Z" fill="#465160" />
        <path d="M24 54 Q40 46 56 54 Q48 62 32 62 Z" fill="#677587" opacity="0.46" />

        {/* Snow-white fluffy chest bib & paws */}
        <path d="M27 98 C25 74 30 56 40 55 C50 56 55 74 53 98 Z" fill="#F5F2EC" />
        <ellipse cx="33" cy="98" rx="6.5" ry="3.8" fill="#F5F2EC" />
        <ellipse cx="47" cy="98" rx="6.5" ry="3.8" fill="#F5F2EC" />

        {/* Warm terracotta collar + brass tag */}
        <path d="M26 54 Q40 61 54 54" fill="none" stroke="#D98366" strokeWidth="4" strokeLinecap="round" />
        <circle cx="40" cy="60.5" r="2.3" fill="#E8C27A" />

        {/* Slightly tilted curious Siberian Husky head with bright ice-blue eyes */}
        <g transform="translate(11 6) rotate(-5 29 30)">
          <path d="M10 34 L7 29 L11 25 C10 18 14 13 29 12 C44 13 48 18 47 25 L51 29 L48 34 L50 39 L43 42 C39 47 34 50 29 50 C24 50 19 47 15 42 L8 39 Z" fill="#465160" />
          <path d="M12 20 L15 3 Q17 0 20 3 L26 14 Z" fill="#465160" />
          <path d="M46 20 L43 3 Q41 0 38 3 L32 14 Z" fill="#465160" />
          <path d="M16 17 L17.5 7 L23 15 Z" fill="#F5F2EC" />
          <path d="M42 17 L40.5 7 L35 15 Z" fill="#F5F2EC" />
          <path d="M29 15 L30.8 24 C34 22.8 39 23.4 42.5 26 C45.5 28.5 46 34 44.5 39 C42 45 36 48.5 29 48.5 C22 48.5 16 45 13.5 39 C12 34 12.5 28.5 15.5 26 C19 23.4 24 22.8 27.2 24 Z" fill="#F5F2EC" />
          <ellipse cx="22.5" cy="21" rx="2.7" ry="1.3" transform="rotate(-14 22.5 21)" fill="#F5F2EC" />
          <ellipse cx="35.5" cy="21" rx="2.7" ry="1.3" transform="rotate(14 35.5 21)" fill="#F5F2EC" />
          {/* Warm curious ice-blue husky eyes */}
          <ellipse cx="22.4" cy="29.4" rx="2.6" ry="2.3" fill="#7CC8EE" />
          <ellipse cx="35.6" cy="29.4" rx="2.6" ry="2.3" fill="#7CC8EE" />
          <circle cx="22.4" cy="29.4" r="1.2" fill="#1B2128" />
          <circle cx="35.6" cy="29.4" r="1.2" fill="#1B2128" />
          <circle cx="23.2" cy="28.6" r="0.6" fill="#FFFFFF" />
          <circle cx="36.4" cy="28.6" r="0.6" fill="#FFFFFF" />
          {/* Broad dark dog nose & attentive smile */}
          <path d="M25 36 Q29 34.8 33 36 Q32.5 39 29 40.4 Q25.5 39 25 36 Z" fill="#1D2229" />
          <path d="M29 40 V42.5 M24.8 43.2 Q27 45 29 42.6 Q31 45 33.2 43.2" fill="none" stroke="#2E3642" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </g>

      {/* Seamless golden-dusk veil fading cleanly into the check-in card canvas */}
      <rect width="420" height="560" fill="url(#stGoldFade)" />
    </svg>
  );
}
