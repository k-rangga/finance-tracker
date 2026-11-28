import { useState, type ReactNode } from 'react';
import s from '../styles/ui.module.css';
import { IconChip, Modal, Options } from './ui';
import { Select } from './Select';
import { CATEGORIES, toCategory } from '../data/categories';
import { dayLabel, ordinal, startOfToday, sum } from '../lib/format';
import { DEFAULT_PAYDAY, nextPaydayFor, type PaydayRule } from '../lib/cycle';
import { DEFAULT_INCOME, useSettings, type Settings } from '../lib/settings';
import type { Currency } from '../lib/format';
import { applyTheme, getTheme, type Theme } from '../lib/theme';
import { useData } from '../lib/data';
import { run } from '../lib/gas';
import { googleConnectUrl } from '../lib/gmail';
import { onVercel } from '../lib/supabase';
import { PIN_LENGTH, setPin, signOut } from './SignIn';

type NumKey = 'income' | 'savingsPct' | 'investPct' | 'emergencyFund' | 'giveFirstPct' | 'idxCap' | 'usCap' | 'cryptoCap' | 'fxRate';

/** Quick picks; a saved value that isn't one of them is shown too, so nothing is silently changed. */
const RUNWAY_MONTHS = [3, 6, 9, 12];
const WARN_AT = [70, 80, 90];
const withCurrent = (list: number[], cur: number) => (list.includes(cur) ? list : [...list, cur].sort((a, b) => a - b));

