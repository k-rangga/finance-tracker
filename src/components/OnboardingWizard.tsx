import { useEffect, useState } from 'react';
import s from '../styles/ui.module.css';
import { Logo } from './Logo';
import { IC, Icon } from './Icon';
import { Select } from './Select';
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
  TRUSTED_RECEIPT_DOMAINS,
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

const VIBE_PRESETS = [
  { pct: 20, labelEn: 'Balanced · 20%', labelId: 'Santai · 20%' },
  { pct: 30, labelEn: 'Jakarta Saver · 30%', labelId: 'Hemat · 30%' },
  { pct: 40, labelEn: 'Ambitious · 40%', labelId: 'Agresif · 40%' },
];

/**
 * Ultra-quick 2-step first-visit onboarding (~20 seconds):
 * 1. Quick intro: language (EN/ID), name, monthly income, payday, and 1-tap savings vibe.
 * 2. Bring in receipts (hardened read-only Gmail with proof-before-import preview) OR start clean right away.
 * Everything else (Emergency Fund, Buffer sorting, quick PIN) lives gently in Summary's Quick Start checklist.
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
  const [step, setStep] = useState<1 | 2>(initialStep === 2 ? 2 : 1);

  // Step 1 fields (streamlined: no redundant bank-name prompt)
  const [lang, setLang] = useState<'en' | 'id'>(settings.maxieLanguage ?? 'en');
  const [name, setName] = useState(settings.name);
  const [currency, setCurrency] = useState<Currency>(settings.currency);
  const [income, setIncome] = useState(settings.income || DEFAULT_INCOME[settings.currency]);
  const [incomeTxt, setIncomeTxt] = useState(String(settings.income || DEFAULT_INCOME[settings.currency]));
  const [payday, setPayday] = useState<PaydayRule>({ ...DEFAULT_PAYDAY, ...settings.payday });
  const [savingsPct, setSavingsPct] = useState(() => {
    const raw = settings.savingsPct || 30;
    return raw <= 20 ? 20 : raw >= 40 ? 40 : 30;
  });
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

  const isId = lang === 'id';
  const target = mode === 'auto' ? AUTO_LABEL : pick;

  // Auto-prefill display name when signed in via Google OAuth and no name is saved yet.
  useEffect(() => {
    if (!onVercel || !supabase || settings.name) return;
    let alive = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!alive) return;
      const meta = data.user?.user_metadata as Record<string, unknown> | undefined;
      const rawName = String(meta?.full_name || meta?.name || '').trim();
      if (rawName) setName(cur => cur || rawName.slice(0, 40));
    });
    return () => {
      alive = false;
    };
  }, [settings.name]);

  // Load Gmail labels & metadata-only sample preview on Step 2 with Google connected.
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

  const finish = () => {
    try {
      sessionStorage.removeItem(ONBOARDING_STEP_KEY);
    } catch {
      /* ignore */
    }
    update({ onboardingDone: true });
    onDone();
  };

  const saveStep1 = () => {
    const val = Number(incomeTxt.replace(/[^\d.]/g, ''));
    if (!(val > 0)) return setStepErr(isId ? 'Isi perkiraan penghasilan bulananmu dulu.' : 'Enter your monthly take-home income.');
    setStepErr('');
    const trimmedName = name.trim();
    update({
      name: trimmedName,
      maxieLanguage: lang,
      ...(trimmedName && !settings.ownAccountNames ? { ownAccountNames: trimmedName } : {}),
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
      const { url } = await googleConnectUrl(false);
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
    } catch (e) {
      setGmailErr(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  };

  const saveAmt = Math.round((income * savingsPct) / 100);
  const spendAmt = Math.max(0, income - saveAmt);

  return (
    <div className={s.onbOverlay}>
      <section className={`${s.onbCard} fade-in`} role="dialog" aria-modal="true" aria-label="Welcome to Maxie">
        {/* Compact 2-step header */}
        <div className={s.onbTop}>
          <div className={s.onbSteps} aria-label={`Step ${step} of 2`}>
            {[1, 2].map(n => (
              <span key={n} className={s.onbStepBar} data-active={n === step || undefined} data-done={n < step || undefined} />
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className={s.segment} role="group" aria-label="Language">
              <button type="button" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>
                EN
              </button>
              <button type="button" aria-pressed={lang === 'id'} onClick={() => setLang('id')}>
                ID
              </button>
            </div>
            <button type="button" className={s.textBtnSm} onClick={finish}>
              {isId ? 'Lewati' : 'Skip setup'}
            </button>
          </div>
        </div>

        {step === 1 && (
          <div className={s.onbBody}>
            <div className={s.onbHero}>
              <Logo size={52} mood="happy" interactive followCursor cheer={isId ? 'Halo!' : 'Nice to meet you!'} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <h1 className={s.onbTitle}>{isId ? 'Kenalan singkat dengan Maxie' : 'Quick setup with Maxie'}</h1>
                <p className={s.onbSub}>
                  {isId
                    ? 'Cuma 20 detik untuk atur siklus gajian — semuanya bisa diubah kapan saja nanti.'
                    : 'About 20 seconds to map your pay cycle — you can fine-tune everything anytime.'}
                </p>
              </div>
            </div>

            <label className={s.field}>
              <span>{isId ? 'Maxie panggil kamu siapa?' : 'What should Maxie call you?'}</span>
              <input
                className={s.input}
                autoFocus
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={isId ? 'contoh: Rangga' : 'e.g. Rangga'}
                maxLength={40}
              />
            </label>

            <div className={s.onbBlock}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: C.textSoft }}>
                  {isId ? 'Penghasilan bersih per bulan' : 'Monthly take-home income'}
                </span>
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
                <span style={{ fontSize: 13, fontWeight: 600, color: C.textSoft }}>{isId ? 'Tanggal gajian' : 'Payday'}</span>
                <div className={s.onbChipRow}>
                  {[
                    { label: isId ? 'Tgl 25' : '25th', day: 25 },
                    { label: isId ? 'Tgl 1' : '1st', day: 1 },
                    { label: isId ? 'Akhir bln' : 'Last day', day: 31 },
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
                  <span style={{ fontWeight: 600, color: C.textSoft }}>{isId ? 'Target nabung' : 'Savings goal'}</span>
                  <strong style={{ color: C.accent600 }}>{savingsPct}%</strong>
                </div>
                <div className={s.onbChipRow}>
                  {VIBE_PRESETS.map(v => (
                    <button
                      key={v.pct}
                      type="button"
                      className={s.winBadge}
                      data-active={savingsPct === v.pct || undefined}
                      onClick={() => setSavingsPct(v.pct)}
                    >
                      {isId ? v.labelId : v.labelEn}
                    </button>
                  ))}
                </div>
                <span style={{ fontSize: 12, color: C.textMuted }}>
                  {isId ? 'Simpan' : 'Save'} {fmtShort(saveAmt, currency)} · {isId ? 'Belanja' : 'Spend'} {fmtShort(spendAmt, currency)}
                </span>
              </div>
            </div>

            {stepErr && <span className={s.error}>{stepErr}</span>}

            <div className={s.onbFoot}>
              <button type="button" className={s.btnPrimary} onClick={saveStep1} style={{ marginLeft: 'auto' }}>
                {isId ? 'Lanjut' : 'Continue'}
              </button>
            </div>
          </div>
        )}

        {step === 2 && importResult && (
          <div className={s.onbBody}>
            <div className={s.onbHero}>
              <Logo size={54} mood="happy" interactive followCursor cheer={isId ? 'Berhasil!' : 'All tidy!'} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <h1 className={s.onbTitle}>
                  {isId ? `Semua siap${name.trim() ? `, ${name.trim()}` : ''}` : `You're all set${name.trim() ? `, ${name.trim()}` : ''}`}
                </h1>
                <p className={s.onbSub}>
                  {importResult.imported > 0
                    ? isId
                      ? `Maxie membaca ${importResult.scanned} email dan merapikan ${importResult.imported} transaksi${importResult.duplicates ? ` (${importResult.duplicates} duplikat digabung)` : ''}.`
                      : `Maxie read ${importResult.scanned} emails and organized ${importResult.imported} ${importResult.imported === 1 ? 'transaction' : 'transactions'}${importResult.duplicates ? ` (${importResult.duplicates} duplicates merged)` : ''}.`
                    : isId
                      ? 'Siklus dan target tabunganmu sudah siap digunakan.'
                      : 'Your pay cycle and savings plan are ready to explore.'}
                </p>
              </div>
            </div>
            <div className={s.onbFoot}>
              <button type="button" className={s.btnPrimary} onClick={finish} style={{ marginLeft: 'auto' }}>
                {isId ? 'Buka Ringkasanku' : 'Open my Summary'}
              </button>
            </div>
          </div>
        )}

        {step === 2 && !importResult && (
          <div className={s.onbBody}>
            <div className={s.onbHero}>
              <Logo size={48} mood="curious" followCursor />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <h1 className={s.onbTitle}>{isId ? 'Impor struk otomatis (opsional)' : 'Bring in your receipts (optional)'}</h1>
                <p className={s.onbSub}>
                  {isId
                    ? 'Maxie membaca email struk bank & e-wallet (hanya baca) — atau kamu bisa langsung mulai kosong.'
                    : 'Maxie scans bank & app receipt emails (read-only) — or start with a clean slate and connect later.'}
                </p>
              </div>
            </div>

            {needsGoogle ? (
              <>
                <div className={s.gmTrustRow}>
                  <span className={s.gmTrustPill}>
                    <Icon d={IC.check} size={12} strokeWidth={2.4} color={C.good} /> Read-only Gmail (no Drive)
                  </span>
                  <span className={s.gmTrustPill}>
                    <Icon d={IC.check} size={12} strokeWidth={2.4} color={C.good} /> Token encrypted at rest
                  </span>
                  <span className={s.gmTrustPill}>
                    <Icon d={IC.check} size={12} strokeWidth={2.4} color={C.good} /> Bodies never stored
                  </span>
                  <span className={s.gmTrustPill}>
                    <Icon d={IC.check} size={12} strokeWidth={2.4} color={C.good} /> Revokes at Google on disconnect
                  </span>
                </div>
                <details className={s.gmPrivacyDetails}>
                  <summary>{isId ? 'Apa yang bisa dan tidak bisa dilihat Maxie' : 'What Maxie can and cannot see'}</summary>
                  <div className={s.gmPrivacyBody}>
                    <span>
                      <strong>Scope requested:</strong> <code>gmail.readonly</code> only — no Send, no Delete, no Drive.
                    </span>
                    <span>
                      <strong>Allowed senders:</strong> {TRUSTED_RECEIPT_DOMAINS.slice(0, 12).join(', ')}, and receipt subjects — personal emails are skipped.
                    </span>
                    <span>
                      <strong>Storage:</strong> Only date, merchant, and amount are saved. Raw email bodies are discarded right after parsing.
                    </span>
                  </div>
                </details>
                <div className={s.gmTipBox}>
                  <span style={{ fontWeight: 600, color: C.text }}>Quick heads-up on Google&apos;s screen</span>
                  <span>
                    If Google mentions the app isn&apos;t verified, tap <strong>Advanced → Continue</strong> — you&apos;ll land right back here to preview your receipts.
                  </span>
                </div>
                {gmailErr && <span className={s.error}>{gmailErr}</span>}
                <div className={s.onbFoot}>
                  <button type="button" className={s.btnGhost} onClick={() => setStep(1)}>
                    {isId ? 'Kembali' : 'Back'}
                  </button>
                  <button type="button" className={s.btnOutline} onClick={finish} style={{ marginLeft: 'auto' }}>
                    {isId ? 'Mulai tanpa Gmail' : 'Start clean'}
                  </button>
                  <button type="button" className={s.btnPrimary} onClick={connectGoogle}>
                    {isId ? 'Hubungkan Gmail' : 'Connect Gmail'}
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
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
                    {!previewing && preview?.samples && preview.samples.length > 0 && (
                      <div className={s.gmSampleList}>
                        <span className={s.caption} style={{ fontWeight: 600 }}>
                          Sample matches (only date, merchant &amp; amount are saved; personal emails are ignored):
                        </span>
                        {preview.samples.map((sm, idx) => (
                          <div key={idx} className={s.gmSampleRow}>
                            <span className={s.gmSampleFrom}>{sm.from}</span>
                            <span className={s.gmSampleSubj}>{sm.subject}</span>
                          </div>
                        ))}
                      </div>
                    )}
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
                    {isId ? 'Kembali' : 'Back'}
                  </button>
                  <button type="button" className={s.btnOutline} disabled={importing} onClick={finish} style={{ marginLeft: 'auto' }}>
                    {isId ? 'Mulai tanpa Gmail' : 'Start clean'}
                  </button>
                  <button type="button" className={s.btnPrimary} disabled={!target || importing} onClick={runImport}>
                    {importing ? (isId ? 'Mengimpor…' : 'Importing…') : isId ? 'Impor struk saya' : 'Import my receipts'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
