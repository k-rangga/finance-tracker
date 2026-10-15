import type { Cycle } from '../lib/cycle';
import { INCOME_CATEGORY } from './categories';

export type Transaction = {
  id: string;
  date: Date;
  time: string;
  title: string;
  /** Category as read from the Gmail receipt (before user overrides). */
  category: string;
  /** Positive number in the display currency. Income uses category `Income`. */
  amount: number;
  source: string;
};

export type Bill = { date: Date; title: string; category: string; amount: number; source: string };

// Demo receipts for the current cycle: [day offset, time, title, category, % of income, source].
// Stand-in for the Gmail import until the sync backend exists.
const DEMO_TX: [number, string, string, string, number, string][] = [
  [20, '19:30', 'Fresh Market', 'Groceries', 0.45, 'Card receipt'], [20, '18:55', 'Ride home', 'Transport', 0.12, 'Ride app email'], [20, '12:40', 'Bistro lunch', 'Dining', 0.25, 'Card receipt'],
  [19, '09:10', 'Electricity top-up', 'Utilities', 0.4, 'Utility email'], [19, '08:15', 'Coffee Corner', 'Dining', 0.08, 'E-wallet email'],
  [18, '17:20', 'Weekly groceries', 'Groceries', 0.6, 'Card receipt'], [18, '12:30', 'Gift for a friend', 'Buffer', 0.3, 'Marketplace email'], [18, '08:30', 'Ride to office', 'Transport', 0.15, 'Ride app email'],
  [17, '21:05', 'Online store order', 'Shopping', 0.5, 'Marketplace email'],
  [16, '19:40', 'Family dinner', 'Dining', 0.5, 'Card receipt'], [16, '10:15', 'Fuel', 'Transport', 0.55, 'Card receipt'],
  [15, '18:10', 'Neighbourhood grocer', 'Groceries', 0.75, 'E-wallet email'], [15, '08:40', 'Ride to office', 'Transport', 0.2, 'Ride app email'],
  [14, '20:00', 'Streaming plan', 'Subscriptions', 0.1, 'Billing email'], [14, '13:00', 'Team lunch', 'Dining', 0.37, 'Card receipt'], [14, '07:50', 'Ride to office', 'Transport', 0.58, 'Ride app email'],
  [13, '22:10', 'Online store order', 'Shopping', 0.9, 'Marketplace email'],
  [12, '18:30', 'Weekly groceries', 'Groceries', 0.8, 'Card receipt'], [12, '08:20', 'Ride to office', 'Transport', 0.5, 'Ride app email'],
  [11, '19:15', 'Dinner out', 'Dining', 0.65, 'Card receipt'], [11, '17:40', 'Pharmacy', 'Buffer', 0.3, 'Card receipt'],
  [10, '09:00', 'Water and internet', 'Utilities', 0.9, 'Utility email'],
  [9, '18:05', 'Fresh Market', 'Groceries', 0.8, 'Card receipt'], [9, '08:35', 'Ride to office', 'Transport', 0.5, 'Ride app email'], [9, '07:00', 'News subscription', 'Subscriptions', 0.2, 'Billing email'],
  [8, '20:45', 'Home goods', 'Shopping', 0.7, 'Marketplace email'], [8, '12:50', 'Lunch with team', 'Dining', 0.45, 'Card receipt'],
  [7, '09:20', 'Electricity bill', 'Utilities', 1.2, 'Utility email'],
  [6, '19:30', 'Weekend dinner', 'Dining', 0.7, 'Card receipt'], [5, '17:45', 'Weekly groceries', 'Groceries', 1.0, 'Card receipt'],
  [4, '21:00', 'Online store order', 'Shopping', 0.4, 'Marketplace email'], [4, '08:30', 'Fuel', 'Transport', 0.5, 'Card receipt'],
  [3, '13:10', 'Bistro lunch', 'Dining', 0.5, 'Card receipt'],
  [2, '18:20', 'Neighbourhood grocer', 'Groceries', 0.9, 'E-wallet email'], [2, '09:00', 'Music and cloud plans', 'Subscriptions', 0.6, 'Billing email'], [2, '08:10', 'Ride to office', 'Transport', 0.4, 'Ride app email'],
  [1, '10:00', 'Health insurance premium', 'Insurance', 2, 'Insurer email'],
  [0, '09:05', 'Rent transfer', 'Housing', 14, 'Bank email'], [0, '06:00', 'Salary', INCOME_CATEGORY, 100, 'Payroll email'],
];

const DEMO_BILLS: [number, string, string, number, string][] = [
  [23, 'Gas bill', 'Utilities', 0.2, 'Utility email'],
  [26, 'Cloud storage', 'Subscriptions', 0.1, 'Billing email'],
];

/**
 * Transactions imported from Gmail receipts for this cycle. Returns demo data
 * scaled to the user's income; only receipts dated on or before today.
 */
export function loadCycleTransactions(cycle: Cycle, income: number): Transaction[] {
  return DEMO_TX.map(([d, time, title, category, p, source], i) => ({
    id: 't' + i,
    date: cycle.dateOf(d),
    time,
    title,
    category,
    amount: (p / 100) * income,
    source,
  })).filter(t => cycle.offsetOf(t.date) <= cycle.dayIdx);
}

/** Fixed bills expected later this cycle. */
export function loadUpcomingBills(cycle: Cycle, income: number): Bill[] {
  return DEMO_BILLS.map(([d, title, category, p, source]) => ({ date: cycle.dateOf(d), title, category, amount: (p / 100) * income, source })).filter(b => {
    const o = cycle.offsetOf(b.date);
    return o > cycle.dayIdx && o < cycle.cycleDays;
  });
}
