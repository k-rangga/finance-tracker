import { IC } from '../components/Icon';

export type CategoryType = 'fixed' | 'variable';

export type Category = {
  name: string;
  type: CategoryType;
  /** Limit as % of monthly income. */
  limitPct: number;
  /** Last cycle's spend per week (W1–W4), as % of income. */
  prevPct: [number, number, number, number];
  color: string;
  icon: string;
};

export const INCOME_CATEGORY = 'Income';
export const SAVINGS_TARGET_PCT = 60;

export const CATEGORIES: Category[] = [
  { name: 'Housing', type: 'fixed', limitPct: 14, prevPct: [14, 0, 0, 0], color: '#0b4f45', icon: IC.home },
  { name: 'Utilities', type: 'fixed', limitPct: 3, prevPct: [0, 2.3, 0.3, 0.2], color: '#0b7a6a', icon: IC.zap },
  { name: 'Insurance', type: 'fixed', limitPct: 2, prevPct: [2, 0, 0, 0], color: '#3d9a88', icon: IC.shield },
  { name: 'Subscriptions', type: 'fixed', limitPct: 1, prevPct: [0.6, 0.2, 0.1, 0.1], color: '#7fb8aa', icon: IC.repeat },
  { name: 'Groceries', type: 'variable', limitPct: 7, prevPct: [2.0, 1.8, 1.7, 1.6], color: '#14a08a', icon: IC.basket },
  { name: 'Dining', type: 'variable', limitPct: 4, prevPct: [1.3, 1.0, 1.2, 0.9], color: '#2fc2a4', icon: IC.utensils },
  { name: 'Transport', type: 'variable', limitPct: 4, prevPct: [0.9, 0.8, 0.9, 0.8], color: '#6fd9c2', icon: IC.nav },
  { name: 'Shopping', type: 'variable', limitPct: 3, prevPct: [0.6, 0.7, 0.5, 0.6], color: '#b4ecdf', icon: IC.bag },
  { name: 'Buffer', type: 'variable', limitPct: 2, prevPct: [0.2, 0.3, 0.2, 0.4], color: '#a6e4d6', icon: IC.wallet },
];

export const categoryByName = (n: string) => CATEGORIES.find(c => c.name === n);
