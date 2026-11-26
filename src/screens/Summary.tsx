import { useEffect, useState, type ReactNode } from 'react';
import s from '../styles/ui.module.css';
import { IC, Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { MaxieNote } from './categoryCards';
import { storage } from '../lib/storage';
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
      <WhereMap cycle={cycle} budget={b} onOpenCategory={onOpenCategory} />
      <BillsTimeline cycle={cycle} budget={b} onDismissBill={onDismissBill} />
      <Recent budget={b} cycle={cycle} onSeeAll={() => onShowTransactions('today')} />
    </div>
  );
}

// ---- shared bits ----

/** A chart card: serif title, optional right header figure and subtitle, and the chart. */
function ChartCard({ title, right, sub, children, wide }: { title: string; right?: ReactNode; sub?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <section className={s.sxChartCard} data-wide={wide || undefined} aria-label={title}>
      <div className={s.sxChartHead}>
        <h2 className={s.sxChartTitle}>{title}</h2>
        {right != null && <span className={s.sxChartRight}>{right}</span>}
      </div>
      {sub != null && <span className={s.sxChartSub}>{sub}</span>}
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
  const { short, full } = useSettings();
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
    <ChartCard title="This cycle" right={`${cycle.daysLeft + 1} ${cycle.daysLeft === 0 ? 'day' : 'days'} to payday`}>
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
  const { short } = useSettings();
  const bills = b.bills.filter(x => x.date > cycle.today);
  const billTotal = sum(bills.map(x => x.amount));
  const owed = sum(b.cards.map(c => Math.max(0, c.owed)));
  const cardInstallments = sum(b.cards.map(c => c.installments));
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
        <span className={s.sxTileNote}>{owed > 0 ? (cardInstallments > 0 ? `Includes ${short(cardInstallments)} installments` : 'Owed on your cards') : 'Nothing owed'}</span>
      </div>
    </div>
  );
}

/**
 * By day (Maxie DailyBarChart): spending per day ending at today, solid labelled average line, the three biggest
 * days and today labelled, period total in header, hover/keyboard tooltip, and a visually hidden data table.
 */
