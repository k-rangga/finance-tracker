import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import s from '../styles/ui.module.css';
import { Icon, IC } from '../components/Icon';
import { Logo, type MaxieMood } from '../components/Logo';
import { useCountUp } from '../components/Delight';
import type { TxView } from '../lib/budget';
import { getCycle, type Cycle } from '../lib/cycle';
import { dayMonth, sum, tidyName, toISO } from '../lib/format';
import { haptic } from '../lib/haptics';
import { useSettings } from '../lib/settings';
import { useIsPhone } from '../lib/media';
import { C } from '../lib/tokens';

const DAY = 864e5;
const isSpend = (t: TxView) => !t.isIncome && !t.isTransfer;

/** How the cycle is going: under the pace for today, on it, or past it (colours the bar and the line under it). */
export function moodOf(spent: number, limit: number, expected: number): { label: string; cheer: string; tone: 'good' | 'warn' | 'over'; ink: string; bar: string; face: MaxieMood } {
  if (limit > 0 && spent > limit) return { label: 'A little over plan', cheer: 'Totally fixable together!', tone: 'over', ink: C.redInk, bar: C.red, face: 'steady' };
  if (expected > 0 && spent > expected * 1.1) return { label: 'Running a bit warm', cheer: 'Easy to ease back from here!', tone: 'warn', ink: C.amberInk, bar: C.amber, face: 'steady' };
  if (expected > 0 && spent < expected * 0.85) return { label: 'Nicely under pace', cheer: 'Plenty of breathing room!', tone: 'good', ink: C.good, bar: 'var(--category-1)', face: 'happy' };
  return { label: 'Steady groove', cheer: 'Right on track!', tone: 'good', ink: C.good, bar: 'var(--category-1)', face: 'happy' };
}

/**
 * The top of Categories: one big number, warm mood badge, a bar with interactive pace tick for today,
 * how much a day is safe from here, and a quick Ask Maxie button.
 */
