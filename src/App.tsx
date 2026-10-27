import { useCallback, useMemo, useState } from 'react';
import s from './styles/ui.module.css';
import { IC, Icon } from './components/Icon';
import { Logo } from './components/Logo';
import { SettingsDialog } from './components/SettingsDialog';
import { CategoryDialog } from './components/CategoryDialog';
import { GmailDialog, syncedAgo } from './components/GmailDialog';
import { KEYS, storage } from './lib/storage';
import { getCycle } from './lib/cycle';
import { computeBudget, txViews } from './lib/budget';
import { addDays, dayLabel, dayMonth, startOfToday } from './lib/format';
import { useSettings } from './lib/settings';
import { useData } from './lib/data';
import { expectedBills, inCycle, toTransaction, withMerchantRules } from './data/transactions';
import { Summary } from './screens/Summary';
import { Categories } from './screens/Categories';
import { Activity, type ActivityFilter } from './screens/Activity';
import { SavingsPlan } from './screens/SavingsPlan';
import { Invest } from './screens/invest/Invest';

export type Tab = 'summary' | 'categories' | 'tx' | 'plan' | 'invest';

const TABS: { key: Tab; label: string; short: string; icon: string }[] = [
  { key: 'summary', label: 'Summary', short: 'Summary', icon: IC.summary },
  { key: 'categories', label: 'Categories', short: 'Categories', icon: IC.categories },
  { key: 'tx', label: 'Transactions', short: 'Activity', icon: IC.list },
  { key: 'plan', label: 'Savings plan', short: 'Plan', icon: IC.piggy },
  { key: 'invest', label: 'Investment journal', short: 'Invest', icon: IC.trend },
];

export default function App() {
  const [collapsed, setCollapsed] = useState(() => storage.getRaw(KEYS.nav) === 'mini');
  const [tab, setTabState] = useState<Tab>(() => {
    const t = storage.getRaw(KEYS.tab) as Tab | null;
    return t && TABS.some(x => x.key === t) ? t : 'summary';
  });
  const { recat: fixed, links, shares, removed, setOverride, setLink, setShare, setRemoved, saveError, dismissError, txRows, gmail, email } = useData();
  const [txFilter, setTxFilter] = useState<ActivityFilter>({ range: 'week', cat: '', q: '' });
  const [openCat, setOpenCat] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Create (no name) or edit one of your categories; opened from Settings or a Categories row. */
  const [catDialog, setCatDialog] = useState<{ editing?: string } | null>(null);
  const [gmailOpen, setGmailOpen] = useState(false);
  const { settings } = useSettings();

  const today = useMemo(startOfToday, []);
  const cycle = useMemo(() => getCycle(today), [today]);
  const prevCycle = useMemo(() => getCycle(addDays(cycle.start, -1)), [cycle]);
  const imported = useMemo(() => txRows.map(r => toTransaction(r, settings.currency, settings.fxRate)), [txRows, settings.currency, settings.fxRate]);
  const removedIds = useMemo(() => new Set(removed), [removed]);
  /** What every screen counts: imported transactions minus the ones you removed. */
  const all = useMemo(() => imported.filter(t => !removedIds.has(t.id)), [imported, removedIds]);
  /** Your fixes by hand, plus your merchant rules for every other transaction of those merchants. */
  const recat = useMemo(() => withMerchantRules(imported, fixed, settings.merchantRules), [imported, fixed, settings.merchantRules]);
  const transactions = useMemo(() => inCycle(all, cycle), [all, cycle]);
  const prevTransactions = useMemo(() => all.filter(t => t.date >= prevCycle.start && t.date < cycle.start), [all, prevCycle, cycle]);
  const bills = useMemo(
    () => expectedBills(prevTransactions, prevCycle, transactions, cycle, recat),
    // Custom categories change which categories are fixed bills.
    [prevTransactions, prevCycle, transactions, cycle, recat, settings.customCategories],
  );
  const budget = useMemo(
    () => computeBudget({ transactions, prevTransactions, prevCycle, bills, recat, links, shares, cycle, income: settings.income, warnAt: settings.warnAt }),
    [transactions, prevTransactions, prevCycle, bills, recat, links, shares, cycle, settings.income, settings.warnAt, settings.savingsPct, settings.customCategories, settings.limitOverrides, settings.colorOverrides],
  );
  /** Every synced transaction, for the Transactions screen's own date range. */
  const allTxs = useMemo(() => txViews(all, all, { recat, links, shares, cycle }).txs, [all, recat, links, shares, cycle]);
  const removedTxs = useMemo(
    () => txViews(imported.filter(t => removedIds.has(t.id)), imported, { recat, links, shares, cycle }).txs,
    [imported, removedIds, recat, links, shares, cycle],
  );
  const ready = !!gmail.label_name;
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

      <main className={s.main}>
        <div className={s.content}>
          <header className={s.header}>
            <div className={s.headerTitle}>
              <span className={s.mobileOnly} style={{ fontWeight: 600, fontSize: 14 }}>
                Personal Spending Tracker
              </span>
              <div className={s.headerLine}>
                <h1 className={s.h1}>{current.label}</h1>
                <span className={s.label}>
                  Cycle {dayMonth(cycle.start)} – {dayMonth(cycle.end)} · Day {cycle.dayN} of {cycle.cycleDays}
                </span>
              </div>
              <span className={s.cycleProgress} role="progressbar" aria-label="Pay cycle" aria-valuemin={1} aria-valuemax={cycle.cycleDays} aria-valuenow={cycle.dayN}>
                <span style={{ width: `${(cycle.dayN / cycle.cycleDays) * 100}%` }} />
              </span>
            </div>
            <span className={s.badgeAccent}>
              Next payday {dayLabel(cycle.next)}
              {nextNote}
            </span>
            <button
              type="button"
              className={s.chip}
              onClick={() => setGmailOpen(true)}
              style={syncWarn ? { borderColor: 'var(--amber)', color: 'var(--amber-ink)', fontWeight: 600 } : undefined}
              title="Gmail sync settings"
            >
              <Icon d={IC.refresh} size={14} />
              {syncLabel}
            </button>
            <button type="button" className={`${s.chip} ${s.mobileOnly}`} onClick={() => setSettingsOpen(true)} aria-label="Settings" title="Settings">
              <Icon d={IC.settings} size={14} />
            </button>
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

          {tab === 'summary' && (
            <Summary
              cycle={cycle}
              budget={budget}
              onOpenCategory={showCategory}
              onOpenSettings={() => setSettingsOpen(true)}
              onShowTransactions={(range, cat = '') => {
                setTxFilter({ range, cat, q: '' });
                setTab('tx');
              }}
            />
          )}
          {tab === 'categories' && (
            <Categories cycle={cycle} budget={budget} open={openCat} setOpen={setOpenCat} onShowTransactions={showTransactions} onEditCategory={name => setCatDialog({ editing: name })} onNewCategory={() => setCatDialog({})} />
          )}
          {tab === 'tx' && <Activity cycle={cycle} budget={budget} allTxs={allTxs} removedTxs={removedTxs} onRemove={setRemoved} filter={txFilter} setFilter={setTxFilter} onRecat={setOverride} onLink={setLink} onShare={setShare} />}
          {tab === 'plan' && <SavingsPlan cycle={cycle} budget={budget} onOpenInvest={() => setTab('invest')} />}
          {tab === 'invest' && <Invest cycle={cycle} />}
        </div>
      </main>

      {gmailOpen && <GmailDialog onClose={() => setGmailOpen(false)} />}
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
