import { useState, type ReactNode } from 'react';
import s from '../styles/ui.module.css';
import { IconChip, Modal, Options } from './ui';
import { CATEGORIES, toCategory } from '../data/categories';
import { dayLabel, startOfToday, sum } from '../lib/format';
import { DEFAULT_PAYDAY, nextPaydayFor, type PaydayRule } from '../lib/cycle';
import { DEFAULT_INCOME, useSettings, type Settings } from '../lib/settings';
import type { Currency } from '../lib/format';
import { applyTheme, getTheme, type Theme } from '../lib/theme';
import { useData } from '../lib/data';
import { onVercel } from '../lib/supabase';
import { signOut } from './SignIn';

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
  /** Credit cards seen in your transactions, for their statement and due days. */
  const { txRows } = useData();
  const cardNames = [...new Set([...txRows.map(r => r.account ?? ''), ...Object.keys(settings.cards ?? {})])].filter(a => a.startsWith('CC ')).sort();
  const setCard = (name: string, key: 'statement' | 'due', text: string) => {
    const v = Math.max(0, Math.min(31, Math.round(Number(text.replace(/\D/g, '')) || 0)));
    setD(p => {
      const cards = { ...(p.cards ?? {}) };
      const cur = { ...(cards[name] ?? { statement: 0, due: 0 }), [key]: v };
      if (cur.statement || cur.due) cards[name] = cur;
      else delete cards[name];
      return { ...p, cards };
    });
  };
  // Appearance is per device and applies at once (not part of Save).
  const [theme, setTheme] = useState<Theme>(getTheme);
  const THEMES: Record<string, Theme> = { Auto: 'auto', Light: 'light', Dark: 'dark' };

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

  // Your pay cycle runs from one payday to the day before the next; everything (plans, pace, bills) follows it.
  const rule: PaydayRule = { ...DEFAULT_PAYDAY, ...d.payday };
  const setRule = (patch: Partial<PaydayRule>) => setD(p => ({ ...p, payday: { ...DEFAULT_PAYDAY, ...p.payday, ...patch } }));
  const WEEKEND: Record<string, PaydayRule['weekend']> = { 'Friday before': 'before', 'Monday after': 'after', 'Keep the date': 'same' };
  const weekendLabel = Object.keys(WEEKEND).find(k => WEEKEND[k] === rule.weekend) ?? 'Friday before';
  // Category limits are your spending budget; with the savings target they must fit in your income.
  const budgetPct = Math.round(sum(CATEGORIES.map(c => c.limitPct)));
  const savePct = Number(txt.savingsPct.replace(/[^\d.]/g, '')) || 0;
  const planned = budgetPct + savePct;

  return (
    <Modal title="Settings" onClose={onClose} width={600}>
      <Section title="You">
        <div className={s.setGrid}>
          <label className={s.field}>
            <span>Name</span>
            <input className={s.input} value={d.name} onChange={e => setD(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Rangga" maxLength={40} />
          </label>
          <label className={s.field}>
            <span>City</span>
            <input className={s.input} value={d.city ?? ''} onChange={e => setD(p => ({ ...p, city: e.target.value }))} placeholder="e.g. Jakarta Selatan" maxLength={60} />
          </label>
        </div>
        <span className={s.setHint}>Your name is for greetings. Your city lets Maxie compare your spending with local prices when it plans.</span>
        <Row label="Currency">
          <Options label="Currency" items={['IDR', 'USD'] as const} value={d.currency} onChange={setCurrency} />
        </Row>
      </Section>

      <Section title="Income and payday">
        <div className={s.setGrid}>
          {num('income', 'Monthly income', d.currency)}
          <label className={s.field}>
            <span>Payday</span>
            <select className={s.input} value={rule.day} onChange={e => setRule({ day: Number(e.target.value) })}>
              {Array.from({ length: 31 }, (_, i) => i + 1).map(n => (
                <option key={n} value={n}>
                  {n === 31 ? 'Last day of the month' : `The ${ordinal(n)}`}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Row label="On a weekend, paid">
          <Options label="On a weekend, paid" items={Object.keys(WEEKEND)} value={weekendLabel} onChange={k => setRule({ weekend: WEEKEND[k] })} />
        </Row>
        <span className={s.setHint}>Next payday {dayLabel(nextPaydayFor(rule, startOfToday()))}. Each cycle runs from one payday to the day before the next.</span>
      </Section>

      <Section title="Saving and alerts">
        <div className={s.setGrid}>
          {num('savingsPct', 'Savings target', '% of income')}
          {num('investPct', 'Invest each payday', '% of income')}
        </div>
        <span className={s.setHint} style={planned > 100 ? { color: 'var(--amber-ink)', fontWeight: 600 } : undefined}>
          Category limits {budgetPct}% and savings {savePct}% make {planned}% of income
          {planned > 100 ? '. Lower the savings target or a category limit to fit.' : planned < 100 ? `, ${100 - planned}% left unplanned.` : '.'}
        </span>
        <label className={s.field}>
          <span>
            Warn me when a category reaches <strong style={{ color: 'var(--text)' }}>{d.warnAt}%</strong> of its limit
          </span>
          <input
            type="range"
            min={60}
            max={95}
            step={5}
            value={d.warnAt}
            onChange={e => setD(p => ({ ...p, warnAt: Number(e.target.value) }))}
            style={{ accentColor: 'var(--clay)', minHeight: 32 }}
          />
        </label>
      </Section>

      <Section title="Your categories">
        {settings.customCategories.length === 0 ? (
          <span className={s.setHint}>None yet. Add one from a transaction's category menu.</span>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {settings.customCategories.map((cc, i) => {
              const c = toCategory(cc);
              return (
                <div key={c.name} className={s.setListRow} style={i === 0 ? { borderTop: 'none' } : undefined}>
                  <IconChip d={c.icon} bg={c.tint} ink={c.ink} size={32} iconSize={15} />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2, marginRight: 'auto', minWidth: 0 }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{c.name}</span>
                    <span className={s.setHint}>
                      {c.type === 'fixed' ? 'Fixed bill' : 'Everyday'}, {c.limitPct}% of income ({full((c.limitPct / 100) * settings.income)})
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
      </Section>

      {cardNames.length > 0 && (
        <Section title="Credit cards">
          <span className={s.setHint}>From your card statement. Installment payments land on the statement day, so they count in the right cycle.</span>
          {cardNames.map((name, i) => (
            <div key={name} className={s.setCardRow} style={i === 0 ? { borderTop: 'none', paddingTop: 0 } : undefined}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{name}</span>
              <label className={s.field}>
                <span>Statement day</span>
                <input className={s.input} inputMode="numeric" placeholder="e.g. 18" value={d.cards?.[name]?.statement || ''} onChange={e => setCard(name, 'statement', e.target.value)} />
              </label>
              <label className={s.field}>
                <span>Due day</span>
                <input className={s.input} inputMode="numeric" placeholder="e.g. 3" value={d.cards?.[name]?.due || ''} onChange={e => setCard(name, 'due', e.target.value)} />
              </label>
            </div>
          ))}
        </Section>
      )}

      <Section title="Investing">
        <div className={s.setGrid3}>
          {num('idxCap', 'IDX cap', '%')}
          {num('usCap', 'US cap', '%')}
          {num('cryptoCap', 'Crypto cap', '%')}
        </div>
        {num('fxRate', 'USD exchange rate', 'Rp per $1')}
      </Section>

      <Section title="Receipts">
        <label className={s.field}>
          <span>Google Drive folder link</span>
          <input
            className={s.input}
            value={d.receiptsFolder}
            onChange={e => setD(p => ({ ...p, receiptsFolder: e.target.value.trim() }))}
            placeholder="https://drive.google.com/drive/folders/…"
            inputMode="url"
          />
        </label>
        <span className={s.setHint}>Receipts you attach are saved there as 20261031_id_Merchant.jpg.</span>
      </Section>

      <Section title="Appearance">
        <Row label="On this device">
          <Options
            label="Appearance"
            items={['Auto', 'Light', 'Dark'] as const}
            value={(Object.keys(THEMES) as ('Auto' | 'Light' | 'Dark')[]).find(k => THEMES[k] === theme) ?? 'Auto'}
            onChange={k => {
              setTheme(THEMES[k]);
              applyTheme(THEMES[k]);
            }}
          />
        </Row>
      </Section>

      <Section title="Account">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2, marginRight: 'auto', minWidth: 0 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{email ?? 'Local preview'}</span>
            <span className={s.setHint}>{onVercel ? 'Saved to your account' : 'Saved to your Google Drive spreadsheet'}</span>
          </span>
          {onVercel && (
            <button type="button" className={s.btnOutlineSm} onClick={signOut}>
              Sign out
            </button>
          )}
        </div>
      </Section>

      <div className={s.setFoot}>
        {err && <span className={s.error}>{err}</span>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className={s.btnPrimary} onClick={save}>
            Save settings
          </button>
          <button type="button" className={s.btnGhost} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** One group of settings under a serif heading, divided from the one above by a line. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={s.setSection} aria-label={title}>
      <h3 className={s.setTitle}>{title}</h3>
      {children}
    </section>
  );
}

/** A label beside its control (stacks on phones). */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={s.setRow}>
      <span className={s.setRowLabel}>{label}</span>
      {children}
    </div>
  );
}

/** 1 → "1st", 22 → "22nd". */
const ordinal = (n: number) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
