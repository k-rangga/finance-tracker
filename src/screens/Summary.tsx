import { useEffect, useState, type ReactNode } from 'react';
import s from '../styles/ui.module.css';
import { IC, Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { Celebrate, useCountUp } from '../components/Delight';
import { cycleKey, hasPlan, nextCycleOf } from '../lib/cyclePlans';
import type { Budget } from '../lib/budget';
import type { Cycle } from '../lib/cycle';
import { dayLabel, dayMonth, sum, tidyName, toISO } from '../lib/format';
import { useSettings } from '../lib/settings';
import { useIsPhone } from '../lib/media';
import { C } from '../lib/tokens';
import { categoryByName, SAVINGS_TARGET_PCT, TRANSFER_CATEGORY } from '../data/categories';
import { canDismissBill, type Bill } from '../data/transactions';

type SummaryProps = {
  cycle: Cycle;
  budget: Budget;
  onOpenCategory: (name: string) => void;
  /** Hide a predicted bill for this cycle. */
  onDismissBill: (b: Bill) => void;
  /** Open Transactions on a range, optionally filtered to one category. */
  onShowTransactions: (range: 'today' | 'cycle', cat?: string) => void;
  /** Open Plan on the next cycle. */
  onPlanNext: () => void;
};

/**
 * The cycle at a glance, charts first: what's left as a ring, three tiles, spending by day against the plan,
 * where the money went, and the bills still coming. Words only where a number needs a label; each chart's
 * explanation is behind its info button.
 */
export function Summary({ cycle, budget: b, onOpenCategory, onDismissBill, onShowTransactions, onPlanNext }: SummaryProps) {
  const { ofIncome, settings } = useSettings();
  const id = toISO(cycle.start);
  const target = ofIncome(SAVINGS_TARGET_PCT);
  return (
    <div className={s.sxSumGrid}>
      <Celebrate id={id + '.saved'} when={target > 0 && b.saved >= target} />
      <Celebrate id={id + '.under'} when={cycle.daysLeft <= 1 && b.spent <= b.budget} />
      {cycle.daysLeft <= 4 && <PlanNextNudge cycle={cycle} planned={hasPlan(settings.cyclePlans?.[cycleKey(nextCycleOf(cycle))])} onOpen={onPlanNext} />}
      <CycleLine cycle={cycle} budget={b} />
      <Tiles cycle={cycle} budget={b} onSavings={() => onShowTransactions('cycle', TRANSFER_CATEGORY)} />
      <DailyBars cycle={cycle} budget={b} />
      <WhereMap budget={b} onOpenCategory={onOpenCategory} />
      <BillsTimeline cycle={cycle} budget={b} onDismissBill={onDismissBill} />
      <Recent budget={b} cycle={cycle} onSeeAll={() => onShowTransactions('today')} />
    </div>
  );
}

// ---- shared bits ----

/** A chart card: a short title, an info icon whose one-line explanation shows on hover (or tap), and the chart. */
function ChartCard({ title, info, right, children, wide }: { title: string; info: string | string[]; right?: ReactNode; children: ReactNode; wide?: boolean }) {
  const lines = typeof info === 'string' ? [info] : info;
  const [open, setOpen] = useState(false);
  return (
    <section className={s.sxChartCard} data-wide={wide || undefined} aria-label={title}>
      <div className={s.sxChartHead}>
        <h2 className={s.sxChartTitle}>{title}</h2>
        <span className={s.sxInfo} data-open={open || undefined} onMouseLeave={() => setOpen(false)}>
          <button type="button" className={s.sxInfoBtn} aria-label={`About ${title}: ${lines.join(' ')}`} onClick={() => setOpen(!open)} onBlur={() => setOpen(false)}>
            <Icon d={IC.info} size={14} />
          </button>
          <span className={s.sxInfoTip} role="tooltip">
            <strong className={s.sxInfoTipTitle}>{title}</strong>
            {lines.map(l => (
              <span key={l}>{l}</span>
            ))}
          </span>
        </span>
        {right != null && <span className={s.sxChartRight}>{right}</span>}
      </div>
      {children}
    </section>
  );
}

/** How the cycle is going: under the pace for today, on it, or past it. */
function paceTone(spent: number, budget: number, expected: number) {
  if (budget > 0 && spent > budget) return { bar: C.red, ink: C.redInk };
  if (expected > 0 && spent > expected * 1.1) return { bar: C.amber, ink: C.amberInk };
  return { bar: 'var(--category-1)', ink: C.text };
}

// ---- this cycle: spending so far, and where it's heading ----

const CW = 320;
const CH = 120;

/**
 * What's left on top; below it, the running total of what you've spent (solid), a dashed projection to payday at
 * your pace so far plus the bills still to come, and your plan as a flat line.
 */
function CycleLine({ cycle, budget: b }: { cycle: Cycle; budget: Budget }) {
  const { compact: short, full } = useSettings();
  const [hover, setHover] = useState<number | null>(null);
  const left = b.budget - b.spent - b.fixedDue;
  const shownLeft = useCountUp(Math.abs(left));
  const tone = paceTone(b.spent, b.budget, b.paceToday);
  const days = cycle.cycleDays;
  const today = Math.min(cycle.dayIdx, days - 1);
  const perDay = new Array<number>(days).fill(0);
  for (const t of b.txs) if (t.offset >= 0 && t.offset < days && categoryByName(t.cat)) perDay[t.offset] += t.net;
  const cum: number[] = [];
  perDay.reduce((acc, v, i) => (cum[i] = acc + v), 0);
  const end = Math.max(b.projTotal, cum[today]);
  const top = Math.max(b.budget, end, 1) * 1.08;
  const x = (i: number) => (days > 1 ? (i / (days - 1)) * CW : 0);
  const y = (v: number) => CH - (v / top) * CH;
  const actual = cum.slice(0, today + 1).map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const area = `${actual} L${x(today).toFixed(1)} ${CH} L0 ${CH} Z`;
  const overPlan = b.budget > 0 && end > b.budget;
  const projInk = overPlan ? C.redInk : C.textMuted;
  const shown = hover != null && hover <= today ? hover : null;
  const pick = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setHover(Math.round(((e.clientX - r.left) / r.width) * (days - 1)));
  };
  return (
    <ChartCard
      title="This cycle"
      info={['Solid line: what you\'ve spent so far, bills included.', 'Dashed line: your pace carried on to payday, with bills still to come.', 'Flat line: your plan.']}
      right={`${cycle.daysLeft + 1} ${cycle.daysLeft === 0 ? 'day' : 'days'} to payday`}
    >
      <div className={s.sxLeftHead}>
        <span className={s.sxLeftBig} style={{ color: left < 0 ? C.redInk : C.text }}>
          {short(shownLeft)}
        </span>
        <span className={s.sxLeftLabel}>{left < 0 ? 'over plan' : 'left'}</span>
        <span className={s.sxLeftDay}>
          <strong style={{ color: tone.ink }}>{short(b.safeDay)}</strong> a day
        </span>
      </div>
      <div className={s.sxLine} onPointerMove={pick} onPointerDown={pick} onPointerLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${CW} ${CH}`} preserveAspectRatio="none" role="img" aria-label={`Spent ${full(cum[today])} so far; heading for ${full(end)} by payday, plan ${full(b.budget)}`}>
          <path d={area} fill="var(--category-1)" opacity={0.1} />
          {b.budget > 0 && <line x1={0} x2={CW} y1={y(b.budget)} y2={y(b.budget)} stroke="var(--line-strong)" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
          {today < days - 1 && (
            <line x1={x(today)} y1={y(cum[today])} x2={CW} y2={y(end)} stroke={overPlan ? 'var(--danger)' : 'var(--ink-muted)'} strokeWidth={2} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
          )}
          <path d={actual} fill="none" stroke="var(--category-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {shown != null && <line x1={x(shown)} x2={x(shown)} y1={0} y2={CH} stroke="var(--line-strong)" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
        </svg>
        <span className={s.sxLineDot} style={{ left: `${(x(shown ?? today) / CW) * 100}%`, top: `${(y(cum[shown ?? today]) / CH) * 100}%` }} />
        {b.budget > 0 && (
          <span className={s.sxLinePlan} style={{ top: `${(y(b.budget) / CH) * 100}%` }}>
            Plan {short(b.budget)}
          </span>
        )}
      </div>
      <div className={s.sxDayAxis} aria-hidden="true">
        <span>{dayMonth(cycle.start)}</span>
        <span>Payday {dayMonth(cycle.next)}</span>
      </div>
      <div className={s.sxLineFoot}>
        {shown != null ? (
          <span>
            {dayMonth(cycle.dateOf(shown))} <strong style={{ color: C.text }}>{short(cum[shown])}</strong> spent
          </span>
        ) : (
          <span>
            Heading for <strong style={{ color: projInk }}>{short(end)}</strong> by payday
          </span>
        )}
      </div>
    </ChartCard>
  );
}

/** Three StatTiles (Maxie): a label, one number, and a note that says what it means. */
function Tiles({ cycle, budget: b, onSavings }: { cycle: Cycle; budget: Budget; onSavings: () => void }) {
  const { compact: short } = useSettings();
  const bills = b.bills.filter(x => x.date > cycle.today);
  const billTotal = sum(bills.map(x => x.amount));
  const owed = sum(b.cards.map(c => Math.max(0, c.owed)));
  const savedShare = SAVINGS_TARGET_PCT > 0 ? Math.min(1, b.savedPct / SAVINGS_TARGET_PCT) : 0;
  return (
    <div className={s.sxTiles}>
      <button type="button" className={s.sxTile} onClick={onSavings}>
        <span className={s.sxTileLabel}>
          <Icon d={IC.piggy} size={16} /> Saved
        </span>
        <span className={s.sxTileValue}>{Math.round(b.savedPct)}%</span>
        <span className={s.sxTileMeter}>
          <span style={{ width: savedShare * 100 + '%', background: savedShare >= 1 ? C.good : 'var(--clay)' }} />
        </span>
        <span className={s.sxTileNote}>of income, goal {SAVINGS_TARGET_PCT}%</span>
      </button>
      <div className={s.sxTile}>
        <span className={s.sxTileLabel}>
          <Icon d={IC.calendar} size={16} /> Bills to come
        </span>
        <span className={s.sxTileValue}>{short(billTotal)}</span>
        <span className={s.sxTileNote}>{bills.length === 0 ? 'Nothing left this cycle' : bills.length === 1 ? '1 bill before payday' : `${bills.length} bills before payday`}</span>
      </div>
      <div className={s.sxTile}>
        <span className={s.sxTileLabel}>
          <Icon d={IC.card} size={16} /> Card bill
        </span>
        <span className={s.sxTileValue}>{short(owed)}</span>
        <span className={s.sxTileNote}>{owed > 0 ? 'Owed on your cards' : 'Nothing owed'}</span>
      </div>
    </div>
  );
}

function DailyBars({ cycle, budget: b }: { cycle: Cycle; budget: Budget }) {
  const { compact: short, full } = useSettings();
  const phone = useIsPhone();
  const [hover, setHover] = useState<number | null>(null);
  const days = cycle.cycleDays;
  const perDay = new Array<number>(days).fill(0);
  for (const t of b.txs) if (t.offset >= 0 && t.offset < days && categoryByName(t.cat)?.type === 'variable') perDay[t.offset] += t.net;
  const plan = b.varBudget / days;
  const top = Math.max(plan * 1.6, ...perDay, 1);
  const shown = hover ?? cycle.dayIdx;
  return (
    <ChartCard
      title="By day"
      wide
      info="Everyday spending each day, fixed bills left out. The line is the daily share of your everyday plan."
      right={
        <span>
          {dayMonth(cycle.dateOf(shown))} <strong style={{ color: C.text }}>{short(perDay[shown])}</strong>
        </span>
      }
    >
      <div className={s.sxDayBars} onMouseLeave={() => setHover(null)} role="img" aria-label={`Spending by day; daily plan ${full(plan)}`}>
        <span className={s.sxPlanLineMark} style={{ bottom: (plan / top) * 100 + '%' }} aria-hidden="true" />
        {perDay.map((v, i) => {
          const future = i > cycle.dayIdx;
          return (
            <button
              key={i}
              type="button"
              className={s.sxDayBar}
              data-active={i === shown || undefined}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onClick={() => setHover(i)}
              aria-label={`${dayMonth(cycle.dateOf(i))}: ${full(v)}`}
              tabIndex={future ? -1 : 0}
            >
              <span
                className={s.sxDayBarFill}
                style={{
                  height: !future && v > 0 ? Math.max(4, (v / top) * 100) + '%' : 3,
                  background: future || v === 0 ? C.divider : v > plan ? C.amber : 'var(--category-1)',
                }}
              />
            </button>
          );
        })}
      </div>
      <div className={s.sxDayAxis} aria-hidden="true">
        <span>{dayMonth(cycle.start)}</span>
        {!phone && <span>{dayMonth(cycle.dateOf(Math.floor(days / 2)))}</span>}
        <span>{dayMonth(cycle.end)}</span>
      </div>
    </ChartCard>
  );
}

// ---- where it went ----

/** A category colour's matching label ink: `var(--category-7)` → `var(--on-category-7)`. */
const onColor = (color: string) => color.replace('var(--category-', 'var(--on-category-');

type Cell = { name: string; value: number; color: string; on: string; x: number; y: number; w: number; h: number };

/** Squarified treemap layout: rectangles close to square, biggest first. */
function squarify(items: Omit<Cell, 'x' | 'y' | 'w' | 'h'>[], W: number, H: number): Cell[] {
  const out: Cell[] = [];
  const total = sum(items.map(d => d.value));
  if (!total) return out;
  let x = 0, y = 0, w = W, h = H;
  const rest = items.map(d => ({ d, a: (d.value * W * H) / total }));
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

/** How big a box's label can be: big boxes get a big name and share, small ones a small label or none. */
function labelSize(w: number, h: number, name: string) {
  for (const [nameSize, pctSize] of [
    [20, 26],
    [15, 18],
    [12, 13],
  ] as const) {
    const fits = name.length * nameSize * 0.58 + 24 <= w && nameSize + pctSize + 26 <= h;
    if (fits) return { nameSize, pctSize };
  }
  return null;
}

/**
 * Where it went, as a treemap: boxes sized by spending, split by thin gaps, each with its name and share when it
 * fits. Small boxes are named in the legend under it. Tap a box to open the category.
 */
function WhereMap({ budget: b, onOpenCategory }: { budget: Budget; onOpenCategory: (name: string) => void }) {
  const { compact: short, full } = useSettings();
  const phone = useIsPhone();
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const W = useWidth(box);
  const H = phone ? 240 : 300;
  const cats = b.cats.filter(c => c.spent > 0).sort((x, y) => y.spent - x.spent);
  const total = sum(cats.map(c => c.spent));
  // Eight categories at most, then the rest together as Other, shown last.
  const main = cats.slice(0, 8);
  const rest = sum(cats.slice(8).map(c => c.spent));
  const items = [
    ...main.map(c => ({ name: c.name, value: c.spent, color: c.color, on: onColor(c.color) })),
    ...(rest > 0 ? [{ name: 'Other', value: rest, color: 'var(--category-other)', on: 'var(--on-category-other)' }] : []),
  ];
  const cells = W ? squarify(items, W, H) : [];
  const pct = (v: number) => {
    const x = (v / total) * 100;
    return (x < 1 ? '<1' : x < 10 ? x.toFixed(1).replace(/\.0$/, '') : Math.round(x)) + '%';
  };
  const laid = cells.map(c => {
    // 2px gap between boxes: each inner edge gives up 1px.
    const L = Math.round(c.x), T = Math.round(c.y), R = Math.round(c.x + c.w), B = Math.round(c.y + c.h);
    const x = L + (L > 0 ? 1 : 0), y = T + (T > 0 ? 1 : 0);
    const w = R - (R < W ? 1 : 0) - x, h = B - (B < H ? 1 : 0) - y;
    return { ...c, x, y, w, h, label: labelSize(w, h, c.name) };
  });
  const unlabelled = laid.filter(c => !c.label);
  return (
    <ChartCard title="Where it went" wide info="This cycle's spending by category: the bigger the box, the bigger its share. Tap one to open it." right={total > 0 ? short(total) : undefined}>
      {total === 0 ? (
        <span className={s.sxChartEmpty}>Nothing spent yet</span>
      ) : (
        <>
          <div ref={setBox} className={s.sxTreemap} style={{ height: H }} role="img" aria-label={items.map(d => `${d.name} ${full(d.value)} (${pct(d.value)})`).join(', ')}>
            {laid.map(c => (
              <button
                key={c.name}
                type="button"
                className={s.sxTmCell}
                disabled={c.name === 'Other'}
                onClick={() => onOpenCategory(c.name)}
                title={`${c.name}: ${full(c.value)}, ${pct(c.value)}`}
                aria-label={`${c.name}: ${full(c.value)}, ${pct(c.value)}`}
                style={{ left: c.x, top: c.y, width: Math.max(0, c.w), height: Math.max(0, c.h), background: c.color, color: c.on }}
              >
                {c.label && (
                  <>
                    <span className={s.sxTmName} style={{ fontSize: c.label.nameSize, lineHeight: 1.2 }}>
                      {c.name}
                    </span>
                    <span className={s.sxTmPct} style={{ fontSize: c.label.pctSize, lineHeight: 1.15 }}>
                      {pct(c.value)}
                    </span>
                  </>
                )}
              </button>
            ))}
          </div>
          <div className={s.sxTmFoot}>
            {unlabelled.map(p => (
              <button key={p.name} type="button" className={s.sxTmKey} disabled={p.name === 'Other'} onClick={() => onOpenCategory(p.name)} title={full(p.value)}>
                <span className={s.sxLegendDot} style={{ background: p.color }} />
                {p.name} {pct(p.value)}
              </button>
            ))}
            <span className={s.sxTmCaption}>Box size is share of spending, tap one to open</span>
          </div>
        </>
      )}
    </ChartCard>
  );
}

/** An element's width, kept current as it resizes. */
function useWidth(el: HTMLElement | null) {
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return w;
}

// ---- bills to come ----

function BillsTimeline({ cycle, budget: b, onDismissBill }: { cycle: Cycle; budget: Budget; onDismissBill: (b: Bill) => void }) {
  const { compact: short, full } = useSettings();
  const bills = b.bills.filter(x => x.date > cycle.today);
  const [picked, setPicked] = useState(0);
  const from = cycle.today.getTime();
  const to = cycle.end.getTime() + 864e5;
  const at = (d: Date) => Math.min(97, Math.max(3, ((d.getTime() - from) / (to - from)) * 100));
  const sel = bills[Math.min(picked, bills.length - 1)];
  return (
    <ChartCard
      title="Bills to come"
      wide
      info="Bills due before payday, on a line from today to payday. Tap a dot for its details."
      right={bills.length ? short(sum(bills.map(x => x.amount))) : undefined}
    >
      {bills.length === 0 ? (
        <span className={s.sxChartEmpty}>None before payday</span>
      ) : (
        <>
          <div className={s.sxTimeline}>
            <span className={s.sxTimelineLine} />
            {bills.map((x, i) => (
              <button
                key={x.title + x.date.getTime()}
                type="button"
                className={s.sxTimelineDot}
                data-active={x === sel || undefined}
                style={{ left: at(x.date) + '%', background: categoryByName(x.category)?.color ?? C.textSoft }}
                onClick={() => setPicked(i)}
                aria-label={`${tidyName(x.title)}, ${full(x.amount)}, ${dayMonth(x.date)}`}
              />
            ))}
          </div>
          <div className={s.sxDayAxis} aria-hidden="true">
            <span>Today</span>
            <span>{dayMonth(cycle.next)}</span>
          </div>
          {sel && (
            <div className={s.sxTimelinePick}>
              <span className={s.sxLegendDot} style={{ background: categoryByName(sel.category)?.color ?? C.textSoft }} />
              <span style={{ marginRight: 'auto', minWidth: 0 }} className={s.ellipsis}>
                {tidyName(sel.title)}
              </span>
              <span style={{ color: C.textMuted, whiteSpace: 'nowrap' }}>{dayMonth(sel.date)}</span>
              <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{full(sel.amount)}</span>
              {canDismissBill(sel) && (
                <button type="button" className={s.iconBtnSm} aria-label={`Not a bill this cycle: ${tidyName(sel.title)}`} title="Not a bill this cycle" onClick={() => onDismissBill(sel)}>
                  <Icon d={IC.close} size={14} />
                </button>
              )}
            </div>
          )}
        </>
      )}
    </ChartCard>
  );
}

// ---- today ----

function Recent({ budget: b, cycle, onSeeAll }: { budget: Budget; cycle: Cycle; onSeeAll: () => void }) {
  const { full } = useSettings();
  const all = b.txs.filter(t => t.offset === cycle.dayIdx && !t.isTransfer);
  const today = all.slice(0, 3);
  return (
    <ChartCard
      title="Today"
      wide
      info="Your latest transactions today."
      right={
        <button type="button" className={s.textBtnSm} style={{ padding: 0 }} onClick={onSeeAll}>
          {all.length > 3 ? `+${all.length - 3} more` : 'See all'}
        </button>
      }
    >
      {today.length === 0 ? (
        <span className={s.sxChartEmpty}>Nothing yet</span>
      ) : (
        today.map(t => (
          <div key={t.id} className={s.sxRecentRow}>
            <span className={s.sxLegendDot} style={{ background: categoryByName(t.cat)?.color ?? C.textFaint }} />
            <span className={s.ellipsis} style={{ marginRight: 'auto', minWidth: 0 }}>
              {tidyName(t.title)}
            </span>
            <span style={{ fontWeight: 600, whiteSpace: 'nowrap', color: t.isIncome ? C.good : C.text }}>
              {t.isIncome ? '+ ' : '− '}
              {full(t.isIncome ? t.amount : t.net)}
            </span>
          </div>
        ))
      )}
    </ChartCard>
  );
}

/** Near payday: plan the next cycle before it starts (or look over the plan already made). */
/** Maxie speaking up (InsightCard): one serif sentence and one next step. */
function PlanNextNudge({ cycle, planned, onOpen }: { cycle: Cycle; planned: boolean; onOpen: () => void }) {
  return (
    <aside className={s.insightCard} data-wide aria-label="Maxie noticed">
      <span className={s.insightHead}>
        <Logo size={28} /> Maxie noticed
      </span>
      <p className={s.insightBody}>
        {planned ? `Next cycle is planned, and payday is ${dayLabel(cycle.next)}. Want to look it over?` : `Payday is ${dayLabel(cycle.next)}. Want to plan the next cycle now?`}
      </p>
      <div>
        <button type="button" className={s.btnPrimarySm} onClick={onOpen}>
          {planned ? 'Review plan' : 'Plan next cycle'}
        </button>
      </div>
    </aside>
  );
}

export function usualDay(cycle: Cycle, b: Budget) {
  const from = Math.max(0, cycle.dayIdx - 7);
  if (cycle.dayIdx <= from) return null;
  const days = new Array<number>(cycle.dayIdx - from).fill(0);
  for (const t of b.txs) if (t.offset >= from && t.offset < cycle.dayIdx && categoryByName(t.cat)?.type === 'variable') days[t.offset - from] += t.net;
  days.sort((x, y) => x - y);
  const m = days.length >> 1;
  return days.length % 2 ? days[m] : (days[m - 1] + days[m]) / 2;
}

/**
 * One status, agreeing with the daily target (Summary and Plan both show it): over budget, nothing left, your
 * usual day against the target, or on track.
 */
export function cycleStatus(cycle: Cycle, b: Budget, full: (v: number) => string, short: (v: number) => string) {
  const over = b.spent - b.budget;
  const usual = usualDay(cycle, b);
  if (over > 0) return { ink: C.redInk, text: `Over budget by ${full(over)}` };
  if (b.budget - b.spent - b.fixedDue <= 0) return { ink: C.redInk, text: 'Nothing left for spending before payday' };
  if (usual == null) return { ink: C.textMuted, text: 'Stay at or under this each day to finish on budget' };
  if (usual > b.safeDay * 1.05) return { ink: C.amberInk, text: `Your usual day lately is ${short(usual)}, ${short(usual - b.safeDay)} more than this` };
  return { ink: C.good, text: `On track, your usual day lately is ${short(usual)}` };
}
