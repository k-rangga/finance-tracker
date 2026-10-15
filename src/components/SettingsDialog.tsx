import { useState } from 'react';
import s from '../styles/ui.module.css';
import { Modal, Options } from './ui';
import { DEFAULT_INCOME, useSettings, type Settings } from '../lib/settings';
import type { Currency } from '../lib/format';

type NumKey = 'income' | 'investPct' | 'idxCap' | 'usCap' | 'cryptoCap' | 'fxRate';

export function SettingsDialog({ onClose, email }: { onClose: () => void; email: string | null }) {
  const { settings, update } = useSettings();
  const [d, setD] = useState<Settings>(settings);
  const [txt, setTxt] = useState<Record<NumKey, string>>(() => ({
    income: String(settings.income),
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
    const next: Settings = { ...d, income: n('income'), investPct: n('investPct'), idxCap: n('idxCap'), usCap: n('usCap'), cryptoCap: n('cryptoCap'), fxRate: n('fxRate') };
    if (!(next.income > 0)) return setErr('Enter your monthly income.');
    if (!(next.fxRate > 0)) return setErr('Enter the USD exchange rate.');
    if ([next.investPct, next.idxCap, next.usCap, next.cryptoCap].some(v => !(v >= 0 && v <= 100))) return setErr('Percentages must be between 0 and 100.');
    update(next);
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
        Signed in as {email ?? 'your account'} · settings are saved to your account
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className={s.label}>Currency</span>
        <Options label="Currency" items={['IDR', 'USD'] as const} value={d.currency} onChange={setCurrency} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        {num('income', 'Monthly income', d.currency)}
        {num('investPct', 'Invest each payday', '% of income')}
      </div>
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
