import { useEffect, useState } from 'react';
import s from '../styles/ui.module.css';
import { Logo } from './Logo';
import { IC, Icon } from './Icon';
import { Select } from './Select';
import { PIN_LENGTH } from './SignIn';
import { suggestLabel } from './GmailDialog';
import { DEFAULT_PAYDAY, type PaydayRule } from '../lib/cycle';
import { useData } from '../lib/data';
import {
  AUTO_LABEL,
  chooseLabel,
  googleConnectUrl,
  listLabels,
  previewGmail,
  syncAllBatches,
  type GmailPreview,
  type SyncResult,
} from '../lib/gmail';
import { DEFAULT_INCOME, useSettings } from '../lib/settings';
import { fmtShort, type Currency } from '../lib/format';
import { onVercel, supabase } from '../lib/supabase';
import { C } from '../lib/tokens';

export const ONBOARDING_STEP_KEY = 'maxie.onboarding.step';

const INCOME_PRESETS: Record<Currency, { label: string; value: number }[]> = {
  IDR: [
    { label: 'Rp 15M', value: 15_000_000 },
    { label: 'Rp 25M', value: 25_000_000 },
    { label: 'Rp 30M', value: 30_000_000 },
    { label: 'Rp 50M', value: 50_000_000 },
  ],
  USD: [
    { label: '$4k', value: 4_000 },
    { label: '$6.5k', value: 6_500 },
    { label: '$10k', value: 10_000 },
    { label: '$15k', value: 15_000 },
  ],
};

/**
 * Calm 3-step first-visit onboarding wizard:
 * 1. Personalize (name, bank account names, income, payday, savings target)
 * 2. Connect Gmail (zero-setup Smart Receipt Scan with live preview & auto-continuing batch import)
 * 3. Ready (import summary + optional 6-digit quick sign-in PIN)
 */
