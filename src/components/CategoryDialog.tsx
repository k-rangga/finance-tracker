import { useState } from 'react';
import s from '../styles/ui.module.css';
import { IconChip, Modal, Options } from './ui';
import { IC, Icon } from './Icon';
import { Select } from './Select';
import {
  builtInCategory,
  CATEGORIES,
  CATEGORY_ICONS,
  categoryByName,
  categoryLabel,
  HUES,
  isReservedName,
  nextHue,
  OTHER_CATEGORIES,
  toCategory,
  type CategoryType,
  type CustomCategory,
} from '../data/categories';
import { useData } from '../lib/data';
import { useSettings } from '../lib/settings';
import { C } from '../lib/tokens';

type Props = {
  /** Name of a category to edit (built-in: limit and colour only); omit to create a new one. */
  editing?: string;
  /** Prefilled name when creating (e.g. what was typed in the category search). */
  initialName?: string;
  onClose: () => void;
  /** After create or edit, with the category's (new) name. */
  onSaved?: (name: string) => void;
};

/**
 * Create or edit a category: name, fixed or variable, monthly limit, icon and colour. Saved in settings.
 * Built-in categories are assigned by Gmail import, so only their limit and colour can change.
 */
export function CategoryDialog({ editing, initialName = '', onClose, onSaved }: Props) {
  const { settings, update, full } = useSettings();
  const { recat, txRows, setOverride, rules, setRules } = useData();
  const existing = editing ? settings.customCategories.find(c => c.name === editing) : undefined;
  const builtIn = editing ? builtInCategory(editing) : undefined;
  /** Built-in category as it is now (your limit and colour applied). */
  const current = builtIn ? categoryByName(builtIn.name) : undefined;
  const [name, setName] = useState((existing?.name ?? builtIn?.name ?? initialName).trim());
  const [type, setType] = useState<CategoryType>(existing?.type ?? builtIn?.type ?? 'variable');
  // The limit is stored as % of income; you can type either the % or the amount and the other fills in.
  const ofIncome = (p: number) => (p / 100) * settings.income;
  const fmtPct = (p: number) => String(Math.round(p * 100) / 100);
  const fmtAmt = (v: number) => (settings.currency === 'IDR' ? Math.round(v).toLocaleString('id-ID') : String(Math.round(v * 100) / 100));
  const startPct = existing?.limitPct ?? current?.limitPct ?? 2;
  const [limitPct, setLimitPct] = useState(startPct);
  const [pctText, setPctText] = useState(fmtPct(startPct));
  const [amtText, setAmtText] = useState(fmtAmt(ofIncome(startPct)));
  const setFromPct = (text: string) => {
    setPctText(text);
    const p = Number(text.replace(',', '.'));
    setLimitPct(text.trim() === '' ? NaN : p);
    if (text.trim() !== '' && Number.isFinite(p)) setAmtText(fmtAmt(ofIncome(p)));
    setErr('');
  };
  const setFromAmount = (text: string) => {
    setAmtText(text);
    const v = settings.currency === 'IDR' ? Number(text.replace(/\D/g, '')) : Number(text.replace(/[^\d.]/g, ''));
    const p = settings.income > 0 ? (v / settings.income) * 100 : NaN;
    // Keep full precision so the amount you typed is exactly the limit.
    setLimitPct(text.trim() === '' ? NaN : p);
    if (text.trim() !== '' && Number.isFinite(p)) setPctText(fmtPct(p));
    setErr('');
  };
  const resetTo = (p: number) => {
    setLimitPct(p);
    setPctText(fmtPct(p));
    setAmtText(fmtAmt(ofIncome(p)));
  };
  const [icon, setIcon] = useState<string>(existing?.icon ?? 'wallet');
  const [color, setColor] = useState(existing?.color ?? current?.color ?? nextHue(CATEGORIES).color);
  const [err, setErr] = useState('');
  const [deleting, setDeleting] = useState(false);

  const draft: CustomCategory = { name: name.trim() || 'New category', type, limitPct, icon, color };
  const preview = { ...toCategory(draft), ...(builtIn ? { icon: builtIn.icon } : {}) };
  const used = new Set(CATEGORIES.filter(c => c.name !== editing).map(c => c.color));

  /** Transactions you moved into this category (by id). Gmail never assigns your own categories, so these are all of them. */
  const usedBy = existing ? Object.keys(recat).filter(id => recat[id] === existing.name) : [];
  /** Re-point a transaction's override; the original category comes from the import (unknown for older rows, so the override is kept). */
  const move = (to: string) => usedBy.forEach(id => setOverride(id, txRows.find(r => r.id === id)?.category ?? '', to));
  /** Re-point the merchant rules for this category to `to`. */
  const moveRules = (to: string) => {
    const mine = Object.keys(rules).filter(m => rules[m].toLowerCase() === existing?.name.toLowerCase());
    if (mine.length) setRules(Object.fromEntries(mine.map(m => [m, to])));
  };

  const save = () => {
    if (builtIn) {
      if (!(limitPct >= 0 && limitPct <= 100)) return setErr('The limit must be between 0 and 100% of income.');
      // Only store what differs from the default, so defaults can still change later.
      const limits = { ...settings.limitOverrides, [builtIn.name]: limitPct };
      const colors = { ...settings.colorOverrides, [builtIn.name]: color };
      if (Math.abs(limitPct - builtIn.limitPct) < 1e-9) delete limits[builtIn.name];
      if (color === builtIn.color) delete colors[builtIn.name];
      update({ limitOverrides: limits, colorOverrides: colors });
      onSaved?.(builtIn.name);
      return onClose();
    }
    const n = name.trim();
    if (!n) return setErr('Give the category a name.');
    if (n.toLowerCase() !== existing?.name.toLowerCase() && isReservedName(n)) return setErr(`There's already a category called ${n}.`);
    if (!(limitPct >= 0 && limitPct <= 100)) return setErr('The limit must be between 0 and 100% of income.');
    const next = { ...draft, name: n };
    if (existing) {
      update({ customCategories: settings.customCategories.map(c => (c.name === existing.name ? next : c)) });
      if (n !== existing.name) {
        move(n);
        moveRules(n);
      }
    } else {
      update({ customCategories: [...settings.customCategories, next] });
    }
    onSaved?.(n);
    onClose();
  };

  if (existing && deleting)
    return (
      <DeleteCategory
        name={existing.name}
        count={usedBy.length}
        onBack={() => setDeleting(false)}
        onClose={onClose}
        onDelete={to => {
          move(to);
          moveRules(to);
          update({ customCategories: settings.customCategories.filter(c => c.name !== existing.name) });
          onClose();
        }}
      />
    );

  return (
    <Modal title={existing || builtIn ? 'Edit category' : 'New category'} onClose={onClose} width={520}>
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
          autoFocus={!builtIn}
          disabled={!!builtIn}
          value={name}
          maxLength={30}
          placeholder="e.g. Health, Travel, Gifts"
          onChange={e => {
            setName(e.target.value);
            setErr('');
          }}
          onKeyDown={e => e.key === 'Enter' && save()}
        />
        {builtIn && <span style={{ fontWeight: 500 }}>Name, type and icon are fixed: Gmail auto-categorising uses this category.</span>}
        {existing && name.trim() && name.trim() !== existing.name && usedBy.length > 0 && (
          <span style={{ fontWeight: 500 }}>
            {usedBy.length} {usedBy.length === 1 ? 'transaction moves' : 'transactions move'} to the new name.
          </span>
        )}
      </label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className={s.label}>Type</span>
        {builtIn ? (
          <span style={{ fontSize: 14, fontWeight: 600 }}>{type === 'fixed' ? 'Fixed bill' : 'Variable'}</span>
        ) : (
          <Options
            label="Type"
            items={['variable', 'fixed'] as const}
            value={type}
            onChange={setType}
            render={v => (v === 'fixed' ? 'Fixed bill' : 'Variable')}
          />
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className={s.label}>Monthly limit</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
          <label className={s.field}>
            <span style={{ fontWeight: 500 }}>% of income</span>
            <input className={s.input} autoFocus={!!builtIn} inputMode="decimal" value={pctText} onChange={e => setFromPct(e.target.value)} aria-label="Monthly limit as % of income" />
          </label>
          <label className={s.field}>
            <span style={{ fontWeight: 500 }}>Amount a month ({settings.currency})</span>
            <input className={s.input} inputMode="decimal" value={amtText} onChange={e => setFromAmount(e.target.value)} aria-label={`Monthly limit in ${settings.currency}`} />
          </label>
        </div>
        <span style={{ fontSize: 13, fontWeight: 500, color: C.textMuted }}>
          Of your {full(settings.income)} income · adds to your spending budget
          {builtIn && Math.abs(limitPct - builtIn.limitPct) > 1e-9 && (
            <>
              {' · '}
              <button type="button" className={s.textBtnSm} onClick={() => resetTo(builtIn.limitPct)} style={{ padding: 0 }}>
                Reset to {builtIn.limitPct}%
              </button>
            </>
          )}
        </span>
      </div>
      {!builtIn && (
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
      )}
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
              style={{
                background: h.color,
                boxShadow: color === h.color ? `0 0 0 2px #fff, 0 0 0 4px ${h.color}` : undefined,
                opacity: used.has(h.color) && color !== h.color ? 0.45 : 1,
              }}
            >
              {color === h.color && <Icon d="M20 6 9 17l-5-5" size={14} color="#fff" />}
            </button>
          ))}
        </div>
        <span style={{ fontSize: 13, color: C.textMuted }}>Faded colours are already used. Pick an unused one to keep categories easy to tell apart.</span>
      </div>
      {err && <span className={s.error}>{err}</span>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className={s.btnPrimary} onClick={save}>
          {existing || builtIn ? 'Save changes' : 'Create category'}
        </button>
        <button type="button" className={s.btnGhost} onClick={onClose}>
          Cancel
        </button>
        {existing && (
          <button type="button" className={s.btnGhost} onClick={() => setDeleting(true)} style={{ marginLeft: 'auto', color: C.redInk }}>
            Delete category
          </button>
        )}
      </div>
    </Modal>
  );
}

