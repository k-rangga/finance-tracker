import { useEffect, useState } from 'react';
import s from '../styles/ui.module.css';
import { Modal } from './ui';
import { Select } from './Select';
import { Logo } from './Logo';
import { IC, Icon } from './Icon';
import { useData } from '../lib/data';
import {
  AUTO_LABEL,
  chooseLabel,
  disconnectGmail,
  googleConnectUrl,
  googleDisconnect,
  labelDisplay,
  listLabels,
  previewGmail,
  reimportGmail,
  setGmailPaused,
  SMART_FILTER_QUERY,
  syncAllBatches,
  syncNow,
  syncRange,
  TRUSTED_RECEIPT_DOMAINS,
  type GmailPreview,
  type SyncResult,
} from '../lib/gmail';
import { onVercel } from '../lib/supabase';
import { C } from '../lib/tokens';
import { needsAuthorization, SCRIPT_EDITOR_URL } from '../lib/gas';

export function syncedAgo(iso: string | null): string {
  if (!iso) return 'never';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60e3);
  if (min < 1) return 'just now';
  if (min < 60) return min + ' min ago';
  const h = Math.round(min / 60);
  if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
  const d = Math.round(h / 24);
  return d + (d === 1 ? ' day ago' : ' days ago');
}

export const resultText = (r: SyncResult) =>
  r.busy
    ? 'An import is already running in the background. Check back in a few minutes.'
    : `Read ${r.scanned} ${r.scanned === 1 ? 'email' : 'emails'}, imported ${r.imported} new ${r.imported === 1 ? 'receipt' : 'receipts'}` +
      (r.duplicates ? `, ${r.duplicates} ${r.duplicates === 1 ? 'duplicate' : 'duplicates'} merged` : '') +
      (r.reversed ? `, ${r.reversed} cancelled ${r.reversed === 1 ? 'charge' : 'charges'} removed` : '') +
      '.' +
      (r.more
        ? ` ${r.remaining != null ? r.remaining + ' more' : 'More'} to read${r.paused ? ' (Gmail asked to slow down)' : ''}: ${onVercel ? 'press Sync now again, or it continues at the next hourly sync.' : 'it continues on its own in about 2 minutes, until done.'}`
        : '');

/** What Google's return to the app (?google=…) means. */
const GOOGLE_NOTICE: Record<string, string> = {
  connected: 'Google connected — ready to scan your receipts.',
  cancelled: 'Google connection cancelled.',
  expired: 'That took too long. Connect Google again.',
  error: "Couldn't connect Google. Try again.",
};

/** Pick the most likely existing receipts label (if any) when switching to Label mode. */
export const suggestLabel = (labels: string[]) =>
  labels.find(l => /receipt|struk|finance|bank|spend|transaksi|expense|keuangan|bayar/i.test(l)) ?? '';

