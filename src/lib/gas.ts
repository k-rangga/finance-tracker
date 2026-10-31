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

/** Editor URL of the Apps Script project (where new permissions are approved by running `setup`). */
export const SCRIPT_EDITOR_URL = 'https://script.google.com/d/1cc9XbesHR8YwZagOgEeqrwIli9SIn4jXUwPu0ak-uSFWZ8pAaoTZFZ0m/edit';

/** Google's "You do not have permission to call …" means a newly added scope hasn't been approved yet. */
export const needsAuthorization = (msg: string) => /do not have permission to call|authorization is required|required permissions/i.test(msg);

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
  links?: Record<string, string>;
  shares?: Record<string, number>;
  notes?: Record<string, string>;
  removed?: string[];
  installments?: Record<string, unknown>;
  rules?: Record<string, string>;
  trades: Record<string, unknown>[];
  updates?: { id: string }[];
  snapshots: { day: string }[];
  /** Sample imported rows for working on the UI locally (set by hand in localStorage). */
  txRows?: unknown[];
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
      return { email: 'dev@localhost', settings: d.settings ?? null, recat: d.overrides, links: d.links ?? {}, shares: d.shares ?? {}, notes: d.notes ?? {}, removed: d.removed ?? [], installments: d.installments ?? {}, rules: d.rules ?? {}, trades: d.trades, updates: d.updates ?? [], prices: d.prices ?? null, snaps: d.snapshots, txRows: d.txRows ?? [], gmail };
    case 'getImports':
      return { txRows: d.txRows ?? [], gmail };
    case 'saveSettings':
      d.settings = q.settings;
      return save();
    case 'setOverride':
      if (q.category == null) delete d.overrides[q.txId as string];
      else d.overrides[q.txId as string] = q.category as string;
      return save();
    case 'setLink': {
      const links = (d.links ??= {});
      if (q.expenseId == null) delete links[q.incomeId as string];
      else links[q.incomeId as string] = q.expenseId as string;
      return save();
    }
    case 'setShare': {
      const shares = (d.shares ??= {});
      if (q.ratio == null) delete shares[q.txId as string];
      else shares[q.txId as string] = q.ratio as number;
      return save();
    }
    case 'setNote': {
      const notes = (d.notes ??= {});
      const note = String(q.note ?? '').trim();
      if (note) notes[q.txId as string] = note;
      else delete notes[q.txId as string];
      return save();
    }
    case 'setInstallment': {
      const plans = (d.installments ??= {});
      if (q.plan) plans[q.txId as string] = q.plan;
      else delete plans[q.txId as string];
      return save();
    }
    case 'setRules': {
      const rules = (d.rules ??= {});
      for (const [m, cat] of Object.entries(q.rules as Record<string, string | null>)) {
        for (const k of Object.keys(rules)) if (k.toLowerCase() === m.toLowerCase()) delete rules[k];
        if (cat) rules[m] = cat;
      }
      return save();
    }
    case 'setRemoved': {
      const rest = (d.removed ?? []).filter(id => id !== q.txId);
      d.removed = q.removed ? [...rest, q.txId as string] : rest;
      return save();
    }
    case 'saveTrade': {
      const t = q.trade as { id: string };
      d.trades = [t, ...d.trades.filter(x => x.id !== t.id)];
      return save();
    }
    case 'saveTradeUpdate': {
      const x = q.update as { id: string };
      d.updates = [...(d.updates ?? []).filter(y => y.id !== x.id), x];
      return save();
    }
    case 'deleteTradeUpdate':
      d.updates = (d.updates ?? []).filter(y => y.id !== q.id);
      return save();
    case 'quotes': {
      // Stand-in for Google Finance: prices from `quotes` in localStorage; anything missing acts like #N/A.
      const at = new Date().toISOString();
      const known = (d.quotes ?? {}) as Record<string, number>;
      const items = (q.items ?? []) as { tk: string }[];
      return Object.fromEntries(items.filter(i => known[i.tk] > 0).map(i => [i.tk, { price: known[i.tk], at }]));
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
    case 'syncRange':
      return { imported: 0, skipped: 0, scanned: 0 };
    case 'disconnectGmail':
      delete d.label;
      return save();
    default:
      throw new Error('Unknown action: ' + action);
  }
}
