import { addDays, diffDays } from './format';

/**
 * When you're paid, as set in Settings: a day of the month (a day past the month's end means its last day), and
 * where a payday that falls on a weekend moves: back to the Friday before, on to the Monday after, or nowhere.
 */
export type PaydayRule = { day: number; weekend: 'before' | 'after' | 'same' };
export const DEFAULT_PAYDAY: PaydayRule = { day: 25, weekend: 'before' };

/** The rule in use; set from your settings (see SettingsProvider), like the savings target. */
let RULE: PaydayRule = DEFAULT_PAYDAY;
export const setPaydayRule = (r?: Partial<PaydayRule>) => {
  const day = Math.min(31, Math.max(1, Math.round(Number(r?.day) || DEFAULT_PAYDAY.day)));
  RULE = { day, weekend: r?.weekend === 'after' || r?.weekend === 'same' ? r.weekend : 'before' };
};
export const paydayRule = () => RULE;

/** Payday in month `m` of year `y` (m may run past 0–11) under `rule`. */
export function paydayFor(rule: PaydayRule, y: number, m: number): Date {
  const last = new Date(y, m + 1, 0).getDate();
  const d = new Date(y, m, Math.min(rule.day, last));
  const w = d.getDay();
  if (rule.weekend === 'before' && (w === 6 || w === 0)) d.setDate(d.getDate() - (w === 6 ? 1 : 2));
  if (rule.weekend === 'after' && (w === 6 || w === 0)) d.setDate(d.getDate() + (w === 6 ? 2 : 1));
  return d;
}

/** Payday in month `m` of year `y`, under your rule. */
export const payday = (y: number, m: number) => paydayFor(RULE, y, m);

/** The first payday after `today` under `rule` (for previewing a rule before you save it). */
export function nextPaydayFor(rule: PaydayRule, today: Date): Date {
  for (let k = 0; k < 3; k++) {
    const d = paydayFor(rule, today.getFullYear(), today.getMonth() + k);
    if (d > today) return d;
  }
  return paydayFor(rule, today.getFullYear(), today.getMonth() + 1);
}

export type Cycle = {
  today: Date;
  start: Date;
  next: Date;
  /** Last day of the cycle (day before next payday). */
  end: Date;
  cycleDays: number;
  /** 1-based day of the cycle. */
  dayN: number;
  /** 0-based offset of today from cycle start. */
  dayIdx: number;
  daysLeft: number;
  /** Week of the cycle today falls in (0–3; the 4th week runs to the end). */
  weekIdx: number;
  dateOf: (offset: number) => Date;
  offsetOf: (d: Date) => number;
};

export const weekOf = (offset: number) => Math.min(3, Math.floor(offset / 7));

export function getCycle(today: Date): Cycle {
  let start = payday(today.getFullYear(), today.getMonth());
  if (start > today) start = payday(today.getFullYear(), today.getMonth() - 1);
  const next = payday(start.getFullYear(), start.getMonth() + 1);
  const cycleDays = diffDays(start, next);
  const dayIdx = diffDays(start, today);
  return {
    today,
    start,
    next,
    end: addDays(next, -1),
    cycleDays,
    dayN: dayIdx + 1,
    dayIdx,
    daysLeft: cycleDays - dayIdx - 1,
    weekIdx: weekOf(dayIdx),
    dateOf: o => addDays(start, o),
    offsetOf: d => diffDays(start, d),
  };
}

/** The `count` paydays starting with the one that opened `start`'s cycle. */
export function paydaysFrom(start: Date, count: number): Date[] {
  return Array.from({ length: count }, (_, k) => payday(start.getFullYear(), start.getMonth() + k));
}