export function OnboardingWizard({
  initialStep = 1,
  googleNotice,
  onDone,
}: {
  initialStep?: 1 | 2 | 3;
  googleNotice?: string;
  onDone: () => void;
}) {
  const { settings, update } = useSettings();
  const { gmail, refreshImports } = useData();
  const [step, setStep] = useState<1 | 2 | 3>(initialStep);

  // Step 1 fields
  const [name, setName] = useState(settings.name);
  const [ownNames, setOwnNames] = useState(settings.ownAccountNames ?? '');
  const [currency, setCurrency] = useState<Currency>(settings.currency);
  const [income, setIncome] = useState(settings.income || DEFAULT_INCOME[settings.currency]);
  const [incomeTxt, setIncomeTxt] = useState(String(settings.income || DEFAULT_INCOME[settings.currency]));
  const [payday, setPayday] = useState<PaydayRule>({ ...DEFAULT_PAYDAY, ...settings.payday });
  const [savingsPct, setSavingsPct] = useState(Math.min(70, Math.max(10, settings.savingsPct || 30)));
  const [stepErr, setStepErr] = useState('');

  // Step 2 Gmail state
  const [needsGoogle, setNeedsGoogle] = useState(onVercel && gmail.google_connected === false && googleNotice !== 'connected');
  const [mode, setMode] = useState<'auto' | 'label'>('auto');
  const [labels, setLabels] = useState<string[] | null>(null);
  const [pick, setPick] = useState('');
  const [preview, setPreview] = useState<GmailPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<SyncResult | null>(null);
  const [importResult, setImportResult] = useState<SyncResult | null>(null);
  const [gmailErr, setGmailErr] = useState('');

  // Step 3 optional PIN
  const [pin, setPin] = useState('');
  const [pinSaved, setPinSaved] = useState(false);
  const [pinBusy, setPinBusy] = useState(false);
  const [pinErr, setPinErr] = useState('');

  const target = mode === 'auto' ? AUTO_LABEL : pick;

  // Load Gmail labels & preview once on Step 2 with Google connected.
  useEffect(() => {
    if (step !== 2 || needsGoogle) return;
    listLabels()
      .then(list => {
        setLabels(list);
        setPick(cur => cur || suggestLabel(list));
      })
      .catch(e => {
        const m = e instanceof Error ? e.message : String(e);
        if (/google_not_connected/.test(m)) setNeedsGoogle(true);
        else setGmailErr(m);
      });
  }, [step, needsGoogle]);

  useEffect(() => {
    if (step !== 2 || needsGoogle || !target) {
      setPreview(null);
      return;
    }
    let alive = true;
    setPreviewing(true);
    previewGmail(target)
      .then(p => alive && setPreview(p))
      .catch(() => alive && setPreview(null))
      .finally(() => alive && setPreviewing(false));
    return () => {
      alive = false;
    };
  }, [step, needsGoogle, target]);

  const pickCurrency = (c: Currency) => {
    setCurrency(c);
    if (income === DEFAULT_INCOME[c === 'IDR' ? 'USD' : 'IDR']) {
      setIncome(DEFAULT_INCOME[c]);
      setIncomeTxt(String(DEFAULT_INCOME[c]));
    }
  };

  const saveStep1 = () => {
    const val = Number(incomeTxt.replace(/[^\d.]/g, ''));
    if (!(val > 0)) return setStepErr('Enter your monthly take-home income.');
    setStepErr('');
    update({
      name: name.trim(),
      ownAccountNames: ownNames.trim() || undefined,
      currency,
      income: val,
      payday,
      savingsPct,
    });
    setStep(2);
  };

  const connectGoogle = async () => {
    setGmailErr('');
    try {
      sessionStorage.setItem(ONBOARDING_STEP_KEY, '2');
      const { url } = await googleConnectUrl();
      location.href = url;
    } catch (e) {
      setGmailErr(e instanceof Error ? e.message : String(e));
    }
  };

  const runImport = async () => {
    if (!target) return;
    setImporting(true);
    setGmailErr('');
    setProgress(null);
    try {
      const r = await syncAllBatches(() => chooseLabel(target), acc => setProgress(acc));
      setImportResult(r);
      await refreshImports();
      try {
        sessionStorage.removeItem(ONBOARDING_STEP_KEY);
      } catch {
        /* ignore */
      }
      setStep(3);
    } catch (e) {
      setGmailErr(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  };

  const savePin = async () => {
    const p = pin.replace(/\D/g, '');
    if (p.length !== PIN_LENGTH) return setPinErr(`Enter ${PIN_LENGTH} digits.`);
    setPinBusy(true);
    setPinErr('');
    const { error } = await supabase!.auth.updateUser({ password: p });
    setPinBusy(false);
    if (error) setPinErr(error.message);
    else {
      setPinSaved(true);
      setPin('');
    }
  };

  const finish = () => {
    try {
      sessionStorage.removeItem(ONBOARDING_STEP_KEY);
    } catch {
      /* ignore */
    }
    update({ onboardingDone: true });
    onDone();
  };

  const saveAmt = Math.round((income * savingsPct) / 100);
  const spendAmt = Math.max(0, income - saveAmt);

  return (
    <div className={s.onbOverlay}>
      <section className={`${s.onbCard} fade-in`} role="dialog" aria-modal="true" aria-label="Welcome to Maxie">
        {/* Step progress bar */}
        <div className={s.onbTop}>
          <div className={s.onbSteps} aria-label={`Step ${step} of 3`}>
            {[1, 2, 3].map(n => (
              <span key={n} className={s.onbStepBar} data-active={n === step || undefined} data-done={n < step || undefined} />
            ))}
          </div>
          <button type="button" className={s.textBtnSm} onClick={finish}>
            Skip setup
          </button>
        </div>

        {step === 1 && (
          <div className={s.onbBody}>
            <div className={s.onbHero}>
              <Logo size={54} mood="happy" interactive followCursor cheer="Nice to meet you!" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <h1 className={s.onbTitle}>Welcome to Maxie</h1>
                <p className={s.onbSub}>Take 30 seconds to tune your pay cycle — you can change any of this later in Settings.</p>
              </div>
            </div>

            <div className={s.onbGrid}>
              <label className={s.field}>
                <span>What should Maxie call you?</span>
                <input
                  className={s.input}
                  autoFocus
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Rangga"
                  maxLength={40}
                />
              </label>
              <label className={s.field}>
                <span>Full name on bank accounts (optional)</span>
                <input
                  className={s.input}
                  value={ownNames}
                  onChange={e => setOwnNames(e.target.value)}
                  placeholder="e.g. Kalaka Rangga S"
                  maxLength={120}
                />
              </label>
            </div>

            <div className={s.onbBlock}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: C.textSoft }}>Monthly take-home income</span>
                <div className={s.segment} role="group" aria-label="Currency">
                  {(['IDR', 'USD'] as Currency[]).map(c => (
                    <button key={c} type="button" aria-pressed={currency === c} onClick={() => pickCurrency(c)}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              <input
                className={s.input}
                inputMode="decimal"
                value={incomeTxt}
                onChange={e => {
                  setIncomeTxt(e.target.value);
                  const n = Number(e.target.value.replace(/[^\d.]/g, ''));
                  if (n > 0) setIncome(n);
                  setStepErr('');
                }}
                aria-label="Monthly take-home income"
              />
              <div className={s.onbChipRow}>
                {INCOME_PRESETS[currency].map(p => (
                  <button
                    key={p.label}
                    type="button"
                    className={s.winBadge}
                    data-active={income === p.value || undefined}
                    onClick={() => {
                      setIncome(p.value);
                      setIncomeTxt(String(p.value));
                      setStepErr('');
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className={s.onbGrid}>
              <div className={s.onbBlock}>
                <span style={{ fontSize: 13, fontWeight: 600, color: C.textSoft }}>Payday</span>
                <div className={s.onbChipRow}>
                  {[
                    { label: '25th', day: 25 },
                    { label: '1st', day: 1 },
                    { label: 'Last day', day: 31 },
                  ].map(opt => (
                    <button
                      key={opt.label}
                      type="button"
                      className={s.winBadge}
                      data-active={payday.day === opt.day || undefined}
                      onClick={() => setPayday(p => ({ ...p, day: opt.day }))}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className={s.onbBlock}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span style={{ fontWeight: 600, color: C.textSoft }}>Savings goal</span>
                  <strong style={{ color: C.accent600 }}>{savingsPct}%</strong>
                </div>
                <input
                  type="range"
                  min={10}
                  max={70}
                  step={5}
                  value={savingsPct}
                  onChange={e => setSavingsPct(Number(e.target.value))}
                  aria-label="Monthly savings target percentage"
                  style={{ accentColor: 'var(--clay)', width: '100%' }}
                />
                <span style={{ fontSize: 12, color: C.textMuted }}>
                  Save {fmtShort(saveAmt, currency)} · Spend {fmtShort(spendAmt, currency)}
                </span>
              </div>
            </div>

            {stepErr && <span className={s.error}>{stepErr}</span>}

            <div className={s.onbFoot}>
              <button type="button" className={s.btnPrimary} onClick={saveStep1} style={{ marginLeft: 'auto' }}>
                Continue
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className={s.onbBody}>
            <div className={s.onbHero}>
              <Logo size={48} mood="curious" followCursor />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <h1 className={s.onbTitle}>Bring in your receipts</h1>
                <p className={s.onbSub}>
                  Maxie reads bank &amp; app receipt emails (read-only) to build your cycle automatically — no manual typing.
                </p>
              </div>
            </div>

            {needsGoogle ? (
              <>
                <div className={s.gmTrustRow}>
                  <span className={s.gmTrustPill}>
                    <Icon d={IC.check} size={12} strokeWidth={2.4} color={C.good} /> Read-only Gmail
                  </span>
                  <span className={s.gmTrustPill}>
                    <Icon d={IC.check} size={12} strokeWidth={2.4} color={C.good} /> Zero labels needed
                  </span>
                  <span className={s.gmTrustPill}>
                    <Icon d={IC.check} size={12} strokeWidth={2.4} color={C.good} /> Disconnect anytime
                  </span>
                </div>
                <div className={s.gmTipBox}>
                  <span style={{ fontWeight: 600, color: C.text }}>Quick heads-up on Google&apos;s screen</span>
                  <span>
                    If Google mentions the app isn&apos;t verified, tap <strong>Advanced → Continue</strong> — you&apos;ll land right back here to preview your receipts.
                  </span>
                </div>
                {gmailErr && <span className={s.error}>{gmailErr}</span>}
                <div className={s.onbFoot}>
                  <button type="button" className={s.btnGhost} onClick={() => setStep(1)}>
                    Back
                  </button>
                  <button type="button" className={s.textBtnSm} onClick={() => setStep(3)} style={{ marginLeft: 'auto' }}>
                    Skip for now
                  </button>
                  <button type="button" className={s.btnPrimary} onClick={connectGoogle}>
                    Connect Google
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className={s.gmModes} role="radiogroup" aria-label="Receipt import mode">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={mode === 'auto'}
                    className={s.gmModeCard}
                    data-active={mode === 'auto' || undefined}
                    onClick={() => setMode('auto')}
                    disabled={importing}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <strong style={{ fontSize: 14 }}>Smart Receipt Scan</strong>
                      <span className={s.gmRecTag}>Recommended</span>
                    </div>
                    <span style={{ fontSize: 12.5, color: C.textMuted, lineHeight: 1.45 }}>
                      Automatically scans BCA, blu, Mandiri, Superbank, Jago, Grab, Gojek &amp; Tokopedia receipts.
                    </span>
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={mode === 'label'}
                    className={s.gmModeCard}
                    data-active={mode === 'label' || undefined}
                    onClick={() => setMode('label')}
                    disabled={importing}
                  >
                    <strong style={{ fontSize: 14 }}>Use a Gmail label</strong>
                    <span style={{ fontSize: 12.5, color: C.textMuted, lineHeight: 1.45 }}>
                      Pick an existing Gmail label if you already organize receipts with filters.
                    </span>
                  </button>
                </div>

                {mode === 'label' && (
                  <label className={s.field}>
                    Gmail label
                    <Select
                      value={pick}
                      onChange={setPick}
                      ariaLabel="Gmail label"
                      disabled={!labels || !labels.length || importing}
                      placeholder={!labels ? 'Loading labels…' : labels.length ? 'Choose a label' : 'No labels found — use Smart Receipt Scan above'}
                      options={(labels ?? []).map(l => ({ value: l, label: l }))}
                    />
                  </label>
                )}

                {!importing && target && (
                  <div className={s.gmPreviewRow}>
                    <Icon d={IC.sparkle} size={13} color={C.accent600} />
                    <span>
                      {previewing
                        ? 'Scanning your last 62 days for bank & app receipts…'
                        : preview
                          ? preview.count > 0
                            ? `Found ${preview.count} receipt ${preview.count === 1 ? 'email' : 'emails'} in the last ${preview.days} days — ready to import.`
                            : `No matching receipt emails found in the last ${preview.days} days.`
                          : 'Ready to import your last 62 days.'}
                    </span>
                  </div>
                )}

                {importing && (
                  <div className={s.gmProgressBox} role="status" aria-live="polite">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13 }}>
                      <strong>Importing your receipts…</strong>
                      <span style={{ color: C.textMuted }}>
                        {progress ? `${progress.scanned} read · ${progress.imported} imported${progress.remaining ? ` · ${progress.remaining} left` : ''}` : 'Starting…'}
                      </span>
                    </div>
                    <div className={s.gmProgressTrack}>
                      <div
                        className={s.gmProgressFill}
                        data-indeterminate={!progress || undefined}
                        style={
                          progress
                            ? { width: `${Math.min(96, Math.max(12, Math.round((progress.scanned / Math.max(1, progress.scanned + (progress.remaining ?? 0))) * 100)))}%` }
                            : undefined
                        }
                      />
                    </div>
                  </div>
                )}

                {gmailErr && <span className={s.error}>{gmailErr}</span>}

                <div className={s.onbFoot}>
                  <button type="button" className={s.btnGhost} disabled={importing} onClick={() => setStep(1)}>
                    Back
                  </button>
                  <button type="button" className={s.textBtnSm} disabled={importing} onClick={() => setStep(3)} style={{ marginLeft: 'auto' }}>
                    Skip for now
                  </button>
                  <button type="button" className={s.btnPrimary} disabled={!target || importing} onClick={runImport}>
                    {importing ? 'Importing…' : 'Import my receipts'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {step === 3 && (
          <div className={s.onbBody}>
            <div className={s.onbHero}>
              <Logo size={56} mood="happy" interactive followCursor cheer="All set!" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <h1 className={s.onbTitle}>You&apos;re all set{name.trim() ? `, ${name.trim()}` : ''}</h1>
                <p className={s.onbSub}>
                  {importResult && importResult.imported > 0
                    ? `Maxie read ${importResult.scanned} emails and imported ${importResult.imported} ${importResult.imported === 1 ? 'transaction' : 'transactions'}${importResult.duplicates ? ` (${importResult.duplicates} duplicates merged cleanly)` : ''}.`
                    : 'Your pay cycle and savings goal are ready. You can connect or sync Gmail anytime from the top bar.'}
                </p>
              </div>
            </div>

            {onVercel && supabase && (
              <div className={s.gmTipBox}>
                <span style={{ fontWeight: 600, color: C.text }}>Optional: set a quick 6-digit sign-in PIN</span>
                <span>Skip waiting for email links next time — enter your 6-digit PIN and sign in instantly.</span>
                {pinSaved ? (
                  <span style={{ color: C.good, fontWeight: 600, fontSize: 13 }}>PIN saved — you can sign in with Email + PIN next time.</span>
                ) : (
                  <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    <input
                      className={s.input}
                      type="password"
                      inputMode="numeric"
                      maxLength={PIN_LENGTH}
                      placeholder="6-digit PIN"
                      value={pin}
                      onChange={e => {
                        setPin(e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH));
                        setPinErr('');
                      }}
                      style={{ maxWidth: 160, letterSpacing: 4, textAlign: 'center' }}
                      aria-label="Optional 6-digit PIN"
                    />
                    <button type="button" className={s.btnOutlineSm} disabled={pinBusy || pin.length !== PIN_LENGTH} onClick={savePin}>
                      {pinBusy ? 'Saving…' : 'Save PIN'}
                    </button>
                  </div>
                )}
                {pinErr && <span className={s.error}>{pinErr}</span>}
              </div>
            )}

            <div className={s.onbFoot}>
              <button type="button" className={s.btnPrimary} onClick={finish} style={{ marginLeft: 'auto' }}>
                Open my Summary
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
