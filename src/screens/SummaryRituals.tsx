import { useEffect, useMemo, useState } from 'react';
import s from '../styles/ui.module.css';
import { IC, Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { categoryByName, SAVINGS_TARGET_PCT } from '../data/categories';
import type { Budget, TxView } from '../lib/budget';
import type { Cycle } from '../lib/cycle';
import { dayMonth, tidyName } from '../lib/format';
import { useSettings } from '../lib/settings';
import { storage } from '../lib/storage';

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

/**
 * Living Maxie Vignette: an editorial drawn-SVG window scene that subtly mirrors your cycle mood
 * (payday sunrise, blooming plant on savings goal, cozy lamp on zero-spend streak, gentle rain when above plan).
 */
export function MaxieVignette({
  cycle,
  budget: b,
  target,
  streak,
  todaySpend,
  onOpenStory,
}: {
  cycle: Cycle;
  budget: Budget;
  target: number;
  streak: number;
  todaySpend: number;
  onOpenStory: () => void;
}) {
  const { settings } = useSettings();
  if (settings.quietMode) return null;
  const info = resolveVignetteScene({ cycle, budget: b, target, streak, todaySpend });

  return (
    <section className={s.vigCard} data-wide data-scene={info.scene} aria-label={`Maxie's room: ${info.label}`}>
      <div className={s.vigArtWrap} aria-hidden="true">
        <VignetteSvg scene={info.scene} />
      </div>
      <div className={s.vigBody}>
        <span className={s.vigTag}>{info.label}</span>
        <p className={s.vigSub}>{info.sub}</p>
      </div>
      <button type="button" className={s.btnOutlineSm} onClick={onOpenStory}>
        <Icon d={IC.sparkle} size={13} />
        Cycle story
      </button>
    </section>
  );
}

/** Minimalist ceramic/editorial window illustration (180×76 viewBox) adapting cleanly to Light & Dark mode. */
function VignetteSvg({ scene }: { scene: VignetteScene }) {
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

      {/* Calm sitting Maxie silhouette on the sill */}
      <g transform="translate(76 28)">
        {/* Body */}
        <path d="M12 29 C10 21 13 15 20 14 C27 15 29 21 28 29 Z" fill="var(--clay)" opacity="0.92" />
        {/* Fluffy curled tail */}
        <path d="M27 27 Q35 25 33 19 Q31 16 27 20" fill="none" stroke="var(--clay)" strokeWidth="3.2" strokeLinecap="round" />
        {/* Head + ears */}
        <path d="M14 14 L15.5 6 L19.5 10.5 Q22 9.8 24.5 10.5 L28.5 6 L30 14 C30 18.5 26.5 21 22 21 C17.5 21 14 18.5 14 14 Z" fill="var(--clay)" />
        {/* Ivory mask & happy/calm eyes */}
        <ellipse cx="22" cy="16.2" rx="5.2" ry="4.1" fill="var(--mark-face)" />
        <circle cx="19.8" cy="15.2" r="1" fill="var(--mark-eye)" />
        <circle cx="24.2" cy="15.2" r="1" fill="var(--mark-eye)" />
        <circle cx="22" cy="17.2" r="1.1" fill="var(--clay)" />
      </g>
    </svg>
  );
}

type JoyVote = 'worth' | 'everyday' | 'skip';

/**
 * Daily 10-Second Micro-Ritual Card: invites one calm interaction per visit —
 * rate yesterday's highlight spend (Joy-per-Rupiah), flip the Weekend vs Weekday mystery stat,
 * or check today's gentle target.
 */
