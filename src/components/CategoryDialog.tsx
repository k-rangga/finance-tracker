import { useState } from 'react';
import s from '../styles/ui.module.css';
import { Checkbox, IconChip, Modal, Options } from './ui';
import { IC, Icon } from './Icon';
import { Select } from './Select';
import {
  builtInCategory,
  CATEGORIES,
  CATEGORY_ICONS,
  CATEGORY_TEMPLATES,
  categoryByName,
  categoryLabel,
  HUES,
  HUE_NAMES,
  hueOf,
  isReservedName,
  nextHue,
  OTHER_CATEGORIES,
  toCategory,
  type CategoryTemplate,
  type CategoryType,
  type CustomCategory,
} from '../data/categories';
import { useData } from '../lib/data';
import { merchantKey } from '../data/transactions';
import { useSettings } from '../lib/settings';
import { C } from '../lib/tokens';

/** A built-in category's starting limit for this account (0 for fixed bills on newer accounts). */
const startPctOf = (name: string) => categoryByName(name)?.defaultLimitPct ?? builtInCategory(name)?.limitPct ?? 0;

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
  const [color, setColor] = useState(hueOf(existing?.color)?.color ?? current?.color ?? nextHue(CATEGORIES).color);
  const [err, setErr] = useState('');
  const [deleting, setDeleting] = useState(false);
  /** Sub-categories: labels inside this category (they share its limit). */
  const [subs, setSubs] = useState<string[]>(() => settings.subcategories[editing ?? ''] ?? []);
  const [subText, setSubText] = useState('');
  const addSub = () => {
    const n = subText.trim().slice(0, 40);
    if (n && !subs.some(x => x.toLowerCase() === n.toLowerCase())) setSubs([...subs, n]);
    setSubText('');
  };
  /** Settings' sub-category lists with this category's saved under `name` (and dropped from its old name). */
  const withSubs = (name: string | null) => {
    const all = { ...settings.subcategories };
    if (editing) delete all[editing];
    if (name && subs.length) all[name] = subs;
    return all;
  };

  /** The template this new category started from, and whether its merchants should sort themselves here. */
  const [tpl, setTpl] = useState<CategoryTemplate | null>(null);
  const [tplMerchants, setTplMerchants] = useState(true);
  const creating = !existing && !builtIn;
  const templates = creating ? CATEGORY_TEMPLATES.filter(t => !isReservedName(t.name)) : [];
  const useTemplate = (t: CategoryTemplate) => {
    setTpl(t);
    setName(t.name);
    setType(t.type);
    setIcon(t.icon);
    setColor(nextHue(CATEGORIES).color);
    resetTo(t.limitPct);
    setSubs(t.subs);
    setErr('');
  };
  /** Template merchants that no rule of yours already covers. */
  const tplNew = tpl ? tpl.merchants.filter(m => !Object.keys(rules).some(r => merchantKey(r) === merchantKey(m))) : [];

  const draft: CustomCategory = {
    name: name.trim() || 'New category',
    type,
    limitPct,
    icon,
    color,
  };
  const preview = {
    ...toCategory(draft),
    ...(builtIn ? { icon: builtIn.icon } : {}),
  };
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
      if (Math.abs(limitPct - startPctOf(builtIn.name)) < 1e-9) delete limits[builtIn.name];
      if (color === builtIn.color) delete colors[builtIn.name];
      update({
        limitOverrides: limits,
        colorOverrides: colors,
        subcategories: withSubs(builtIn.name),
      });
      onSaved?.(builtIn.name);
      return onClose();
    }
    const n = name.trim();
    if (!n) return setErr('Give the category a name.');
    if (n.toLowerCase() !== existing?.name.toLowerCase() && isReservedName(n)) return setErr(`There's already a category called ${n}.`);
    if (!(limitPct >= 0 && limitPct <= 100)) return setErr('The limit must be between 0 and 100% of income.');
    const next = { ...draft, name: n };
    if (existing) {
      update({
        customCategories: settings.customCategories.map(c => (c.name === existing.name ? next : c)),
        subcategories: withSubs(n),
      });
      if (n !== existing.name) {
        move(n);
        moveRules(n);
      }
    } else {
      update({
        customCategories: [...settings.customCategories, next],
        subcategories: withSubs(n),
      });
      if (tpl && tplMerchants && tplNew.length) setRules(Object.fromEntries(tplNew.map(m => [m, n])));
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
          update({
            customCategories: settings.customCategories.filter(c => c.name !== existing.name),
            subcategories: withSubs(null),
          });
          onClose();
        }}
      />
    );

  return (
    <Modal title={existing || builtIn ? 'Edit category' : 'New category'} onClose={onClose} width={520}>
      {templates.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className={s.label}>Start from a template</span>
          <div className={s.tplGrid}>
            {templates.map(t => (
              <button key={t.name} type="button" className={s.tplOpt} aria-pressed={tpl?.name === t.name} onClick={() => useTemplate(t)}>
                <Icon d={IC[t.icon]} size={15} />
                {t.name}
              </button>
            ))}
          </div>
          {tpl && tpl.merchants.length > 0 && (
            <Checkbox className={s.tplMerchants} checked={tplMerchants} onChange={setTplMerchants}>
              Sort these merchants here automatically:{' '}
              <span style={{ color: C.textMuted }}>{tpl.merchants.map(m => m.replace(/\b\w/g, c => c.toUpperCase())).join(', ')}</span>
              {tplNew.length < tpl.merchants.length && <span style={{ color: C.textMuted }}> (ones you already have a rule for stay as they are)</span>}
            </Checkbox>
          )}
          <span style={{ fontSize: 13, color: C.textMuted }}>Or name your own below.</span>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <IconChip d={preview.icon} bg={preview.tint} ink={preview.ink} size={44} iconSize={20} />
        <span
          className={s.catPill}
          style={{
            background: preview.tint,
            color: preview.ink,
            borderColor: preview.color,
          }}
        >
          <span style={{ color: preview.color }} aria-hidden="true">●</span> {draft.name}
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
      {builtIn?.auto ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className={s.label}>Monthly limit</span>
          <span style={{ fontSize: 14, color: C.textSoft }}>Follows your installment plans: each cycle it's exactly the payments billed in it.</span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className={s.label}>Monthly limit</span>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: 10,
            }}
          >
            <label className={s.field}>
              <span style={{ fontWeight: 500 }}>% of income</span>
              <input
                className={s.input}
                autoFocus={!!builtIn}
                inputMode="decimal"
                value={pctText}
                onChange={e => setFromPct(e.target.value)}
                aria-label="Monthly limit as % of income"
              />
            </label>
            <label className={s.field}>
              <span style={{ fontWeight: 500 }}>Amount a month ({settings.currency})</span>
              <input
                className={s.input}
                inputMode="decimal"
                value={amtText}
                onChange={e => setFromAmount(e.target.value)}
                aria-label={`Monthly limit in ${settings.currency}`}
              />
            </label>
          </div>
          <span style={{ fontSize: 13, fontWeight: 500, color: C.textMuted }}>
            Of your {full(settings.income)} income, adds to your spending budget
            {builtIn && Math.abs(limitPct - startPctOf(builtIn.name)) > 1e-9 && (
              <>
                {', '}
                <button type="button" className={s.textBtnSm} onClick={() => resetTo(startPctOf(builtIn.name))} style={{ padding: 0 }}>
                  Reset to {startPctOf(builtIn.name)}%
                </button>
              </>
            )}
          </span>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className={s.label}>Sub-categories</span>
        {subs.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {subs.map(x => (
              <span key={x} className={s.subChip}>
                {x}
                <button type="button" aria-label={`Remove ${x}`} onClick={() => setSubs(subs.filter(y => y !== x))}>
                  <Icon d={IC.close} size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className={s.input}
            value={subText}
            maxLength={40}
            placeholder={subs.length ? 'Add another' : 'e.g. Fuel, Parking'}
            aria-label="New sub-category"
            onChange={e => setSubText(e.target.value)}
            onKeyDown={e => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              addSub();
            }}
          />
          <button type="button" className={s.btnOutline} onClick={addSub} disabled={!subText.trim()} style={{ flex: 'none' }}>
            Add
          </button>
        </div>
        <span style={{ fontSize: 13, color: C.textMuted }}>
          Labels inside this category: they share its limit. Pick one from a transaction's category menu.
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
                style={
                  icon === k
                    ? {
                        background: preview.tint,
                        color: preview.ink,
                        borderColor: preview.color,
                      }
                    : undefined
                }
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
          {HUES.map((h, hi) => (
            <button
              key={h.color}
              type="button"
              role="radio"
              aria-checked={color === h.color}
              aria-label={HUE_NAMES[hi] + (used.has(h.color) ? ' (used by another category)' : '')}
              title={used.has(h.color) ? 'Used by another category' : undefined}
              className={s.swatch}
              onClick={() => setColor(h.color)}
              style={{
                background: h.color,
                boxShadow: color === h.color ? `0 0 0 2px var(--surface), 0 0 0 4px ${h.color}` : undefined,
                opacity: used.has(h.color) && color !== h.color ? 0.45 : 1,
              }}
            >
              {color === h.color && <Icon d="M20 6 9 17l-5-5" size={14} color={h.color.replace('var(--category-', 'var(--on-category-')} />}
            </button>
          ))}
        </div>
        <span style={{ fontSize: 13, color: C.textMuted }}>Faded colours are already used. Pick an unused one to keep categories easy to tell apart.</span>
      </div>
      {err && <span className={s.error}>{err}</span>}
      <div
        style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
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
            <Select
              value={to}
              onChange={setTo}
              ariaLabel="Move to"
              options={targets.map(t => ({
                value: t,
                label: categoryLabel(t),
              }))}
            />
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
