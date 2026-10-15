/**
 * Calls the Apps Script server (`api(action, payload)` in apps-script/Code.js) through google.script.run.
 * Outside Apps Script (plain `npm run dev`) a small browser-storage stand-in answers instead, so the UI can be worked on locally.
 */

type ScriptRun = {
  withSuccessHandler(fn: (r: unknown) => void): ScriptRun;
  withFailureHandler(fn: (e: Error) => void): ScriptRun;
  api(action: string, payload: unknown): void;
};

declare global {
  interface Window {
    google?: { script?: { run: ScriptRun } };
  }
}

export const inAppsScript = () => !!window.google?.script?.run;

export function run<T>(action: string, payload: unknown = {}): Promise<T> {
  const gs = window.google?.script?.run;
  if (!gs) return devApi(action, payload) as Promise<T>;
  return new Promise((resolve, reject) => {
    gs.withSuccessHandler(r => resolve(r as T))
      .withFailureHandler(e => reject(new Error(String(e?.message ?? e).replace(/^Error:\s*/, ''))))
      .api(action, payload);
  });
}

// ---------------------------------------------------------------- local stand-in

const DEV_KEY = 'moneyTracker.dev';
type Dev = Record<string, unknown> & {
  overrides: Record<string, string>;
  trades: Record<string, unknown>[];
  snapshots: { day: string }[];
};

function devLoad(): Dev {
  try {
    return { overrides: {}, trades: [], snapshots: [], ...JSON.parse(localStorage.getItem(DEV_KEY) || '{}') };
  } catch {
    return { overrides: {}, trades: [], snapshots: [] };
  }
}

async function devApi(action: string, p: unknown): Promise<unknown> {
  const d = devLoad();
  const q = (p ?? {}) as Record<string, unknown>;
  const save = () => {
    try {
      localStorage.setItem(DEV_KEY, JSON.stringify(d));
    } catch {
      /* ignore */
    }
    return true;
  };
  const gmail = { google_email: 'dev@localhost', label_name: (d.label as string) ?? null, last_synced_at: null, last_sync_status: null, last_sync_count: null };
  switch (action) {
    case 'getState':
      return { email: 'dev@localhost', settings: d.settings ?? null, recat: d.overrides, trades: d.trades, prices: d.prices ?? null, snaps: d.snapshots, txRows: [], gmail };
    case 'getImports':
      return { txRows: [], gmail };
    case 'saveSettings':
      d.settings = q.settings;
      return save();
    case 'setOverride':
      if (q.category == null) delete d.overrides[q.txId as string];
      else d.overrides[q.txId as string] = q.category as string;
      return save();
    case 'saveTrade': {
      const t = q.trade as { id: string };
      d.trades = [t, ...d.trades.filter(x => x.id !== t.id)];
      return save();
    }
    case 'savePrices':
      d.prices = q.prices;
      return save();
    case 'saveSnapshot': {
      const s = q.snap as { day: string };
      d.snapshots = [...d.snapshots.filter(x => x.day !== s.day), s];
      return save();
    }
    case 'listLabels':
      return ['Receipts'];
    case 'chooseLabel':
      d.label = q.name;
      save();
      return { imported: 0, skipped: 0, scanned: 0 };
    case 'syncNow':
      return { imported: 0, skipped: 0, scanned: 0 };
    case 'disconnectGmail':
      delete d.label;
      return save();
    default:
      throw new Error('Unknown action: ' + action);
  }
}
