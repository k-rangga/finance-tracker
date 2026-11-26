import { useState, type ReactNode } from 'react';
import s from '../styles/ui.module.css';
import { Logo } from '../components/Logo';
import { useCountUp } from '../components/Delight';
import type { TxView } from '../lib/budget';
import { getCycle, type Cycle } from '../lib/cycle';
import { dayMonth, sum, tidyName, toISO } from '../lib/format';
import { useSettings } from '../lib/settings';
import { useIsPhone } from '../lib/media';
import { C } from '../lib/tokens';

const DAY = 864e5;
const isSpend = (t: TxView) => !t.isIncome && !t.isTransfer;

/** How the cycle is going: under the pace for today, on it, or past it (colours the bar and the line under it). */
export function moodOf(spent: number, limit: number, expected: number) {
  if (limit > 0 && spent > limit) return { label: 'Over the plan', ink: C.redInk, bar: C.red };
  if (expected > 0 && spent > expected * 1.1) return { label: 'Spending faster than planned', ink: C.amberInk, bar: C.amber };
  if (expected > 0 && spent < expected * 0.8) return { label: 'Nicely under pace', ink: C.good, bar: 'var(--category-1)' };
  return { label: 'On pace', ink: C.good, bar: 'var(--category-1)' };
}

/**
 * The top of Categories: one big number, what it's out of, a bar with where you should be by today, and how much
 * a day is safe from here.
 */
export function Summary({
  spent,
  limit,
  todayFrac,
  period,
  footnote,
  switcher,
}: {
  spent: number;
  limit: number;
  /** Where spending should be by today, as a share of the limit (0–1). */
  todayFrac: number;
  period: string;
  footnote: string;
  switcher: ReactNode;
}) {
  const { full, short } = useSettings();
  const phone = useIsPhone();
  const shown = useCountUp(spent);
  const mood = moodOf(spent, limit, limit * todayFrac);
  const width = limit > 0 ? Math.min(100, (spent / limit) * 100) : 0;
  return (
    <section className={s.sumCard} aria-label="This cycle at a glance">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <span className={s.sumCat} role="img" aria-label={mood.label} title={mood.label}>
          <Logo size={44} />
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, marginRight: 'auto', minWidth: 0, flex: '1 1 180px' }}>
          <span className={s.sumBig}>{(phone ? short : full)(shown)} spent</span>
          <span style={{ fontSize: 14, color: C.textMuted }}>
            of {(phone ? short : full)(limit)} {period}
          </span>
        </span>
        {switcher}
      </div>
      <span className={s.sumTrack}>
        <span className={s.sumFill} style={{ width: width + '%', background: mood.bar }} />
        {limit > 0 && todayFrac > 0 && todayFrac < 1 && <span className={s.todayMark} style={{ left: todayFrac * 100 + '%' }} title="Where you'd be today on plan" />}
      </span>
      <span style={{ fontSize: 14, color: mood.ink, fontWeight: 500 }}>{footnote}</span>
    </section>
  );
}

