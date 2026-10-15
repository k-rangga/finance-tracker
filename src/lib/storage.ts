/**
 * Small persistence layer. Everything the app saves goes through here so the
 * localStorage backend can later be swapped for an API without touching screens.
 */
export const KEYS = {
  auth: 'moneyTracker.auth',
  nav: 'moneyTracker.nav',
  tab: 'moneyTracker.tab',
  recat: 'moneyTracker.recat',
  journal: 'moneyTracker.journal',
  prices: 'moneyTracker.prices',
  snaps: 'moneyTracker.snaps',
  settings: 'moneyTracker.settings',
  buckets: 'moneyTracker.buckets',
} as const;

export const storage = {
  getRaw(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setRaw(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* storage unavailable (private mode, quota) — keep in-memory state only */
    }
  },
  get<T>(key: string, fallback: T): T {
    const raw = storage.getRaw(key);
    if (raw == null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  },
  set<T>(key: string, value: T) {
    storage.setRaw(key, JSON.stringify(value));
  },
};
