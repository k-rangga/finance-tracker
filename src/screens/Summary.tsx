import { useEffect, useState, type ReactNode } from 'react';
import s from '../styles/ui.module.css';
import { IC, Icon } from '../components/Icon';
import { Logo, type MaxieMood } from '../components/Logo';
import { usePlans } from '../components/Plans';
import { MaxieNote } from './categoryCards';
import { storage } from '../lib/storage';
import { Celebrate, useCountUp } from '../components/Delight';
import { cycleKey, hasPlan, nextCycleOf } from '../lib/cyclePlans';
import { changeBadge, type Budget, type TxView } from '../lib/budget';
import type { Cycle } from '../lib/cycle';
import { dayLabel, dayMonth, sum, tidyName, toISO } from '../lib/format';
import { useSettings } from '../lib/settings';
import { useIsPhone } from '../lib/media';
import { C } from '../lib/tokens';
import { categoryByName, SAVINGS_CATEGORY, SAVINGS_TARGET_PCT, TRANSFER_CATEGORY } from '../data/categories';
import { canDismissBill, type Bill } from '../data/transactions';
import type { ActivityFilter } from './Activity';

type TxPatch = Pick<ActivityFilter, 'range'> & Partial<ActivityFilter>;

type SummaryProps = {
  cycle: Cycle;
  budget: Budget;
  onOpenCategory: (name: string) => void;
  onOpenCategories: () => void;
  /** Hide a predicted bill for this cycle. */
  onDismissBill: (b: Bill) => void;
  /** Open Transactions with a range/category/date filter. */
  onShowTransactions: (patch: TxPatch) => void;
  /** Open Plan on the next cycle. */
  onPlanNext: () => void;
  /** Open Ask Maxie, optionally pre-asking a contextual question. */
  onAskMaxie: (ask?: string) => void;
};

/**
 * The cycle at a glance, charts first: a warm daily greeting from Maxie, actionable alerts when needed, what's left,
 * three interactive tiles, spending by day, where the money went (treemap), upcoming bills, and recent activity.
 */
export function Summary({ cycle, budget: b, onOpenCategory, onOpenCategories, onDismissBill, onShowTransactions, onPlanNext, onAskMaxie }: SummaryProps) {
  const { ofIncome, settings } = useSettings();
  const id = toISO(cycle.start);
  const target = ofIncome(SAVINGS_TARGET_PCT);
  const scrollToBills = () => document.getElementById('summary-bills')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return (
    <div className={s.sxSumGrid}>
      <Celebrate id={id + '.saved'} when={target > 0 && b.saved >= target} />
      <Celebrate id={id + '.under'} when={cycle.daysLeft <= 1 && b.spent <= b.budget} />
      <MaxieGreeting cycle={cycle} budget={b} onAskMaxie={onAskMaxie} />
      {cycle.daysLeft <= 4 && <PlanNextNudge cycle={cycle} planned={hasPlan(settings.cyclePlans?.[cycleKey(nextCycleOf(cycle))])} onOpen={onPlanNext} />}
      <NeedsAttention
        budget={b}
        onOpenCategory={onOpenCategory}
        onOpenCategories={onOpenCategories}
        onSortBuffer={() => onShowTransactions({ range: 'cycle', cat: 'Buffer' })}
        onAskMaxie={onAskMaxie}
      />
      <CycleLine cycle={cycle} budget={b} />
      <Tiles
        cycle={cycle}
        budget={b}
        onSavings={() => onShowTransactions({ range: 'cycle', cat: b.saved > 0 ? SAVINGS_CATEGORY : TRANSFER_CATEGORY })}
        onBills={scrollToBills}
      />
      <DailyBars cycle={cycle} budget={b} onOpenDay={iso => onShowTransactions({ range: 'custom', from: iso, to: iso })} />
      <WhereMap cycle={cycle} budget={b} onOpenCategory={onOpenCategory} onOpenCategories={onOpenCategories} />
      <BillsTimeline cycle={cycle} budget={b} onDismissBill={onDismissBill} />
      <Recent
        budget={b}
        cycle={cycle}
        onSeeAll={range => onShowTransactions({ range })}
        onOpenTx={t => onShowTransactions({ range: 'custom', from: toISO(t.date), to: toISO(t.date), cat: categoryByName(t.cat) ? t.cat : '' })}
      />
    </div>
  );
}

