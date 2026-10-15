import { useState } from 'react';
import s from '../styles/ui.module.css';
import { IconChip, Modal, Options } from './ui';
import { IC, Icon } from './Icon';
import { CATEGORIES, CATEGORY_ICONS, HUES, isReservedName, nextHue, toCategory, type CategoryType, type CustomCategory } from '../data/categories';
import { useSettings } from '../lib/settings';
import { C } from '../lib/tokens';

/** Create a category: name, fixed or variable, monthly limit, icon and colour. Saved in settings. */
export function NewCategoryDialog({ initialName = '', onClose, onCreated }: { initialName?: string; onClose: () => void; onCreated: (name: string) => void }) {
  const { settings, update, full } = useSettings();
  const [name, setName] = useState(initialName.trim());
  const [type, setType] = useState<CategoryType>('variable');
  const [pct, setPct] = useState('2');
  const [icon, setIcon] = useState<string>('wallet');
  const [color, setColor] = useState(nextHue(CATEGORIES).color);
  const [err, setErr] = useState('');

  const limitPct = Number(pct.replace(',', '.'));
  const draft: CustomCategory = { name: name.trim() || 'New category', type, limitPct, icon, color };
  const preview = toCategory(draft);
  const used = new Set(CATEGORIES.map(c => c.color));

  const save = () => {
    const n = name.trim();
    if (!n) return setErr('Give the category a name.');
    if (isReservedName(n)) return setErr(`There's already a category called ${n}.`);
    if (!(limitPct >= 0 && limitPct <= 100)) return setErr('The limit must be between 0 and 100% of income.');
    update({ customCategories: [...settings.customCategories, { ...draft, name: n }] });
    onCreated(n);
  };

  return (
    <Modal title="New category" onClose={onClose} width={520}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <IconChip d={preview.icon} bg={preview.tint} ink={preview.ink} size={44} iconSize={20} />
        <span className={s.catPill} style={{ background: preview.tint, color: preview.ink, borderColor: preview.color }}>
          ● {draft.name}
        </span>
      </div>
      <label className={s.field}>
        <span>Name</span>
        <input
          className={s.input}
          autoFocus
          value={name}
          maxLength={30}
          placeholder="e.g. Health, Travel, Gifts"
          onChange={e => {
            setName(e.target.value);
            setErr('');
          }}
          onKeyDown={e => e.key === 'Enter' && save()}
        />
      </label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className={s.label}>Type</span>
        <Options label="Type" items={['variable', 'fixed'] as const} value={type} onChange={setType} render={v => (v === 'fixed' ? 'Fixed bill' : 'Variable')} />
      </div>
      <label className={s.field}>
        <span>
          Monthly limit <span style={{ fontWeight: 500 }}>(% of income)</span>
        </span>
        <input
          className={s.input}
          inputMode="decimal"
          value={pct}
          onChange={e => {
            setPct(e.target.value);
            setErr('');
          }}
        />
        <span style={{ fontWeight: 500 }}>{Number.isFinite(limitPct) ? `${full((limitPct / 100) * settings.income)} a month · adds to your spending budget` : ''}</span>
      </label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className={s.label}>Icon</span>
        <div className={s.iconGrid} role="radiogroup" aria-label="Icon">
          {CATEGORY_ICONS.map(k => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={icon === k}
              aria-label={k}
              title={k}
              className={s.iconOpt}
              onClick={() => setIcon(k)}
              style={icon === k ? { background: preview.tint, color: preview.ink, borderColor: preview.color } : undefined}
            >
              <Icon d={IC[k]} size={18} />
            </button>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className={s.label}>Colour</span>
        <div className={s.swatches} role="radiogroup" aria-label="Colour">
          {HUES.map(h => (
            <button
              key={h.color}
              type="button"
              role="radio"
              aria-checked={color === h.color}
              aria-label={h.color + (used.has(h.color) ? ' (used by another category)' : '')}
              title={used.has(h.color) ? 'Used by another category' : undefined}
              className={s.swatch}
              onClick={() => setColor(h.color)}
              style={{ background: h.color, boxShadow: color === h.color ? `0 0 0 2px #fff, 0 0 0 4px ${h.color}` : undefined, opacity: used.has(h.color) && color !== h.color ? 0.45 : 1 }}
            >
              {color === h.color && <Icon d="M20 6 9 17l-5-5" size={14} color="#fff" />}
            </button>
          ))}
        </div>
        <span style={{ fontSize: 12, color: C.textMuted }}>Faded colours are already used. Pick an unused one to keep categories easy to tell apart.</span>
      </div>
      {err && <span className={s.error}>{err}</span>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className={s.btnPrimary} onClick={save}>
          Create category
        </button>
        <button type="button" className={s.btnGhost} onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