export function Summary({
  spent,
  limit,
  todayFrac,
  period,
  footnote,
  switcher,
  pulse,
  activeFilter,
  onSelectPulse,
  pepTalks,
  onAskMaxie,
}: {
  spent: number;
  limit: number;
  /** Where spending should be by today, as a share of the limit (0–1). */
  todayFrac: number;
  period: string;
  footnote: string;
  switcher: ReactNode;
  pulse?: { cruising: number; watch: number; quests: number; zeroClub: number };
  activeFilter?: 'all' | 'watch' | 'smooth' | 'untouched' | 'challenges';
  onSelectPulse?: (target: 'smooth' | 'watch' | 'untouched' | 'challenges') => void;
  pepTalks?: string[];
  onAskMaxie?: () => void;
}) {
  const { full, short, settings } = useSettings();
  const phone = useIsPhone();
  const [showPace, setShowPace] = useState(false);
  const [pepIdx, setPepIdx] = useState<number | null>(null);
  const shown = useCountUp(spent);
  const expected = limit * todayFrac;
  const mood = moodOf(spent, limit, expected);
  const width = limit > 0 ? Math.min(100, (spent / limit) * 100) : 0;
  const paceDelta = expected - spent;
  const cyclePep = () => {
    if (!pepTalks || pepTalks.length === 0) return;
    haptic('tick', settings.quietMode);
    setPepIdx(prev => (prev == null ? 0 : (prev + 1) % pepTalks.length));
  };
  return (
    <section className={s.sumCard} aria-label="This cycle at a glance">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <button
          type="button"
          className={s.sumCatBtn}
          onClick={cyclePep}
          title="Tap Maxie for a warm pep talk"
          aria-label="Tap Maxie for a warm pep talk"
        >
          <Logo size={44} mood={mood.face} interactive cheer={mood.cheer} />
        </button>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 3, marginRight: 'auto', minWidth: 0, flex: '1 1 180px' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className={s.sumBig}>{(phone ? short : full)(shown)} spent</span>
            <span className={s.catMoodPill} data-tone={mood.tone}>
              {mood.label}
            </span>
          </span>
          <span style={{ fontSize: 14, color: C.textMuted }}>
            of {(phone ? short : full)(limit)} {period}
          </span>
        </span>
        {switcher}
      </div>
      {pepIdx != null && pepTalks && pepTalks[pepIdx] && (
        <div className={s.sumPepBubble} role="status">
          <span>{pepTalks[pepIdx]}</span>
          <button type="button" className={s.textBtnSm} style={{ padding: 0, flex: 'none' }} onClick={cyclePep}>
            Next →
          </button>
        </div>
      )}
      <div className={s.sumTrackWrap} onMouseEnter={() => setShowPace(true)} onMouseLeave={() => setShowPace(false)} onClick={() => setShowPace(v => !v)}>
        <span className={s.sumTrack}>
          <span className={s.sumFill} style={{ width: width + '%', background: mood.bar }} />
          {limit > 0 && todayFrac > 0 && todayFrac < 1 && (
            <span className={s.todayMark} style={{ left: todayFrac * 100 + '%' }} title={`On-plan pace today: ${full(expected)}`} />
          )}
        </span>
        {showPace && limit > 0 && todayFrac > 0 && todayFrac < 1 && (
          <span className={s.sumPaceTip}>
            On-plan pace today: <strong>{full(expected)}</strong> ({paceDelta >= 0 ? `${short(paceDelta)} under pace` : `${short(-paceDelta)} over pace`})
          </span>
        )}
      </div>
      {pulse && (pulse.cruising > 0 || pulse.watch > 0 || pulse.zeroClub > 0 || pulse.quests > 0) && (
        <div className={s.sumPulseRow} data-own-gestures aria-label="Category rhythm overview">
          {(
            [
              pulse.cruising > 0 ? { key: 'smooth' as const, tone: 'good', label: `${pulse.cruising} cruising` } : null,
              pulse.zeroClub > 0 ? { key: 'untouched' as const, tone: 'calm', label: `${pulse.zeroClub} untouched` } : null,
              pulse.watch > 0 ? { key: 'watch' as const, tone: 'warn', label: `${pulse.watch} on watch` } : null,
              pulse.quests > 0 ? { key: 'challenges' as const, tone: 'quest', label: `${pulse.quests} ${pulse.quests === 1 ? 'quest' : 'quests'} live` } : null,
            ].filter((x): x is { key: 'smooth' | 'untouched' | 'watch' | 'challenges'; tone: string; label: string } => !!x)
          ).map(pill => {
            const on = activeFilter === pill.key;
            return onSelectPulse ? (
              <button
                key={pill.key}
                type="button"
                className={s.sumPulsePill}
                data-tone={pill.tone}
                data-active={on || undefined}
                aria-pressed={on}
                onClick={() => onSelectPulse(pill.key)}
              >
                {pill.label}
              </button>
            ) : (
              <span key={pill.key} className={s.sumPulsePill} data-tone={pill.tone}>
                {pill.label}
              </span>
            );
          })}
        </div>
      )}
      <div className={s.sumFootRow}>
        <span style={{ fontSize: 14, color: mood.ink, fontWeight: 500 }}>{footnote}</span>
        {onAskMaxie && (
          <button type="button" className={s.sxAttnPill} onClick={onAskMaxie}>
            <Icon d={IC.sparkle} size={12} /> Ask Maxie
          </button>
        )}
      </div>
    </section>
  );
}

/** A section title with its total or primary control on the right. */
export function SectionHead({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <div className={s.sectionHead}>
      <h2 className={s.sectionHeadTitle}>{title}</h2>
      {right != null && <div className={s.sectionHeadRight}>{right}</div>}
    </div>
  );
}

/**
 * Cycles in a row, before this one, where you spent on the category and stayed within today's limit. A cycle
 * with nothing spent there ends the streak (no data isn't a win); at most six back.
 */