/** One cheerful daily sentence from Maxie tuned to time of day, your name, your cycle state, and language setting. */
function MaxieGreeting({ cycle, budget: b, onAskMaxie }: { cycle: Cycle; budget: Budget; onAskMaxie: (ask?: string) => void }) {
  const { short, settings } = useSettings();
  const id = settings.maxieLanguage === 'id';
  const name = settings.name.trim();
  const hr = new Date().getHours();
  const baseSalutation = id
    ? hr < 11
      ? 'Selamat pagi'
      : hr < 15
        ? 'Selamat siang'
        : hr < 19
          ? 'Selamat sore'
          : 'Selamat malam'
    : hr < 12
      ? 'Good morning'
      : hr < 18
        ? 'Good afternoon'
        : 'Good evening';
  const salutation = `${baseSalutation}${name ? `, ${name}` : ''}!`;
  const left = b.budget - b.spent - b.fixedDue;
  const yesterdaySpend =
    cycle.dayIdx > 0
      ? sum(b.txs.filter(t => t.offset === cycle.dayIdx - 1 && categoryByName(t.cat) && !t.isIncome && !t.isTransfer).map(t => t.net))
      : null;
  const recentSavings = b.txs.some(t => t.isSavings && t.offset >= Math.max(0, cycle.dayIdx - 1));

  let mood: MaxieMood = 'happy';
  let line = '';
  let quickAsk: string | undefined;
  if (cycle.dayN === 1) {
    mood = 'happy';
    line = id
      ? `Selamat gajian${name ? `, ${name}` : ''}! Siklus baru, semangat baru — yuk mulai dengan langkah ringan hari ini.`
      : `Happy payday${name ? `, ${name}` : ''}! Fresh cycle, clean slate — here's to a great month ahead!`;
  } else if (left < 0) {
    mood = 'steady';
    line = id
      ? `${salutation} Siklus ini agak ketat, lewat ${short(-left)} dari rencana — tenang, kita atur bareng pelan-pelan ya.`
      : `${salutation} A little tight at ${short(-left)} over plan — no stress, we've got this one day at a time.`;
    quickAsk = id ? 'Kenapa siklus ini lewat rencana dan gimana cara aturnya?' : 'Why am I over plan and how do I recover?';
  } else if (cycle.daysLeft <= 3 && left >= 0) {
    mood = 'happy';
    line = id
      ? `${salutation} Tinggal ${cycle.daysLeft + 1} hari lagi ke gajian dan masih ada sisa ${short(left)} — mantap banget, finishing strong!`
      : `${salutation} Almost at payday with ${short(left)} still to spare — you're finishing strong!`;
  } else if (SAVINGS_TARGET_PCT > 0 && b.savedPct >= SAVINGS_TARGET_PCT && (cycle.dayN <= 4 || recentSavings)) {
    mood = 'happy';
    line = id
      ? `${salutation} Yeay, target tabungan ${SAVINGS_TARGET_PCT}% siklus ini sudah tercapai — keren banget!`
      : `${salutation} Woohoo — savings goal met with ${Math.round(b.savedPct)}% set aside this cycle!`;
  } else if (yesterdaySpend === 0 && cycle.dayN >= 2) {
    mood = 'happy';
    line = id
      ? `${salutation} Kemarin nol pengeluaran — keren! Enak banget buat lanjutin ritme hari ini.`
      : `${salutation} Zero spend yesterday — love that momentum! Let's keep the good groove going.`;
  } else if (b.paceToday > 0 && b.spent < b.paceToday * 0.9 && cycle.dayN >= 4) {
    mood = 'happy';
    line = id
      ? `${salutation} Ritmemu cakep banget — masih ${short(b.paceToday - b.spent)} di bawah kecepatan normal hari ke-${cycle.dayN}!`
      : `${salutation} You're crushing it — ${short(b.paceToday - b.spent)} under pace by day ${cycle.dayN}!`;
  } else {
    mood = 'happy';
    line = id
      ? `${salutation} Semua masih aman di ${short(b.safeDay)} per hari sampai gajian nanti — semoga harimu menyenangkan!`
      : `${salutation} Looking steady at ${short(b.safeDay)} a day until payday — hope you have a great day!`;
  }

  return (
    <div className={s.mxGreeting} data-wide>
      <Logo size={36} mood={mood} interactive />
      <p className={s.mxGreetingText} style={{ marginRight: 'auto' }}>
        {line}
      </p>
      {quickAsk && (
        <button type="button" className={s.sxAttnPill} onClick={() => onAskMaxie(quickAsk)}>
          <Icon d={IC.sparkle} size={12} /> {id ? 'Tanya Maxie' : 'Ask Maxie'}
        </button>
      )}
    </div>
  );
}