function DailyBars({ cycle, budget: b }: { cycle: Cycle; budget: Budget }) {
  const { short, full } = useSettings();
  const phone = useIsPhone();
  const [hover, setHover] = useState<number | null>(null);
  const days = cycle.cycleDays;
  const perDay = new Array<number>(days).fill(0);
  const catsByDay: Record<string, number>[] = Array.from({ length: days }, () => ({}));
  for (const t of b.txs)
    if (t.offset >= 0 && t.offset < days && categoryByName(t.cat) && !t.isIncome && !t.isTransfer) {
      perDay[t.offset] += t.net;
      catsByDay[t.offset][t.cat] = (catsByDay[t.offset][t.cat] ?? 0) + t.net;
    }
  const sofar = perDay.slice(0, cycle.dayIdx + 1);
  const total = sum(sofar);
  const avg = total / Math.max(1, cycle.dayN);
  const top = Math.max(avg * 1.6, ...sofar, 1);
  // Label only the three biggest days (two on phones) and today.
  const labelled = new Set(
    sofar
      .map((v, i) => ({ v, i }))
      .filter(x => x.v > 0)
      .sort((x, y) => y.v - x.v)
      .slice(0, phone ? 2 : 3)
      .map(x => x.i),
  );
  if (sofar[cycle.dayIdx] > 0) labelled.add(cycle.dayIdx);
  // A spike: a day over 2.5× the average, named by its two biggest categories.
  const spikeIdx = sofar.reduce((m, v, i) => (v > (sofar[m] ?? 0) ? i : m), 0);
  const spike = sofar[spikeIdx] > avg * 2.5 && cycle.dayN >= 5 ? spikeIdx : null;
  const spikeText = (() => {
    if (spike == null) return '';
    const cats = Object.entries(catsByDay[spike]).sort((x, y) => y[1] - x[1]).slice(0, 2).map(([c]) => c);
    return `${dayMonth(cycle.dateOf(spike))}: ${cats.length === 2 ? `${cats[0]} and ${cats[1].toLowerCase()}` : cats[0]}, ${short(sofar[spike])}`;
  })();
  const shown = hover != null && hover < sofar.length ? hover : null;
  const tipPct = shown != null ? Math.min(88, Math.max(12, ((shown + 0.5) / Math.max(1, sofar.length)) * 100)) : 50;
  return (
    <ChartCard
      title="By day"
      wide
      sub={`${dayMonth(cycle.start)} – ${dayMonth(cycle.today)}`}
      right={
        <span>
          <strong style={{ color: C.text }}>{full(total)}</strong> in {cycle.dayN} {cycle.dayN === 1 ? 'day' : 'days'}
        </span>
      }
    >
      {spikeText && (
        <span className={s.sxSpike}>
          <span className={s.sxSpikeDot} aria-hidden="true" />
          {spikeText}
        </span>
      )}
      <div className={s.sxDayBars} style={{ height: phone ? 150 : 180 }} onMouseLeave={() => setHover(null)} role="img" aria-label={`Spending by day, ${full(total)} in ${cycle.dayN} days, average ${full(avg)} a day`}>
        {avg > 0 && (
          <span className={s.sxPlanLineMark} style={{ bottom: (avg / top) * 100 + '%' }} aria-hidden="true">
            <span className={s.sxAvgLabel}>Avg {short(avg)}</span>
          </span>
        )}
        {shown != null && (
          <div className={s.mxTip} style={{ left: tipPct + '%', bottom: Math.min(92, Math.max(16, (sofar[shown] / top) * 100 + 8)) + '%' }} role="tooltip">
            <strong className={s.mxTipVal}>{full(sofar[shown])}</strong>
            <span className={s.mxTipLabel}>{dayMonth(cycle.dateOf(shown))}</span>
          </div>
        )}
        {sofar.map((v, i) => (
          <button
            key={i}
            type="button"
            className={s.sxDayBar}
            data-active={i === shown || undefined}
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
            onClick={() => setHover(i)}
            aria-label={`${dayMonth(cycle.dateOf(i))}: ${full(v)}`}
          >
            <span
              className={s.sxDayBarFill}
              style={{
                position: 'relative',
                height: v > 0 ? Math.max(4, (v / top) * 100) + '%' : 3,
                background: v === 0 ? C.divider : 'var(--category-1)',
                outline: i === spike ? '2px solid var(--category-1)' : undefined,
                outlineOffset: i === spike ? 2 : undefined,
              }}
            >
              {labelled.has(i) && <span className={s.sxBarTop}>{short(v)}</span>}
            </span>
          </button>
        ))}
      </div>
      <div className={s.sxDayAxis} aria-hidden="true">
        <span>{dayMonth(cycle.start)}</span>
        <span style={{ fontWeight: 600, color: C.text }}>Today, {dayMonth(cycle.today)}</span>
      </div>
      <table className="sr-only">
        <caption>Daily spending</caption>
        <thead>
          <tr>
            <th>Date</th>
            <th>Spent</th>
          </tr>
        </thead>
        <tbody>
          {sofar.map((v, i) => (
            <tr key={i}>
              <td>{dayMonth(cycle.dateOf(i))}</td>
              <td>{full(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ChartCard>
  );
}

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

/** Whether a box has room for its label (name and value/share); small boxes go in the legend. */
const labelFits = (w: number, h: number, name: string) => name.length * 7.6 + 24 <= w && h >= 46;

/**
 * Where it went (Maxie CategoryTreemap): flush boxes sized by spending (outer corners radius-md only, no inner gaps
 * or borders), whole percentages, hover/keyboard tooltip, legend for small boxes, and a visually hidden table.
 */
function WhereMap({ cycle, budget: b, onOpenCategory }: { cycle: Cycle; budget: Budget; onOpenCategory: (name: string) => void }) {
  const { full, short } = useSettings();
  const phone = useIsPhone();
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<Cell | null>(null);
  const W = useWidth(box);
  const H = phone ? 240 : 300;
  const cats = b.cats.filter(c => c.spent > 0).sort((x, y) => y.spent - x.spent);
  const total = sum(cats.map(c => c.spent));
  // Eight categories at most, then the rest together as Other.
  const main = cats.slice(0, 8);
  const rest = sum(cats.slice(8).map(c => c.spent));
  // Biggest first, Other too, so the boxes read largest to smallest.
  const items = [
    ...main.map(c => ({ name: c.name, value: c.spent, color: c.color, on: onColor(c.color) })),
    ...(rest > 0 ? [{ name: 'Other', value: rest, color: 'var(--category-other-fill)', on: 'var(--on-category-other)' }] : []),
  ].sort((x, y) => y.value - x.value);
  const cells = W ? squarify(items, W, H) : [];
  const pct = (v: number) => {
    const p = Math.round((v / total) * 100);
    return p < 1 ? '<1%' : `${p}%`;
  };
  // Flush cells: no gaps, borders, or inner rounding; only outer corners (radius-md on container).
  const laid = cells.map(c => {
    const x = Math.round(c.x), y = Math.round(c.y);
    const w = Math.round(c.x + c.w) - x, h = Math.round(c.y + c.h) - y;
    return { ...c, x, y, w, h, label: labelFits(w, h, c.name) };
  });
  const unlabelled = laid.filter(c => !c.label);
  return (
    <ChartCard
      title="Where it went"
      wide
      sub={total > 0 ? `${full(total)} spent, ${dayMonth(cycle.start)} – ${dayMonth(cycle.today)}` : undefined}
    >
      {total === 0 ? (
        <span className={s.sxChartEmpty}>Nothing spent yet</span>
      ) : (
        <>
          <div style={{ position: 'relative' }} onMouseLeave={() => setHover(null)}>
            <div ref={setBox} className={s.sxTreemap} style={{ height: H }} role="img" aria-label={items.map(d => `${d.name} ${full(d.value)} (${pct(d.value)})`).join(', ')}>
              {laid.map(c => (
                <button
                  key={c.name}
                  type="button"
                  className={s.sxTmCell}
                  disabled={c.name === 'Other'}
                  onClick={() => onOpenCategory(c.name)}
                  onMouseEnter={() => setHover(c)}
                  onFocus={() => setHover(c)}
                  onBlur={() => setHover(null)}
                  aria-label={`${c.name}: ${full(c.value)} (${pct(c.value)})`}
                  style={{ left: c.x, top: c.y, width: Math.max(0, c.w), height: Math.max(0, c.h), background: c.color, color: c.on }}
                >
                  {c.label && (
                    <>
                      <span className={s.sxTmName}>{c.name}</span>
                      <span className={s.sxTmPct}>
                        {c.w >= 120 ? `${short(c.value)} (${pct(c.value)})` : pct(c.value)}
                      </span>
                    </>
                  )}
                </button>
              ))}
            </div>
            {hover && W > 0 && (
              <div
                className={s.mxTip}
                style={{
                  left: Math.min(86, Math.max(14, ((hover.x + hover.w / 2) / W) * 100)) + '%',
                  top: Math.max(8, hover.y - 6),
                }}
                role="tooltip"
              >
                <strong className={s.mxTipVal}>
                  {full(hover.value)} ({pct(hover.value)})
                </strong>
                <span className={s.mxTipLabel}>{hover.name}</span>
              </div>
            )}
          </div>
          {unlabelled.length > 0 && (
            <div className={s.sxTmFoot}>
              {unlabelled.map(p => (
                <button key={p.name} type="button" className={s.sxTmKey} disabled={p.name === 'Other'} onClick={() => onOpenCategory(p.name)} title={full(p.value)}>
                  <span className={s.sxLegendDot} style={{ background: p.color }} />
                  {p.name} {short(p.value)} ({pct(p.value)})
                </button>
              ))}
            </div>
          )}
          <table className="sr-only">
            <caption>Spending by category</caption>
            <thead>
              <tr>
                <th>Category</th>
                <th>Spent</th>
                <th>Share</th>
              </tr>
            </thead>
            <tbody>
              {items.map(d => (
                <tr key={d.name}>
                  <td>{d.name}</td>
                  <td>{full(d.value)}</td>
                  <td>{pct(d.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <WhereFlag cycle={cycle} budget={b} onOpenCategory={onOpenCategory} />
        </>
      )}
    </ChartCard>
  );
}

/**
 * Maxie's flag under the treemap: a category well over its limit because of one big expense, which might be in
 * the wrong category. "Review it" opens the category; "It's right" hides it for this cycle (this device).
 */
function WhereFlag({ cycle, budget: b, onOpenCategory }: { cycle: Cycle; budget: Budget; onOpenCategory: (name: string) => void }) {
  const { full } = useSettings();
  const found = b.cats
    .filter(c => c.type === 'variable' && c.limit > 0 && c.spent > c.limit * 1.5)
    // The most over its limit first.
    .sort((x, y) => y.spent / y.limit - x.spent / x.limit)
    .map(c => {
      const big = b.txs.filter(t => t.cat === c.name && !t.isIncome && !t.isTransfer).sort((x, y) => y.net - x.net)[0];
      return big && big.net >= c.spent * 0.4 ? { c, big } : null;
    })
    .find(Boolean);
  const key = found ? `moneyTracker.dismiss.flag.${toISO(cycle.start)}.${found.c.name}` : '';
  const [gone, setGone] = useState(() => !!key && storage.getRaw(key) === '1');
  if (!found || gone) return null;
  return (
    <MaxieNote
      text={`${found.c.name} looks high this cycle. One ${tidyName(found.big.title)} expense (${full(found.big.net)}) might be in the wrong category.`}
      actions={[
        { label: 'Review it', primary: true, onClick: () => onOpenCategory(found.c.name) },
        {
          label: "It's right",
          onClick: () => {
            storage.setRaw(key, '1');
            setGone(true);
          },
        },
      ]}
    />
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
  const { short, full } = useSettings();
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
              {t.isIncome ? '+' : '−'}
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