export function streaks(allTxs: TxView[], cycle: Cycle, limits: Record<string, number>) {
  const cycles: { start: Date; end: Date }[] = [];
  let c = cycle;
  for (let i = 0; i < 6; i++) {
    c = getCycle(new Date(c.start.getTime() - DAY));
    cycles.push({ start: c.start, end: c.end });
  }
  const out: Record<string, number> = {};
  for (const [name, limit] of Object.entries(limits)) {
    if (!(limit > 0)) continue;
    let n = 0;
    for (const p of cycles) {
      const inside = allTxs.filter(t => t.date >= p.start && t.date <= p.end);
      const spent = sum(inside.filter(t => t.cat === name && isSpend(t)).map(t => t.net));
      // A cycle with nothing spent here isn't a win, just no data: it ends the streak too.
      if (!inside.length || spent <= 0 || spent > limit) break;
      n++;
    }
    out[name] = n;
  }
  return out;
}

// ---- colour icons for streaks and challenges (drawn, so they match on every device) ----

/** A two-tone flame: clay outside, ochre inside. */
export const FlameIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flex: 'none' }}>
    <path d="M12 2c.6 3.2 2.6 5.3 4.4 7.3C18 11 19 12.9 19 15a7 7 0 1 1-14 0c0-2.1 1-3.7 2.2-5 .3 1.6 1.2 2.7 2.5 3.1C9 9.3 10.2 5.2 12 2z" fill="var(--clay)" />
    <path d="M12 11.5c.4 1.6 1.4 2.6 2.3 3.6.7.8 1.2 1.6 1.2 2.6a3.5 3.5 0 1 1-7 0c0-1.3.6-2.2 1.4-3 .2.8.7 1.3 1.3 1.5-.1-1.7.3-3.3.8-4.7z" fill="var(--category-4)" />
  </svg>
);

/** A target: danger and surface rings with a denim dart. */
export const TargetIcon = ({ size = 14, muted }: { size?: number; muted?: boolean }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flex: 'none' }}>
    <circle cx="11" cy="13" r="9" fill={muted ? 'var(--line-strong)' : 'var(--danger)'} />
    <circle cx="11" cy="13" r="6.2" fill="var(--surface-000)" />
    <circle cx="11" cy="13" r="3.6" fill={muted ? 'var(--line-strong)' : 'var(--danger)'} />
    <path d="M11 13 20.5 3.5" stroke={muted ? 'var(--ink-muted)' : 'var(--category-7)'} strokeWidth="2" strokeLinecap="round" />
    <path d="M17.6 3.2 20.5 3.5 20.8 6.4" stroke={muted ? 'var(--ink-muted)' : 'var(--category-7)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </svg>
);

/** An ochre trophy with an umber base. */
export const TrophyIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flex: 'none' }}>
    <path d="M5 4h2v3a3 3 0 0 1-3-3H3v1a4 4 0 0 0 4 4h.4M19 4h-2v3a3 3 0 0 0 3-3h1v1a4 4 0 0 1-4 4h-.4" stroke="var(--category-8)" strokeWidth="1.8" fill="none" strokeLinecap="round" />
    <path d="M7 3h10v5a5 5 0 0 1-10 0z" fill="var(--category-4)" />
    <path d="M10.5 13h3v3.5h-3z" fill="var(--category-8)" />
    <rect x="7.5" y="16.5" width="9" height="4" rx="1.2" fill="var(--ink-muted)" />
    <path d="M9.5 5.2v2.6" stroke="var(--category-4-soft)" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

/** A gentle moss leaf for calmest-category keepsakes. */
export const LeafIcon = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flex: 'none' }}>
    <path d="M5 19c.5-7.5 5.5-13 14-14-1 8.5-6.5 13.5-14 14z" fill="var(--good)" opacity="0.22" stroke="var(--good)" strokeWidth="1.8" strokeLinejoin="round" />
    <path d="M5 19c3-3 6.5-6 10-8.5" stroke="var(--good)" strokeWidth="1.8" strokeLinecap="round" fill="none" />
  </svg>
);

