import { useState } from 'react';
import s from '../styles/ui.module.css';
import { IconChip, Modal, Options } from './ui';
import { CATEGORIES, toCategory } from '../data/categories';
import { sum } from '../lib/format';
import { DEFAULT_INCOME, useSettings, type Settings } from '../lib/settings';
import type { Currency } from '../lib/format';

type NumKey = 'income' | 'savingsPct' | 'investPct' | 'idxCap' | 'usCap' | 'cryptoCap' | 'fxRate';

export function SettingsDialog({ onClose, email, onEditCategory }: { onClose: () => void; email: string | null; onEditCategory: (name: string) => void }) {
  const { settings, update, full } = useSettings();
  const [d, setD] = useState<Settings>(settings);
  const [txt, setTxt] = useState<Record<NumKey, string>>(() => ({
    income: String(settings.income),
    savingsPct: String(settings.savingsPct),
    investPct: String(settings.investPct),
    idxCap: String(settings.idxCap),
    usCap: String(settings.usCap),
    cryptoCap: String(settings.cryptoCap),
    fxRate: String(settings.fxRate),
  }));
  const [err, setErr] = useState('');

  const setCurrency = (c: Currency) => {
    setD(p => ({ ...p, currency: c }));
    // Switching currency with the other currency's default income swaps to this one's default.
    if (Number(txt.income) === DEFAULT_INCOME[c === 'IDR' ? 'USD' : 'IDR']) setTxt(t => ({ ...t, income: String(DEFAULT_INCOME[c]) }));
  };

  const save = () => {
    const n = (k: NumKey) => Number(txt[k].replace(/[^\d.]/g, ''));
    const next: Settings = { ...d, income: n('income'), savingsPct: n('savingsPct'), investPct: n('investPct'), idxCap: n('idxCap'), usCap: n('usCap'), cryptoCap: n('cryptoCap'), fxRate: n('fxRate') };
    if (!(next.income > 0)) return setErr('Enter your monthly income.');
    if (!(next.fxRate > 0)) return setErr('Enter the USD exchange rate.');
    if ([next.savingsPct, next.investPct, next.idxCap, next.usCap, next.cryptoCap].some(v => !(v >= 0 && v <= 100))) return setErr('Percentages must be between 0 and 100.');
    // Categories are edited in their own dialog; don't write back this dialog's (possibly stale) copies.
    const { customCategories: _c, limitOverrides: _l, colorOverrides: _o, ...rest } = next;
    update(rest);
    onClose();
  };

  const num = (k: NumKey, label: string, suffix?: string) => (
    <label className={s.field}>
      <span>
        {label}
        {suffix && <span style={{ fontWeight: 500 }}> ({suffix})</span>}
      </span>
      <input
        className={s.input}
        inputMode="decimal"
        value={txt[k]}
        onChange={e => {
          setTxt(t => ({ ...t, [k]: e.target.value }));
          setErr('');
        }}
      />
    </label>
  );

  return (
    <Modal title="Settings" onClose={onClose} width={560}>
      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
        {email ? `Signed in as ${email}` : 'Local preview'} · saved to your Google Drive spreadsheet
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className={s.label}>Currency</span>
        <Options label="Currency" items={['IDR', 'USD'] as const} value={d.currency} onChange={setCurrency} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        {num('income', 'Monthly income', d.currency)}
        {num('savingsPct', 'Savings target', '% of income')}
        {num('investPct', 'Invest each payday', '% of income')}
      </div>
      {(() => {
        // Category limits are your spending budget; with the savings target they must fit in your income.
        const budgetPct = Math.round(sum(CATEGORIES.map(c => c.limitPct)));
        const savePct = Number(txt.savingsPct.replace(/[^\d.]/g, '')) || 0;
        const total = budgetPct + savePct;
        return (
          <span style={{ fontSize: 13, fontWeight: total > 100 ? 700 : 500, color: total > 100 ? 'var(--amber-ink)' : 'var(--text-muted)' }}>
            Category limits {budgetPct}% + savings {savePct}% = {total}% of income
            {total > 100 ? ' · over 100%: lower the savings target or a category limit.' : total < 100 ? ` · ${100 - total}% unplanned` : ' ✓'}
          </span>
        );
      })()}
      <label className={s.field}>
        <span>
          Warn when a category reaches <strong style={{ color: 'var(--text)' }}>{d.warnAt}%</strong> of its limit
        </span>
        <input
          type="range"
          min={60}
          max={95}
          step={5}
          value={d.warnAt}
          onChange={e => setD(p => ({ ...p, warnAt: Number(e.target.value) }))}
          style={{ accentColor: 'var(--accent-600)', minHeight: 32 }}
        />
      </label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className={s.label}>Portfolio caps</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }}>
          {num('idxCap', 'IDX', '%')}
          {num('usCap', 'US', '%')}
          {num('cryptoCap', 'Crypto', '%')}
        </div>
      </div>
      {num('fxRate', 'USD exchange rate', 'Rp per $1')}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className={s.label}>Your categories</span>
        {settings.customCategories.length === 0 ? (
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>None yet. Add one from a transaction's category menu.</span>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {settings.customCategories.map(cc => {
              const c = toCategory(cc);
              return (
                <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderTop: '1px solid var(--divider)' }}>
                  <IconChip d={c.icon} bg={c.tint} ink={c.ink} size={32} iconSize={15} />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2, marginRight: 'auto', minWidth: 0 }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{c.name}</span>
                    <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                      {c.type === 'fixed' ? 'Fixed bill' : 'Variable'} · {c.limitPct}% of income ({full((c.limitPct / 100) * settings.income)})
                    </span>
                  </span>
                  <button type="button" className={s.linkBtn} onClick={() => onEditCategory(c.name)}>
                    Edit
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {err && <span className={s.error}>{err}</span>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className={s.btnPrimary} onClick={save}>
          Save settings
        </button>
        <button type="button" className={s.btnGhost} onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
