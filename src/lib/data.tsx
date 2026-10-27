import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Backend, UserData } from './backend';
import type { Settings } from './settings';
import type { Prices, Snap, Trade, TradeUpdate } from '../screens/invest/model';
import type { InstallmentPlan } from '../data/transactions';
import { getCycle } from './cycle';
import { addDays, startOfToday } from './format';

/** Load transactions from the start of the previous pay cycle (needed for last-cycle comparisons). */
const importsSince = () => getCycle(addDays(getCycle(startOfToday()).start, -1)).start;

type Ctx = UserData & {
  /** Re-read imported transactions and Gmail status. */
  refreshImports: () => Promise<void>;
  /** Last write that failed, shown as a banner until dismissed. */
  saveError: string | null;
  dismissError: () => void;
  saveSettings: (s: Settings) => void;
  setOverride: (txId: string, orig: string, cat: string) => void;
  /** Link an income to the expense it pays back; `null` unlinks. */
  setLink: (incomeId: string, expenseId: string | null) => void;
  /** Your share of an expense as a fraction (0–1); `null` counts the full amount. */
  setShare: (txId: string, ratio: number | null) => void;
  /** Hide a transaction everywhere (`true`) or bring it back. */
  setRemoved: (txId: string, removed: boolean) => void;
  /** Pay a purchase in installments; `null` makes it one purchase again. */
  setInstallment: (txId: string, plan: InstallmentPlan | null) => void;
  saveTrade: (t: Trade) => void;
  saveUpdate: (u: TradeUpdate) => void;
  deleteUpdate: (id: string) => void;
  savePrices: (p: Prices) => void;
  saveSnapshot: (s: Snap) => void;
};

const DataCtx = createContext<Ctx | null>(null);

/** Loads the signed-in user's data and writes changes through to the backend (optimistic). */
export function DataProvider({ backend, children, loading, failed }: { backend: Backend; children: ReactNode; loading: ReactNode; failed: (msg: string, retry: () => void) => ReactNode }) {
  const [data, setData] = useState<UserData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setLoadError(null);
    backend
      .load(importsSince())
      .then(d => live && setData(d))
      .catch(e => live && setLoadError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [backend, attempt]);

  const write = useCallback((p: Promise<void>) => {
    p.catch(e => setSaveError("Couldn't save your last change: " + (e instanceof Error ? e.message : String(e))));
  }, []);

  const value = useMemo<Ctx | null>(() => {
    if (!data) return null;
    return {
      ...data,
      refreshImports: async () => {
        const imports = await backend.loadImports(importsSince());
        setData(d => d && { ...d, ...imports });
      },
      saveError,
      dismissError: () => setSaveError(null),
      saveSettings: s => {
        setData(d => d && { ...d, settings: s });
        write(backend.saveSettings(s));
      },
      setOverride: (txId, orig, cat) => {
        const next = cat === orig ? null : cat;
        setData(d => {
          if (!d) return d;
          const recat = { ...d.recat };
          if (next == null) delete recat[txId];
          else recat[txId] = next;
          return { ...d, recat };
        });
        write(backend.setOverride(txId, next));
      },
      setLink: (incomeId, expenseId) => {
        setData(d => {
          if (!d) return d;
          const links = { ...d.links };
          if (expenseId == null) delete links[incomeId];
          else links[incomeId] = expenseId;
          return { ...d, links };
        });
        write(backend.setLink(incomeId, expenseId));
      },
      setShare: (txId, ratio) => {
        setData(d => {
          if (!d) return d;
          const shares = { ...d.shares };
          if (ratio == null) delete shares[txId];
          else shares[txId] = ratio;
          return { ...d, shares };
        });
        write(backend.setShare(txId, ratio));
      },
      setRemoved: (txId, removed) => {
        setData(d => d && { ...d, removed: removed ? [...d.removed.filter(id => id !== txId), txId] : d.removed.filter(id => id !== txId) });
        write(backend.setRemoved(txId, removed));
      },
      setInstallment: (txId, plan) => {
        setData(d => {
          if (!d) return d;
          const installments = { ...d.installments };
          if (plan) installments[txId] = plan;
          else delete installments[txId];
          return { ...d, installments };
        });
        write(backend.setInstallment(txId, plan));
      },
      saveTrade: t => {
        setData(d => d && { ...d, journal: d.journal.some(x => x.id === t.id) ? d.journal.map(x => (x.id === t.id ? t : x)) : [t, ...d.journal] });
        write(backend.saveTrade(t));
      },
      saveUpdate: x => {
        setData(d => d && { ...d, updates: [...d.updates.filter(y => y.id !== x.id), x] });
        write(backend.saveUpdate(x));
      },
      deleteUpdate: id => {
        setData(d => d && { ...d, updates: d.updates.filter(y => y.id !== id) });
        write(backend.deleteUpdate(id));
      },
      savePrices: p => {
        setData(d => d && { ...d, prices: p });
        write(backend.savePrices(p));
      },
      saveSnapshot: s => {
        setData(d => d && { ...d, snaps: [...d.snaps.filter(x => x.d !== s.d), s].sort((a, b) => a.d.localeCompare(b.d)) });
        write(backend.saveSnapshot(s));
      },
    };
  }, [data, backend, saveError, write]);

  if (loadError) return <>{failed(loadError, () => setAttempt(a => a + 1))}</>;
  if (!value) return <>{loading}</>;
  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>;
}

export function useData(): Ctx {
  const c = useContext(DataCtx);
  if (!c) throw new Error('useData outside DataProvider');
  return c;
}