export function GmailDialog({ onClose, notice }: { onClose: () => void; notice?: string }) {
  const { gmail, refreshImports } = useData();
  const initialMode: 'auto' | 'label' = !gmail.label_name || gmail.label_name === AUTO_LABEL ? 'auto' : 'label';
  const [mode, setMode] = useState<'auto' | 'label'>(initialMode);
  const [labels, setLabels] = useState<string[] | null>(null);
  const [pick, setPick] = useState(gmail.label_name && gmail.label_name !== AUTO_LABEL ? gmail.label_name : '');
  const [preview, setPreview] = useState<GmailPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [progress, setProgress] = useState<SyncResult | null>(null);
  const [copiedFilter, setCopiedFilter] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const target = mode === 'auto' ? AUTO_LABEL : pick;

  const run = async (what: string, fn: () => Promise<string>) => {
    setBusy(what);
    setErr('');
    setMsg('');
    setProgress(null);
    try {
      setMsg(await fn());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  // Vercel: Gmail is read through your own Google connection, made once.
  const [needsGoogle, setNeedsGoogle] = useState(onVercel && gmail.google_connected === false && notice !== 'connected');
  useEffect(() => {
    if (needsGoogle) return;
    listLabels()
      .then(list => {
        setLabels(list);
        setPick(cur => cur || suggestLabel(list));
      })
      .catch(e => {
        const m = e instanceof Error ? e.message : String(e);
        if (/google_not_connected/.test(m)) setNeedsGoogle(true);
        else setErr(m);
      });
  }, [needsGoogle]);

  // Fast dry-run count of matching emails whenever the selected source changes.
  useEffect(() => {
    if (needsGoogle || !target) {
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
  }, [needsGoogle, target]);

  const connectGoogle = () =>
    run('google', async () => {
      location.href = (await googleConnectUrl()).url;
      return '';
    });

  const copyFilter = () => {
    navigator.clipboard?.writeText(SMART_FILTER_QUERY).catch(() => {});
    setCopiedFilter(true);
    setTimeout(() => setCopiedFilter(false), 2000);
  };

  if (needsGoogle)
    return (
      <Modal title="Connect Gmail" onClose={onClose} width={480}>
        <div className={s.gmPreHead}>
          <Logo size={42} mood="calm" followCursor />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <strong style={{ fontSize: 16, fontFamily: 'var(--font-serif)', fontWeight: 500 }}>Automatic receipt sync</strong>
            <span style={{ fontSize: 13.5, color: C.textMuted }}>Works right away — no Gmail filters or labels needed.</span>
          </div>
        </div>
        {notice && notice !== 'connected' && (
          <span style={{ fontSize: 13.5, fontWeight: 600, color: C.amberInk }}>{GOOGLE_NOTICE[notice] ?? notice}</span>
        )}
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
          <summary>What Maxie can and cannot see</summary>
          <div className={s.gmPrivacyBody}>
            <span>
              <strong>Scope requested:</strong> <code>gmail.readonly</code> only. Maxie cannot send, delete, or read Google Drive during Gmail connect.
            </span>
            <span>
              <strong>Allowed senders:</strong> {TRUSTED_RECEIPT_DOMAINS.slice(0, 12).join(', ')}, and receipt subjects — personal emails outside these are ignored.
            </span>
            <span>
              <strong>Storage:</strong> Only date, merchant, and amount are kept. Raw email bodies are discarded right after parsing.
            </span>
          </div>
        </details>
        <div className={s.gmTipBox}>
          <span style={{ fontWeight: 600, color: C.text }}>Quick heads-up on Google&apos;s screen</span>
          <span>
            Because this is your own personal app, Google may show an unverified-app warning. Just tap{' '}
            <strong>Advanced → Continue</strong> — you&apos;ll come right back here to preview &amp; import.
          </span>
        </div>
        {err && <span className={s.error}>{err}</span>}
        <button type="button" className={s.btnPrimary} style={{ alignSelf: 'flex-start' }} disabled={!!busy} onClick={connectGoogle}>
          {busy === 'google' ? 'Opening Google…' : 'Connect Google account'}
        </button>
      </Modal>
    );

  const lastError = gmail.last_sync_status?.startsWith('error') ? gmail.last_sync_status.replace(/^error:\s*/, '') : null;
  const partial = gmail.last_sync_status === 'partial';
  const changed = !!target && target !== gmail.label_name;
  const isBusySync = busy === 'label' || busy === 'sync' || busy === 'range' || busy === 'reimport';

  return (
    <Modal title="Gmail sync" onClose={onClose} width={520}>
      {notice === 'connected' && !gmail.label_name && (
        <span role="status" className={s.gmBannerGood}>
          <Icon d={IC.check} size={14} strokeWidth={2.4} /> {GOOGLE_NOTICE.connected}
        </span>
      )}

      {gmail.label_name && (
        <div className={s.note} style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13.5 }}>
          <span>
            Connected to <strong>{gmail.google_email ?? 'your Google account'}</strong> · Source:{' '}
            <strong>{labelDisplay(gmail.label_name)}</strong> · Synced {syncedAgo(gmail.last_synced_at)}
            {gmail.last_sync_count != null && !lastError ? ` (${gmail.last_sync_count} emails checked)` : ''}
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <span className={s.gmTrustPill}>
              <Icon d={IC.check} size={11} strokeWidth={2.4} color={C.good} />{' '}
              {gmail.google_has_drive ? 'gmail.readonly + drive.file' : 'gmail.readonly only'}
            </span>
            {onVercel && gmail.google_encrypted && (
              <span className={s.gmTrustPill}>
                <Icon d={IC.shield} size={11} strokeWidth={2.2} color={C.good} /> Token encrypted (AES-256)
              </span>
            )}
            {gmail.paused && (
              <span className={s.gmTrustPill} style={{ color: C.amberInk, borderColor: 'var(--amber)' }}>
                Auto-sync paused (manual only)
              </span>
            )}
          </div>
          {lastError && <span style={{ fontSize: 13, fontWeight: 600, color: C.redInk }}>Last sync failed: {lastError}</span>}
          {partial && <span style={{ fontSize: 13, fontWeight: 600, color: C.amberInk }}>Import still finishing in the background.</span>}
        </div>
      )}

      <div className={s.gmModes} role="radiogroup" aria-label="How Maxie finds receipt emails">
        <button
          type="button"
          role="radio"
          aria-checked={mode === 'auto'}
          className={s.gmModeCard}
          data-active={mode === 'auto' || undefined}
          onClick={() => setMode('auto')}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <strong style={{ fontSize: 14 }}>Smart Receipt Scan</strong>
            <span className={s.gmRecTag}>Recommended</span>
          </div>
          <span style={{ fontSize: 12.5, color: C.textMuted, lineHeight: 1.45 }}>
            Automatically finds emails from your banks (BCA, blu, Mandiri, Superbank, Jago…), e-wallets, Grab, and Tokopedia — zero labels or filters needed.
          </span>
        </button>

        <button
          type="button"
          role="radio"
          aria-checked={mode === 'label'}
          className={s.gmModeCard}
          data-active={mode === 'label' || undefined}
          onClick={() => setMode('label')}
        >
          <strong style={{ fontSize: 14 }}>Specific Gmail label</strong>
          <span style={{ fontSize: 12.5, color: C.textMuted, lineHeight: 1.45 }}>
            Only scan emails you route into one dedicated Gmail label.
          </span>
        </button>
      </div>

      {mode === 'label' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label className={s.field}>
            Label with your receipts
            <Select
              value={pick}
              onChange={setPick}
              ariaLabel="Gmail label"
              disabled={!labels || !labels.length}
              placeholder={!labels ? 'Loading labels…' : labels.length ? 'Choose a label' : 'No labels yet. Create one in Gmail.'}
              options={(labels ?? []).map(l => ({ value: l, label: l }))}
            />
          </label>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <span className={s.caption}>Want a filter for your label? Copy our ready-made bank &amp; receipt filter.</span>
            <button type="button" className={s.textBtnSm} onClick={copyFilter}>
              {copiedFilter ? 'Copied filter!' : 'Copy Gmail filter'}
            </button>
          </div>
        </div>
      )}

      {!isBusySync && target && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className={s.gmPreviewRow}>
            <Icon d={IC.sparkle} size={13} color={C.accent600} />
            <span>
              {previewing
                ? 'Checking matching receipt emails in the last 62 days…'
                : preview
                  ? preview.count > 0
                    ? `Found ${preview.count} matching ${preview.count === 1 ? 'email' : 'emails'} in the last ${preview.days} days.`
                    : `No matching emails found in the last ${preview.days} days.`
                  : 'Syncs automatically every 2 hours (Jakarta time).'}
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

      {isBusySync && (
        <div className={s.gmProgressBox} role="status" aria-live="polite">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13 }}>
            <strong>{busy === 'reimport' ? 'Re-importing receipts…' : 'Reading receipt emails…'}</strong>
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

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {changed || !gmail.label_name ? (
          <button
            type="button"
            className={s.btnPrimary}
            disabled={!target || !!busy}
            onClick={() =>
              run('label', async () => {
                const r = await syncAllBatches(() => chooseLabel(target), acc => setProgress(acc));
                await refreshImports();
                return resultText(r);
              })
            }
          >
            {busy === 'label' ? 'Importing…' : mode === 'auto' ? 'Enable Smart Scan & import' : 'Save label & import'}
          </button>
        ) : (
          <button
            type="button"
            className={s.btnPrimary}
            disabled={!!busy}
            onClick={() =>
              run('sync', async () => {
                const r = await syncAllBatches(() => syncNow(), acc => setProgress(acc));
                await refreshImports();
                return resultText(r);
              })
            }
          >
            {busy === 'sync' ? 'Syncing…' : 'Sync now'}
          </button>
        )}
        {gmail.label_name && !changed && (
          <button
            type="button"
            className={s.btnOutline}
            disabled={!!busy}
            title="Read the last 2 months again and add any receipts that are missing. Nothing is cleared."
            onClick={() =>
              run('range', async () => {
                const r = await syncAllBatches(() => syncRange(), acc => setProgress(acc));
                await refreshImports();
                return 'Checked the last 2 months. ' + resultText(r);
              })
            }
          >
            {busy === 'range' ? 'Syncing 2 months…' : 'Sync last 2 months'}
          </button>
        )}
        {gmail.label_name && !changed && (
          <button
            type="button"
            className={s.btnOutline}
            disabled={!!busy}
            title="Clear imported transactions and read again with the current rules. Your category changes are kept."
            onClick={() =>
              run('reimport', async () => {
                if (!window.confirm('Re-import clears imported transactions and reads again with the latest rules. Your category changes are kept. Continue?')) return '';
                const r = await syncAllBatches(() => reimportGmail(), acc => setProgress(acc));
                await refreshImports();
                return 'Re-imported. ' + resultText(r);
              })
            }
          >
            {busy === 'reimport' ? 'Re-importing…' : 'Re-import all'}
          </button>
        )}
        {gmail.label_name && (
          <button
            type="button"
            className={s.btnGhost}
            disabled={!!busy}
            onClick={() =>
              run('pause', async () => {
                const nextPaused = !gmail.paused;
                await setGmailPaused(nextPaused);
                await refreshImports();
                return nextPaused ? 'Automatic 2-hour sync paused. You can still sync manually anytime.' : 'Automatic 2-hour sync resumed.';
              })
            }
          >
            {gmail.paused ? 'Resume auto-sync' : 'Pause auto-sync'}
          </button>
        )}
        {gmail.label_name && (
          <button
            type="button"
            className={s.btnGhost}
            disabled={!!busy}
            onClick={() =>
              run('stop', async () => {
                await disconnectGmail();
                setPick('');
                await refreshImports();
                return 'Gmail sync stopped. Imported transactions are kept.';
              })
            }
          >
            Stop syncing
          </button>
        )}
        {onVercel && (
          <button
            type="button"
            className={s.btnGhost}
            disabled={!!busy}
            title="Revokes the app's access directly at Google and deletes the encrypted token. Imported transactions stay safe."
            onClick={() =>
              run('unlink', async () => {
                await disconnectGmail();
                await googleDisconnect();
                await refreshImports();
                setNeedsGoogle(true);
                return 'Google access revoked and removed from Maxie.';
              })
            }
          >
            Revoke &amp; disconnect Google
          </button>
        )}
      </div>
      <details className={s.gmPrivacyDetails}>
        <summary>Privacy &amp; permissions transparency</summary>
        <div className={s.gmPrivacyBody}>
          <span>
            <strong>Active access:</strong> Read-only Gmail ({gmail.google_has_drive ? 'plus drive.file for uploaded receipts' : 'no Google Drive access'}). Cannot send or delete emails.
          </span>
          <span>
            <strong>Allowed senders:</strong> {TRUSTED_RECEIPT_DOMAINS.slice(0, 12).join(', ')}, and Indonesian bank/e-receipt subjects.
          </span>
          <span>
            <strong>Manage externally:</strong>{' '}
            <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">
              myaccount.google.com/permissions
            </a>
          </span>
        </div>
      </details>
      {msg && (
        <span role="status" className={s.gmBannerGood}>
          {msg}
        </span>
      )}
      {err &&
        (needsAuthorization(err) ? (
          <div role="alert" className={s.note} style={{ background: C.amberTint, color: C.amberInk, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <strong>The script needs a new permission.</strong>
            <span>
              Open{' '}
              <a href={SCRIPT_EDITOR_URL} target="_blank" rel="noreferrer">
                the script editor
              </a>
              , choose <strong>setup</strong> and press <strong>Run</strong>, then approve (Advanced → Go to project → Allow). Come back and try again.
            </span>
          </div>
        ) : (
          <span className={s.error} role="alert">
            {err}
          </span>
        ))}
    </Modal>
  );
}