export function DailyRitualCard({ cycle, budget: b }: { cycle: Cycle; budget: Budget }) {
  const { short, full, settings } = useSettings();
  const [slot, setSlot] = useState(() => cycle.today.getDate() % 3);
  const [revealed, setRevealed] = useState(false);

  // Yesterday's biggest everyday spend (or latest everyday spend if yesterday was zero).
  const targetTx: TxView | null = useMemo(() => {
    const varSpend = b.txs.filter(t => !t.isIncome && !t.isTransfer && categoryByName(t.cat)?.type === 'variable' && t.net > 0);
    const yesterday = varSpend.filter(t => t.offset === cycle.dayIdx - 1).sort((a, z) => z.net - a.net)[0];
    if (yesterday) return yesterday;
    return varSpend[0] ?? null;
  }, [b.txs, cycle.dayIdx]);

  const voteKey = targetTx ? `moneyTracker.joy.${targetTx.id}` : '';
  const [vote, setVote] = useState<JoyVote | null>(() => (voteKey ? storage.get<JoyVote | null>(voteKey, null) : null));
  useEffect(() => {
    setVote(voteKey ? storage.get<JoyVote | null>(voteKey, null) : null);
  }, [voteKey]);

  const castVote = (v: JoyVote) => {
    if (!voteKey) return;
    storage.set(voteKey, v);
    setVote(v);
  };

  // Weekend vs. Weekday real average this cycle.
  const rhythm = useMemo(() => {
    let wdSum = 0, wdDays = 0, weSum = 0, weDays = 0;
    const daysSoFar = Math.min(cycle.dayIdx + 1, cycle.cycleDays);
    const byDay = new Array<number>(daysSoFar).fill(0);
    for (const t of b.txs) {
      if (t.offset >= 0 && t.offset < daysSoFar && !t.isIncome && !t.isTransfer && categoryByName(t.cat)?.type === 'variable') {
        byDay[t.offset] += t.net;
      }
    }
    for (let i = 0; i < daysSoFar; i++) {
      const dow = cycle.dateOf(i).getDay();
      if (dow === 0 || dow === 6) {
        weSum += byDay[i];
        weDays++;
      } else {
        wdSum += byDay[i];
        wdDays++;
      }
    }
    const wdAvg = wdDays > 0 ? wdSum / wdDays : 0;
    const weAvg = weDays > 0 ? weSum / weDays : 0;
    return { wdAvg, weAvg, hasBoth: wdDays >= 2 && weDays >= 1 && (wdAvg > 0 || weAvg > 0) };
  }, [b.txs, cycle]);

  if (settings.quietMode || b.txs.length === 0) return null;

  // Build available ritual cards so empty ones are skipped cleanly.
  const cards: ('joy' | 'curiosity' | 'target')[] = [];
  if (targetTx) cards.push('joy');
  if (rhythm.hasBoth) cards.push('curiosity');
  cards.push('target');
  const active = cards[slot % cards.length];

  const left = b.budget - b.spent - b.fixedDue;
  const gentleTarget = b.safeDay > 0 ? Math.round(b.safeDay * 0.85) : 0;
  const voteReply: Record<JoyVote, string> = {
    worth: 'Noted — spending on things you truly enjoy is money well spent.',
    everyday: 'Got it — part of your normal rhythm.',
    skip: 'Good catch — small awareness like this quietly saves a lot next cycle.',
  };

  return (
    <section className={s.ritualCard} data-wide aria-label="Daily check-in">
      <div className={s.ritualHead}>
        <span className={s.winsLabel}>Daily check-in</span>
        {cards.length > 1 && (
          <button
            type="button"
            className={s.modelMicroLink}
            style={{ fontSize: 12, marginLeft: 'auto' }}
            onClick={() => {
              setRevealed(false);
              setSlot(n => n + 1);
            }}
          >
            Another prompt
          </button>
        )}
      </div>

      {active === 'joy' && targetTx && (
        <div className={s.ritualBody}>
          <p className={s.ritualPrompt}>
            How did <strong>{tidyName(targetTx.title)}</strong> ({full(targetTx.net)} · {targetTx.cat}) feel?
          </p>
          <div className={s.ritualPills} role="group" aria-label="Rate how this spend felt">
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
                className={s.winBadge}
                data-active={vote === k || undefined}
                aria-pressed={vote === k}
                onClick={() => castVote(k)}
              >
                {label}
              </button>
            ))}
          </div>
          {vote && <span className={s.ritualNote}>{voteReply[vote]}</span>}
        </div>
      )}

      {active === 'curiosity' && (
        <div className={s.ritualBody}>
          {!revealed ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <p className={s.ritualPrompt}>Curious how your weekend spending compares to your weekdays this cycle?</p>
              <button type="button" className={s.btnOutlineSm} onClick={() => setRevealed(true)}>
                Tap to reveal
              </button>
            </div>
          ) : (
            <div className={s.ritualReveal}>
              <p className={s.ritualPrompt}>
                {rhythm.weAvg > rhythm.wdAvg * 1.15 ? (
                  <>
                    Weekends average <strong>{(rhythm.weAvg / Math.max(1, rhythm.wdAvg)).toFixed(1)}×</strong> your weekdays —{' '}
                    <strong>{short(rhythm.weAvg)}/day</strong> vs. <strong>{short(rhythm.wdAvg)}/day</strong>.
                  </>
                ) : rhythm.wdAvg > rhythm.weAvg * 1.15 ? (
                  <>
                    Weekdays run higher than weekends — <strong>{short(rhythm.wdAvg)}/day</strong> vs. <strong>{short(rhythm.weAvg)}/day</strong>.
                  </>
                ) : (
                  <>
                    Super balanced rhythm — weekdays (<strong>{short(rhythm.wdAvg)}/day</strong>) and weekends (<strong>{short(rhythm.weAvg)}/day</strong>) are nearly identical.
                  </>
                )}
              </p>
              <span className={s.ritualNote}>Knowing your natural tempo makes planning effortless.</span>
            </div>
          )}
        </div>
      )}

      {active === 'target' && (
        <div className={s.ritualBody}>
          <p className={s.ritualPrompt}>
            {left >= 0 && gentleTarget > 0 ? (
              <>
                Keeping today under <strong>{short(gentleTarget)}</strong> adds an extra <strong>{short(b.safeDay - gentleTarget)}</strong> to your cushion before payday.
              </>
            ) : (
              <>One quiet low-spend day today softens your cycle pace and eases you gently back toward plan.</>
            )}
          </p>
          <span className={s.ritualNote}>No pressure — small calm days carry the whole month.</span>
        </div>
      )}
    </section>
  );
}

