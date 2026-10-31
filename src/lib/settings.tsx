import { createContext, useContext, useMemo, useRef, type ReactNode } from 'react';
import { fmtFull, fmtShort, type Currency } from './format';
import { useData } from './data';
import { applyCategorySettings, DEFAULT_SUBCATEGORIES, setSavingsTarget, type CustomCategory } from '../data/categories';

export type Settings = {
  /** What the Summary greeting calls you; empty for a greeting without a name. */
  name: string;
  income: number;
  currency: Currency;
  /** Warn when a variable category reaches this % of its limit (60–95). */
  warnAt: number;
  /** Share of income you aim to save each cycle (the savings target). */
  savingsPct: number;
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
  /** Google Drive folder (link or id) receipts are saved to. */
  receiptsFolder: string;
  /** Merchants (merchant keys) you said aren't subscriptions, so they aren't suggested again. */
  notSubscriptions: string[];
  /** Sub-categories per category (labels inside it; the limit stays on the category). */
  subcategories: Record<string, string[]>;
  /** Predicted bills you said aren't due this cycle, by `billKey`. Older cycles' keys are dropped. */
  dismissedBills: string[];
};

export const DEFAULT_INCOME: Record<Currency, number> = { IDR: 30_000_000, USD: 6_500 };

export const DEFAULT_SETTINGS: Settings = {
  name: '',
  income: DEFAULT_INCOME.IDR,
  currency: 'IDR',
  warnAt: 80,
  savingsPct: 60,
  investPct: 20,
  idxCap: 60,
  usCap: 35,
  cryptoCap: 15,
  fxRate: 16_400,
  customCategories: [],
  limitOverrides: {},
  colorOverrides: {},
  dismissedBills: [],
  subcategories: DEFAULT_SUBCATEGORIES,
  receiptsFolder: '',
  notSubscriptions: [],
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
  /** Settings as of the last update, so two updates in one click (a new category, then a merchant rule) both land. */
  const latest = useRef<Settings>(DEFAULT_SETTINGS);
  const settings = useMemo(() => {
    const merged = { ...DEFAULT_SETTINGS, ...stored };
    // Before children render, so every screen sees the same category list.
    applyCategorySettings(merged.customCategories, merged);
    setSavingsTarget(merged.savingsPct);
    latest.current = merged;
    return merged;
  }, [stored]);
  const value = useMemo<Ctx>(
    () => ({
      settings,
      update: patch => {
        latest.current = { ...latest.current, ...patch };
        saveSettings(latest.current);
      },
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
