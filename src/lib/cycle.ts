import { addDays, diffDays } from './format';

/** Payday is the 25th; a Saturday 25th moves to the 24th, a Sunday 25th to the 23rd. */
export function payday(y: number, m: number): Date {
  const d = new Date(y, m, 25);
  const w = d.getDay();
  if (w === 6) d.setDate(24);
  if (w === 0) d.setDate(23);
  return d;
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
