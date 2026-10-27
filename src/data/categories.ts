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
  /** Created by you (saved in settings), not built in. */
  custom?: boolean;
  /** Built-in only: the limit before any change you made in settings. */
  defaultLimitPct?: number;
};

/** A category you created, as saved in settings. `icon` is a key of `IC`. */
export type CustomCategory = { name: string; type: CategoryType; limitPct: number; icon: string; color: string };

export type Hue = Pick<Category, 'color' | 'tint' | 'ink'>;

export const INCOME_CATEGORY = 'Income';
/** Money moved between your own accounts: shown in Activity, never counted as spending or income. */
export const TRANSFER_CATEGORY = 'Transfer';
/** Paying a credit card bill from the bank: a transfer to the card, never spending (the purchases already were). */
export const CC_PAYMENT_CATEGORY = 'CC Payment';
/** Money moved to your brokers: the Investing pocket. Like a transfer, never spending. */
export const INVESTMENT_CATEGORY = 'Investment';
/** Money you moved to your savings account: the only thing counted as saved. Like a transfer, never spending. */
export const SAVINGS_CATEGORY = 'Savings';
/** Categories a transaction can be moved to besides the budget ones. */
export const OTHER_CATEGORIES = [TRANSFER_CATEGORY, SAVINGS_CATEGORY, INVESTMENT_CATEGORY, INCOME_CATEGORY];
/** How a non-budget category reads in menus. */
export const categoryLabel = (name: string) => (name === TRANSFER_CATEGORY ? 'Transfer (own accounts)' : name === SAVINGS_CATEGORY ? 'Transfer (savings)' : name);
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
  // Extra hues for categories you add (the first nine are taken by the built-in ones).
  { color: '#5560d0', tint: '#ebedfb', ink: '#3a43a0' }, // indigo
  { color: '#8a9a1f', tint: '#f2f5df', ink: '#566210' }, // olive
  { color: '#a0703c', tint: '#f6ede3', ink: '#6e4a22' }, // brown
  { color: '#b04fb8', tint: '#f7e9f8', ink: '#7d2f85' }, // magenta
  { color: '#5a7389', tint: '#e9eef2', ink: '#3b4f61' }, // slate
  { color: '#c9a227', tint: '#fbf5dd', ink: '#725b0c' }, // gold
];

export const nextHue = (cats: Hue[]): Hue => HUES.find(h => !cats.some(c => c.color === h.color)) ?? HUES[cats.length % HUES.length];

/** Icons you can pick for a new category (keys of `IC`). */
export const CATEGORY_ICONS = [
  'home', 'zap', 'shield', 'repeat', 'basket', 'utensils', 'coffee', 'nav', 'car', 'plane', 'bag', 'shirt', 'gift', 'heart', 'pill',
  'dumbbell', 'book', 'graduation', 'film', 'music', 'gamepad', 'phone', 'wrench', 'card', 'coins', 'wallet', 'piggy', 'calendar',
] as const;

const BUILT_IN: Category[] = [
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

/**
 * Built-in categories (with your limit and colour changes) followed by yours.
 * Reassigned by `applyCategorySettings`; imports see the new list.
 */
export let CATEGORIES: Category[] = BUILT_IN;

/**
 * Built-in categories are the ones Gmail import assigns automatically (Parse.js CATEGORY_RULES, Buffer as the
 * fallback), so their name and icon can't change and they can't be deleted. Their limit and colour can.
 */
export const isBuiltIn = (name: string) => BUILT_IN.some(c => c.name === name);
export const builtInCategory = (name: string) => BUILT_IN.find(c => c.name === name);

export function toCategory(c: CustomCategory): Category {
  const hue = HUES.find(h => h.color === c.color) ?? HUES[8];
  return { name: c.name, type: c.type, limitPct: c.limitPct, ...hue, icon: IC[c.icon as keyof typeof IC] ?? IC.wallet, custom: true };
}

/** Your changes to built-in categories, as saved in settings. */
export type BuiltInOverrides = { limitOverrides?: Record<string, number>; colorOverrides?: Record<string, string> };

/** Called whenever settings load or change (see SettingsProvider). */
export function applyCategorySettings(custom: CustomCategory[] = [], { limitOverrides = {}, colorOverrides = {} }: BuiltInOverrides = {}) {
  const builtIn = BUILT_IN.map(c => {
    const hue = HUES.find(h => h.color === colorOverrides[c.name]);
    return { ...c, ...(hue ?? {}), limitPct: limitOverrides[c.name] ?? c.limitPct, defaultLimitPct: c.limitPct };
  });
  CATEGORIES = [...builtIn, ...custom.map(toCategory)];
}

/** Names a new category can't take. */
export const isReservedName = (n: string) => [...CATEGORIES.map(c => c.name), ...OTHER_CATEGORIES, CC_PAYMENT_CATEGORY].some(x => x.toLowerCase() === n.trim().toLowerCase());

export const categoryByName = (n: string) => CATEGORIES.find(c => c.name === n);