/** A cozy warm cup for favorite-spot keepsakes. */
export const CupIcon = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flex: 'none' }}>
    <path d="M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9z" fill="var(--clay)" opacity="0.2" stroke="var(--clay-ink)" strokeWidth="1.7" strokeLinejoin="round" />
    <path d="M16 10.5h2a2.5 2.5 0 0 1 0 5h-2" stroke="var(--clay-ink)" strokeWidth="1.7" strokeLinecap="round" fill="none" />
    <path d="M8 5.5c0-1 .8-1.5.8-2.5M12 5.5c0-1 .8-1.5.8-2.5" stroke="var(--clay-ink)" strokeWidth="1.5" strokeLinecap="round" fill="none" />
  </svg>
);

/** A soft warm heart-spark for extra breathing room keepsakes. */
export const HeartSparkIcon = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flex: 'none' }}>
    <path d="M12 20s-7-4.4-8.8-8.3A5.1 5.1 0 0 1 12 6.8a5.1 5.1 0 0 1 8.8 4.9C19 15.6 12 20 12 20z" fill="var(--category-4)" opacity="0.24" stroke="var(--clay-ink)" strokeWidth="1.7" strokeLinejoin="round" />
  </svg>
);

/** Crisp progress ring with centered completion readout for Fixed Bills. */
export const BillRing = ({ paid, total, size = 40 }: { paid: number; total: number; size?: number }) => {
  if (total <= 0) return null;
  const r = 16;
  const circ = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, paid / total));
  const done = paid >= total;
  return (
    <span className={s.fbRingWrap} style={{ width: size, height: size }} aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 40 40" style={{ transform: 'rotate(-90deg)', display: 'block' }}>
        <circle cx="20" cy="20" r={r} fill="none" stroke="var(--divider)" strokeWidth="3.2" />
        <circle
          cx="20"
          cy="20"
          r={r}
          fill="none"
          stroke={done ? 'var(--good)' : 'var(--clay)'}
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - frac)}
          style={{ transition: 'stroke-dashoffset 420ms cubic-bezier(0.22, 1, 0.36, 1)' }}
        />
      </svg>
      <span className={s.fbRingCenter} style={done ? { color: 'var(--good)' } : undefined}>
        {done ? <Icon d={IC.check} size={15} strokeWidth={2.5} /> : `${paid}/${total}`}
      </span>
    </span>
  );
};

/** Consecutive quiet (zero-spend) days ending today within the cycle for a category; null when untouched all cycle. */
export function quietDaysFor(mine: TxView[], today: Date, cycleStart: Date): number | null {
  if (mine.length === 0) return null;
  const latest = mine.reduce((max, t) => Math.max(max, t.date.getTime()), cycleStart.getTime());
  const diff = Math.floor((today.getTime() - latest) / DAY);
  return Math.max(0, diff);
}

/** A flame and "3": under budget that many cycles running, shown from two (hidden in Quiet mode). */
export const StreakChip = ({ n }: { n?: number }) => {
  const { settings } = useSettings();
  if (settings.quietMode || !n || n < 2) return null;
  return (
    <span className={s.streak} title={`Within budget ${n} cycles in a row`} aria-label={`Within budget ${n} cycles in a row`}>
      <FlameIcon size={15} />
      {n}
    </span>
  );
};

// ---- mini-quests (no-spend resets & beat last cycle) ----

export type Challenge = { category: string; start: string; days?: number; kind?: 'nospend' | 'beat_last'; target?: number };
const CHALLENGE_DAYS = 7;

export type ChallengeState = {
  key: 'running' | 'done' | 'missed';
  day: number;
  totalDays: number;
  kind: 'nospend' | 'beat_last';
  spent?: number;
  target?: number;
  text: string;
};

