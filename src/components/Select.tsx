import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import s from '../styles/ui.module.css';
import { IC, Icon } from './Icon';
import { C } from '../lib/tokens';

export type SelectOption<V extends string> = {
  value: V;
  label: string;
  /** Options with the same group are listed under that heading, in the order given. */
  group?: string;
  /** A colour dot before the label (category colours). */
  dot?: string;
};

type Props<V extends string> = {
  value: V;
  onChange: (v: V) => void;
  options: SelectOption<V>[];
  ariaLabel?: string;
  /** Shown on the button when no option matches `value`. */
  placeholder?: string;
  disabled?: boolean;
  /** Which edge of the button the list lines up with. */
  align?: 'left' | 'right';
  style?: CSSProperties;
};

/** Dropdown with a search box: type to filter, arrow keys and Enter to pick, Escape to close. */
export function Select<V extends string>({ value, onChange, options, ariaLabel, placeholder = 'Choose…', disabled, align = 'left', style }: Props<V>) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const shown = options.filter(o => !needle || o.label.toLowerCase().includes(needle) || o.group?.toLowerCase().includes(needle));
  const [active, setActive] = useState(0);
  const at = Math.min(active, shown.length - 1);
  const current = options.find(o => o.value === value);

  const show = () => {
    setQ('');
    setActive(Math.max(0, options.findIndex(o => o.value === value)));
    setOpen(true);
  };
  const pick = (o: SelectOption<V>) => {
    setOpen(false);
    if (o.value !== value) onChange(o.value);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  useEffect(() => {
    if (open) list.current?.querySelectorAll('[role=option]')[at]?.scrollIntoView({ block: 'nearest' });
  }, [open, at]);

  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (shown.length) setActive((at + (e.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (shown[at]) pick(shown[at]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div ref={box} style={{ position: 'relative', minWidth: 0, ...(style?.marginLeft != null ? { marginLeft: style.marginLeft } : {}) }}>
      <button
        type="button"
        className={s.select}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel ? `${ariaLabel}: ${current?.label ?? placeholder}` : undefined}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={e => (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') && !open && (e.preventDefault(), show())}
        style={{ display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', cursor: disabled ? 'default' : 'pointer', ...style, marginLeft: undefined }}
      >
        {current?.dot && <span aria-hidden="true" style={{ flex: 'none', width: 8, height: 8, borderRadius: '50%', background: current.dot }} />}
        <span className={s.ellipsis} style={{ color: current ? undefined : C.textMuted }}>
          {current?.label ?? placeholder}
        </span>
      </button>
      {open && (
        <div className={s.picker} style={{ width: 'max(100%, 240px)', maxWidth: 'calc(100vw - 32px)', ...(align === 'right' ? { left: 'auto', right: 0 } : {}) }}>
          <label className={s.pickSearch}>
            <Icon d={IC.search} size={15} color={C.textMuted} />
            <input
              autoFocus
              value={q}
              onChange={e => {
                setQ(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKey}
              placeholder="Search"
              aria-label={`Search ${ariaLabel ?? 'options'}`}
              role="combobox"
              aria-expanded="true"
              aria-controls={id}
              aria-activedescendant={shown[at] ? `${id}-${at}` : undefined}
            />
          </label>
          <div ref={list} id={id} role="listbox" aria-label={ariaLabel} className={s.pickList} style={{ maxHeight: 320 }}>
            {shown.length === 0 && <div style={{ padding: '8px 10px', fontSize: 14, color: C.textMuted }}>No matches.</div>}
            {shown.map((o, n) => (
              <div key={o.value}>
                {o.group && o.group !== shown[n - 1]?.group && <div className={s.menuGroup}>{o.group}</div>}
                <div
                  id={`${id}-${n}`}
                  role="option"
                  aria-selected={o.value === value}
                  className={s.pickRow + (n === at ? ' ' + s.pickRowActive : '') + (o.value === value ? ' ' + s.pickRowOn : '')}
                  onMouseEnter={() => setActive(n)}
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => pick(o)}
                >
                  {o.dot && <span aria-hidden="true" style={{ flex: 'none', width: 8, height: 8, borderRadius: '50%', background: o.dot }} />}
                  <span style={{ marginRight: 'auto', fontSize: 14, fontWeight: 600, color: C.text }}>{o.label}</span>
                  {o.value === value && <Icon d="M20 6 9 17l-5-5" size={16} color={C.accent600} />}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