// ---- needs attention: over/near limit categories & inbox items ----

function NeedsAttention({
  budget: b,
  onOpenCategory,
  onOpenCategories,
  onSortBuffer,
  onAskMaxie,
}: {
  budget: Budget;
  onOpenCategory: (name: string) => void;
  onOpenCategories: () => void;
  onSortBuffer: () => void;
  onAskMaxie: (ask?: string) => void;
}) {
  const { short, settings } = useSettings();
  const { found } = usePlans();
  const isId = settings.maxieLanguage === 'id';
  const alerts = b.cats
    .filter(c => c.status.key !== 'ok')
    .sort((a, z) => a.status.rank - z.status.rank || z.used - a.used);
  const bufferCount = b.txs.filter(t => t.cat === 'Buffer' && !t.isIncome && !t.isTransfer).length;
  const shown = alerts.slice(0, 4);
  if (alerts.length === 0 && bufferCount === 0 && found.length === 0) return null;
  const topAlert = alerts[0];

  return (
    <section className={s.sxAttnCard} data-wide aria-label="Needs attention">
      <div className={s.sxAttnHead}>
        <span className={s.sxAttnTitle}>
          <Icon d={IC.alert} size={15} color={alerts.some(c => c.status.key === 'over') ? C.redInk : C.amberInk} />
          Needs attention
        </span>
        <div className={s.sxAttnActions}>
          {topAlert && (
            <button
              type="button"
              className={s.sxAttnPill}
              onClick={() =>
                onAskMaxie(
                  isId
                    ? `Gimana cara ngerem ${topAlert.name} supaya siklus ini tetap aman?`
                    : `How do I get back on track with ${topAlert.name}?`,
                )
              }
            >
              <Icon d={IC.sparkle} size={12} /> {isId ? 'Tanya Maxie' : 'Ask Maxie'}
            </button>
          )}
          {bufferCount > 0 && (
            <button type="button" className={s.sxAttnPill} onClick={onSortBuffer}>
              Sort {bufferCount} in Buffer <Icon d={IC.arrowRight} size={12} />
            </button>
          )}
          {found.length > 0 && (
            <button type="button" className={s.sxAttnPill} onClick={onOpenCategories}>
              Confirm {found.length} {found.length === 1 ? 'installment' : 'installments'} <Icon d={IC.arrowRight} size={12} />
            </button>
          )}
        </div>
      </div>
      {shown.length > 0 && (
        <div className={s.sxAttnGrid}>
          {shown.map(c => {
            const over = c.spent > c.limit;
            return (
              <button key={c.name} type="button" className={s.sxAttnItem} onClick={() => onOpenCategory(c.name)}>
                <span className={s.sxAttnTop}>
                  <span className={s.sxLegendDot} style={{ background: c.color }} />
                  <span className={s.sxAttnName}>{c.name}</span>
                  <span className={s.sxAttnMeta} style={{ color: c.status.ink }}>
                    {over ? `${short(c.spent - c.limit)} over` : `${Math.round(c.used)}%`}
                  </span>
                </span>
                <span className={s.sxAttnBar}>
                  <span style={{ width: Math.min(100, c.used) + '%', background: c.status.bar }} />
                </span>
              </button>
            );
          })}
          {alerts.length > shown.length && (
            <button type="button" className={s.sxAttnMore} onClick={onOpenCategories}>
              +{alerts.length - shown.length} more categories
            </button>
          )}
        </div>
      )}
    </section>
  );
}

// ---- shared bits ----

