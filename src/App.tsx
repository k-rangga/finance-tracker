import { useCallback, useEffect, useMemo, useState } from 'react';
import s from './styles/ui.module.css';
import { IC, Icon } from './components/Icon';
import { Toast } from './components/ui';
import { Logo } from './components/Logo';
import { SettingsDialog } from './components/SettingsDialog';
import { CategoryDialog } from './components/CategoryDialog';
import { GmailDialog, syncedAgo } from './components/GmailDialog';
import { KEYS, storage } from './lib/storage';
import { getCycle, paydayRule } from './lib/cycle';
import { computeBudget, txViews } from './lib/budget';
import { addDays, dayLabel, dayMonth, ordinal, startOfToday, tidyName, toISO } from './lib/format';
import { useSettings } from './lib/settings';
import { useData } from './lib/data';
import { billKey, merchantKey, expectedBills, inCycle, installmentPayments, resolveSubs, toTransaction, withMerchantRules, type Bill } from './data/transactions';
import { CATEGORIES, INSTALLMENT_CATEGORY, INSTALLMENTS_CATEGORY, SAVINGS_CATEGORY } from './data/categories';
import { InstallmentsAhead } from './screens/InstallmentsAhead';
import { PlansProvider, ScheduleModal } from './components/Plans';
import { detectInstallments, matchTracked, planBills, planViews, trackFound, withTrackedPlans } from './lib/installments';
import { cycleKey, matchCosts, nextCycleOf, plannedCostBills } from './lib/cyclePlans';
import { fixedBillCategoryLimits, fixedBillDueItems, matchFixedBills } from './lib/fixedBills';
import { Summary } from './screens/Summary';
import { Categories } from './screens/Categories';
import { Activity, type ActivityFilter } from './screens/Activity';
import { SavingsPlan } from './screens/SavingsPlan';
import { Subscriptions } from './screens/Subscriptions';
import { chargesBySub, subscriptionBills, subState, suggestSubscriptions } from './lib/subscriptions';
import { Invest } from './screens/invest/Invest';
import { Chat } from './components/Chat';
import { useIsPhone } from './lib/media';
import { PULL_TO_SYNC, usePageGestures } from './lib/gestures';
import { syncNow } from './lib/gmail';
import { buildBootHint, writeBootHint } from './lib/bootHint';

export type Tab = 'summary' | 'categories' | 'tx' | 'plan' | 'invest';

const TABS: { key: Tab; label: string; short: string; icon: string }[] = [
  { key: 'summary', label: 'Summary', short: 'Summary', icon: IC.summary },
  { key: 'categories', label: 'Categories', short: 'Categories', icon: IC.categories },
  { key: 'tx', label: 'Transactions', short: 'Transactions', icon: IC.list },
  { key: 'plan', label: 'Savings plan', short: 'Plan', icon: IC.piggy },
  { key: 'invest', label: 'Investment journal', short: 'Invest', icon: IC.trend },
];

