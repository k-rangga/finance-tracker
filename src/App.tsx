import { useCallback, useEffect, useMemo, useState } from 'react';
import s from './styles/ui.module.css';
import { IC, Icon } from './components/Icon';
import { Logo } from './components/Logo';
import { SettingsDialog } from './components/SettingsDialog';
import { CategoryDialog } from './components/CategoryDialog';
import { GmailDialog, syncedAgo } from './components/GmailDialog';
import { KEYS, storage } from './lib/storage';
import { getCycle } from './lib/cycle';
import { computeBudget, txViews } from './lib/budget';
import { addDays, dayLabel, dayMonth, startOfToday, tidyName, toISO } from './lib/format';
import { useSettings } from './lib/settings';
import { useData } from './lib/data';
import { billKey, expectedBills, inCycle, installmentBills, installmentPayments, resolveSubs, toTransaction, withMerchantRules, type Bill } from './data/transactions';
import { INSTALLMENT_CATEGORY } from './data/categories';
import { Summary } from './screens/Summary';
import { Categories } from './screens/Categories';
import { Activity, type ActivityFilter } from './screens/Activity';
import { SavingsPlan } from './screens/SavingsPlan';
import { Invest } from './screens/invest/Invest';
import { PULL_TO_SYNC, usePageGestures } from './lib/gestures';
import { syncNow } from './lib/gmail';

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
  const { recat: fixed, links, shares, removed, installments, rules, ruleSubs, subs: picked, setOverride, setLink, setShare, setRemoved, saveError, dismissError, txRows, gmail, email, refreshImports } = useData();
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
  const [gmailOpen, setGmailOpen] = useState(false);
  const { settings, update } = useSettings();

  const today = useMemo(startOfToday, []);
  const cycle = useMemo(() => getCycle(today), [today]);
  const prevCycle = useMemo(() => getCycle(addDays(cycle.start, -1)), [cycle]);
  const imported = useMemo(() => txRows.map(r => toTransaction(r, settings.currency, settings.fxRate)), [txRows, settings.currency, settings.fxRate]);
  const removedIds = useMemo(() => new Set(removed), [removed]);
  /** Your fixes by hand, plus your merchant rules for every other transaction of those merchants. */
  // Categories are in the deps: a rule naming a category you just made starts to apply.
  const fixedAndRules = useMemo(() => withMerchantRules(imported, fixed, rules), [imported, fixed, rules, settings.customCategories]);
  const kept = useMemo(() => imported.filter(t => !removedIds.has(t.id)), [imported, removedIds]);
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
  /** Sub-categories: yours, else your rules', else a guess from the merchant name. */
  const subs = useMemo(() => resolveSubs(all, t => recat[t.id] ?? t.category, picked, ruleSubs, settings.subcategories), [all, recat, picked, ruleSubs, settings.subcategories]);
  const transactions = useMemo(() => inCycle(all, cycle), [all, cycle]);
  const prevTransactions = useMemo(() => all.filter(t => t.date >= prevCycle.start && t.date < cycle.start), [all, prevCycle, cycle]);
  const bills = useMemo(
    () =>
      [
        ...expectedBills(prevTransactions, prevCycle, transactions, cycle, recat).filter(b => !settings.dismissedBills.includes(billKey(toISO(cycle.start), b))),
        ...installmentBills(payments, cycle),
      ].sort((x, y) => x.date.getTime() - y.date.getTime()),
    // Custom categories change which categories are fixed bills.
    [prevTransactions, prevCycle, transactions, cycle, recat, payments, settings.customCategories, settings.dismissedBills],
  );
  /** "Not a bill this cycle": hides a predicted bill until payday, with a few seconds to undo. */
  const [billUndo, setBillUndo] = useState<{ text: string; run: () => void } | null>(null);
  useEffect(() => {
    if (!billUndo) return;
    const t = setTimeout(() => setBillUndo(null), 5000);
    return () => clearTimeout(t);
  }, [billUndo]);
  const dismissBill = (b: Bill) => {
    const id = toISO(cycle.start);
    // Keys from earlier cycles no longer match anything.
    const before = settings.dismissedBills.filter(k => k.startsWith(id + '|'));
    update({ dismissedBills: [...before, billKey(id, b)] });
    setBillUndo({ text: `${tidyName(b.title)} removed from bills`, run: () => update({ dismissedBills: before }) });
  };
  const budget = useMemo(
    () => computeBudget({ transactions, prevTransactions, prevCycle, bills, recat, links, shares, subs, cycle, income: settings.income, warnAt: settings.warnAt }),
    [transactions, prevTransactions, prevCycle, bills, recat, links, shares, subs, cycle, settings.income, settings.warnAt, settings.savingsPct, settings.customCategories, settings.limitOverrides, settings.colorOverrides],
  );
  /** Every synced transaction, for the Transactions screen's own date range. */
  const allTxs = useMemo(() => txViews(all, all, { recat, links, shares, cycle, subs }).txs, [all, recat, links, shares, cycle, subs]);
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
      setSyncNote(r.busy ? 'A sync is already running' : r.imported ? `Synced · ${r.imported} new` : 'Synced · nothing new');
    } catch {
      setSyncNote("Couldn't sync. Try again from the Synced button.");
    }
    setTimeout(() => setSyncNote(null), 2200);
  };
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
    (cat: string) => {
      setTxFilter({ range: 'cycle', cat, q: '' });
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
  const raw25 = new Date(cycle.next.getFullYear(), cycle.next.getMonth(), 25);
  const nextNote = cycle.next.getDate() !== 25 ? ` (25th is ${raw25.toLocaleDateString('en-GB', { weekday: 'long' })})` : '';

  return (
    <div className={`${s.shell} ${collapsed ? s.collapsed : ''}`}>
      <aside className={s.sideFull} aria-label="Main navigation">
        <div className={s.brandRow}>
          <Logo size={32} />
          <span className={s.brandText}>Personal Spending Tracker</span>
          <button type="button" className={s.miniBtn} onClick={() => setNav(true)} title="Minimize sidebar" aria-label="Minimize sidebar">
            <Icon d={IC.chevLeft} size={16} strokeWidth={2.5} />
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
        <Logo size={36} />
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
            <Icon d={IC.chevRight} size={20} strokeWidth={2.5} />
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
          <header className={s.header}>
            <div className={s.headerTitle}>
              <div className={s.headerLine}>
                <h1 className={s.h1}>{current.label}</h1>
                <span className={s.label}>
                  <span className={s.desktopOnly}>
                    Cycle {dayMonth(cycle.start)} – {dayMonth(cycle.end)} ·&nbsp;
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
            </span>
            <div className={s.headerActions}>
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
                onOpenSettings={() => setSettingsOpen(true)}
                onDismissBill={dismissBill}
                onShowTransactions={(range, cat = '') => {
                  setTxFilter({ range, cat, q: '' });
                  setTab('tx');
                }}
              />
            )}
            {tab === 'categories' && (
              <Categories cycle={cycle} budget={budget} open={openCat} setOpen={setOpenCat} onShowTransactions={showTransactions} onEditCategory={name => setCatDialog({ editing: name })} onNewCategory={() => setCatDialog({})} />
            )}
            {tab === 'tx' && <Activity cycle={cycle} budget={budget} allTxs={allTxs} removedTxs={removedTxs} onRemove={setRemoved} filter={txFilter} setFilter={setTxFilter} onRecat={setOverride} onLink={setLink} onShare={setShare} onDismissBill={dismissBill} />}
            {tab === 'plan' && <SavingsPlan cycle={cycle} budget={budget} onOpenInvest={() => setTab('invest')} />}
            {tab === 'invest' && <Invest cycle={cycle} />}
          </div>
        </div>
      </main>

      {gmailOpen && <GmailDialog onClose={() => setGmailOpen(false)} />}
      {billUndo && (
        <div className={s.toast} role="status">
          <span style={{ marginRight: 'auto', minWidth: 0 }}>{billUndo.text}</span>
          <button
            type="button"
            className={s.toastBtn}
            onClick={() => {
              billUndo.run();
              setBillUndo(null);
            }}
          >
            Undo
          </button>
        </div>
      )}
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
    </div>
  );
}
