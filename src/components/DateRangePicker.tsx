import { useEffect, useRef, useState } from 'react';
import s from '../styles/ui.module.css';
import { IC, Icon } from './Icon';
import { addDays, parseISO, toISO } from '../lib/format';

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const monthTitle = (d: Date) => d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
const firstOfMonth = (d: Date, add = 0) => new Date(d.getFullYear(), d.getMonth() + add, 1);
/** Monday of `d`'s calendar week, matching "This week" on Transactions. */
const monday = (d: Date) => addDays(d, -((d.getDay() + 6) % 7));

type Props = {
  /** Picked range, YYYY-MM-DD inclusive. */
  from: string;
  to: string;
  /** Earliest and latest days that can be picked. */
  min: string;
  max: string;
  /** Payday that opened the current cycle, for the "This cycle" quick range. */
  cycleStart: string;
  onChange: (from: string, to: string) => void;
  onClose: () => void;
};

/** Two-month range calendar: click a start day, then an end day. Quick ranges underneath. */
export function DateRangePicker({ from, to, min, max, cycleStart, onChange, onClose }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const today = parseISO(max);
  // The right-hand month; the left one is the month before (hidden on phones).
  const [view, setView] = useState(() => firstOfMonth(parseISO(to)));
  /** The start day while waiting for the end day. */
  const [start, setStart] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const maxMonth = firstOfMonth(today);
  const minMonth = firstOfMonth(parseISO(min));

  useEffect(() => {
    const onDown = (e: MouseEvent) => !box.current?.parentElement?.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const pick = (a: string, b: string) => {
    onChange(a < b ? a : b, a < b ? b : a);
    onClose();
  };
  const click = (iso: string) => {
    if (!start) return setStart(iso);
    pick(start, iso);
  };
  // While picking, shade from the start day to the hovered day.
  const [lo, hi] = start ? [start, hover ?? start].sort() : [from, to];

  const go = (months: number) => {
    const next = firstOfMonth(view, months);
    setView(next > maxMonth ? maxMonth : next < minMonth ? minMonth : next);
  };
  // Phones show only the right-hand month, so it may go back to the first synced month.
  const canBack = view > minMonth;
  const canFwd = view < maxMonth;

  const month = (first: Date, side: 'prev' | 'cur') => {
    const lead = (first.getDay() + 6) % 7;
    const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const cells = [...Array<null>(lead).fill(null), ...Array.from({ length: days }, (_, i) => new Date(first.getFullYear(), first.getMonth(), i + 1))];
    return (
      <div className={side === 'prev' ? s.calMonthPrev : s.calMonth}>
        <div className={s.calHead}>
          <span className={s.calNav}>
            {side === 'prev' ? (
              <>
                <button type="button" aria-label="Back a year" disabled={!canBack} onClick={() => go(-12)}>
                  «
                </button>
                <button type="button" aria-label="Previous month" disabled={!canBack} onClick={() => go(-1)}>
                  <Icon d={IC.chevLeft} size={15} strokeWidth={2.5} />
                </button>
              </>
            ) : (
              <span className={s.calNavPhone}>
                <button type="button" aria-label="Previous month" disabled={!canBack} onClick={() => go(-1)}>
                  <Icon d={IC.chevLeft} size={15} strokeWidth={2.5} />
                </button>
              </span>
            )}
          </span>
          <strong>{monthTitle(first)}</strong>
          <span className={s.calNav}>
            {side === 'cur' && (
              <>
                <button type="button" aria-label="Next month" disabled={!canFwd} onClick={() => go(1)}>
                  <Icon d={IC.chevRight} size={15} strokeWidth={2.5} />
                </button>
                <button type="button" aria-label="Forward a year" disabled={!canFwd} onClick={() => go(12)}>
                  »
                </button>
              </>
            )}
          </span>
        </div>
        <div className={s.calGrid} role="grid" aria-label={monthTitle(first)}>
          {WEEKDAYS.map(w => (
            <span key={w} className={s.calWeekday}>
              {w}
            </span>
          ))}
          {cells.map((d, i) => {
            if (!d) return <span key={'x' + i} />;
            const iso = toISO(d);
            const off = iso < min || iso > max;
            const inRange = iso >= lo && iso <= hi;
            const end = iso === lo || iso === hi;
            const col = (lead + d.getDate() - 1) % 7;
            const cls = [s.calDay, inRange && s.calIn, inRange && (iso === lo || col === 0) && s.calInStart, inRange && (iso === hi || col === 6 || d.getDate() === days) && s.calInEnd]
              .filter(Boolean)
              .join(' ');
            return (
              <span key={iso} className={cls}>
                <button
                  type="button"
                  disabled={off}
                  className={end && !off ? s.calDayEnd : undefined}
                  aria-pressed={end}
                  aria-label={d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                  onMouseEnter={() => start && setHover(iso)}
                  onClick={() => click(iso)}
                >
                  {d.getDate()}
                </button>
              </span>
            );
          })}
        </div>
      </div>
    );
  };

  const wk = monday(today);
  const presets: [string, Date, Date][] = [
    ['Today', today, today],
    ['Yesterday', addDays(today, -1), addDays(today, -1)],
    ['This week', wk, today],
    ['Last week', addDays(wk, -7), addDays(wk, -1)],
    ['This cycle', parseISO(cycleStart), today],
    ['Last 14D', addDays(today, -13), today],
    ['Last 30D', addDays(today, -29), today],
  ];

  return (
    <div ref={box} className={s.calPop} role="dialog" aria-label="Pick a date range">
      <div className={s.calMonths}>
        {month(firstOfMonth(view, -1), 'prev')}
        {month(view, 'cur')}
      </div>
      <div className={s.calFoot}>
        <span>{start ? 'Now click an end date.' : 'Click a start date, then an end date.'}</span>
        <div className={s.calPresets}>
          {presets.map(([label, a, b]) => {
            const [pa, pb] = [toISO(a < parseISO(min) ? parseISO(min) : a), toISO(b)];
            return (
              <button key={label} type="button" className={!start && pa === from && pb === to ? s.calPresetOn : s.calPreset} onClick={() => pick(pa, pb)}>
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