/** A chart card: serif title, optional right header figure and subtitle, and the chart. */
function ChartCard({ id, title, right, sub, children, wide }: { id?: string; title: string; right?: ReactNode; sub?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <section id={id} className={s.sxChartCard} data-wide={wide || undefined} aria-label={title}>
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
 * What's left on top; below it, the running total of what you've spent (solid), an ideal-pace reference diagonal,
 * a dashed projection to payday at your pace so far plus the bills still to come, and your plan as a flat line.
 */
function CycleLine({ cycle, budget: b }: { cycle: Cycle; budget: Budget }) {
  const { short, full } = useSettings();
  const [hover, setHover] = useState<number | null>(null);
  const left = b.budget - b.spent - b.fixedDue;
  const shownLeft = useCountUp(Math.abs(left), 700, 'summary.left');
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
  const lastSameDays = sum(b.cats.map(c => c.lastSameDays));
  const vsLast = lastSameDays > 0 && b.spent > 0 ? changeBadge(b.spent, lastSameDays) : null;
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
      <div className={s.sxLine} onPointerMove={pick} onPointerDown={pick} onPointerLeave={() => setHover(null)} onPointerCancel={() => setHover(null)}>
        <svg viewBox={`0 0 ${CW} ${CH}`} preserveAspectRatio="none" role="img" aria-label={`Spent ${full(cum[today])} so far; heading for ${full(end)} by payday, plan ${full(b.budget)}`}>
          <path d={area} fill="var(--category-1)" opacity={0.1} />
          {b.budget > 0 && <line x1={0} x2={CW} y1={y(b.budget)} y2={y(b.budget)} stroke="var(--line-strong)" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
          {b.budget > 0 && (
            <line
              x1={0}
              y1={y(Math.min(b.fixedSpent, b.budget))}
              x2={CW}
              y2={y(b.budget)}
              stroke="var(--line-strong)"
              strokeWidth={1}
              strokeDasharray="2 4"
              opacity={0.7}
              vectorEffect="non-scaling-stroke"
            />
          )}
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
          <span className={s.sxLineFootRow}>
            <span>
              Spent <strong style={{ color: C.text }}>{short(b.spent)}</strong> · Heading for <strong style={{ color: projInk }}>{short(end)}</strong>
            </span>
            {vsLast && (
              <span className={s.sxDeltaBadge} style={{ background: vsLast.bg, color: vsLast.ink }} title="Compared to the same point last cycle">
                {vsLast.label} vs last
              </span>
            )}
          </span>
        )}
      </div>
    </ChartCard>
  );
}

