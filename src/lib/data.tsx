import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Backend, UserData } from './backend';
import type { Settings } from './settings';
import type { Prices, Snap, Trade } from '../screens/invest/model';

type Ctx = UserData & {
  mode: Backend['mode'];
  /** Last write that failed, shown as a banner until dismissed. */
  saveError: string | null;
  dismissError: () => void;
  saveSettings: (s: Settings) => void;
  setOverride: (txId: string, orig: string, cat: string) => void;
  saveTrade: (t: Trade) => void;
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
      .load()
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
      mode: backend.mode,
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
      saveTrade: t => {
        setData(d => d && { ...d, journal: d.journal.some(x => x.id === t.id) ? d.journal.map(x => (x.id === t.id ? t : x)) : [t, ...d.journal] });
        write(backend.saveTrade(t));
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
