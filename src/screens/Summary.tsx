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
import { billLandingDay, paceInsight, weekendSafeSplit } from '../lib/pace';
import { addDays, dayLabel, dayMonth, sum, tidyName, toISO } from '../lib/format';
import { haptic } from '../lib/haptics';
import { useSettings } from '../lib/settings';
import { useIsPhone } from '../lib/media';
import { C } from '../lib/tokens';
import { categoryByName, SAVINGS_CATEGORY, SAVINGS_TARGET_PCT, TRANSFER_CATEGORY } from '../data/categories';
import type { Bill } from '../data/transactions';
import { UpcomingBills } from '../components/UpcomingBills';
import type { ActivityFilter } from './Activity';
import { TargetIcon } from './categoriesExtras';
import { CycleStoryModal, resolveVignetteScene, VignetteSvg } from './SummaryRituals';
import { WealthCompactStrip } from './WealthSection';
import type { FortAssetsAlert, ImpulseSummary, LifestyleCreepSignal, WealthSnapshot } from '../lib/wealth';

type TxPatch = Pick<ActivityFilter, 'range'> & Partial<ActivityFilter>;

type SummaryProps = {
  cycle: Cycle;
  budget: Budget;
  wealth?: WealthSnapshot;
  impulse?: ImpulseSummary;
  fortDip?: FortAssetsAlert | null;
  lifestyleCreep?: LifestyleCreepSignal | null;
  pyfStreak?: number;
  onOpenCategory: (name: string) => void;
  onOpenCategories: () => void;
  onOpenPlan?: () => void;
  onOpenInvest?: () => void;
  /** Skip or remove an upcoming bill for this cycle. */
  onDismissBill: (b: Bill) => void;
  /** 1-tap mark a fixed bill as paid for this cycle. */
  onMarkBillPaid?: (b: Bill) => void;
  /** Open Transactions with a range/category/date filter. */
  onShowTransactions: (patch: TxPatch) => void;
  /** Open Plan on the next cycle. */
  onPlanNext: () => void;
  /** Open Ask Maxie, optionally pre-asking a contextual question. */
  onAskMaxie: (ask?: string) => void;
};

/**
 * The cycle at a glance, charts first: one unified Maxie companion bar (vignette, greeting, and Cycle Story),
 * gentle alerts, what's left, three warm interactive tiles, wealth runway pulse, spending by day, where the money went (treemap),
 * upcoming bills, and recent activity.
 */
export function Summary({
  cycle,
  budget: b,
  wealth,
  impulse,
  fortDip,
  lifestyleCreep,
  pyfStreak,
  onOpenCategory,
  onOpenCategories,
  onOpenPlan,
  onOpenInvest,
  onDismissBill,
  onMarkBillPaid,
  onShowTransactions,
  onPlanNext,
  onAskMaxie,
}: SummaryProps) {
  const { ofIncome, settings } = useSettings();
  const id = toISO(cycle.start);
  const todayISO = toISO(cycle.today);
  const storyKey = `moneyTracker.storySeen.${todayISO}`;
  const [storyOpen, setStoryOpen] = useState(false);

  // Open the 4-card Cycle Story pop-up gently on first visit of the day (skipped in Quiet mode or empty cycles).
  useEffect(() => {
    if (settings.quietMode || b.txs.length === 0) return;
    if (storage.getRaw(storyKey)) return;
    const t = setTimeout(() => {
      storage.setRaw(storyKey, '1');
      setStoryOpen(true);
    }, 320);
    return () => clearTimeout(t);
  }, [storyKey, settings.quietMode, b.txs.length]);

  const target = ofIncome(SAVINGS_TARGET_PCT);
  const scrollToBills = () => document.getElementById('summary-bills')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return (
    <div className={s.sxSumGrid}>
      <Celebrate id={id + '.payday'} when={cycle.dayN === 1} />
      <Celebrate id={id + '.saved'} when={target > 0 && b.saved >= target} />
      <Celebrate id={id + '.under'} when={cycle.daysLeft <= 1 && b.spent <= b.budget} />
      <MaxieGreeting
        cycle={cycle}
        budget={b}
        target={target}
        onAskMaxie={onAskMaxie}
        onOpenStory={() => {
          haptic('tap', settings.quietMode);
          setStoryOpen(true);
        }}
      />
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
        budget={b}
        onSavings={() => onShowTransactions({ range: 'cycle', cat: b.saved > 0 ? SAVINGS_CATEGORY : TRANSFER_CATEGORY })}
        onBills={scrollToBills}
      />
      {wealth && impulse && (
        <WealthCompactStrip
          wealth={wealth}
          impulse={impulse}
          fortDip={fortDip ?? null}
          lifestyleCreep={lifestyleCreep ?? null}
          pyfStreak={pyfStreak ?? 0}
          onOpenPlan={onOpenPlan ?? onPlanNext}
          onOpenInvest={onOpenInvest ?? onOpenCategories}
          onAskMaxie={onAskMaxie}
        />
      )}
      <DailyBars cycle={cycle} budget={b} onOpenDay={iso => onShowTransactions({ range: 'custom', from: iso, to: iso })} />
      <WhereMap cycle={cycle} budget={b} onOpenCategory={onOpenCategory} onOpenCategories={onOpenCategories} />
      <UpcomingBills id="summary-bills" cycle={cycle} bills={b.bills} limit={5} compact onDismiss={onDismissBill} onMarkPaid={onMarkBillPaid} />
      <Recent
        budget={b}
        cycle={cycle}
        onSeeAll={range => onShowTransactions({ range })}
        onOpenTx={t => onShowTransactions({ range: 'custom', from: toISO(t.date), to: toISO(t.date), cat: categoryByName(t.cat) ? t.cat : '' })}
      />
      <CycleStoryModal cycle={cycle} budget={b} wealth={wealth} pyfStreak={pyfStreak} open={storyOpen} onClose={() => setStoryOpen(false)} />
    </div>
  );
}

