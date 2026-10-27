import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { fmtFull, fmtShort, type Currency } from './format';
import { useData } from './data';
import { applyCategorySettings, type CustomCategory } from '../data/categories';

export type Settings = {
  income: number;
  currency: Currency;
  /** Warn when a variable category reaches this % of its limit (60–95). */
  warnAt: number;
  /** Share of income moved to brokers each payday. */
  investPct: number;
  idxCap: number;
  usCap: number;
  cryptoCap: number;
  /** Rupiah per US dollar, used to convert US / crypto holdings. */
  fxRate: number;
  /** Categories you added, after the built-in ones. */
  customCategories: CustomCategory[];
  /** Your monthly limits for built-in categories (% of income), by name. */
  limitOverrides: Record<string, number>;
  /** Your colours for built-in categories, by name. */
  colorOverrides: Record<string, string>;
};

export const DEFAULT_INCOME: Record<Currency, number> = { IDR: 30_000_000, USD: 6_500 };

export const DEFAULT_SETTINGS: Settings = {
  income: DEFAULT_INCOME.IDR,
  currency: 'IDR',
  warnAt: 80,
  investPct: 20,
  idxCap: 60,
  usCap: 35,
  cryptoCap: 15,
  fxRate: 16_400,
  customCategories: [],
  limitOverrides: {},
  colorOverrides: {},
};

type Ctx = {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  /** Money in the display currency → full / short label. */
  full: (v: number, signed?: boolean) => string;
  short: (v: number, signed?: boolean) => string;
  /** % of monthly income → money. */
  ofIncome: (pct: number) => number;
};

const SettingsCtx = createContext<Ctx | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { settings: stored, saveSettings } = useData();
  const settings = useMemo(() => {
    const merged = { ...DEFAULT_SETTINGS, ...stored };
    // Before children render, so every screen sees the same category list.
    applyCategorySettings(merged.customCategories, merged);
    return merged;
  }, [stored]);
  const value = useMemo<Ctx>(
    () => ({
      settings,
      update: patch => saveSettings({ ...settings, ...patch }),
      full: (v, s) => fmtFull(v, settings.currency, s),
      short: (v, s) => fmtShort(v, settings.currency, s),
      ofIncome: pct => (pct / 100) * settings.income,
    }),
    [settings, saveSettings],
  );
  return <SettingsCtx.Provider value={value}>{children}</SettingsCtx.Provider>;
}

export function useSettings(): Ctx {
  const c = useContext(SettingsCtx);
  if (!c) throw new Error('useSettings outside SettingsProvider');
  return c;
}