/** Where a mini-quest stands: running, done, or missed. */
export function challengeState(
  ch: Challenge,
  allTxs: TxView[],
  today: Date,
  ctx?: { cycleSpent?: number; cycleDaysLeft?: number },
): ChallengeState {
  if (ch.kind === 'beat_last' && (ch.target ?? 0) > 0) {
    const target = ch.target!;
    const spent = ctx?.cycleSpent ?? 0;
    const daysLeft = ctx?.cycleDaysLeft ?? 1;
    if (spent >= target) return { key: 'missed', day: 1, totalDays: 1, kind: 'beat_last', spent, target, text: 'Passed last cycle' };
    if (daysLeft <= 0) return { key: 'done', day: 1, totalDays: 1, kind: 'beat_last', spent, target, text: 'Beat last cycle!' };
    return { key: 'running', day: 1, totalDays: 1, kind: 'beat_last', spent, target, text: 'Beating last cycle' };
  }
  const totalDays = ch.days ?? CHALLENGE_DAYS;
  const start = new Date(ch.start + 'T00:00:00');
  const end = new Date(start.getTime() + totalDays * DAY);
  const spent = allTxs.some(t => t.cat === ch.category && isSpend(t) && t.date >= start && t.date < end);
  const day = Math.min(totalDays, Math.max(1, Math.floor((today.getTime() - start.getTime()) / DAY) + 1));
  const label = totalDays === 3 ? '3-day reset' : 'No-spend week';
  if (spent) return { key: 'missed', day, totalDays, kind: 'nospend', text: `${label} paused` };
  if (today >= end) return { key: 'done', day: totalDays, totalDays, kind: 'nospend', text: `${label} done!` };
  return { key: 'running', day, totalDays, kind: 'nospend', text: `${label} · Day ${day}/${totalDays}` };
}

export function ChallengeChip({ text, kind }: { text: string; kind: 'running' | 'done' | 'missed' }) {
  return (
    <span className={s.challengeChip} data-kind={kind}>
      {kind === 'done' ? <TrophyIcon size={15} /> : <TargetIcon size={15} muted={kind === 'missed'} />}
      {text}
    </span>
  );
}