/**
 * "Story of Your Cycle" — a calm, 3-card interactive pop-up deck with unique nature illustrations
 * (Maxie running along a mountain ridge, trotting by a tranquil lake, and resting by a camp lantern under twilight peaks).
 * Auto-opens once on first visit of the day (outside Quiet mode) and can be replayed anytime from Summary.
 */
export function CycleStoryModal({
  cycle,
  budget: b,
  open,
  onClose,
}: {
  cycle: Cycle;
  budget: Budget;
  open: boolean;
  onClose: () => void;
}) {
  const { short, full } = useSettings();
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (!open) return;
    setIdx(0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') setIdx(i => Math.min(2, i + 1));
      else if (e.key === 'ArrowLeft') setIdx(i => Math.max(0, i - 1));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const stats = useMemo(() => {
    const daysSoFar = Math.min(cycle.dayIdx + 1, cycle.cycleDays);
    const byDay = new Array<number>(daysSoFar).fill(0);
    const merch = new Map<string, { name: string; count: number; total: number }>();
    for (const t of b.txs) {
      if (t.isIncome || t.isTransfer || t.net <= 0) continue;
      if (t.offset >= 0 && t.offset < daysSoFar && categoryByName(t.cat)) byDay[t.offset] += t.net;
      const nm = tidyName(t.title);
      const cur = merch.get(nm);
      if (cur) {
        cur.count++;
        cur.total += t.net;
      } else {
        merch.set(nm, { name: nm, count: 1, total: t.net });
      }
    }
    const zeroDays = byDay.filter(v => v <= 0).length;
    const peakIdx = byDay.reduce((m, v, i) => (v > byDay[m] ? i : m), 0);
    const favSpot = [...merch.values()].sort((a, z) => z.count - a.count || z.total - a.total)[0];
    const topVar = b.cats.filter(c => c.type === 'variable' && c.spent > 0).sort((a, z) => z.spent - a.spent)[0];
    const improved = b.cats
      .filter(c => c.type === 'variable' && c.lastSameDays > 0 && c.spent < c.lastSameDays * 0.88)
      .map(c => ({ name: c.name, pct: Math.round(((c.lastSameDays - c.spent) / c.lastSameDays) * 100) }))
      .sort((a, z) => z.pct - a.pct)[0];
    const left = b.budget - b.spent - b.fixedDue;
    return { zeroDays, peakIdx, peakVal: byDay[peakIdx] ?? 0, favSpot, topVar, improved, left };
  }, [b, cycle]);

  if (!open) return null;

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
    },
    {
      kicker: `${cycle.daysLeft + 1} ${cycle.daysLeft === 0 ? 'day' : 'days'} to payday · Your Trajectory`,
      title: stats.left >= 0 ? `${short(stats.left)} of breathing room left` : `Slightly above plan by ${short(-stats.left)}`,
      art: <TwilightCampSvg />,
      body:
        SAVINGS_TARGET_PCT > 0 && b.savedPct >= SAVINGS_TARGET_PCT
          ? `Savings goal is already met at ${Math.round(b.savedPct)}% — cruise gently into payday ${dayMonth(cycle.next)}.`
          : stats.left >= 0
            ? `Keeping near ${short(b.safeDay)}/day carries you calmly to payday on ${dayMonth(cycle.next)}.`
            : `No stress — a couple of quiet days brings your pace smoothly back toward plan by ${dayMonth(cycle.next)}.`,
      chips: [
        { label: 'Saved so far', val: `${Math.round(b.savedPct)}%` },
        { label: 'Safe daily pace', val: short(b.safeDay) },
      ],
    },
  ];

  const card = cards[idx];

  return (
    <div className={s.storyOverlay} onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <section className={`${s.storyModal} fade-in`} role="dialog" aria-modal="true" aria-label="Story of your cycle">
        <div className={s.storyTop}>
          <div className={s.storyDots} role="tablist" aria-label="Story cards">
            {cards.map((c, i) => (
              <button
                key={c.kicker}
                type="button"
                role="tab"
                aria-selected={i === idx}
                aria-label={`Card ${i + 1} of 3`}
                className={s.storyDot}
                data-active={i === idx || undefined}
                data-past={i < idx || undefined}
                onClick={() => setIdx(i)}
              />
            ))}
          </div>
          <button type="button" className={s.iconBtnSm} aria-label="Close story" onClick={onClose}>
            <Icon d={IC.close} size={16} />
          </button>
        </div>

        <div key={idx} className={s.storyCardBody}>
          <div className={s.storyArt} aria-hidden="true">
            {card.art}
          </div>
          <div className={s.storyCopy}>
            <span className={s.storyKicker}>{card.kicker}</span>
            <h2 className={s.storyTitle}>{card.title}</h2>
            <p className={s.storyText}>{card.body}</p>
            {card.chips.length > 0 && (
              <div className={s.storyChips}>
                {card.chips.map(ch => (
                  <div key={ch.label} className={s.storyChip}>
                    <span className={s.modelKpiLabel}>{ch.label}</span>
                    <strong>{ch.val}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className={s.storyFoot}>
          <Logo size={28} mood={idx === 2 ? 'happy' : 'calm'} followCursor />
          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
            {idx > 0 && (
              <button type="button" className={s.btnGhost} onClick={() => setIdx(i => i - 1)}>
                Back
              </button>
            )}
            {idx < cards.length - 1 ? (
              <button type="button" className={s.btnPrimarySm} onClick={() => setIdx(i => i + 1)}>
                Next
              </button>
            ) : (
              <button type="button" className={s.btnPrimarySm} onClick={onClose}>
                Continue to Summary
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

/** Card 1 Art: Maxie bounding happily along a sunlit alpine mountain ridge. */
function MountainRunSvg() {
  return (
    <svg viewBox="0 0 360 154" className={s.storySvg}>
      <rect width="360" height="154" fill="var(--bg)" />
      {/* Warm sunrise sun */}
      <circle cx="272" cy="46" r="24" fill="var(--amber)" opacity="0.22" />
      <circle cx="272" cy="46" r="14" fill="var(--amber)" opacity="0.65" />
      {/* Distant misty peaks */}
      <path d="M0 112 L68 54 L132 98 L206 42 L286 100 L360 66 V154 H0 Z" fill="var(--category-9)" opacity="0.22" />
      <path d="M0 124 L94 74 L172 114 L256 64 L360 118 V154 H0 Z" fill="var(--category-8)" opacity="0.28" />
      {/* Foreground serene meadow ridge */}
      <path d="M0 124 Q96 98 188 112 T360 106 V154 H0 Z" fill="var(--good)" opacity="0.28" />
      {/* Minimalist pines */}
      <g fill="var(--good)" opacity="0.55">
        <path d="M44 114 L51 94 L58 114 Z" />
        <path d="M62 116 L67 101 L72 116 Z" />
        <path d="M308 111 L315 92 L322 111 Z" />
      </g>
      {/* Running Maxie silhouette bounding across the ridge */}
      <g transform="translate(154 78)">
        <g className={s.storyMaxieRun}>
          {/* Fluffy tail streaming back */}
          <path d="M4 18 Q-6 12 -3 6 Q2 4 8 13" fill="none" stroke="var(--clay)" strokeWidth="4" strokeLinecap="round" />
          {/* Striding hind & front legs */}
          <path d="M12 22 L4 31 M16 22 L12 31 M30 22 L38 29 M34 21 L44 26" stroke="var(--clay)" strokeWidth="3.2" strokeLinecap="round" />
          {/* Torso */}
          <ellipse cx="22" cy="18" rx="14" ry="7.5" transform="rotate(-7 22 18)" fill="var(--clay)" />
          {/* Ivory chest */}
          <path d="M27 14 Q35 16 33 23 Q27 24 25 19 Z" fill="var(--mark-face)" opacity="0.9" />
          {/* Head + perked husky ears */}
          <path d="M30 12 L33 2 L38 8 L43 3 L44 12 C45 17 41 20 36 20 C31 20 29 17 30 12 Z" fill="var(--clay)" />
          <ellipse cx="38.5" cy="14.5" rx="4.2" ry="3.4" fill="var(--mark-face)" />
          <circle cx="39.8" cy="13.8" r="1.1" fill="var(--mark-eye)" />
          <circle cx="42.5" cy="15.2" r="1.1" fill="var(--clay)" />
        </g>
      </g>
    </svg>
  );
}

/** Card 2 Art: Maxie trotting calmly beside a tranquil sea-glass lake with ripples and reeds. */
function LakeTrotSvg() {
  return (
    <svg viewBox="0 0 360 154" className={s.storySvg}>
      <rect width="360" height="154" fill="var(--bg)" />
      {/* Soft afternoon sun reflection */}
      <circle cx="110" cy="40" r="16" fill="var(--amber)" opacity="0.35" />
      {/* Distant rolling shore hills */}
      <path d="M0 84 Q88 52 180 76 T360 68 V96 H0 Z" fill="var(--category-2)" opacity="0.22" />
      {/* Calm reflective sea-glass lake */}
      <rect x="0" y="88" width="360" height="66" fill="var(--category-2)" opacity="0.2" />
      {/* Gentle shimmering water ripples */}
      <g stroke="var(--category-2)" strokeWidth="1.5" strokeLinecap="round" opacity="0.45" className={s.vigDrift}>
        <line x1="78" y1="104" x2="146" y2="104" />
        <line x1="94" y1="114" x2="132" y2="114" />
        <line x1="210" y1="108" x2="278" y2="108" />
        <line x1="232" y1="120" x2="268" y2="120" />
      </g>
      {/* Foreground warm sandy shoreline */}
      <path d="M0 124 Q130 112 248 128 T360 122 V154 H0 Z" fill="var(--category-8)" opacity="0.32" />
      {/* Minimalist reeds */}
      <g stroke="var(--good)" strokeWidth="1.6" strokeLinecap="round" opacity="0.6">
        <path d="M36 132 Q34 114 39 102 M44 134 Q46 118 42 108 M316 134 Q319 116 314 104" fill="none" />
      </g>
      {/* Maxie happily trotting along the lakeside shore */}
      <g transform="translate(170 92)">
        <g className={s.storyMaxieRun}>
          <path d="M6 17 Q-2 10 3 6 Q8 6 10 14" fill="none" stroke="var(--clay)" strokeWidth="3.8" strokeLinecap="round" />
          <path d="M13 21 L9 30 M18 22 L19 30 M28 22 L27 30 M32 21 L37 29" stroke="var(--clay)" strokeWidth="3" strokeLinecap="round" />
          <ellipse cx="22" cy="18" rx="13" ry="7" fill="var(--clay)" />
          <path d="M27 14 Q34 16 32 22 Q27 23 25 19 Z" fill="var(--mark-face)" opacity="0.9" />
          <path d="M29 12 L32 3 L36.5 8.5 L41.5 3.5 L42.5 12 C43.5 16.5 40 19.5 35.5 19.5 C31 19.5 28.5 16.5 29 12 Z" fill="var(--clay)" />
          <ellipse cx="37.2" cy="14.5" rx="4" ry="3.2" fill="var(--mark-face)" />
          <circle cx="38.5" cy="13.8" r="1.1" fill="var(--mark-eye)" />
          <circle cx="41.2" cy="15.2" r="1.1" fill="var(--clay)" />
        </g>
      </g>
    </svg>
  );
}

/** Card 3 Art: Maxie sitting peacefully by a warm lantern overlooking twilight peaks toward payday. */
function TwilightCampSvg() {
  return (
    <svg viewBox="0 0 360 154" className={s.storySvg}>
      <rect width="360" height="154" fill="var(--bg)" />
      {/* Soft twilight sky wash */}
      <rect width="360" height="104" fill="var(--sky)" opacity="0.14" />
      {/* Gentle stars & crescent moon */}
      <path d="M294 26 A11 11 0 1 0 307 39 A8.5 8.5 0 1 1 294 26 Z" fill="var(--amber)" opacity="0.72" />
      <g fill="var(--ink-muted)" opacity="0.5">
        <circle cx="66" cy="28" r="1.3" />
        <circle cx="122" cy="20" r="1.1" />
        <circle cx="218" cy="30" r="1.4" />
        <circle cx="256" cy="18" r="1" />
      </g>
      {/* Layered dusk ridges */}
      <path d="M0 108 L82 64 L174 96 L276 58 L360 98 V154 H0 Z" fill="var(--sky)" opacity="0.2" />
      <path d="M0 122 Q120 102 224 118 T360 110 V154 H0 Z" fill="var(--category-11)" opacity="0.28" />
      {/* Winding trail heading toward the horizon */}
      <path d="M126 154 Q158 132 192 124 T256 106" fill="none" stroke="var(--surface)" strokeWidth="4" strokeLinecap="round" opacity="0.55" />
      {/* Warm camp lantern + soft radial glow */}
      <circle cx="218" cy="112" r="24" fill="var(--amber)" opacity="0.18" />
      <rect x="213" y="106" width="10" height="13" rx="3" fill="var(--amber)" opacity="0.88" />
      <path d="M214 106 Q218 100 222 106" fill="none" stroke="var(--ink-muted)" strokeWidth="1.5" />
      {/* Peaceful sitting Maxie looking ahead */}
      <g transform="translate(152 84)">
        <path d="M12 34 C10 23 14 16 21 15 C28 16 31 23 30 34 Z" fill="var(--clay)" />
        <path d="M13 32 Q4 29 7 22 Q9 19 13 24" fill="none" stroke="var(--clay)" strokeWidth="3.6" strokeLinecap="round" />
        <path d="M15 16 L17 6 L21.5 11.5 Q24 10.6 26.5 11.5 L31 6 L32.5 16 C32.5 21 28.5 24 23.8 24 C19 24 15 21 15 16 Z" fill="var(--clay)" />
        <ellipse cx="23.8" cy="18.2" rx="5.6" ry="4.4" fill="var(--mark-face)" />
        <path d="M20.2 17.6 Q21.8 15.8 23.2 17.6 M24.4 17.6 Q26 15.8 27.4 17.6" fill="none" stroke="var(--clay)" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="23.8" cy="19.6" r="1.1" fill="var(--clay)" />
      </g>
    </svg>
  );
}