export function SettingsDialog({
  onClose,
  email,
  onEditCategory,
  onReplayOnboarding,
}: {
  onClose: () => void;
  email: string | null;
  onEditCategory: (name: string) => void;
  onReplayOnboarding?: () => void;
}) {
  const { settings, update, full } = useSettings();
  const [d, setD] = useState<Settings>(settings);
  const [txt, setTxt] = useState<Record<NumKey, string>>(() => ({
    income: String(settings.income),
    savingsPct: String(settings.savingsPct),
    investPct: String(settings.investPct),
    emergencyFund: String(settings.emergencyFund ?? 0),
    giveFirstPct: String(settings.giveFirstPct ?? 0),
    idxCap: String(settings.idxCap),
    usCap: String(settings.usCap),
    cryptoCap: String(settings.cryptoCap),
    fxRate: String(settings.fxRate),
  }));
  const [err, setErr] = useState('');
  /** Less-used settings (charity, alerts, investing caps, exchange rate) stay folded away until asked for. */
  const [advanced, setAdvanced] = useState(false);
  /** Sign-in PIN (Vercel only): saved on its own, straight away, not with Save settings. */
  const [pinDraft, setPinDraft] = useState('');
  const [pinMsg, setPinMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pinBusy, setPinBusy] = useState(false);
  const savePin = async () => {
    setPinBusy(true);
    const problem = await setPin(pinDraft);
    setPinBusy(false);
    setPinMsg(problem ? { ok: false, text: problem } : { ok: true, text: 'PIN saved. Next time, choose Email + PIN to sign in.' });
    if (!problem) setPinDraft('');
  };
  /** Credit cards seen in your transactions, for their statement and due days. */
  const { txRows, gmail } = useData();
  const [driveBusy, setDriveBusy] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [delTxt, setDelTxt] = useState('');
  const [delBusy, setDelBusy] = useState(false);
  const [delErr, setDelErr] = useState('');

  const deactivate = async () => {
    setDelBusy(true);
    setDelErr('');
    try {
      await run('deactivateAccount');
      try {
        Object.keys(localStorage)
          .filter(k => k.startsWith('maxie.'))
          .forEach(k => localStorage.removeItem(k));
      } catch {
        /* ignore */
      }
      await signOut();
    } catch (e) {
      setDelErr(e instanceof Error ? e.message : String(e));
      setDelBusy(false);
    }
  };
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
  // Appearance previews live, but like everything else it only sticks when you press Save.
  const [startTheme] = useState<Theme>(getTheme);
  const [theme, setTheme] = useState<Theme>(startTheme);
  const THEMES: Record<string, Theme> = { Auto: 'auto', Light: 'light', Dark: 'dark' };
  const close = () => {
    if (theme !== startTheme) applyTheme(startTheme);
    onClose();
  };

  const setCurrency = (c: Currency) => {
    setD(p => ({ ...p, currency: c }));
    // Switching currency with the other currency's default income swaps to this one's default.
    if (Number(txt.income) === DEFAULT_INCOME[c === 'IDR' ? 'USD' : 'IDR']) setTxt(t => ({ ...t, income: String(DEFAULT_INCOME[c]) }));
  };

  const n = (k: NumKey) => Number(txt[k].replace(/[^\d.]/g, '')) || 0;

  const save = () => {
    const next: Settings = {
      ...d,
      income: n('income'),
      savingsPct: n('savingsPct'),
      investPct: n('investPct'),
      emergencyFund: Math.max(0, n('emergencyFund')),
      emergencyTargetMonths: Math.max(1, Math.min(24, Math.round(d.emergencyTargetMonths ?? 6))),
      giveFirstPct: Math.max(0, Math.min(50, n('giveFirstPct'))),
      idxCap: n('idxCap'),
      usCap: n('usCap'),
      cryptoCap: n('cryptoCap'),
      fxRate: n('fxRate'),
    };
    if (!(next.income > 0)) return setErr('Enter your monthly income.');
    if ([next.savingsPct, next.investPct].some(v => !(v >= 0 && v <= 100))) return setErr('Percentages must be between 0 and 100.');
    // The rest live under "More settings": open it so the field with the problem is on screen.
    if (!(next.fxRate > 0)) {
      setAdvanced(true);
      return setErr('Enter the USD exchange rate.');
    }
    if ([next.idxCap, next.usCap, next.cryptoCap].some(v => !(v >= 0 && v <= 100))) {
      setAdvanced(true);
      return setErr('Investing caps must be between 0 and 100.');
    }
    // Categories are edited in their own dialog; don't write back this dialog's (possibly stale) copies.
    const { customCategories: _c, limitOverrides: _l, colorOverrides: _o, ...rest } = next;
    update(rest);
    applyTheme(theme);
    onClose();
  };

  /** A number field; `note` is a live line under it, such as what a percentage comes to in money. */
  const num = (k: NumKey, label: string, suffix?: string, note?: string) => (
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
      {note && <span className={s.setFieldNote}>{note}</span>}
    </label>
  );

  // Your pay cycle runs from one payday to the day before the next; everything (plans, pace, bills) follows it.
  const rule: PaydayRule = { ...DEFAULT_PAYDAY, ...d.payday };
  const setRule = (patch: Partial<PaydayRule>) => setD(p => ({ ...p, payday: { ...DEFAULT_PAYDAY, ...p.payday, ...patch } }));
  const WEEKEND: Record<string, PaydayRule['weekend']> = { 'Friday before': 'before', 'Monday after': 'after', 'Keep the date': 'same' };
  const weekendLabel = Object.keys(WEEKEND).find(k => WEEKEND[k] === rule.weekend) ?? 'Friday before';

  // How income splits: category limits are the spending budget, savings (investing included) comes off the top.
  const income = n('income');
  const ofIncome = (pct: number) => full(Math.round((income * pct) / 100));
  const spendPct = Math.round(sum(CATEGORIES.map(c => c.limitPct)));
  const savePct = n('savingsPct');
  const investPct = Math.min(n('investPct'), savePct);
  const planned = spendPct + savePct;
  const leftPct = Math.max(0, 100 - planned);
  const scale = Math.max(100, planned); // when over 100%, the bar shrinks to fit instead of overflowing
  const segs = [
    { label: 'Spending limits', pct: spendPct, color: 'var(--clay)' },
    { label: 'Savings', pct: savePct, color: 'var(--good)' },
    { label: 'Unplanned', pct: leftPct, color: 'var(--border-strong)' },
  ];

  // Safety net: how many months of planned spending the emergency fund covers.
  const monthlySpend = (income * spendPct) / 100;
  const covered = monthlySpend > 0 ? n('emergencyFund') / monthlySpend : 0;
  const runway = d.emergencyTargetMonths ?? 6;

  return (
    <Modal title="Settings" onClose={close} width={600}>
      <Section title="Profile">
        <div className={s.setGrid}>
          <label className={s.field}>
            <span>Name</span>
            <input className={s.input} value={d.name} onChange={e => setD(p => ({ ...p, name: e.target.value }))} placeholder="e.g. John Doe" maxLength={40} />
          </label>
          <label className={s.field}>
            <span>City</span>
            <input className={s.input} value={d.city ?? ''} onChange={e => setD(p => ({ ...p, city: e.target.value }))} placeholder="e.g. Jakarta Selatan" maxLength={60} />
          </label>
        </div>
        <Row label="Maxie speaks">
          <Options
            label="Maxie speaks"
            items={['English', 'Bahasa Indonesia'] as const}
            value={d.maxieLanguage === 'id' ? 'Bahasa Indonesia' : 'English'}
            onChange={v => setD(p => ({ ...p, maxieLanguage: v === 'Bahasa Indonesia' ? 'id' : 'en' }))}
          />
        </Row>
        <span className={s.setHint}>For greetings and plan checks. In chat, Maxie replies in whichever language you write in.</span>
        <Row label="Currency">
          <Options label="Currency" items={['IDR', 'USD'] as const} value={d.currency} onChange={setCurrency} />
        </Row>
      </Section>

      <Section title="Money plan">
        <div className={s.setPlan} aria-label="How your income is planned">
          <div className={s.setPlanBar}>
            {segs.map(g => g.pct > 0 && <span key={g.label} style={{ width: `${(g.pct / scale) * 100}%`, background: g.color }} />)}
          </div>
          <div className={s.setPlanLegend}>
            {segs.map(
              g =>
                (g.pct > 0 || g.label !== 'Unplanned') && (
                  <span key={g.label}>
                    <i style={{ background: g.color }} />
                    {g.label} <b>{Math.round(g.pct)}%</b>
                  </span>
                ),
            )}
          </div>
          {planned > 100 && (
            <span className={s.setHint} style={{ color: 'var(--amber-ink)', fontWeight: 600 }}>
              That's {Math.round(planned)}% of your income. Lower the savings target or a category limit to fit.
            </span>
          )}
        </div>
        <div className={s.setGrid}>
          {num('income', 'Monthly income', d.currency)}
          <div className={s.field}>
            <span>Payday</span>
            <Select
              ariaLabel="Payday"
              value={String(rule.day)}
              onChange={v => setRule({ day: Number(v) })}
              options={Array.from({ length: 31 }, (_, i) => i + 1).map(n => ({
                value: String(n),
                label: n === 31 ? 'Last day of the month' : `The ${ordinal(n)}`,
              }))}
            />
          </div>
        </div>
        <Row label="If payday is a weekend">
          <Options label="If payday is a weekend" items={Object.keys(WEEKEND)} value={weekendLabel} onChange={k => setRule({ weekend: WEEKEND[k] })} />
        </Row>
        <span className={s.setHint}>Next payday is {dayLabel(nextPaydayFor(rule, startOfToday()))}.</span>
        <div className={s.setGrid}>
          {num('savingsPct', 'Save each payday', '% of income', `${ofIncome(savePct)} a month`)}
          {num('investPct', 'Of which, invest', '% of income', `${ofIncome(investPct)} a month`)}
        </div>
        {settings.customCategories.length === 0 ? (
          <span className={s.setHint}>Want your own category? Add one from any transaction&apos;s category menu.</span>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span className={s.setRowLabel} style={{ marginTop: 4 }}>
              Your categories
            </span>
            {settings.customCategories.map(cc => {
              const c = toCategory(cc);
              return (
                <div key={c.name} className={s.setListRow}>
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

      <Section title="Safety net">
        {num(
          'emergencyFund',
          'Emergency fund',
          d.currency,
          monthlySpend <= 0
            ? undefined
            : covered <= 0
              ? 'Add what you have set aside to see how long it would last'
              : `Covers about ${covered < 10 ? covered.toFixed(1) : Math.round(covered)} months of planned spending`,
        )}
        <Row label="Aim to cover">
          <Options
            label="Aim to cover"
            items={withCurrent(RUNWAY_MONTHS, runway)}
            value={runway}
            render={m => `${m} months`}
            onChange={m => setD(p => ({ ...p, emergencyTargetMonths: m }))}
          />
        </Row>
        <span className={s.setHint}>6 months is a common goal for city living.</span>
      </Section>

      <Section title="Connections">
        <label className={s.field}>
          <span>Other names on your bank accounts</span>
          <input
            className={s.input}
            value={d.ownAccountNames ?? ''}
            onChange={e => setD(p => ({ ...p, ownAccountNames: e.target.value }))}
            placeholder="e.g. John Doe, John D, 5210"
            maxLength={140}
          />
        </label>
        <span className={s.setHint}>
          Your name is already included. Add other spellings or an account&apos;s last 4 digits, separated by commas. Money moved between your own accounts
          counts as a transfer, not spending.
        </span>
        {cardNames.length > 0 && (
          <>
            <span className={s.setRowLabel} style={{ marginTop: 4 }}>
              Credit cards
            </span>
            <span className={s.setHint}>Statement and due days from your card bill, so installments land in the right cycle.</span>
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
          </>
        )}
        <label className={s.field} style={{ marginTop: 4 }}>
          <span>Receipts folder (Google Drive link)</span>
          <input
            className={s.input}
            value={d.receiptsFolder}
            onChange={e => setD(p => ({ ...p, receiptsFolder: e.target.value.trim() }))}
            placeholder="https://drive.google.com/drive/folders/…"
            inputMode="url"
          />
        </label>
        <span className={s.setHint}>Photos and PDFs you attach to transactions are saved here.</span>
        {onVercel && gmail.google_connected && !gmail.google_has_drive && (
          <div className={s.gmTipBox} style={{ marginTop: 4 }}>
            <span>
              To save receipts to Drive, Maxie needs permission to create files there. It can only see the files it creates.
            </span>
            <button
              type="button"
              className={s.btnOutlineSm}
              style={{ alignSelf: 'flex-start' }}
              disabled={driveBusy}
              onClick={async () => {
                setDriveBusy(true);
                try {
                  location.href = (await googleConnectUrl(true)).url;
                } catch {
                  setDriveBusy(false);
                }
              }}
            >
              {driveBusy ? 'Opening Google…' : 'Allow Drive uploads'}
            </button>
          </div>
        )}
      </Section>

      <Section title="App">
        <Row label="Theme on this device">
          <Options
            label="Theme"
            items={['Auto', 'Light', 'Dark'] as const}
            value={(Object.keys(THEMES) as ('Auto' | 'Light' | 'Dark')[]).find(k => THEMES[k] === theme) ?? 'Auto'}
            onChange={k => {
              setTheme(THEMES[k]);
              applyTheme(THEMES[k]);
            }}
          />
        </Row>
        <Row label="App tone">
          <Options
            label="App tone"
            items={['Warm', 'Quiet'] as const}
            value={d.quietMode ? 'Quiet' : 'Warm'}
            onChange={v => setD(p => ({ ...p, quietMode: v === 'Quiet' }))}
          />
        </Row>
        <span className={s.setHint}>Quiet turns off confetti, streaks, and badges.</span>
      </Section>

      <section className={s.setSection} aria-label="More settings">
        <button type="button" className={s.setAdvBtn} aria-expanded={advanced} onClick={() => setAdvanced(v => !v)}>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span className={s.setTitle}>More settings</span>
            <span className={s.setHint}>Charity, spending alerts, investing caps, exchange rate</span>
          </span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        {advanced && (
          <>
            {num('giveFirstPct', 'Give first / charity', '% of income', n('giveFirstPct') > 0 ? `${ofIncome(n('giveFirstPct'))} a month, set aside before everyday spending` : 'Set aside before everyday spending, e.g. zakat')}
            <Row label="Warn me when a category hits">
              <Options
                label="Warn me when a category hits"
                items={withCurrent(WARN_AT, d.warnAt)}
                value={d.warnAt}
                render={v => `${v}%`}
                onChange={v => setD(p => ({ ...p, warnAt: v }))}
              />
            </Row>
            <span className={s.setRowLabel} style={{ marginTop: 4 }}>
              Investing caps (% of portfolio)
            </span>
            <div className={s.setGrid3}>
              {num('idxCap', 'Indonesia (IDX)')}
              {num('usCap', 'US stocks')}
              {num('cryptoCap', 'Crypto')}
            </div>
            {num('fxRate', 'USD exchange rate', 'Rp per $1')}
          </>
        )}
      </section>

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
        {onVercel && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className={s.setRowLabel}>Sign-in PIN</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                className={s.input}
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                placeholder={`New ${PIN_LENGTH}-digit PIN`}
                maxLength={PIN_LENGTH}
                value={pinDraft}
                onChange={e => {
                  setPinDraft(e.target.value.replace(/\D/g, ''));
                  setPinMsg(null);
                }}
                aria-label="New PIN"
                style={{ width: 200, letterSpacing: 4 }}
              />
              <button type="button" className={s.btnOutlineSm} onClick={savePin} disabled={pinBusy || pinDraft.length !== PIN_LENGTH}>
                {pinBusy ? 'Saving…' : 'Set PIN'}
              </button>
            </div>
            <span className={s.setHint} style={pinMsg ? { color: pinMsg.ok ? 'var(--good)' : 'var(--red-ink)' } : undefined}>
              {pinMsg?.text ?? 'Lets you sign in with your email and a PIN instead of waiting for a link. Setting it again changes it.'}
            </span>
          </div>
        )}
        {onVercel && (
          <div style={{ marginTop: 6, paddingTop: 12, borderTop: '1px solid var(--divider)' }}>
            {!delOpen ? (
              <button
                type="button"
                className={s.textBtnSm}
                style={{ color: 'var(--red-ink)', padding: 0 }}
                onClick={() => setDelOpen(true)}
              >
                Delete account…
              </button>
            ) : (
              <div className={s.gmTipBox} style={{ borderColor: 'color-mix(in srgb, var(--danger) 35%, var(--border))' }}>
                <strong style={{ color: 'var(--red-ink)' }}>Deactivate account</strong>
                <span>
                  Your account will be set to inactive, Google access will be revoked, and you will be signed out. Anonymized
                  merchant rules &amp; Maxie feedback learnings are retained to keep improving.
                </span>
                <label className={s.field} style={{ marginTop: 4 }}>
                  <span>Type DELETE to confirm</span>
                  <input
                    className={s.input}
                    value={delTxt}
                    onChange={e => setDelTxt(e.target.value)}
                    placeholder="DELETE"
                    autoComplete="off"
                  />
                </label>
                {delErr && <span className={s.error}>{delErr}</span>}
                <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className={s.btnPrimarySm}
                    style={{ background: 'var(--danger)' }}
                    disabled={delBusy || delTxt.trim().toUpperCase() !== 'DELETE'}
                    onClick={() => void deactivate()}
                  >
                    {delBusy ? 'Deactivating…' : 'Deactivate & sign out'}
                  </button>
                  <button
                    type="button"
                    className={s.btnGhost}
                    disabled={delBusy}
                    onClick={() => {
                      setDelOpen(false);
                      setDelTxt('');
                      setDelErr('');
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </Section>
      <div className={s.setFoot}>
        {err && <span className={s.error}>{err}</span>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" className={s.btnPrimary} onClick={save}>
            Save settings
          </button>
          <button type="button" className={s.btnGhost} onClick={close}>
            Cancel
          </button>
          {onReplayOnboarding && (
            <button
              type="button"
              className={s.textBtnSm}
              style={{ marginLeft: 'auto' }}
              onClick={() => {
                close();
                onReplayOnboarding();
              }}
            >
              Open setup guide
            </button>
          )}
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