/** In an opened category: pick a cheerful mini-quest (3-day reset, 7-day no-spend week, or beat last cycle), or track progress. */
export function ChallengeBox({
  name,
  state,
  lastSpent = 0,
  onStart,
  onClear,
}: {
  name: string;
  state: ChallengeState | null;
  lastSpent?: number;
  onStart: (opts?: { days?: number; kind?: 'nospend' | 'beat_last'; target?: number }) => void;
  onClear: () => void;
}) {
  const { settings, short } = useSettings();
  const [picking, setPicking] = useState(false);
  if (!state) {
    if (!picking) {
      return (
        <button type="button" className={s.btnOutlineSm} onClick={() => setPicking(true)} title={`Start a playful mini-quest for ${name}`}>
          <TargetIcon size={14} />
          Try a mini-quest
          <Icon d={IC.chevDown} size={13} />
        </button>
      );
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: C.textMuted }}>Pick a mini-quest for {name}</span>
          <button type="button" className={s.textBtnSm} style={{ padding: 0 }} onClick={() => setPicking(false)}>
            Cancel
          </button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <button
            type="button"
            className={s.btnOutlineSm}
            onClick={() => {
              haptic('success', settings.quietMode);
              setPicking(false);
              onStart({ days: 3, kind: 'nospend' });
            }}
            title={`Spend nothing on ${name} for 3 days`}
          >
            <TargetIcon size={14} />
            3-day mini reset
          </button>
          <button
            type="button"
            className={s.btnOutlineSm}
            onClick={() => {
              haptic('success', settings.quietMode);
              setPicking(false);
              onStart({ days: 7, kind: 'nospend' });
            }}
            title={`Spend nothing on ${name} for 7 days`}
          >
            <TrophyIcon size={14} />
            7-day no-spend week
          </button>
          {lastSpent > 0 && (
            <button
              type="button"
              className={s.btnOutlineSm}
              onClick={() => {
                haptic('success', settings.quietMode);
                setPicking(false);
                onStart({ kind: 'beat_last', target: lastSpent });
              }}
              title={`Finish this cycle under last cycle's ${short(lastSpent)}`}
            >
              <LeafIcon size={14} />
              Beat last cycle (&lt; {short(lastSpent)})
            </button>
          )}
        </div>
      </div>
    );
  }

  if (state.kind === 'beat_last' && state.target) {
    const pct = Math.min(100, Math.round(((state.spent ?? 0) / state.target) * 100));
    const room = Math.max(0, state.target - (state.spent ?? 0));
    return (
      <div className={s.stampCard} data-kind={state.key}>
        <div className={s.stampHead}>
          <ChallengeChip text={state.text} kind={state.key} />
          <button type="button" className={s.textBtnSm} onClick={onClear}>
            {state.key === 'running' ? 'Stop' : 'Clear'}
          </button>
        </div>
        <div className={s.pourTrack}>
          <span className={s.pourFill} style={{ width: `${Math.max(4, pct)}%`, background: state.key === 'missed' ? 'var(--danger)' : 'var(--good)' }} />
        </div>
        <span style={{ fontSize: 12.5, color: C.textMuted }}>
          {state.key === 'done'
            ? `You finished ${short(room)} lighter than last cycle — a lovely quiet win!`
            : state.key === 'missed'
              ? `Edged past ${short(state.target)} this time — fresh try next cycle.`
              : `${short(room)} below last cycle's ${short(state.target)} finish line.`}
        </span>
      </div>
    );
  }

  const total = state.totalDays;
  const earned = state.key === 'done' ? total : state.key === 'running' ? state.day : Math.max(0, state.day - 1);
  return (
    <div className={s.stampCard} data-kind={state.key}>
      <div className={s.stampHead}>
        <ChallengeChip text={state.text} kind={state.key} />
        <button type="button" className={s.textBtnSm} onClick={onClear}>
          {state.key === 'running' ? 'Stop' : 'Clear'}
        </button>
      </div>
      <div
        className={s.stampRow}
        style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}
        role="img"
        aria-label={`${earned} of ${total} quiet days completed`}
      >
        {Array.from({ length: total }, (_, i) => {
          const hit = i < earned;
          const missedHere = state.key === 'missed' && i === earned;
          return (
            <span
              key={i}
              className={s.stampDot}
              data-hit={hit || undefined}
              data-done={state.key === 'done' || undefined}
              data-missed={missedHere || undefined}
              style={hit ? ({ '--stamp-i': i } as CSSProperties) : undefined}
              title={`Day ${i + 1}`}
            >
              {hit ? <Icon d={IC.check} size={13} strokeWidth={2.25} /> : i + 1}
            </span>
          );
        })}
      </div>
      {state.key === 'done' && (
        <span style={{ fontSize: 12.5, color: C.good, fontWeight: 500 }}>
          Lovely discipline — you can tuck that saved room straight into Savings or your Emergency Fund.
        </span>
      )}
    </div>
  );
}

export const startChallenge = (
  category: string,
  today: Date,
  opts?: { days?: number; kind?: 'nospend' | 'beat_last'; target?: number },
): Challenge => ({
  category,
  start: toISO(today),
  ...(opts?.days && opts.days !== 7 ? { days: opts.days } : {}),
  ...(opts?.kind && opts.kind !== 'nospend' ? { kind: opts.kind } : {}),
  ...(opts?.target ? { target: opts.target } : {}),
});

// ---- opened category: the last 7 days, where it went, moving budget ----

