import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from 'react';
import s from '../styles/ui.module.css';
import { IC, Icon } from './Icon';
import { dayMonth, pc } from '../lib/format';

export function Card({ children, style, flush }: { children: ReactNode; style?: CSSProperties; flush?: boolean }) {
  return (
    <section className={flush ? s.cardFlush : s.card} style={style}>
      {children}
    </section>
  );
}

export function CardHead({ title, caption, small }: { title: ReactNode; caption?: ReactNode; small?: boolean }) {
  return (
    <div className={s.cardHead}>
      <h2 className={small ? s.h2Sm : s.h2}>{title}</h2>
      {caption && <span className={s.caption}>{caption}</span>}
    </div>
  );
}

/** "12 Nov · in 15 days" as a small chip; amber when it's due within 3 days. */
export function DueChip({ date, inDays }: { date: Date; inDays: number }) {
  const when = inDays <= 0 ? 'today' : inDays === 1 ? 'tomorrow' : `in ${inDays} days`;
  return (
    <span className={inDays <= 3 ? s.dueChipSoon : s.dueChip}>
      {dayMonth(date)} · {when}
    </span>
  );
}

/** Status as a small coloured dot and plain text, not a filled pill. */
export function Badge({ ink, children, style }: { ink: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <span className={s.badge} style={{ color: ink, ...style }}>
      <span className={s.badgeDot} style={{ background: ink }} aria-hidden="true" />
      {children}
    </span>
  );
}

export function Dot({ color, size = 10 }: { color: string; size?: number }) {
  return <span className={s.dot} style={{ background: color, width: size, height: size }} aria-hidden="true" />;
}

export function IconChip({ d, bg, ink, size = 38, iconSize = 17 }: { d: string; bg: string; ink: string; size?: number; iconSize?: number }) {
  return (
    <span className={s.icChip} style={{ width: size, height: size, background: bg, color: ink }} aria-hidden="true">
      <Icon d={d} size={iconSize} />
    </span>
  );
}

/** Horizontal progress bar with an optional black limit tick. */
export function Bar({ value, max, color, tick, height = 12, label }: { value: number; max: number; color: string; tick?: number; height?: number; label?: string }) {
  return (
    <div
      className={s.track}
      style={{ height }}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
    >
      <div className={s.fill} style={{ width: pc((value / max) * 100), background: color }} />
      {tick != null && <div className={s.tick} style={{ left: pc((tick / max) * 100) }} />}
    </div>
  );
}

export function Pills<K extends string>({ items, value, onChange, label }: { items: [K, string][]; value: K; onChange: (k: K) => void; label: string }) {
  return (
    <div className={s.pills} role="group" aria-label={label}>
      {items.map(([k, l]) => (
        <button key={k} type="button" className={k === value ? s.pillActive : s.pill} aria-pressed={k === value} onClick={() => onChange(k)}>
          {l}
        </button>
      ))}
    </div>
  );
}

/** Segmented option buttons used in forms. */
export function Options<T extends string | number>({
  items,
  value,
  onChange,
  round,
  label,
  render = v => String(v),
}: {
  items: readonly T[];
  value: T;
  onChange: (v: T) => void;
  round?: boolean;
  label: string;
  render?: (v: T) => string;
}) {
  return (
    <div className={s.pills} role="group" aria-label={label}>
      {items.map(o => (
        <button
          key={String(o)}
          type="button"
          aria-pressed={o === value}
          className={`${o === value ? s.optOn : s.opt} ${round ? s.optRound : ''}`}
          onClick={() => onChange(o)}
        >
          {render(o)}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, sub, ink, subInk }: { label: string; value: string; sub?: string; ink?: string; subInk?: string }) {
  return (
    <div className={s.stat}>
      <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>{label}</span>
      <span className={s.statValue} style={{ color: ink }}>
        {value}
      </span>
      {sub && <span style={{ fontSize: 13, color: subInk ?? 'var(--text-muted)' }}>{sub}</span>}
    </div>
  );
}

export function Modal({ title, onClose, children, width = 520 }: { title: string; onClose: () => void; children: ReactNode; width?: number }) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close])');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
      if (e.key === 'Tab' && ref.current) {
        const f = Array.from(ref.current.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(
          el => !el.hasAttribute('disabled'),
        );
        if (!f.length) return;
        const [a, z] = [f[0], f[f.length - 1]];
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault();
          z.focus();
        } else if (!e.shiftKey && document.activeElement === z) {
          e.preventDefault();
          a.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      prev?.focus();
    };
  }, []);

  return (
    <div className={s.overlay} onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} className={`${s.dialog} fade-in`} style={{ maxWidth: width }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h2 id={id} className={s.h2} style={{ flex: 1, minWidth: 0 }}>
            {title}
          </h2>
          <button type="button" data-close className={s.iconBtn} onClick={onClose} aria-label="Close" title="Close">
            <Icon d={IC.close} size={18} strokeWidth={2.5} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export { s as ui };

/** The small × on a predicted bill: "not a bill this cycle". */
export function DismissBill({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <button type="button" className={s.billX} onClick={onClick} aria-label={`${title} isn't due this cycle`} title="Not a bill this cycle">
      <Icon d={IC.close} size={14} strokeWidth={2.5} />
    </button>
  );
}
