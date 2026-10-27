/** Per-device UI preferences (sidebar, last tab). User data lives in Supabase — see backend.ts. */
export const KEYS = {
  nav: 'moneyTracker.nav',
  tab: 'moneyTracker.tab',
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