/** Three interactive StatTiles (Maxie): Saved (with Rp progress), Bills to come (scrolls to bills), and Card bill (expandable per-card view). */
function Tiles({ cycle, budget: b, onSavings, onBills }: { cycle: Cycle; budget: Budget; onSavings: () => void; onBills: () => void }) {
  const { short, full, ofIncome } = useSettings();
  const [cardsOpen, setCardsOpen] = useState(false);
  const bills = b.bills.filter(x => x.date > cycle.today);
  const billTotal = sum(bills.map(x => x.amount));
  const owed = sum(b.cards.map(c => Math.max(0, c.owed)));
  const cardInstallments = sum(b.cards.map(c => c.installments));
  const target = ofIncome(SAVINGS_TARGET_PCT);
  const savedShare = SAVINGS_TARGET_PCT > 0 ? Math.min(1, b.savedPct / SAVINGS_TARGET_PCT) : 0;
  const savedNote =
    target > 0
      ? savedShare >= 1
        ? `Goal met · ${short(b.saved)}`
        : `${short(b.saved)} of ${short(target)} goal`
      : b.saved > 0
        ? `${short(b.saved)} set aside`
        : 'No savings goal set';
  const activeCards = b.cards.filter(c => c.owed > 0 || c.spent > 0 || c.lastBill > 0);

  return (
    <div className={s.sxTilesWrap}>
      <div className={s.sxTiles}>
        <button type="button" className={s.sxTile} onClick={onSavings}>
          <span className={s.sxTileLabel}>
            <Icon d={IC.piggy} size={16} /> Saved
          </span>
          <span className={s.sxTileValue}>{Math.round(b.savedPct)}%</span>
          <span className={s.sxTileMeter}>
            <span style={{ width: savedShare * 100 + '%', background: savedShare >= 1 ? C.good : 'var(--clay)' }} />
          </span>
          <span className={s.sxTileNote}>{savedNote}</span>
        </button>
        <button type="button" className={s.sxTile} onClick={onBills}>
          <span className={s.sxTileLabel}>
            <Icon d={IC.calendar} size={16} /> Bills to come
          </span>
          <span className={s.sxTileValue}>{short(billTotal)}</span>
          <span className={s.sxTileNote}>{bills.length === 0 ? 'Clear until payday' : bills.length === 1 ? '1 bill before payday' : `${bills.length} bills before payday`}</span>
        </button>
        <button
          type="button"
          className={s.sxTile}
          aria-expanded={activeCards.length > 0 ? cardsOpen : undefined}
          disabled={activeCards.length === 0}
          onClick={() => activeCards.length > 0 && setCardsOpen(o => !o)}
        >
          <span className={s.sxTileLabel}>
            <Icon d={IC.card} size={16} /> Card bill
            {activeCards.length > 0 && <Icon d={IC.chevDown} size={13} style={{ marginLeft: 'auto', transform: cardsOpen ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />}
          </span>
          <span className={s.sxTileValue}>{short(owed)}</span>
          <span className={s.sxTileNote}>
            {owed > 0 ? (cardInstallments > 0 ? `Includes ${short(cardInstallments)} installments` : 'Owed on your cards') : 'Nothing owed'}
          </span>
        </button>
      </div>
      {cardsOpen && activeCards.length > 0 && (
        <div className={s.sxCardBreakdown} role="region" aria-label="Card bills breakdown">
          {activeCards.map(c => (
            <div key={c.account} className={s.sxCardBreakRow}>
              <span className={s.ellipsis} style={{ fontWeight: 500, marginRight: 'auto' }}>
                {c.account}
              </span>
              {c.carriedOver > 0 && <span className={s.sxCardBreakSub}>{short(c.carriedOver)} last bill</span>}
              <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{full(Math.max(0, c.owed))}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * By day (Maxie DailyBarChart): full-cycle slots so early days don't stretch awkwardly, solid labelled average line,
 * biggest days and today labelled, clickable spike callout, click-to-inspect day with drill-down to Transactions,
 * and a visually hidden data table.
 */
function DailyBars({ cycle, budget: b, onOpenDay }: { cycle: Cycle; budget: Budget; onOpenDay: (iso: string) => void }) {
  const { short, full } = useSettings();
  const phone = useIsPhone();
  const [hover, setHover] = useState<number | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const days = cycle.cycleDays;
  const perDay = new Array<number>(days).fill(0);
  const catsByDay: Record<string, number>[] = Array.from({ length: days }, () => ({}));
  for (const t of b.txs)
    if (t.offset >= 0 && t.offset < days && categoryByName(t.cat) && !t.isIncome && !t.isTransfer) {
      perDay[t.offset] += t.net;
      catsByDay[t.offset][t.cat] = (catsByDay[t.offset][t.cat] ?? 0) + t.net;
    }
  const sofar = perDay.slice(0, cycle.dayIdx + 1);
  const zeroDays = sofar.filter(v => v === 0).length;
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
  const shown = hover != null && hover < sofar.length ? hover : picked != null && picked < sofar.length ? picked : null;
  const tipPct = shown != null ? Math.min(88, Math.max(12, ((shown + 0.5) / Math.max(1, days)) * 100)) : 50;
  const pickedTopCat =
    picked != null ? Object.entries(catsByDay[picked]).sort((x, y) => y[1] - x[1])[0]?.[0] : undefined;

  return (
    <ChartCard
      title="By day"
      wide
      sub={`${dayMonth(cycle.start)} – ${dayMonth(cycle.today)}${zeroDays > 0 ? `, ${zeroDays} zero-spend ${zeroDays === 1 ? 'day' : 'days'}` : ''}`}
      right={
        <span>
          <strong style={{ color: C.text }}>{full(total)}</strong> in {cycle.dayN} {cycle.dayN === 1 ? 'day' : 'days'}
        </span>
      }
    >
      {spike != null && spikeText && (
        <button type="button" className={s.sxSpikeBtn} onClick={() => onOpenDay(toISO(cycle.dateOf(spike)))}>
          <span className={s.sxSpikeDot} aria-hidden="true" />
          <span>{spikeText}</span>
          <Icon d={IC.arrowRight} size={13} />
        </button>
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
        {perDay.map((v, i) =>
          i <= cycle.dayIdx ? (
            <button
              key={i}
              type="button"
              className={s.sxDayBar}
              data-active={i === shown || undefined}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              onClick={() => setPicked(p => (p === i ? null : i))}
              aria-label={`${dayMonth(cycle.dateOf(i))}: ${full(v)}`}
              aria-pressed={picked === i}
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
          ) : (
            <span key={i} className={s.sxDayFuture} aria-hidden="true">
              <span className={s.sxDayFutureTick} />
            </span>
          ),
        )}
      </div>
      <div className={s.sxDayAxis} aria-hidden="true">
        <span>{dayMonth(cycle.start)}</span>
        <span style={{ fontWeight: 600, color: C.text }}>Today, {dayMonth(cycle.today)}</span>
        {cycle.daysLeft > 0 && <span>Payday {dayMonth(cycle.next)}</span>}
      </div>
      {picked != null && picked < sofar.length && (
        <div className={s.sxDayPick}>
          <span>
            <strong style={{ color: C.text }}>{dayMonth(cycle.dateOf(picked))}</strong>: {full(sofar[picked])}
            {pickedTopCat ? ` · top: ${pickedTopCat}` : ''}
          </span>
          <button type="button" className={s.textBtnSm} onClick={() => onOpenDay(toISO(cycle.dateOf(picked)))}>
            See transactions <Icon d={IC.arrowRight} size={13} />
          </button>
          <button type="button" className={s.iconBtnSm} aria-label="Clear selected day" onClick={() => setPicked(null)}>
            <Icon d={IC.close} size={14} />
          </button>
        </div>
      )}
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

type Cell = { name: string; value: number; color: string; on: string; detail?: string; x: number; y: number; w: number; h: number };

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
 * or borders), All vs Everyday toggle so fixed bills don't dwarf discretionary spend, whole percentages, hover/keyboard
 * tooltip, clickable Other cell, legend for small boxes, and a visually hidden table.
 */
function WhereMap({
  cycle,
  budget: b,
  onOpenCategory,
  onOpenCategories,
}: {
  cycle: Cycle;
  budget: Budget;
  onOpenCategory: (name: string) => void;
  onOpenCategories: () => void;
}) {
  const { full, short } = useSettings();
  const phone = useIsPhone();
  const [scope, setScope] = useState<'all' | 'variable'>('all');
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<Cell | null>(null);
  const W = useWidth(box);
  const H = phone ? 240 : 300;
  const hasFixed = b.cats.some(c => c.type === 'fixed' && c.spent > 0);
  const hasVar = b.cats.some(c => c.type === 'variable' && c.spent > 0);
  const activeScope = hasFixed && hasVar ? scope : 'all';
  const cats = b.cats
    .filter(c => c.spent > 0 && (activeScope === 'all' || c.type === 'variable'))
    .sort((x, y) => y.spent - x.spent);
  const total = sum(cats.map(c => c.spent));
  // Eight categories at most, then the rest together as Other.
  const main = cats.slice(0, 8);
  const restCats = cats.slice(8);
  const rest = sum(restCats.map(c => c.spent));
  // Biggest first, Other too, so the boxes read largest to smallest.
  const items: Omit<Cell, 'x' | 'y' | 'w' | 'h'>[] = [
    ...main.map(c => ({ name: c.name, value: c.spent, color: c.color, on: onColor(c.color) })),
    ...(rest > 0
      ? [
          {
            name: 'Other',
            value: rest,
            color: 'var(--category-other-fill)',
            on: 'var(--on-category-other)',
            detail: restCats.map(c => c.name).join(', '),
          },
        ]
      : []),
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
  const openCell = (name: string) => (name === 'Other' ? onOpenCategories() : onOpenCategory(name));
  return (
    <ChartCard
      title="Where it went"
      wide
      right={
        hasFixed && hasVar ? (
          <div className={s.sxMiniSeg} role="group" aria-label="Spending scope">
            {(['all', 'variable'] as const).map(v => (
              <button key={v} type="button" aria-pressed={activeScope === v} onClick={() => setScope(v)}>
                {v === 'all' ? 'All' : 'Everyday'}
              </button>
            ))}
          </div>
        ) : undefined
      }
      sub={
        total > 0
          ? `${full(total)} ${activeScope === 'variable' ? 'everyday ' : ''}spent, ${dayMonth(cycle.start)} – ${dayMonth(cycle.today)}`
          : undefined
      }
    >
      {total === 0 ? (
        <div className={s.mxEmptyInline}>
          <Logo size={28} mood="curious" />
          <span>Nothing spent yet — clean slate for this cycle.</span>
        </div>
      ) : (
        <>
          <div style={{ position: 'relative' }} onMouseLeave={() => setHover(null)}>
            <div ref={setBox} className={s.sxTreemap} style={{ height: H }} role="img" aria-label={items.map(d => `${d.name} ${full(d.value)} (${pct(d.value)})`).join(', ')}>
              {laid.map(c => (
                <button
                  key={c.name}
                  type="button"
                  className={s.sxTmCell}
                  onClick={() => openCell(c.name)}
                  onMouseEnter={() => setHover(c)}
                  onFocus={() => setHover(c)}
                  onBlur={() => setHover(null)}
                  aria-label={`${c.name}: ${full(c.value)} (${pct(c.value)})${c.detail ? ` — ${c.detail}` : ''}`}
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
                <span className={s.mxTipLabel}>{hover.detail ? `${hover.name}: ${hover.detail}` : hover.name}</span>
              </div>
            )}
          </div>
          {unlabelled.length > 0 && (
            <div className={s.sxTmFoot}>
              {unlabelled.map(p => (
                <button key={p.name} type="button" className={s.sxTmKey} onClick={() => openCell(p.name)} title={p.detail ? `${full(p.value)} — ${p.detail}` : full(p.value)}>
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
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const keyFor = (catName: string) => `moneyTracker.dismiss.flag.${toISO(cycle.start)}.${catName}`;
  const isDismissed = (catName: string) => {
    const k = keyFor(catName);
    return dismissed.has(k) || storage.getRaw(k) === '1';
  };
  const found = b.cats
    .filter(c => c.type === 'variable' && c.limit > 0 && c.spent > c.limit * 1.5 && !isDismissed(c.name))
    // The most over its limit first.
    .sort((x, y) => y.spent / y.limit - x.spent / x.limit)
    .map(c => {
      const big = b.txs.filter(t => t.cat === c.name && !t.isIncome && !t.isTransfer).sort((x, y) => y.net - x.net)[0];
      return big && big.net >= c.spent * 0.4 ? { c, big } : null;
    })
    .find(Boolean);
  if (!found) return null;
  const key = keyFor(found.c.name);
  return (
    <MaxieNote
      text={`${found.c.name} looks high this cycle. One ${tidyName(found.big.title)} expense (${full(found.big.net)}) might be in the wrong category.`}
      actions={[
        { label: 'Review it', primary: true, onClick: () => onOpenCategory(found.c.name) },
        {
          label: "It's right",
          onClick: () => {
            storage.setRaw(key, '1');
            setDismissed(prev => new Set(prev).add(key));
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
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const from = cycle.today.getTime();
  const to = cycle.end.getTime() + 864e5;
  const at = (d: Date) => Math.min(96, Math.max(4, ((d.getTime() - from) / Math.max(1, to - from)) * 100));

  // Group bills sharing the same date into one dot so dots never stack on top of each other.
  const groups: { iso: string; date: Date; items: Bill[]; color: string }[] = [];
  for (const x of bills) {
    const iso = toISO(x.date);
    const existing = groups.find(g => g.iso === iso);
    if (existing) existing.items.push(x);
    else groups.push({ iso, date: x.date, items: [x], color: categoryByName(x.category)?.color ?? C.textSoft });
  }
  const activeDay = pickedDay && groups.some(g => g.iso === pickedDay) ? pickedDay : null;
  const visible = showAll || activeDay ? bills : bills.slice(0, 4);

  return (
    <ChartCard
      id="summary-bills"
      title="Bills to come"
      right={bills.length ? short(sum(bills.map(x => x.amount))) : undefined}
    >
      {bills.length === 0 ? (
        <div className={s.mxEmptyInline}>
          <Logo size={28} mood="happy" />
          <span>Clear skies until payday. No bills left.</span>
        </div>
      ) : (
        <>
          <div className={s.sxTimeline}>
            <span className={s.sxTimelineLine} />
            {groups.map(g => (
              <button
                key={g.iso}
                type="button"
                className={s.sxTimelineDotBtn}
                data-active={g.iso === activeDay || undefined}
                style={{ left: at(g.date) + '%' }}
                onClick={() => setPickedDay(d => (d === g.iso ? null : g.iso))}
                aria-label={`${dayMonth(g.date)}: ${g.items.map(i => `${tidyName(i.title)} ${full(i.amount)}`).join(', ')}`}
                aria-pressed={g.iso === activeDay}
              >
                <span className={s.sxTimelineDotVisual} style={{ background: g.color }}>
                  {g.items.length > 1 ? g.items.length : null}
                </span>
              </button>
            ))}
          </div>
          <div className={s.sxDayAxis} aria-hidden="true">
            <span>Today</span>
            <span>{dayMonth(cycle.next)}</span>
          </div>
          <div className={s.sxBillList}>
            {visible.map((x, idx) => {
              const iso = toISO(x.date);
              return (
                <div key={`${iso}-${x.title}-${x.amount}-${idx}`} className={s.sxBillRow} data-active={iso === activeDay || undefined}>
                  <span className={s.sxLegendDot} style={{ background: categoryByName(x.category)?.color ?? C.textSoft }} />
                  <span className={s.ellipsis} style={{ marginRight: 'auto', minWidth: 0 }}>
                    {tidyName(x.title)}
                  </span>
                  <span className={s.sxBillDate}>{dayMonth(x.date)}</span>
                  <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{short(x.amount)}</span>
                  {canDismissBill(x) && (
                    <button type="button" className={s.iconBtnSm} aria-label={`Not a bill this cycle: ${tidyName(x.title)}`} title="Not a bill this cycle" onClick={() => onDismissBill(x)}>
                      <Icon d={IC.close} size={14} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {bills.length > 4 && !activeDay && (
            <button type="button" className={s.textBtnSm} style={{ alignSelf: 'flex-start', padding: 0 }} onClick={() => setShowAll(v => !v)}>
              {showAll ? 'Show fewer' : `Show all ${bills.length} bills`}
            </button>
          )}
        </>
      )}
    </ChartCard>
  );
}

// ---- today / recent activity ----

function Recent({
  budget: b,
  cycle,
  onSeeAll,
  onOpenTx,
}: {
  budget: Budget;
  cycle: Cycle;
  onSeeAll: (range: 'today' | 'cycle') => void;
  onOpenTx: (t: TxView) => void;
}) {
  const { full } = useSettings();
  const todayAll = b.txs.filter(t => t.offset === cycle.dayIdx && !t.isTransfer);
  const cycleAll = b.txs.filter(t => !t.isTransfer);
  const hasToday = todayAll.length > 0;
  const rows = (hasToday ? todayAll : cycleAll).slice(0, 4);
  const relDate = (t: TxView) => (t.offset === cycle.dayIdx ? 'Today' : t.offset === cycle.dayIdx - 1 ? 'Yesterday' : dayMonth(t.date));

  return (
    <ChartCard
      title={hasToday ? 'Today' : 'Recent'}
      sub={!hasToday && rows.length > 0 ? 'Quiet day so far — nothing spent today.' : undefined}
      right={
        rows.length > 0 ? (
          <button type="button" className={s.textBtnSm} style={{ padding: 0 }} onClick={() => onSeeAll(hasToday ? 'today' : 'cycle')}>
            {hasToday && todayAll.length > 4 ? `+${todayAll.length - 4} more` : 'See all'}
          </button>
        ) : undefined
      }
    >
      {rows.length === 0 ? (
        <div className={s.mxEmptyInline}>
          <Logo size={28} mood="happy" />
          <span>Quiet cycle so far — nothing spent yet.</span>
        </div>
      ) : (
        <div className={s.sxRecentList}>
          {rows.map(t => (
            <button key={t.id} type="button" className={s.sxRecentBtn} onClick={() => onOpenTx(t)}>
              <span className={s.sxLegendDot} style={{ background: categoryByName(t.cat)?.color ?? C.textFaint }} />
              <span className={s.ellipsis} style={{ marginRight: 'auto', minWidth: 0 }}>
                {tidyName(t.title)}
              </span>
              {!hasToday && <span className={s.sxRecentDate}>{relDate(t)}</span>}
              <span style={{ fontWeight: 600, whiteSpace: 'nowrap', color: t.isIncome ? C.good : C.text }}>
                {t.isIncome ? '+' : '−'}
                {full(t.isIncome ? t.amount : t.net)}
              </span>
            </button>
          ))}
        </div>
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