/** Consecutive completed days (ending yesterday) where variable spending stayed within daily target. */
function smoothStreakDays(cycle: Cycle, b: Budget): number {
  const varLimit = sum(b.cats.filter(c => c.type === 'variable').map(c => c.limit));
  const dailyTarget = varLimit > 0 ? varLimit / Math.max(1, cycle.cycleDays) : b.safeDay;
  if (dailyTarget <= 0 || cycle.dayIdx < 3) return 0;
  const byDay = new Array<number>(cycle.dayIdx).fill(0);
  for (const t of b.txs) {
    if (t.offset >= 0 && t.offset < cycle.dayIdx && !t.isIncome && !t.isTransfer && categoryByName(t.cat)?.type === 'variable') {
      byDay[t.offset] += t.net;
    }
  }
  let streak = 0;
  for (let d = cycle.dayIdx - 1; d >= 0; d--) {
    if (byDay[d] <= dailyTarget * 1.05) streak++;
    else break;
  }
  return streak;
}

/**
 * Unified Maxie Companion Bar: combines Maxie's living Husky window scene, personalized daily greeting,
 * optional zero-spend pledge, and the Cycle Story replay trigger into one clean strip.
 */
function MaxieGreeting({
  cycle,
  budget: b,
  target,
  onAskMaxie,
  onOpenStory,
}: {
  cycle: Cycle;
  budget: Budget;
  target: number;
  onAskMaxie: (ask?: string) => void;
  onOpenStory: () => void;
}) {
  const { short, settings } = useSettings();
  const id = settings.maxieLanguage === 'id';
  const name = settings.name.trim();
  const pledgeKey = `moneyTracker.zeroPledge.${toISO(cycle.today)}`;
  const [pledged, setPledged] = useState(() => storage.get<boolean>(pledgeKey, false));
  const [pledgePop, setPledgePop] = useState(false);
  useEffect(() => {
    setPledged(storage.get<boolean>(pledgeKey, false));
  }, [pledgeKey]);
  useEffect(() => {
    if (!pledgePop) return;
    const t = setTimeout(() => setPledgePop(false), 1400);
    return () => clearTimeout(t);
  }, [pledgePop]);

  const togglePledge = () => {
    setPledged(prev => {
      const next = !prev;
      storage.set(pledgeKey, next);
      if (next) {
        haptic('success', settings.quietMode);
        if (!settings.quietMode) setPledgePop(true);
      } else {
        haptic('tick', settings.quietMode);
        setPledgePop(false);
      }
      return next;
    });
  };

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
  const todaySpend = sum(
    b.txs.filter(t => t.offset === cycle.dayIdx && categoryByName(t.cat) && !t.isIncome && !t.isTransfer).map(t => t.net),
  );
  const yesterdaySpend =
    cycle.dayIdx > 0
      ? sum(b.txs.filter(t => t.offset === cycle.dayIdx - 1 && categoryByName(t.cat) && !t.isIncome && !t.isTransfer).map(t => t.net))
      : null;
  const yesterdayPledged = cycle.dayIdx > 0 && storage.get<boolean>(`moneyTracker.zeroPledge.${toISO(addDays(cycle.today, -1))}`, false);
  const keptYesterday = yesterdayPledged && yesterdaySpend === 0;
  const recentSavings = b.txs.some(t => t.isSavings && t.offset >= Math.max(0, cycle.dayIdx - 1));
  const streak = smoothStreakDays(cycle, b);
  const sceneInfo = resolveVignetteScene({ cycle, budget: b, target, streak, todaySpend });

  const insight = paceInsight({
    budget: b.budget,
    projTotal: b.projTotal,
    oneOffs: b.proj.oneOffs,
    remainingVar: b.proj.remainingVar,
    daysLeft: cycle.daysLeft,
    dayN: cycle.dayN,
    cycleDays: cycle.cycleDays,
    cats: b.cats,
  });

  let mood: MaxieMood = 'happy';
  let line = '';
  let quickAsk: string | undefined;
  if (cycle.dayN === 1) {
    mood = 'happy';
    line = id
      ? `Selamat gajian${name ? `, ${name}` : ''}. Siklus baru, lembaran bersih — semoga bulan ini terasa ringan.`
      : `Happy payday${name ? `, ${name}` : ''}. Fresh cycle, clean slate — wishing you a steady month ahead.`;
  } else if (left < 0) {
    mood = 'steady';
    line = id
      ? `${salutation} Siklus ini sedikit di atas rencana sebesar ${short(-left)} — tidak perlu buru-buru, kita atur pelan-pelan ya.`
      : `${salutation} Slightly above plan by ${short(-left)} — no rush, we can ease it back one day at a time.`;
    quickAsk = id ? 'Kenapa siklus ini di atas rencana dan gimana cara aturnya?' : 'Why am I above plan and how do I ease back?';
  } else if (cycle.daysLeft <= 3 && left >= 0) {
    mood = 'happy';
    line = id
      ? `${salutation} Tinggal ${cycle.daysLeft + 1} hari menuju gajian dengan sisa ${short(left)} — penutup yang tenang dan rapi.`
      : `${salutation} Just ${cycle.daysLeft + 1} days to payday with ${short(left)} to spare — a calm, steady finish.`;
  } else if (insight.tier === 'over' && insight.oneOffExplains) {
    mood = 'happy';
    line = id
      ? `${salutation} Ritme harianmu tetap tenang — proyeksi agak tinggi hanya karena transaksi besar ${short(b.proj.oneOffs)} sekali jalan.`
      : `${salutation} Your everyday pace is steady — the projection only edges over because of ${short(b.proj.oneOffs)} in one-offs.`;
  } else if (insight.tier === 'over' && insight.trimPerDay > 0) {
    mood = 'steady';
    const driverNoteId = insight.topDriver ? ` (terutama ${insight.topDriver.name})` : '';
    const driverNoteEn = insight.topDriver ? ` (mostly ${insight.topDriver.name})` : '';
    line = id
      ? `${salutation} Proyeksi sedikit di atas rencana — kurangi sekitar ${short(insight.trimPerDay)}/hari${driverNoteId} supaya finis tetap aman.`
      : `${salutation} Heading a touch above plan — easing back ~${short(insight.trimPerDay)}/day${driverNoteEn} brings you right back on track.`;
    quickAsk = id ? 'Gimana cara ngerem pengeluaran dengan santai sampai gajian?' : 'How can I gently ease back spending until payday?';
  } else if (SAVINGS_TARGET_PCT > 0 && b.savedPct >= SAVINGS_TARGET_PCT && (cycle.dayN <= 4 || recentSavings)) {
    mood = 'happy';
    line = id
      ? `${salutation} Target tabungan ${SAVINGS_TARGET_PCT}% siklus ini sudah tercapai — langkah yang mantap.`
      : `${salutation} Savings goal reached — ${Math.round(b.savedPct)}% already set aside this cycle.`;
  } else if (streak >= 4) {
    mood = 'happy';
    line = id
      ? `${salutation} ${streak} hari berturut-turut berjalan mulus — ruang lega masih ${short(b.safeDay)} per hari.`
      : `${salutation} ${streak} calm days in a row — steady room ahead at ${short(b.safeDay)} a day.`;
  } else if (yesterdaySpend === 0 && cycle.dayN >= 2) {
    mood = 'happy';
    line = id
      ? `${salutation} Kemarin nol pengeluaran — ritme yang tenang untuk dibawa ke hari ini.`
      : `${salutation} Zero spend yesterday — quiet momentum to carry into today.`;
  } else if (insight.tier === 'calm' && b.budget > 0 && insight.spareBy >= b.budget * 0.08 && cycle.dayN >= 4) {
    mood = 'happy';
    line = id
      ? `${salutation} Ritmemu terasa tenang — proyeksi masih punya ruang lega ${short(insight.spareBy)} sampai gajian.`
      : `${salutation} Nicely paced — on track to finish with ${short(insight.spareBy)} to spare by payday.`;
  } else {
    mood = 'happy';
    line = id
      ? `${salutation} Semua masih lega di ${short(b.safeDay)} per hari sampai gajian nanti — semoga harimu tenang.`
      : `${salutation} Looking steady at ${short(b.safeDay)} a day until payday — hope today feels light.`;
  }

  const cheer =
    pledged && todaySpend === 0
      ? id
        ? 'Mode nol pengeluaran aktif.'
        : 'Zero-spend day active.'
      : left < 0
        ? id
          ? 'Pelan-pelan kita rapikan bersama.'
          : 'Easy to ease back together.'
        : streak >= 3
          ? id
            ? `${streak} hari berjalan mulus.`
            : `${streak} calm days in a row.`
          : id
            ? `Masih ada ${short(left)} ruang lega.`
            : `${short(left)} of breathing room.`;

  const hasActions = todaySpend === 0 || !!quickAsk || keptYesterday || b.txs.length > 0;

  return (
    <section className={s.vigCard} data-wide data-scene={sceneInfo.scene} aria-label={`Maxie: ${sceneInfo.label}`}>
      {settings.quietMode ? (
        <Logo size={36} mood={mood} interactive followCursor cheer={cheer} />
      ) : (
        <button
          type="button"
          className={s.vigArtBtn}
          onClick={onOpenStory}
          title={`${sceneInfo.label} — open Cycle story`}
          aria-label={`Open Cycle story (${sceneInfo.label})`}
        >
          <VignetteSvg scene={sceneInfo.scene} />
        </button>
      )}
      <div className={s.vigBody}>
        {!settings.quietMode && <span className={s.vigTag}>{sceneInfo.label}</span>}
        <p className={s.mxGreetingText}>{line}</p>
        {hasActions && (
          <div className={s.vigMetaRow}>
            {b.txs.length > 0 && (
              <button type="button" className={s.vigStoryBtn} onClick={onOpenStory}>
                <Icon d={IC.sparkle} size={13} />
                Cycle story
              </button>
            )}
            {todaySpend === 0 && (
              <button
                type="button"
                className={s.mxPledgeBtn}
                data-active={pledged || undefined}
                data-pop={pledgePop || undefined}
                aria-pressed={pledged}
                onClick={togglePledge}
              >
                {pledged ? <Icon d={IC.check} size={12} strokeWidth={2.4} /> : <TargetIcon size={13} />}
                {pledged
                  ? id
                    ? 'Hari nol pengeluaran aktif'
                    : 'Zero-spend day active'
                  : id
                    ? 'Target nol pengeluaran'
                    : 'Zero-spend day'}
              </button>
            )}
            {keptYesterday && (
              <span className={s.pledgeKeptBadge}>
                <Icon d={IC.check} size={11} strokeWidth={2.5} />
                {id ? 'Target kemarin tercapai' : 'Pledge kept yesterday'}
              </span>
            )}
            {quickAsk && (
              <button type="button" className={s.sxAttnPill} onClick={() => onAskMaxie(quickAsk)}>
                <Icon d={IC.sparkle} size={12} /> {id ? 'Tanya Maxie' : 'Ask Maxie'}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

// ---- worth a gentle look: over/near limit categories & inbox items ----

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
    <section className={s.sxAttnCard} data-wide aria-label="Worth a gentle look">
      <div className={s.sxAttnHead}>
        <span className={s.sxAttnTitle}>
          <Icon d={IC.alert} size={15} color={alerts.some(c => c.status.key === 'over') ? C.redInk : C.amberInk} />
          Worth a gentle look
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
function ChartCard({ id, title, right, sub, children, wide, hero }: { id?: string; title: string; right?: ReactNode; sub?: ReactNode; children: ReactNode; wide?: boolean; hero?: boolean }) {
  return (
    <section id={id} className={s.sxChartCard} data-wide={wide || undefined} data-hero={hero || undefined} aria-label={title}>
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
  const { settings, short, full } = useSettings();
  const idr = settings.currency === 'IDR';
  const [hover, setHover] = useState<number | null>(null);
  const [showTip, setShowTip] = useState(false);
  const left = b.budget - b.spent - b.fixedDue;
  const shownLeft = useCountUp(Math.abs(left), 700, 'summary.left');
  const tone = paceTone(b.spent, b.budget, b.paceToday);
  const tomorrowSafe = cycle.daysLeft > 0 && left > 0 ? left / cycle.daysLeft : 0;
  const wkSplit = weekendSafeSplit(left, cycle.daysLeft + 1, cycle.today.getDay(), b.proj.weekendRatio);
  const hasDayTip = tomorrowSafe > b.safeDay + 1 || wkSplit != null;
  const days = cycle.cycleDays;
  const today = Math.min(cycle.dayIdx, days - 1);
  const perDay = new Array<number>(days).fill(0);
  for (const t of b.txs) if (t.offset >= 0 && t.offset < days && categoryByName(t.cat)) perDay[t.offset] += t.net;
  const cum: number[] = [];
  perDay.reduce((acc, v, i) => (cum[i] = acc + v), 0);
  const end = Math.max(b.projTotal, cum[today]);
  const endLow = Math.max(cum[today], cum[today] + (b.proj.bandLow[days - 1] ?? 0));
  const endHigh = Math.max(end, cum[today] + (b.proj.bandHigh[days - 1] ?? 0));
  const top = Math.max(b.budget, endHigh, 1) * 1.08;
  const x = (i: number) => (days > 1 ? (i / (days - 1)) * CW : 0);
  const y = (v: number) => CH - (v / top) * CH;
  const actual = cum.slice(0, today + 1).map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const area = `${actual} L${x(today).toFixed(1)} ${CH} L0 ${CH} Z`;

  // 3-tier calm tone: neutral (<= plan), warm amber (within 5% over), soft red (>5% over).
  const insight = paceInsight({
    budget: b.budget,
    projTotal: end,
    oneOffs: b.proj.oneOffs,
    remainingVar: b.proj.remainingVar,
    daysLeft: cycle.daysLeft,
    dayN: cycle.dayN,
    cycleDays: days,
    cats: b.cats,
  });
  const projStroke = insight.tier === 'over' ? 'var(--danger)' : insight.tier === 'near' ? 'var(--amber)' : 'var(--clay-ink)';
  const projInk = insight.tier === 'over' ? C.redInk : insight.tier === 'near' ? C.amberInk : C.textMuted;
  const bandFill = insight.tier === 'over' ? 'var(--danger)' : insight.tier === 'near' ? 'var(--amber)' : 'var(--clay)';

  const shownPast = hover != null && hover >= 0 && hover <= today ? hover : null;
  const shownFuture = hover != null && hover > today && hover < days ? hover : null;
  const activeDay = shownPast ?? shownFuture;
  const projAt = (i: number) => cum[today] + (b.proj.add[i] ?? 0);
  // Projected path: everyday spend follows your rhythm; bills step up on the day they're due.
  let projPath = `M${x(today).toFixed(1)} ${y(cum[today]).toFixed(1)}`;
  const hiPts: string[] = [`${x(today).toFixed(1)} ${y(cum[today]).toFixed(1)}`];
  const loPts: string[] = [`${x(today).toFixed(1)} ${y(cum[today]).toFixed(1)}`];
  for (let i = today + 1; i < days; i++) {
    const bill = b.proj.billOn[i] ?? 0;
    if (bill > 0) projPath += ` L${x(i).toFixed(1)} ${y(projAt(i) - bill).toFixed(1)}`;
    projPath += ` L${x(i).toFixed(1)} ${y(projAt(i)).toFixed(1)}`;
    hiPts.push(`${x(i).toFixed(1)} ${y(cum[today] + (b.proj.bandHigh[i] ?? 0)).toFixed(1)}`);
    loPts.push(`${x(i).toFixed(1)} ${y(cum[today] + (b.proj.bandLow[i] ?? 0)).toFixed(1)}`);
  }
  const showBand = today < days - 1 && b.proj.bandHalf >= (idr ? 25_000 : 3);
  const bandPath = showBand ? `M${hiPts.join(' L')} L${loPts.reverse().join(' L')} Z` : '';
  const showRange = b.proj.confidence < 0.7 && b.proj.bandHalf >= (idr ? 50_000 : 5) && short(endLow) !== short(endHigh);

  const billsOnDay = (i: number) =>
    b.bills.filter(bl => billLandingDay(cycle.offsetOf(bl.date), today, days) === i).map(bl => bl.title);
  const projNote = [
    b.proj.basis === 'history'
      ? b.proj.historyCycles > 1
        ? `Follows your last ${b.proj.historyCycles} cycles' spending rhythm`
        : "Follows last cycle's spending rhythm"
      : b.proj.basis === 'plan'
        ? 'Blends your pace with your plan'
        : 'Based on your pace so far',
    b.proj.oneOffCount > 0 ? `${b.proj.oneOffCount} big one-off${b.proj.oneOffCount === 1 ? '' : 's'} counted once` : '',
    b.bills.length > 0 ? 'bills on their due dates' : '',
  ]
    .filter(Boolean)
    .join(' · ');

  // One-line calm wise-spending guidance.
  const minSpare = Math.max(b.budget * 0.05, idr ? 100_000 : 10);
  const guidance: { tone?: 'good' | 'near' | 'over'; node: ReactNode } | null = (() => {
    if (b.budget <= 0 || cycle.daysLeft <= 0) return null;
    if (insight.oneOffExplains) {
      return {
        node: (
          <>
            Everyday pace is steady — <strong>{short(b.proj.oneOffs)}</strong> in one-offs accounts for the overage.
          </>
        ),
      };
    }
    if (insight.overBy > 0 && insight.trimPerDay > 0) {
      return {
        tone: insight.tier === 'over' ? 'over' : 'near',
        node: (
          <>
            Ease back <strong>~{short(insight.trimPerDay)}/day</strong>
            {insight.topDriver ? <> (mostly {insight.topDriver.name})</> : null}
            {insight.zeroDaysToFix > 0 && insight.zeroDaysToFix <= 5 ? (
              <>
                {' — or '}
                <strong>
                  {insight.zeroDaysToFix} zero-spend {insight.zeroDaysToFix === 1 ? 'day' : 'days'}
                </strong>
              </>
            ) : null}
            {' — to finish on plan.'}
          </>
        ),
      };
    }
    if (insight.spareBy >= minSpare) {
      return {
        tone: 'good',
        node: (
          <>
            On track for <strong>{short(insight.spareBy)} spare</strong> — room to enjoy, or tuck into Savings on payday.
          </>
        ),
      };
    }
    if (insight.topDriver) {
      return {
        node: (
          <>
            Overall on pace — just keep a gentle eye on <strong>{insight.topDriver.name}</strong>.
          </>
        ),
      };
    }
    return null;
  })();

  const dotDay = activeDay ?? today;
  const dotVal = shownFuture != null ? projAt(shownFuture) : cum[dotDay];
  const lastSameDays = sum(b.cats.map(c => c.lastSameDays));
  const vsLast = lastSameDays > 0 && b.spent > 0 ? changeBadge(b.spent, lastSameDays) : null;
  const pick = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    setHover(Math.round(frac * (days - 1)));
  };
  return (
    <ChartCard hero title="This cycle" right={`${cycle.daysLeft + 1} ${cycle.daysLeft === 0 ? 'day' : 'days'} to payday`}>
      <div className={s.sxLeftHead}>
        <span className={s.sxLeftBig} style={{ color: left < 0 ? C.redInk : C.text }}>
          {short(shownLeft)}
        </span>
        <span className={s.sxLeftLabel}>{left < 0 ? 'above plan' : 'left'}</span>
        {hasDayTip ? (
          <button
            type="button"
            className={s.sxLeftDayBtn}
            aria-expanded={showTip}
            onClick={() => setShowTip(v => !v)}
            title="See daily allowance tips"
          >
            <strong style={{ color: tone.ink }}>{short(b.safeDay)}</strong> a day
          </button>
        ) : (
          <span className={s.sxLeftDay}>
            <strong style={{ color: tone.ink }}>{short(b.safeDay)}</strong> a day
          </span>
        )}
      </div>
      {showTip && hasDayTip && (
        <span className={s.sxPaceBonus}>
          {wkSplit && (
            <>
              Weekdays: <strong>{short(wkSplit.weekdaySafe)}/day</strong> · Weekends: <strong>{short(wkSplit.weekendSafe)}/day</strong> ({wkSplit.weekendsLeft} weekend {wkSplit.weekendsLeft === 1 ? 'day' : 'days'} left).
              {tomorrowSafe > b.safeDay + 1 ? ' ' : ''}
            </>
          )}
          {tomorrowSafe > b.safeDay + 1 && (
            <>
              Zero spend today bumps tomorrow up to <strong>{short(tomorrowSafe)}/day</strong> (+{short(tomorrowSafe - b.safeDay)}).
            </>
          )}
        </span>
      )}
      <div className={s.sxLine} data-own-gestures onPointerMove={pick} onPointerDown={pick} onPointerLeave={() => setHover(null)} onPointerCancel={() => setHover(null)}>
        <svg viewBox={`0 0 ${CW} ${CH}`} preserveAspectRatio="none" role="img" aria-label={`Spent ${full(cum[today])} so far; heading for ${full(end)} by payday, plan ${full(b.budget)}`}>
          <defs>
            <linearGradient id="sxCycleFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--clay)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--clay)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill="url(#sxCycleFill)" />
          {b.budget > 0 && (
            <line
              x1={0}
              x2={CW}
              y1={y(b.budget)}
              y2={y(b.budget)}
              stroke="var(--line-strong)"
              strokeWidth={1}
              strokeDasharray="3 4"
              opacity={0.6}
              vectorEffect="non-scaling-stroke"
            />
          )}
          {b.budget > 0 && (
            <line
              x1={0}
              y1={y(Math.min(b.fixedSpent, b.budget))}
              x2={CW}
              y2={y(b.budget)}
              stroke="var(--line-strong)"
              strokeWidth={1}
              strokeDasharray="2 4"
              opacity={0.45}
              vectorEffect="non-scaling-stroke"
            />
          )}
          {showBand && <path d={bandPath} fill={bandFill} opacity={0.11} />}
          {today < days - 1 && (
            <path
              d={projPath}
              fill="none"
              stroke={projStroke}
              strokeWidth={1.8}
              strokeDasharray="5 4"
              strokeLinejoin="round"
              opacity={insight.tier === 'calm' ? 0.65 : 0.85}
              vectorEffect="non-scaling-stroke"
            />
          )}
          <path d={actual} fill="none" stroke="var(--clay)" strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {activeDay != null && <line x1={x(activeDay)} x2={x(activeDay)} y1={0} y2={CH} stroke="var(--line-strong)" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
        </svg>
        <span
          className={s.sxLineDot}
          data-future={shownFuture != null || undefined}
          data-near={shownFuture != null && insight.tier === 'near' ? true : undefined}
          data-over={shownFuture != null && insight.tier === 'over' ? true : undefined}
          style={{ left: `${(x(dotDay) / CW) * 100}%`, top: `${(y(dotVal) / CH) * 100}%` }}
        />
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
        {shownPast != null ? (
          <span>
            {dayMonth(cycle.dateOf(shownPast))} <strong style={{ color: C.text }}>{short(cum[shownPast])}</strong> spent
          </span>
        ) : shownFuture != null ? (
          (() => {
            const val = projAt(shownFuture);
            const rem = b.budget - val;
            const due = billsOnDay(shownFuture);
            return (
              <span>
                Projected {dayMonth(cycle.dateOf(shownFuture))}: <strong style={{ color: projInk }}>{short(val)}</strong>
                {b.budget > 0 && (
                  <>
                    {' · '}
                    <strong style={{ color: rem >= 0 ? C.good : rem >= -b.budget * 0.05 ? C.amberInk : C.redInk }}>
                      {rem >= 0 ? `${short(rem)} left` : `${short(-rem)} over`}
                    </strong>
                  </>
                )}
                {due.length > 0 && <> · incl. {due.join(', ')}</>}
              </span>
            );
          })()
        ) : (
          <span className={s.sxLineFootRow}>
            <span title={projNote}>
              Spent <strong style={{ color: C.text }}>{short(b.spent)}</strong>
              {' · Heading for '}
              <strong style={{ color: projInk }}>{showRange ? `~${short(endLow)}–${short(endHigh)}` : short(end)}</strong>
            </span>
            {vsLast && (
              <span className={s.sxDeltaBadge} style={{ background: vsLast.bg, color: vsLast.ink }} title="Compared to the same point last cycle">
                {vsLast.label} vs last
              </span>
            )}
          </span>
        )}
      </div>
      {guidance && (
        <div className={s.sxPaceInsight} data-tone={guidance.tone}>
          {guidance.node}
        </div>
      )}
    </ChartCard>
  );
}

/** Three interactive StatTiles (Maxie): Saved (with Rp progress), Bills to come (scrolls to bills), and Card bill (expandable per-card view). */
function Tiles({ budget: b, onSavings, onBills }: { budget: Budget; onSavings: () => void; onBills: () => void }) {
  const { short, full, ofIncome, settings } = useSettings();
  const [cardsOpen, setCardsOpen] = useState(false);
  const bills = b.bills;
  const billTotal = sum(bills.map(x => x.amount));
  const nextBill = [...bills].sort((a, z) => a.date.getTime() - z.date.getTime())[0];
  const owed = sum(b.cards.map(c => Math.max(0, c.owed)));
  const cardInstallments = sum(b.cards.map(c => c.installments));
  const target = ofIncome(SAVINGS_TARGET_PCT);
  const savedShare = SAVINGS_TARGET_PCT > 0 ? Math.min(1, b.savedPct / SAVINGS_TARGET_PCT) : 0;
  const savedNote =
    target > 0
      ? savedShare >= 1
        ? `Goal reached · ${short(b.saved)} set aside`
        : `${short(b.saved)} of ${short(target)} goal`
      : b.saved > 0
        ? `${short(b.saved)} set aside`
        : 'No savings goal set';
  const activeCards = b.cards.filter(c => c.owed > 0 || c.spent > 0 || c.lastBill > 0);
  const billsNote =
    bills.length === 0
      ? 'All clear until payday'
      : bills.length === 1 && nextBill
        ? `${tidyName(nextBill.title)} · ${dayMonth(nextBill.date)}`
        : nextBill
          ? `${bills.length} scheduled · next ${dayMonth(nextBill.date)}`
          : `${bills.length} scheduled before payday`;
  const cardsNote =
    owed <= 0
      ? 'All settled'
      : cardInstallments > 0
        ? `Includes ${short(cardInstallments)} in installments`
        : activeCards.length > 1
          ? `Across ${activeCards.length} cards this cycle`
          : activeCards[0]
            ? `On ${activeCards[0].account} this cycle`
            : 'On your cards this cycle';

  return (
    <div className={s.sxTilesWrap}>
      <div className={s.sxTiles}>
        <button
          type="button"
          className={s.sxTile}
          data-tone="saved"
          onClick={() => {
            haptic('tick', settings.quietMode);
            onSavings();
          }}
        >
          <span className={s.sxTileLabel}>
            <span className={s.sxTileIcon} data-tone="saved" aria-hidden="true">
              <Icon d={IC.piggy} size={14} />
            </span>
            Saved
          </span>
          <span className={s.sxTileValue}>{Math.round(b.savedPct)}%</span>
          <span className={s.sxTileMeter}>
            <span style={{ width: savedShare * 100 + '%', background: savedShare >= 1 ? C.good : 'var(--clay)' }} />
          </span>
          <span className={s.sxTileNote}>{savedNote}</span>
        </button>
        <button
          type="button"
          className={s.sxTile}
          data-tone="bills"
          onClick={() => {
            haptic('tick', settings.quietMode);
            onBills();
          }}
        >
          <span className={s.sxTileLabel}>
            <span className={s.sxTileIcon} data-tone="bills" aria-hidden="true">
              <Icon d={IC.calendar} size={14} />
            </span>
            Bills to come
          </span>
          <span className={s.sxTileValue}>{short(billTotal)}</span>
          <span className={s.sxTileNote}>{billsNote}</span>
        </button>
        <button
          type="button"
          className={s.sxTile}
          data-tone="cards"
          aria-expanded={activeCards.length > 0 ? cardsOpen : undefined}
          disabled={activeCards.length === 0}
          onClick={() => {
            if (activeCards.length > 0) {
              haptic('tick', settings.quietMode);
              setCardsOpen(o => !o);
            }
          }}
        >
          <span className={s.sxTileLabel}>
            <span className={s.sxTileIcon} data-tone="cards" aria-hidden="true">
              <Icon d={IC.card} size={14} />
            </span>
            Card bill
            {activeCards.length > 0 && <Icon d={IC.chevDown} size={13} style={{ marginLeft: 'auto', transform: cardsOpen ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />}
          </span>
          <span className={s.sxTileValue}>{short(owed)}</span>
          <span className={s.sxTileNote}>{cardsNote}</span>
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
  const { short, full, settings } = useSettings();
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
  // Leave generous headroom above the tallest bar so top value labels never clump into the subtitle.
  const maxBar = Math.max(...sofar, 0);
  const top = Math.max(avg * 1.6, maxBar * 1.22, 1);
  // Label only the three biggest days (two on phones, spaced apart so labels don't collide) and today.
  const labelled = new Set<number>();
  if (sofar[cycle.dayIdx] > 0) labelled.add(cycle.dayIdx);
  const peaks = sofar
    .map((v, i) => ({ v, i }))
    .filter(x => x.v > 0)
    .sort((x, y) => y.v - x.v);
  const maxPeaks = phone ? 2 : 3;
  let added = 0;
  for (const p of peaks) {
    if (added >= maxPeaks) break;
    if (labelled.has(p.i)) {
      added++;
      continue;
    }
    if (phone && [...labelled].some(idx => Math.abs(idx - p.i) <= 2)) continue;
    labelled.add(p.i);
    added++;
  }
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
          <strong style={{ color: C.text }}>{(phone ? short : full)(total)}</strong> in {cycle.dayN} {cycle.dayN === 1 ? 'day' : 'days'}
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
      <div className={s.sxDayBars} style={{ height: phone ? 160 : 190 }} onMouseLeave={() => setHover(null)} role="img" aria-label={`Spending by day, ${full(total)} in ${cycle.dayN} days, average ${full(avg)} a day`}>
        {avg > 0 && (
          <span className={s.sxPlanLineMark} style={{ bottom: (avg / top) * 100 + '%' }} aria-hidden="true">
            <span className={s.sxAvgLabel}>Avg {short(avg)}</span>
          </span>
        )}
        {shown != null && !(phone && picked === shown) && (
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
              onMouseEnter={() => !phone && setHover(i)}
              onFocus={() => !phone && setHover(i)}
              onBlur={() => setHover(null)}
              onClick={() => {
                haptic('tick', settings.quietMode);
                setPicked(p => (p === i ? null : i));
              }}
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
                {labelled.has(i) && (
                  <span
                    className={s.sxBarTop}
                    data-align={
                      i <= 1 || (i > 0 && sofar[i - 1] > v * 1.35)
                        ? 'left'
                        : i >= days - 2 || (i + 1 < sofar.length && sofar[i + 1] > v * 1.35)
                          ? 'right'
                          : undefined
                    }
                  >
                    {short(v)}
                  </span>
                )}
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
          <Logo size={28} mood="curious" interactive cheer="Fresh cycle!" />
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
                        {c.w >= 135 ? `${short(c.value)} (${pct(c.value)})` : pct(c.value)}
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
          <Logo size={28} mood="happy" interactive cheer="Quiet and steady!" />
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
        <Logo size={28} mood="happy" interactive cheer="Almost payday!" /> Maxie noticed
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
