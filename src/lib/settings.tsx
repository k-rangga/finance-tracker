import { createContext, useContext, useMemo, useRef, type ReactNode } from 'react';
import { fmtFull, fmtShort, type Currency } from './format';
import { useData } from './data';
import { setPaydayRule, type PaydayRule } from './cycle';
import { useIsPhone } from './media';
import type { TrackedInstallment } from './installments';
import { applyCategorySettings, DEFAULT_SUBCATEGORIES, setSavingsTarget, type CustomCategory } from '../data/categories';
import { currentCycleKey, type CyclePlan } from './cyclePlans';

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
  /** 'empty' for accounts started after fixed bills became opt-in: they begin at 0 until you set them. */
  fixedStart?: 'empty';
  /** Fixed bills you ticked off by hand this cycle (paid in cash, say): "cycleStartISO|Category". */
  paidBills?: string[];
  /** No-spend challenges: a category with nothing spent for 7 days from `start` (YYYY-MM-DD). */
  challenges?: { category: string; start: string }[];
  /** Share of income to keep unplanned in a cycle's plan, as a buffer (default 10). */
  bufferPct?: number;
  /** Your thumbs up / down on Maxie's answers (newest last, at most 30): sent with each question so Maxie learns what helps. */
  chatFeedback?: ChatFeedback[];
  /** Plans for particular pay cycles, by the cycle's start (YYYY-MM-DD): see lib/cyclePlans. */
  cyclePlans?: Record<string, CyclePlan>;
  /** Installments the bank bills monthly that you confirmed (see lib/installments). */
  trackedInstallments?: TrackedInstallment[];
  /** Charges you said aren't installments ("account|merchant"), so they aren't suggested again. */
  notInstallments?: string[];
  /** Where you live (e.g. "Jakarta Selatan"), so Maxie can compare your spending with local prices. */
  city?: string;
  /** When you're paid: your pay cycle runs from one payday to the day before the next. Default the 25th. */
  payday?: PaydayRule;
  /** Per credit card (account name, e.g. "CC BCA"): the day its statement closes and the day the bill is due. */
  cards: Record<string, CardDates>;
};

export type ChatFeedback = { q: string; a: string; good: boolean; at: string };

export type CardDates = { statement: number; due: number };

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
  cards: {},
};

type Ctx = {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  /** Money in the display currency: `full` always exact (Rp1.250.000). */
  full: (v: number, signed?: boolean) => string;
  /** Where space is tight in lists: exact on wider screens, compact (Rp1.3M) on phones. */
  short: (v: number, signed?: boolean) => string;
  /** Always compact (Rp1.3M): charts, tiles and Summary. */
  compact: (v: number, signed?: boolean) => string;
  /** % of monthly income → money. */
  ofIncome: (pct: number) => number;
};

const SettingsCtx = createContext<Ctx | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { settings: stored, saveSettings } = useData();
  /** Settings as of the last update, so two updates in one click (a new category, then a merchant rule) both land. */
  const latest = useRef<Settings>(DEFAULT_SETTINGS);
  // Full amounts wherever there's room; compact ones only on phone-width screens.
  const phone = useIsPhone();
  const settings = useMemo(() => {
    // `fixedStart` is set when the account had no settings yet (see backend load).
    const merged: Settings = { ...DEFAULT_SETTINGS, ...stored };
    // First: the cycle (and so which cycle plan is current) follows your payday.
    setPaydayRule(merged.payday);
    // Before children render, so every screen sees the same category list. This cycle's own plan (made as
    // "next cycle") overrides the regular amounts while it runs.
    const thisCycle = merged.cyclePlans?.[currentCycleKey()]?.limits ?? {};
    applyCategorySettings(merged.customCategories, { ...merged, limitOverrides: { ...merged.limitOverrides, ...thisCycle } });
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
      short: (v, s) => (phone ? fmtShort : fmtFull)(v, settings.currency, s),
      compact: (v, s) => fmtShort(v, settings.currency, s),
      ofIncome: pct => (pct / 100) * settings.income,
    }),
    [settings, saveSettings, phone],
  );
  return <SettingsCtx.Provider value={value}>{children}</SettingsCtx.Provider>;
}

export function useSettings(): Ctx {
  const c = useContext(SettingsCtx);
  if (!c) throw new Error('useSettings outside SettingsProvider');
  return c;
}