/** A section title with its total on the right, instead of a line of dots. */
export function SectionHead({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <h2 className={s.sectionHead}>
      <span>{title}</span>
      {right != null && <span className={s.sectionHeadRight}>{right}</span>}
    </h2>
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

/** A flame and "3": under budget that many cycles running, shown from two. */
export const StreakChip = ({ n }: { n?: number }) =>
  n && n >= 2 ? (
    <span className={s.streak} title={`Within budget ${n} cycles in a row`} aria-label={`Within budget ${n} cycles in a row`}>
      <FlameIcon size={15} />
      {n}
    </span>
  ) : null;

// ---- no-spend challenges ----

export type Challenge = { category: string; start: string };
const CHALLENGE_DAYS = 7;

/** Where a no-spend week stands: running (day n of 7), done, or missed (something was spent). */
export function challengeState(ch: Challenge, allTxs: TxView[], today: Date) {
  const start = new Date(ch.start + 'T00:00:00');
  const end = new Date(start.getTime() + CHALLENGE_DAYS * DAY);
  const spent = allTxs.some(t => t.cat === ch.category && isSpend(t) && t.date >= start && t.date < end);
  const day = Math.min(CHALLENGE_DAYS, Math.floor((today.getTime() - start.getTime()) / DAY) + 1);
  if (spent) return { key: 'missed' as const, day, text: 'No-spend week missed' };
  if (today >= end) return { key: 'done' as const, day, text: 'No-spend week done' };
  return { key: 'running' as const, day, text: `No-spend day ${day}/${CHALLENGE_DAYS}` };
}

export function ChallengeChip({ text, kind }: { text: string; kind: 'running' | 'done' | 'missed' }) {
  return (
    <span className={s.challengeChip} data-kind={kind}>
      {kind === 'done' ? <TrophyIcon size={15} /> : <TargetIcon size={15} muted={kind === 'missed'} />}
      {text}
    </span>
  );
}

/** In an opened category: start a no-spend week, or see / end the one running. */
export function ChallengeBox({
  name,
  state,
  onStart,
  onClear,
}: {
  name: string;
  state: ReturnType<typeof challengeState> | null;
  onStart: () => void;
  onClear: () => void;
}) {
  if (!state)
    return (
      <button type="button" className={s.btnOutlineSm} onClick={onStart} title={`Spend nothing on ${name} for 7 days`}>
        <TargetIcon size={15} />
        Try a no-spend week
      </button>
    );
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <ChallengeChip text={state.text} kind={state.key} />
      <button type="button" className={s.textBtnSm} onClick={onClear}>
        {state.key === 'running' ? 'Stop' : 'Clear'}
      </button>
    </span>
  );
}

export const startChallenge = (category: string, today: Date): Challenge => ({ category, start: toISO(today) });

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
 * Move part of another category's limit here, with a slider: the total budget stays the same.
 * `donors`: categories with room left, most room first.
 */
export function MoveBudget({
  name,
  need,
  donors,
  onMove,
}: {
  name: string;
  /** How much it's over (suggested amount). */
  need: number;
  donors: { name: string; room: number }[];
  onMove: (from: string, amount: number) => void;
}) {
  const { full, short, settings } = useSettings();
  const step = settings.currency === 'IDR' ? 10_000 : 1;
  const [open, setOpen] = useState(need > 0);
  const [from, setFrom] = useState(donors[0]?.name ?? '');
  const room = donors.find(d => d.name === from)?.room ?? 0;
  const max = Math.floor(room / step) * step;
  const suggest = Math.min(max, Math.ceil((need > 0 ? need : room * 0.25) / step) * step);
  const [amount, setAmount] = useState(suggest);
  const value = Math.min(amount, max);
  if (!donors.length) return null;
  if (!open)
    return (
      <button type="button" className={s.btnOutlineSm} onClick={() => setOpen(true)}>
        Move budget here…
      </button>
    );
  return (
    <div className={s.moveBox}>
      <span className={s.statLabel}>Move budget to {name}</span>
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
      <input
        type="range"
        className={s.moveSlider}
        min={0}
        max={max}
        step={step}
        value={value}
        onChange={e => setAmount(Number(e.target.value))}
        aria-label={`Amount to move from ${from}`}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, marginRight: 'auto' }}>
          <strong>{full(value)}</strong> from {from} → {name}
        </span>
        <button type="button" className={s.btnGhost} onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button type="button" className={s.btnPrimarySm} disabled={value <= 0} onClick={() => onMove(from, value)}>
          Move
        </button>
      </div>
    </div>
  );
}

/** Swipe a row right to tick it off (phones); the row follows the finger a little. */
export function useSwipeRight(onSwipe: () => void) {
  const [dx, setDx] = useState(0);
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      setStart({ x: e.clientX, y: e.clientY });
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!start) return;
      const x = e.clientX - start.x;
      // Mostly sideways only, so scrolling the page still works.
      if (Math.abs(e.clientY - start.y) > 24) return setStart(null), setDx(0);
      setDx(Math.max(0, Math.min(90, x)));
    },
    onPointerUp: () => {
      if (start && dx > 64) onSwipe();
      setStart(null);
      setDx(0);
    },
    onPointerCancel: () => {
      setStart(null);
      setDx(0);
    },
  };
  return { dx, handlers, swiping: dx > 4 };
}
