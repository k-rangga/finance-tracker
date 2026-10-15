import { IC } from '../components/Icon';

export type CategoryType = 'fixed' | 'variable';

export type Category = {
  name: string;
  type: CategoryType;
  /** Limit as % of monthly income. */
  limitPct: number;
  color: string;
  icon: string;
};

export const INCOME_CATEGORY = 'Income';
/** Money moved between your own accounts: shown in Activity, never counted as spending or income. */
export const TRANSFER_CATEGORY = 'Transfer';
/** Categories a transaction can be moved to besides the budget ones. */
export const OTHER_CATEGORIES = [TRANSFER_CATEGORY, INCOME_CATEGORY];
export const SAVINGS_TARGET_PCT = 60;

export const CATEGORIES: Category[] = [
  { name: 'Housing', type: 'fixed', limitPct: 14, color: '#0b4f45', icon: IC.home },
  { name: 'Utilities', type: 'fixed', limitPct: 3, color: '#0b7a6a', icon: IC.zap },
  { name: 'Insurance', type: 'fixed', limitPct: 2, color: '#3d9a88', icon: IC.shield },
  { name: 'Subscriptions', type: 'fixed', limitPct: 1, color: '#7fb8aa', icon: IC.repeat },
  { name: 'Groceries', type: 'variable', limitPct: 7, color: '#14a08a', icon: IC.basket },
  { name: 'Dining', type: 'variable', limitPct: 4, color: '#2fc2a4', icon: IC.utensils },
  { name: 'Transport', type: 'variable', limitPct: 4, color: '#6fd9c2', icon: IC.nav },
  { name: 'Shopping', type: 'variable', limitPct: 3, color: '#b4ecdf', icon: IC.bag },
  { name: 'Buffer', type: 'variable', limitPct: 2, color: '#a6e4d6', icon: IC.wallet },
];

export const categoryByName = (n: string) => CATEGORIES.find(c => c.name === n);