/** Confirm a delete and pick where its transactions go (Buffer by default). */
function DeleteCategory({
  name,
  count,
  onBack,
  onClose,
  onDelete,
}: {
  name: string;
  count: number;
  onBack: () => void;
  onClose: () => void;
  onDelete: (to: string) => void;
}) {
  const [to, setTo] = useState('Buffer');
  const targets = [...CATEGORIES.filter(c => c.name !== name).map(c => c.name), ...OTHER_CATEGORIES];
  return (
    <Modal title={`Delete ${name}?`} onClose={onClose} width={460}>
      {count > 0 ? (
        <>
          <span style={{ fontSize: 14, color: C.textSoft }}>
            {count} {count === 1 ? 'transaction uses' : 'transactions use'} this category. Choose where {count === 1 ? 'it goes' : 'they go'}, so your totals
            stay right.
          </span>
          <label className={s.field}>
            <span>Move {count === 1 ? 'it' : 'them'} to</span>
            <Select value={to} onChange={setTo} ariaLabel="Move to" options={targets.map(t => ({ value: t, label: categoryLabel(t) }))} />
          </label>
        </>
      ) : (
        <span style={{ fontSize: 14, color: C.textSoft }}>No transactions use this category. Its limit comes off your spending budget.</span>
      )}
      <span style={{ fontSize: 13, color: C.textMuted }}>This can't be undone, but you can create the category again.</span>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className={s.btnDanger} onClick={() => onDelete(to)}>
          {count > 0 ? `Delete and move ${count} to ${to}` : 'Delete category'}
        </button>
        <button type="button" className={s.btnGhost} onClick={onBack}>
          Back
        </button>
      </div>
    </Modal>
  );
}
