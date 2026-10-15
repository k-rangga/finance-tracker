import { useCallback, useMemo, useState } from 'react';
import s from './styles/ui.module.css';
import { IC, Icon } from './components/Icon';
import { Logo } from './components/Logo';
import { SettingsDialog } from './components/SettingsDialog';
import { KEYS, storage, usePersistent } from './lib/storage';
import { getCycle } from './lib/cycle';
import { computeBudget } from './lib/budget';
import { dayLabel, dayMonth, startOfToday } from './lib/format';
import { useSettings } from './lib/settings';
import { isAuthed, signOut } from './lib/auth';
import { loadCycleTransactions, loadUpcomingBills } from './data/transactions';
import { Login } from './screens/Login';
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
  const [authed, setAuthedState] = useState(isAuthed);
  const [collapsed, setCollapsed] = useState(() => storage.getRaw(KEYS.nav) === 'mini');
  const [tab, setTabState] = useState<Tab>(() => {
    const t = storage.getRaw(KEYS.tab) as Tab | null;
    return t && TABS.some(x => x.key === t) ? t : 'summary';
  });
  const [recat, setRecat] = usePersistent<Record<string, string>>(KEYS.recat, () => ({}));
  const [txFilter, setTxFilter] = useState<ActivityFilter>({ range: 'week', cat: '', q: '' });
  const [openCat, setOpenCat] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { settings } = useSettings();

  const today = useMemo(startOfToday, []);
  const cycle = useMemo(() => getCycle(today), [today]);
  const transactions = useMemo(() => loadCycleTransactions(cycle, settings.income), [cycle, settings.income]);
  const bills = useMemo(() => loadUpcomingBills(cycle, settings.income), [cycle, settings.income]);
  const budget = useMemo(
    () => computeBudget({ transactions, bills, recat, cycle, income: settings.income, warnAt: settings.warnAt }),
    [transactions, bills, recat, cycle, settings.income, settings.warnAt],
  );

  const setTab = useCallback((t: Tab) => {
    storage.setRaw(KEYS.tab, t);
    setTabState(t);
    window.scrollTo({ top: 0 });
  }, []);
  const setNav = (mini: boolean) => {
    storage.setRaw(KEYS.nav, mini ? 'mini' : 'full');
    setCollapsed(mini);
  };
  const logout = () => {
    signOut();
    setAuthedState(false);
  };
  const recategorise = useCallback(
    (id: string, orig: string, cat: string) =>
      setRecat(prev => {
        const next = { ...prev };
        if (cat === orig) delete next[id];
        else next[id] = cat;
        return next;
      }),
    [setRecat],
  );
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

  if (!authed) return <Login onSignedIn={() => setAuthedState(true)} />;

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
          <button type="button" className={s.navItem} onClick={logout}>
            <Icon d={IC.logout} size={18} />
            <span>Log out</span>
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
          <button type="button" className={s.railBtn} onClick={logout} title="Log out" aria-label="Log out">
            <Icon d={IC.logout} size={20} />
          </button>
        </div>
      </aside>

      <nav className={s.bottomNav} aria-label="Main navigation">
        {TABS.map(t => (
          <button key={t.key} type="button" className={tab === t.key ? s.bottomBtnActive : s.bottomBtn} aria-current={tab === t.key ? 'page' : undefined} onClick={() => setTab(t.key)}>
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
              <span className={s.label}>
                Cycle {dayMonth(cycle.start)} – {dayMonth(cycle.end)} · Day {cycle.dayN} of {cycle.cycleDays}
              </span>
              <h1 className={s.h1}>{current.label}</h1>
            </div>
            <span className={s.badgeAccent}>
              Next payday {dayLabel(cycle.next)}
              {nextNote}
            </span>
            <span className={s.chip}>
              <Icon d={IC.refresh} size={14} />
              Synced from Gmail
            </span>
            <button type="button" className={`${s.chip} ${s.mobileOnly}`} onClick={() => setSettingsOpen(true)} aria-label="Settings" title="Settings">
              <Icon d={IC.settings} size={14} />
            </button>
            <button type="button" className={`${s.chip} ${s.mobileOnly}`} onClick={logout}>
              Log out
            </button>
          </header>

          {tab === 'summary' && <Summary cycle={cycle} budget={budget} onOpenCategory={showCategory} />}
          {tab === 'categories' && (
            <Categories cycle={cycle} budget={budget} open={openCat} setOpen={setOpenCat} onShowTransactions={showTransactions} />
          )}
          {tab === 'tx' && <Activity cycle={cycle} budget={budget} filter={txFilter} setFilter={setTxFilter} onRecat={recategorise} />}
          {tab === 'plan' && <SavingsPlan cycle={cycle} budget={budget} onOpenInvest={() => setTab('invest')} />}
          {tab === 'invest' && <Invest cycle={cycle} />}
        </div>
      </main>

      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