/** Spending per day for the last 7 days, today last. */
export function WeekBars({ mine, today, color }: { mine: TxView[]; today: Date; color: string }) {
  const { short } = useSettings();
  const days = Array.from({ length: 7 }, (_, i) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6 + i));
  const totals = days.map(d => sum(mine.filter(t => t.date.getTime() === d.getTime()).map(t => t.net)));
  const max = Math.max(...totals, 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className={s.statLabel}>Last 7 days</span>
      <div className={s.weekBars} role="img" aria-label={days.map((d, i) => `${dayMonth(d)}: ${short(totals[i])}`).join(', ')}>
        {days.map((d, i) => (
          <span key={i} className={s.weekBar} title={`${dayMonth(d)}: ${short(totals[i])}`}>
            <span className={s.weekBarFill} style={{ height: totals[i] ? Math.max(8, (totals[i] / max) * 100) + '%' : 2, background: totals[i] ? color : C.divider }} />
            <span className={s.weekBarDay} data-today={i === 6 || undefined}>
              {d.toLocaleDateString('en-GB', { weekday: 'narrow' })}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** The three merchants it went to most, by total. */
export function TopMerchants({ mine }: { mine: TxView[] }) {
  const { full } = useSettings();
  const by = new Map<string, { n: number; total: number }>();
  for (const t of mine) {
    const k = tidyName(t.title);
    const x = by.get(k) ?? { n: 0, total: 0 };
    by.set(k, { n: x.n + 1, total: x.total + t.net });
  }
  const top = [...by].sort((a, b) => b[1].total - a[1].total).slice(0, 3);
  if (!top.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <span className={s.statLabel} style={{ paddingBottom: 4 }}>
        Top places
      </span>
      {top.map(([name, x]) => (
        <div key={name} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '5px 0', fontSize: 14 }}>
          <span className={s.ellipsis} style={{ minWidth: 0, marginRight: 'auto' }}>
            {name}
          </span>
          <span style={{ fontSize: 13, color: C.textMuted, whiteSpace: 'nowrap' }}>{x.n}×</span>
          <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{full(x.total)}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Visual "pouring water" envelope transfer: drag a slider to pour spare budget from one category into another,
 * watching both jars rebalance live while the total budget stays untouched.
 */
export function MoveBudget({
  name,
  need,
  targetSpent = 0,
  targetLimit = 0,
  donors,
  onMove,
  onCancel,
}: {
  name: string;
  /** How much it's over (suggested amount). */
  need: number;
  targetSpent?: number;
  targetLimit?: number;
  donors: { name: string; room: number; spent?: number; limit?: number }[];
  onMove: (from: string, amount: number) => void;
  onCancel?: () => void;
}) {
  const { full, short, settings } = useSettings();
  const step = settings.currency === 'IDR' ? 10_000 : 1;
  const [open, setOpen] = useState(need > 0);
  const [from, setFrom] = useState(donors[0]?.name ?? '');
  const donor = donors.find(d => d.name === from) ?? donors[0];
  const room = donor?.room ?? 0;
  const max = Math.floor(room / step) * step;
  const suggest = Math.min(max, Math.ceil((need > 0 ? need : room * 0.25) / step) * step);
  const [amount, setAmount] = useState(suggest);
  const value = Math.min(amount, max);
  if (!donors.length) return null;
  if (!open)
    return (
      <button type="button" className={s.btnOutlineSm} onClick={() => setOpen(true)}>
        Pour budget here…
      </button>
    );

  const donorAfterRoom = Math.max(0, room - value);
  const donorCap = Math.max(1, donor?.limit ?? room);
  const donorFillPct = Math.min(100, Math.round((donorAfterRoom / donorCap) * 100));
  const targetNewLim = Math.max(1, targetLimit + value);
  const targetUsedPct = Math.min(100, Math.round((targetSpent / targetNewLim) * 100));
  const targetAfterDiff = targetNewLim - targetSpent;

  return (
    <div className={s.moveBox}>
      <span className={s.statLabel}>Pour spare room into {name}</span>
      <div className={s.tplGrid}>
        {donors.slice(0, 5).map(d => (
          <button
            key={d.name}
            type="button"
            className={s.tplOpt}
            aria-pressed={from === d.name}
            onClick={() => {
              setFrom(d.name);
              setAmount(Math.min(Math.floor(d.room / step) * step, Math.ceil((need > 0 ? need : d.room * 0.25) / step) * step));
            }}
          >
            {d.name} <span style={{ color: C.textMuted, fontWeight: 400 }}>{short(d.room)} left</span>
          </button>
        ))}
      </div>
      <div className={s.pourGrid}>
        <div className={s.pourBarBox}>
          <span className={s.pourBarTop}>
            <span>{from}</span>
            <strong>{short(donorAfterRoom)} left</strong>
          </span>
          <span className={s.pourTrack}>
            <span className={s.pourFill} style={{ width: `${Math.max(4, donorFillPct)}%`, background: 'var(--clay)' }} />
          </span>
        </div>
        <div className={s.pourBarBox}>
          <span className={s.pourBarTop}>
            <span>{name}</span>
            <strong style={{ color: targetAfterDiff >= 0 ? C.good : C.redInk }}>
              {targetAfterDiff >= 0 ? `${short(targetAfterDiff)} left` : `${short(-targetAfterDiff)} over`}
            </strong>
          </span>
          <span className={s.pourTrack}>
            <span className={s.pourFill} style={{ width: `${Math.max(4, targetUsedPct)}%`, background: targetAfterDiff >= 0 ? 'var(--good)' : 'var(--danger)' }} />
          </span>
        </div>
      </div>
      <input
        type="range"
        className={s.moveSlider}
        min={0}
        max={max}
        step={step}
        value={value}
        onChange={e => setAmount(Number(e.target.value))}
        aria-label={`Amount to pour from ${from}`}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, marginRight: 'auto' }}>
          Pour <strong>{full(value)}</strong> from {from} → {name}
        </span>
        <button
          type="button"
          className={s.btnGhost}
          onClick={() => {
            setOpen(false);
            onCancel?.();
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          className={s.btnPrimarySm}
          disabled={value <= 0}
          onClick={() => {
            haptic('success', settings.quietMode);
            onMove(from, value);
            onCancel?.();
          }}
        >
          Pour budget
        </button>
      </div>
    </div>
  );
}

/** Swipe a row right to tick it off (phones); the row follows the finger a little. */
export function useSwipeRight(onSwipe: () => void, { enabled = true, quiet = false }: { enabled?: boolean; quiet?: boolean } = {}) {
  const [dx, setDx] = useState(0);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const tickedRef = useRef(false);
  const didSwipeRef = useRef(false);
  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      if (!enabled || e.pointerType !== 'touch') return;
      startRef.current = { x: e.clientX, y: e.clientY };
      tickedRef.current = false;
      didSwipeRef.current = false;
    },
    onPointerMove: (e: React.PointerEvent) => {
      const start = startRef.current;
      if (!start) return;
      const x = e.clientX - start.x;
      // Mostly sideways only, so scrolling the page still works.
      if (Math.abs(e.clientY - start.y) > 24) {
        startRef.current = null;
        setDx(0);
        return;
      }
      const next = Math.max(0, Math.min(96, x));
      if (next > 8) didSwipeRef.current = true;
      if (next >= 64 && !tickedRef.current) {
        tickedRef.current = true;
        haptic('tick', quiet);
      }
      setDx(next);
    },
    onPointerUp: () => {
      if (startRef.current && dx >= 64) {
        haptic('success', quiet);
        onSwipe();
      }
      startRef.current = null;
      setDx(0);
    },
    onPointerCancel: () => {
      startRef.current = null;
      setDx(0);
    },
  };
  const consumeClick = () => {
    if (!didSwipeRef.current) return false;
    didSwipeRef.current = false;
    return true;
  };
  return { dx, handlers, swiping: dx > 4, ready: dx >= 64, consumeClick };
}