export default function App() {
  const [collapsed, setCollapsed] = useState(() => storage.getRaw(KEYS.nav) === 'mini');
  const [tab, setTabState] = useState<Tab>(() => {
    const t = storage.getRaw(KEYS.tab) as Tab | null;
    return t && TABS.some(x => x.key === t) ? t : 'summary';
  });
  const { recat: fixed, links, shares, removed, installments, rules, ruleSubs, subs: picked, setOverride, setLink, setShare, setRemoved, saveError, dismissError, txRows, gmail, email, refreshImports, subscriptions, notes } = useData();
  // Transactions remembers your last dates, category and search on this device.
  const [txFilter, setTxFilterState] = useState<ActivityFilter>(() => storage.get<ActivityFilter>(KEYS.txFilter, { range: 'week', cat: '', q: '' }));
  const setTxFilter = useCallback((f: ActivityFilter) => {
    storage.set(KEYS.txFilter, f);
    setTxFilterState(f);
  }, []);
  const [openCat, setOpenCat] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Create (no name) or edit one of your categories; opened from Settings or a Categories row. */
  const [catDialog, setCatDialog] = useState<{ editing?: string } | null>(null);
  // Back from Google's consent screen (Vercel): open Gmail sync with what happened.
  const [googleNotice] = useState(() => new URLSearchParams(location.search).get('google') ?? undefined);
  const [gmailOpen, setGmailOpen] = useState(!!googleNotice);
  useEffect(() => {
    if (googleNotice) history.replaceState(null, '', location.pathname);
  }, [googleNotice]);
  /** Ask Maxie panel (Google Gemini underneath); `ask` is a question to send as it opens. */
  const [chat, setChat] = useState<{ ask?: string } | null>(null);
  const { settings, update } = useSettings();

  const today = useMemo(startOfToday, []);
  // Recomputed when you change your payday in Settings.
  const cycle = useMemo(() => getCycle(today), [today, settings.payday?.day, settings.payday?.weekend]);
  const prevCycle = useMemo(() => getCycle(addDays(cycle.start, -1)), [cycle]);
  const imported = useMemo(() => txRows.map(r => toTransaction(r, settings.currency, settings.fxRate)), [txRows, settings.currency, settings.fxRate]);
  const removedIds = useMemo(() => new Set(removed), [removed]);
  /** Your fixes by hand, plus your merchant rules for every other transaction of those merchants. */
  // Categories are in the deps: a rule naming a category you just made starts to apply.
  const fixedAndRules = useMemo(() => withMerchantRules(imported, fixed, rules), [imported, fixed, rules, settings.customCategories]);
  const keptRaw = useMemo(() => imported.filter(t => !removedIds.has(t.id)), [imported, removedIds]);
  /** Installments the bank bills monthly that you confirmed: their charges become payments of the plan. */
  const tracked = useMemo(() => settings.trackedInstallments ?? [], [settings.trackedInstallments]);
  const matched = useMemo(() => matchTracked(keptRaw, tracked), [keptRaw, tracked]);
  const kept = useMemo(() => withTrackedPlans(keptRaw, tracked, matched), [keptRaw, tracked, matched]);
  /** Installment purchases become monthly payments, each on its due date, in the purchase's category. */
  const payments = useMemo(() => installmentPayments(kept, installments, t => fixedAndRules[t.id] ?? t.category), [kept, installments, fixedAndRules]);
  /** What every screen counts: imported transactions you kept, plus installment payments. */
  const all = useMemo(() => [...kept, ...payments], [kept, payments]);
  /** Categories as every screen sees them; an installment purchase itself is marked Installment (not spending). */
  const recat = useMemo(() => {
    const out = { ...fixedAndRules };
    for (const id of Object.keys(installments)) out[id] = INSTALLMENT_CATEGORY;
    return out;
  }, [fixedAndRules, installments]);
  /** Every installment plan's payments: the one schedule Fixed bills, Next cycle, transactions and card bills read. */
  const plans = useMemo(() => planViews(payments, keptRaw, tracked, matched, today, t => recat[t.id] ?? t.category), [payments, keptRaw, tracked, matched, today, recat]);
  /** Sub-categories: yours, else your rules', else a guess from the merchant name. */
  const subs = useMemo(() => resolveSubs(all, t => recat[t.id] ?? t.category, picked, ruleSubs, settings.subcategories), [all, recat, picked, ruleSubs, settings.subcategories]);
  const transactions = useMemo(() => inCycle(all, cycle), [all, cycle]);
  const prevTransactions = useMemo(() => all.filter(t => t.date >= prevCycle.start && t.date < cycle.start), [all, prevCycle, cycle]);
  /** Each subscription's charges and where it stands: next billing date, missed, new price. */
  const subCharges = useMemo(() => chargesBySub(subscriptions, all), [subscriptions, all]);
  const subStates = useMemo(() => Object.fromEntries(Object.entries(subscriptions).map(([id, x]) => [id, subState(x, subCharges.get(id) ?? [], today)])), [subscriptions, subCharges, today]);
  const catOf = useCallback((t: { id: string; category: string }) => recat[t.id] ?? t.category, [recat]);
  /** Names printed on the user's own bank accounts, for auto-recognizing transfers to self. */
  const ownNames = useMemo(
    () =>
      [settings.name, ...(settings.ownAccountNames ?? '').split(/[,;\n]+/)]
        .map(x => x.trim())
        .filter(Boolean),
    [settings.name, settings.ownAccountNames],
  );
  /** This cycle's transaction views (before budget), used to verify individual fixed bills cleanly. */
  const cycleTxViews = useMemo(
    () => txViews(transactions, [...transactions, ...prevTransactions], { recat, links, shares, cycle, subs, ownNames }).txs,
    [transactions, prevTransactions, recat, links, shares, cycle, subs, ownNames],
  );
  /** Verification status of each individual fixed bill against actual transactions in this cycle. */
  const fixedBillStatuses = useMemo(
    () => matchFixedBills(settings.fixedBills ?? [], cycleTxViews, cycle, settings.fixedBillCycles?.[toISO(cycle.start)]),
    [settings.fixedBills, settings.fixedBillCycles, cycleTxViews, cycle],
  );
  const bills = useMemo(() => {
    const cycleId = toISO(cycle.start);
    // A subscription's billing dates replace the guess from last cycle's charge of the same merchant.
    const subKeys = Object.values(subscriptions).map(x => merchantKey(x.merchant)).filter(Boolean);
    const isSub = (title: string) => subKeys.some(k => ` ${merchantKey(title)} `.includes(` ${k} `));
    const subCat = (id: string) => {
      const last = subCharges.get(id)?.[0];
      return last ? catOf(last) : 'Subscriptions';
    };
    // Categories already tracked via individual fixed bills (or manually ticked off in legacy paidBills) don't also guess from last cycle.
    const managedCats = new Set((settings.fixedBills ?? []).filter(b => !b.paused).map(b => b.category));
    const paidCats = new Set((settings.paidBills ?? []).filter(k => k.startsWith(cycleId + '|')).map(k => k.slice(cycleId.length + 1)));
    // One-off costs planned for this cycle, until a matching payment comes in.
    const costs = settings.cyclePlans?.[cycleKey(cycle)]?.costs ?? [];
    const spending = transactions.filter(t => t.type === 'expense').map(t => ({ id: t.id, date: t.date, amount: t.amount, cat: recat[t.id] ?? t.category }));
    return [
      ...expectedBills(prevTransactions, prevCycle, transactions, cycle, recat).filter(
        b => !isSub(b.title) && !managedCats.has(b.category) && !paidCats.has(b.category),
      ),
      ...fixedBillDueItems(fixedBillStatuses, cycle),
      ...planBills(plans, cycle),
      ...subscriptionBills(subscriptions, subStates, cycle, subCat),
      ...plannedCostBills(costs, cycle, matchCosts(costs, spending)),
    ]
      .filter(b => !settings.dismissedBills.includes(billKey(cycleId, b)))
      .sort((x, y) => x.date.getTime() - y.date.getTime());
    // Custom categories change which categories are fixed bills.
  }, [prevTransactions, prevCycle, transactions, cycle, recat, plans, settings.customCategories, settings.dismissedBills, settings.cyclePlans, settings.fixedBills, settings.paidBills, fixedBillStatuses, subscriptions, subStates, subCharges, catOf]);
  /** What the next cycle already holds: installment payments and subscription charges due in it. */
  const nextCycle = useMemo(() => nextCycleOf(cycle), [cycle]);
  const nextKnown = useMemo(() => {
    const subCat = (id: string) => {
      const last = subCharges.get(id)?.[0];
      return last ? catOf(last) : 'Subscriptions';
    };
    // Repeat charges this cycle that aren't in your subscriptions yet: they'd be missed next cycle.
    const notAdded = suggestSubscriptions(all, subscriptions, settings.notSubscriptions, catOf, today, t => notes[t.id]).filter(x => {
      const last = new Date(x.next + 'T00:00:00');
      return last >= nextCycle.start && last <= nextCycle.end;
    });
    return { installments: planBills(plans, nextCycle), subscriptions: subscriptionBills(subscriptions, subStates, nextCycle, subCat), notAdded };
  }, [plans, nextCycle, subscriptions, subStates, subCharges, catOf, all, settings.notSubscriptions, today, notes]);
  /** Charges that look like installments, for you to confirm (bills you set and subscriptions are left out). */
  const foundPlans = useMemo(
    () =>
      detectInstallments(keptRaw, {
        catOf: t => recat[t.id] ?? t.category,
        skipCats: [...CATEGORIES.filter(c => c.type === 'fixed' && c.name !== INSTALLMENTS_CATEGORY).map(c => c.name), INSTALLMENT_CATEGORY, SAVINGS_CATEGORY],
        subMerchants: Object.values(subscriptions).map(x => merchantKey(x.merchant)).filter(Boolean),
        tracked,
        notInstallments: settings.notInstallments ?? [],
        minAmount: settings.currency === 'USD' ? 20 : 100_000,
      }),
    [keptRaw, recat, subscriptions, tracked, settings.notInstallments, settings.currency],
  );
  /** The plan whose full schedule is open. */
  const [scheduleKey, setScheduleKey] = useState<string | null>(null);
  const plansCtx = useMemo(
    () => ({
      views: plans,
      today,
      found: foundPlans,
      confirm: (f: (typeof foundPlans)[number], payment: number, months: number) =>
        update({ trackedInstallments: [...(settings.trackedInstallments ?? []), trackFound(f, payment, months)] }),
      dismiss: (key: string) => update({ notInstallments: [...(settings.notInstallments ?? []), key] }),
      untrack: (key: string) => {
        const x = (settings.trackedInstallments ?? []).find(t => 'tracked:' + t.id === key);
        if (!x) return;
        update({
          trackedInstallments: (settings.trackedInstallments ?? []).filter(t => t !== x),
          notInstallments: [...(settings.notInstallments ?? []), `${x.account}|${x.merchant}`],
        });
      },
      openSchedule: setScheduleKey,
    }),
    [plans, today, foundPlans, settings.trackedInstallments, settings.notInstallments, update],
  );
  /** Plan tab: this cycle, or planning the next one (Summary's nudge opens it there). */
  const [planView, setPlanView] = useState<'this' | 'next'>('this');
  /** "Not a bill this cycle": hides a predicted bill until payday, with a few seconds to undo. */
  const [billUndo, setBillUndo] = useState<{ text: string; run: () => void } | null>(null);
  useEffect(() => {
    if (!billUndo) return;
    const t = setTimeout(() => setBillUndo(null), 5000);
    return () => clearTimeout(t);
  }, [billUndo]);
  const dismissBill = (b: Bill) => {
    const id = toISO(cycle.start);
    const label = tidyName(b.title.replace(/\s*\(overdue\)$/i, ''));
    if (b.billId) {
      const prevCycles = settings.fixedBillCycles ?? {};
      const cur = prevCycles[id] ?? {};
      const skipped = Array.from(new Set([...(cur.skipped ?? []), b.billId]));
      const paid = (cur.paid ?? []).filter(x => x !== b.billId);
      update({ fixedBillCycles: { ...prevCycles, [id]: { ...cur, skipped, paid } } });
      setBillUndo({ text: `${label} skipped for this cycle`, run: () => update({ fixedBillCycles: prevCycles }) });
      return;
    }
    if (b.costId) {
      const prevPlans = settings.cyclePlans ?? {};
      const key = cycleKey(cycle);
      const cur = prevPlans[key] ?? {};
      const costs = (cur.costs ?? []).filter(c => c.id !== b.costId);
      update({ cyclePlans: { ...prevPlans, [key]: { ...cur, costs } } });
      setBillUndo({ text: `${label} removed from upcoming bills`, run: () => update({ cyclePlans: prevPlans }) });
      return;
    }
    // Keys from earlier cycles no longer match anything.
    const before = settings.dismissedBills.filter(k => k.startsWith(id + '|'));
    update({ dismissedBills: [...before, billKey(id, b)] });
    setBillUndo({ text: `${label} removed for this cycle`, run: () => update({ dismissedBills: before }) });
  };
  const markBillPaid = (b: Bill) => {
    if (!b.billId) return;
    const id = toISO(cycle.start);
    const label = tidyName(b.title.replace(/\s*\(overdue\)$/i, ''));
    const prevCycles = settings.fixedBillCycles ?? {};
    const cur = prevCycles[id] ?? {};
    const paid = Array.from(new Set([...(cur.paid ?? []), b.billId]));
    const skipped = (cur.skipped ?? []).filter(x => x !== b.billId);
    update({ fixedBillCycles: { ...prevCycles, [id]: { ...cur, paid, skipped } } });
    setBillUndo({ text: `${label} marked paid — nice and tidy!`, run: () => update({ fixedBillCycles: prevCycles }) });
  };
  // Global ⌘K / Ctrl+K shortcut to summon Ask Maxie from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setChat(c => (c ? null : {}));
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  const budget = useMemo(
    () => {
      // Planned expenses you added for this cycle: money set aside in their category.
      const plannedCosts: Record<string, number> = {};
      for (const c of settings.cyclePlans?.[cycleKey(cycle)]?.costs ?? []) plannedCosts[c.category] = (plannedCosts[c.category] ?? 0) + c.amount;
      const fixedBillLimits = fixedBillCategoryLimits(fixedBillStatuses);
      return computeBudget({ transactions, prevTransactions, prevCycle, bills, recat, links, shares, subs, ownNames, cycle, income: settings.income, warnAt: settings.warnAt, plannedCosts, fixedBillLimits });
    },
    [transactions, prevTransactions, prevCycle, bills, fixedBillStatuses, recat, links, shares, subs, ownNames, cycle, settings.income, settings.warnAt, settings.cyclePlans, settings.savingsPct, settings.customCategories, settings.limitOverrides, settings.colorOverrides],
  );
  // Keep personalized calm loading reflections fresh locally so the next initial load greets with real context.
  useEffect(() => {
    writeBootHint(buildBootHint({ cycle, budget, settings, plans }));
  }, [cycle, budget, settings, plans]);
  /** Every synced transaction, for the Transactions screen's own date range. */
  const allTxs = useMemo(() => txViews(all, all, { recat, links, shares, cycle, subs, ownNames }).txs, [all, recat, links, shares, cycle, subs, ownNames]);
  const removedTxs = useMemo(
    () => txViews(imported.filter(t => removedIds.has(t.id)), imported, { recat, links, shares, cycle }).txs,
    [imported, removedIds, recat, links, shares, cycle],
  );
  const ready = !!gmail.label_name;

  // Phones: swipe sideways between tabs; pull down from the top to sync Gmail.
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const pullSync = async () => {
    if (!ready) return setGmailOpen(true);
    setSyncNote('Syncing…');
    try {
      const r = await syncNow();
      await refreshImports();
      setSyncNote(r.busy ? 'Already syncing — hang tight!' : r.imported ? `Synced! ${r.imported} new ${r.imported === 1 ? 'entry' : 'entries'} in.` : 'All caught up — nothing new.');
    } catch {
      setSyncNote("Couldn't sync. Try again from the Synced button.");
    }
    setTimeout(() => setSyncNote(null), 2200);
  };
  /** Phones: the header sticks to the top; what else sticks (Transactions' filters) sits under it. */
  // A state ref: the header appears after loading, and the effect must see it when it does.
  const [header, headerRef] = useState<HTMLElement | null>(null);
  const phone = useIsPhone();
  useEffect(() => {
    const el = header;
    const root = document.documentElement.style;
    if (!el || !phone) return void root.setProperty('--sticky-top', '0px');
    const ro = new ResizeObserver(() => root.setProperty('--sticky-top', el.offsetHeight + 'px'));
    ro.observe(el);
    return () => ro.disconnect();
  }, [header, phone]);
  const { pull, handlers } = usePageGestures({
    onSwipe: dir => {
      const next = TABS[TABS.findIndex(x => x.key === tab) + dir];
      if (next) setTab(next.key);
    },
    onPull: pullSync,
  });
  const syncLabel = !ready ? 'Connect Gmail' : gmail.last_sync_status?.startsWith('error') ? 'Gmail sync failed' : `Synced ${syncedAgo(gmail.last_synced_at)}`;
  const syncWarn = !ready || !!gmail.last_sync_status?.startsWith('error');

  const setTab = useCallback((t: Tab) => {
    storage.setRaw(KEYS.tab, t);
    setTabState(t);
    window.scrollTo({ top: 0 });
  }, []);
  const setNav = (mini: boolean) => {
    storage.setRaw(KEYS.nav, mini ? 'mini' : 'full');
    setCollapsed(mini);
  };
  const showTransactions = useCallback(
    (cat: string, extra?: { q?: string; date?: string }) => {
      setTxFilter(extra?.date ? { range: 'custom', from: extra.date, to: extra.date, cat, q: extra.q ?? '' } : { range: 'cycle', cat, q: extra?.q ?? '' });
      setTab('tx');
    },
    [setTab],
  );
  const showCategory = useCallback(
    (name: string) => {
      setOpenCat(name);
      setTab('categories');
    },
    [setTab],
  );


  const current = TABS.find(t => t.key === tab)!;
  const rule = paydayRule();
  const nextMonthDays = new Date(cycle.next.getFullYear(), cycle.next.getMonth() + 1, 0).getDate();
  const targetDay = Math.min(rule.day, nextMonthDays);
  const rawPayday = new Date(cycle.next.getFullYear(), cycle.next.getMonth(), targetDay);
  const nextNote = cycle.next.getDate() !== targetDay ? ` (${ordinal(targetDay)} is ${rawPayday.toLocaleDateString('en-GB', { weekday: 'long' })})` : '';

  return (
    <PlansProvider value={plansCtx}>
    <div className={`${s.shell} ${collapsed ? s.collapsed : ''}`}>
      <aside className={s.sideFull} aria-label="Main navigation">
        <div className={s.brandRow}>
          <Logo size={32} interactive />
          <span className={s.brandText}>Maxie</span>
          <button type="button" className={s.miniBtn} onClick={() => setNav(true)} title="Minimize sidebar" aria-label="Minimize sidebar">
            <Icon d={IC.chevLeft} size={16} />
          </button>
        </div>
        <nav className={s.navList}>
          {TABS.map(t => (
            <button key={t.key} type="button" className={tab === t.key ? s.navItemActive : s.navItem} aria-current={tab === t.key ? 'page' : undefined} onClick={() => setTab(t.key)}>
              <Icon d={t.icon} size={18} />
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <button type="button" className={s.navItem} onClick={() => setSettingsOpen(true)}>
            <Icon d={IC.settings} size={18} />
            <span>Settings</span>
          </button>
        </div>
      </aside>

      <aside className={s.sideRail} aria-label="Main navigation">
        <Logo size={36} interactive />
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {TABS.map(t => (
            <button
              key={t.key}
              type="button"
              className={tab === t.key ? s.railBtnActive : s.railBtn}
              aria-current={tab === t.key ? 'page' : undefined}
              onClick={() => setTab(t.key)}
              title={t.label}
              aria-label={t.label}
            >
              <Icon d={t.icon} size={20} />
            </button>
          ))}
        </nav>
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button type="button" className={`${s.railBtn} ${s.expandOnly}`} onClick={() => setNav(false)} title="Expand sidebar" aria-label="Expand sidebar">
            <Icon d={IC.chevRight} size={20} />
          </button>
          <button type="button" className={s.railBtn} onClick={() => setSettingsOpen(true)} title="Settings" aria-label="Settings">
            <Icon d={IC.settings} size={20} />
          </button>
        </div>
      </aside>

      <nav className={s.bottomNav} aria-label="Main navigation">
        {TABS.map(t => (
          <button key={t.key} type="button" className={tab === t.key ? s.bottomBtnActive : s.bottomBtn} aria-label={t.label} aria-current={tab === t.key ? 'page' : undefined} onClick={() => setTab(t.key)}>
            <Icon d={t.icon} size={20} />
            <span>{t.short}</span>
          </button>
        ))}
      </nav>

      <main className={s.main} {...handlers}>
        {(pull > 0 || syncNote) && (
          <div className={s.pullNote} role="status" style={{ transform: `translate(-50%, ${Math.min(pull / 2, 56)}px)` }}>
            {syncNote ?? (pull >= PULL_TO_SYNC ? 'Release to sync' : 'Pull to sync')}
          </div>
        )}
        <div className={s.content}>
          <header ref={headerRef} className={s.header}>
            <div className={s.headerTitle}>
              <div className={s.headerLine}>
                <h1 className={s.h1}>{current.label}</h1>
                <span className={s.label}>
                  <span className={s.desktopOnly}>
                    Cycle {dayMonth(cycle.start)} – {dayMonth(cycle.end)},&nbsp;
                  </span>
                  Day {cycle.dayN} of {cycle.cycleDays}
                </span>
              </div>
              <span className={s.cycleProgress} role="progressbar" aria-label="Pay cycle" aria-valuemin={1} aria-valuemax={cycle.cycleDays} aria-valuenow={cycle.dayN}>
                <span style={{ width: `${(cycle.dayN / cycle.cycleDays) * 100}%` }} />
              </span>
            </div>
            {/* Phones show payday in the Summary card instead. */}
            <span className={`${s.badgeAccent} ${s.desktopOnly}`}>
              Next payday {dayLabel(cycle.next)}
              {nextNote}
              {cycle.daysLeft <= 2 && budget.spent <= budget.budget ? ' — finishing strong' : ''}
            </span>
            <div className={s.headerActions}>
              <button type="button" className={s.chip} onClick={() => setChat({})} aria-label="Ask Maxie" title="Ask Maxie about your spending (⌘K / Ctrl+K)">
                <span className={s.purrMark} aria-hidden="true">
                  <Logo size={18} />
                </span>
                <span className={s.desktopOnly}>Ask Maxie</span>
              </button>
              <button
                type="button"
                className={s.chip}
                onClick={() => setGmailOpen(true)}
                style={syncWarn ? { borderColor: 'var(--amber)', color: 'var(--amber-ink)', fontWeight: 600 } : undefined}
                title={syncLabel}
                aria-label={syncLabel}
              >
                <Icon d={IC.refresh} size={14} />
                <span className={s.desktopOnly}>{syncLabel}</span>
              </button>
              <button type="button" className={`${s.chip} ${s.mobileOnly}`} onClick={() => setSettingsOpen(true)} aria-label="Settings" title="Settings">
                <Icon d={IC.settings} size={14} />
              </button>
            </div>
          </header>

          {saveError && (
            <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--red-tint)', color: 'var(--red-ink)', borderRadius: 10, padding: '12px 16px', fontSize: 14 }}>
              <span style={{ marginRight: 'auto' }}>{saveError}</span>
              <button type="button" className={s.btnGhost} style={{ color: 'inherit', padding: '0 8px' }} onClick={dismissError}>
                Dismiss
              </button>
            </div>
          )}

          {(!ready || txRows.length === 0) && tab !== 'invest' && (
            <div className={s.note} style={{ background: 'var(--accent-tint)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ marginRight: 'auto' }}>
                {!ready
                  ? 'Choose the Gmail label that holds your receipts. Spending, categories and the savings plan fill in from them.'
                  : 'No receipts in this pay cycle yet. Check the label, or press Sync now.'}
              </span>
              <button type="button" className={s.btnPrimary} onClick={() => setGmailOpen(true)}>
                {!ready ? 'Connect Gmail' : 'Open Gmail sync'}
              </button>
            </div>
          )}

          {/* Each tab fades in when you switch to it. */}
          <div key={tab} className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24, minWidth: 0 }}>
            {tab === 'summary' && (
              <Summary
                cycle={cycle}
                budget={budget}
                onOpenCategory={showCategory}
                onOpenCategories={() => {
                  setOpenCat(null);
                  setTab('categories');
                }}
                onDismissBill={dismissBill}
                onMarkBillPaid={markBillPaid}
                onShowTransactions={patch => {
                  setTxFilter({ cat: '', q: '', ...patch });
                  setTab('tx');
                }}
                onPlanNext={() => {
                  setPlanView('next');
                  setTab('plan');
                }}
                onAskMaxie={ask => setChat({ ask })}
              />
            )}
            {tab === 'categories' && (
              <Categories
                cycle={cycle}
                budget={budget}
                allTxs={allTxs}
                allRaw={all}
                fixedBillStatuses={fixedBillStatuses}
                catOf={catOf}
                open={openCat}
                setOpen={setOpenCat}
                onShowTransactions={showTransactions}
                onEditCategory={name => setCatDialog({ editing: name })}
                onNewCategory={() => setCatDialog({})}
                onAskMaxie={ask => setChat({ ask })}
              />
            )}
            {tab === 'tx' && <Activity cycle={cycle} budget={budget} allTxs={allTxs} removedTxs={removedTxs} onRemove={setRemoved} filter={txFilter} setFilter={setTxFilter} onRecat={setOverride} onLink={setLink} onShare={setShare} onDismissBill={dismissBill} onMarkBillPaid={markBillPaid} fixedBillStatuses={fixedBillStatuses} subscriptions={subscriptions} plans={plans} />}
            {tab === 'plan' && (
              <SavingsPlan
                cycle={cycle}
                budget={budget}
                onOpenInvest={() => setTab('invest')}
                onShowTransactions={showTransactions}
                view={planView}
                setView={setPlanView}
                next={nextCycle}
                nextKnown={nextKnown}
              >
                <InstallmentsAhead cycle={cycle} />
                <Subscriptions budget={budget} states={subStates} txs={all} catOf={catOf} />
              </SavingsPlan>
            )}
            {tab === 'invest' && <Invest cycle={cycle} />}
          </div>
        </div>
      </main>

      {gmailOpen && <GmailDialog notice={googleNotice} onClose={() => setGmailOpen(false)} />}
      {billUndo && (
        <Toast
          text={billUndo.text}
          action="Undo"
          onAction={() => {
            billUndo.run();
            setBillUndo(null);
          }}
          onClose={() => setBillUndo(null)}
        />
      )}
      {chat && <Chat cycle={cycle} budget={budget} allTxs={allTxs} fixedBills={fixedBillStatuses} ask={chat.ask} onClose={() => setChat(null)} />}
      {settingsOpen && (
        <SettingsDialog
          email={email}
          onClose={() => setSettingsOpen(false)}
          onEditCategory={name => {
            // Settings keeps its own copy of every setting, so close it rather than stacking dialogs.
            setSettingsOpen(false);
            setCatDialog({ editing: name });
          }}
        />
      )}
      {catDialog && <CategoryDialog editing={catDialog.editing} onClose={() => setCatDialog(null)} />}
      {scheduleKey && <ScheduleModal planKey={scheduleKey} onClose={() => setScheduleKey(null)} />}
    </div>
    </PlansProvider>
  );
}
