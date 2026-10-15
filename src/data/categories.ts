import { IC } from '../components/Icon';

export type CategoryType = 'fixed' | 'variable';

export type Category = {
  name: string;
  type: CategoryType;
  /** Limit as % of monthly income. */
  limitPct: number;
  /** Bars, donut, legend dots, dropdown outline. */
  color: string;
  /** Icon chip and dropdown background. */
  tint: string;
  /** Icon and dropdown text on `tint` (≥ 4.5:1). */
  ink: string;
  icon: string;
};

export type Hue = Pick<Category, 'color' | 'tint' | 'ink'>;

export const INCOME_CATEGORY = 'Income';
/** Money moved between your own accounts: shown in Activity, never counted as spending or income. */
export const TRANSFER_CATEGORY = 'Transfer';
/** Paying a credit card bill from the bank: a transfer to the card, never spending (the purchases already were). */
export const CC_PAYMENT_CATEGORY = 'CC Payment';
/** Categories a transaction can be moved to besides the budget ones. */
export const OTHER_CATEGORIES = [TRANSFER_CATEGORY, INCOME_CATEGORY];
export const SAVINGS_TARGET_PCT = 60;

/** One hue per category, in order; a new category takes the first hue no category uses yet. */
export const HUES: Hue[] = [
  { color: '#0b7a6a', tint: '#e3f6f2', ink: '#0b5c50' }, // teal
  { color: '#e59a1a', tint: '#fff4de', ink: '#8a5a06' }, // amber
  { color: '#3b74c4', tint: '#e7effa', ink: '#24508f' }, // blue
  { color: '#7b5cc4', tint: '#efeafa', ink: '#553a9a' }, // violet
  { color: '#4a9a3a', tint: '#eaf5e5', ink: '#2f6b23' }, // green
  { color: '#d9643a', tint: '#fdece4', ink: '#9a3d1c' }, // coral
  { color: '#1f97b8', tint: '#e2f3f8', ink: '#0f6680' }, // cyan
  { color: '#c4507e', tint: '#fbe9f0', ink: '#8f2f56' }, // pink
  { color: '#7d8a87', tint: '#eef1f0', ink: '#46524f' }, // grey
];

export const nextHue = (cats: Hue[]): Hue => HUES.find(h => !cats.some(c => c.color === h.color)) ?? HUES[cats.length % HUES.length];

export const CATEGORIES: Category[] = [
  { name: 'Housing', type: 'fixed', limitPct: 14, ...HUES[0], icon: IC.home },
  { name: 'Utilities', type: 'fixed', limitPct: 3, ...HUES[1], icon: IC.zap },
  { name: 'Insurance', type: 'fixed', limitPct: 2, ...HUES[2], icon: IC.shield },
  { name: 'Subscriptions', type: 'fixed', limitPct: 1, ...HUES[3], icon: IC.repeat },
  { name: 'Groceries', type: 'variable', limitPct: 7, ...HUES[4], icon: IC.basket },
  { name: 'Dining', type: 'variable', limitPct: 4, ...HUES[5], icon: IC.utensils },
  { name: 'Transport', type: 'variable', limitPct: 4, ...HUES[6], icon: IC.nav },
  { name: 'Shopping', type: 'variable', limitPct: 3, ...HUES[7], icon: IC.bag },
  { name: 'Buffer', type: 'variable', limitPct: 2, ...HUES[8], icon: IC.wallet },
];

export const categoryByName = (n: string) => CATEGORIES.find(c => c.name === n);
