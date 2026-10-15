import { useEffect, useState } from 'react';
import s from '../styles/ui.module.css';
import { Modal } from './ui';
import { useData } from '../lib/data';
import { chooseLabel, disconnectGmail, listLabels, reimportGmail, syncNow, type SyncResult } from '../lib/gmail';
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

const resultText = (r: SyncResult) =>
  r.busy
    ? 'An import is already running in the background. Check back in a few minutes.'
    : `Read ${r.scanned} ${r.scanned === 1 ? 'email' : 'emails'}, imported ${r.imported} new ${r.imported === 1 ? 'receipt' : 'receipts'}` +
  (r.duplicates ? ` · ${r.duplicates} ${r.duplicates === 1 ? 'duplicate' : 'duplicates'} merged` : '') +
  (r.reversed ? ` · ${r.reversed} cancelled ${r.reversed === 1 ? 'charge' : 'charges'} removed` : '') +
  (r.skipped ? ` · ${r.skipped} not imported (no amount, duplicates or reversals)` : '') +
  '.' +
  (r.more
    ? ` ${r.remaining != null ? r.remaining + ' more' : 'More'} to read${r.paused ? ' (Gmail asked to slow down)' : ''}: it continues on its own in about 2 minutes, until done.`
    : '');

export function GmailDialog({ onClose }: { onClose: () => void }) {
  const { gmail, refreshImports } = useData();
  const [labels, setLabels] = useState<string[] | null>(null);
  const [pick, setPick] = useState(gmail.label_name ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    listLabels()
      .then(setLabels)
      .catch(e => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  const run = async (what: string, fn: () => Promise<string>) => {
    setBusy(what);
    setErr('');
    setMsg('');
    try {
      setMsg(await fn());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const lastError = gmail.last_sync_status?.startsWith('error') ? gmail.last_sync_status.replace(/^error:\s*/, '') : null;
  const partial = gmail.last_sync_status === 'partial';
  const changed = !!pick && pick !== gmail.label_name;

  return (
    <Modal title="Gmail sync" onClose={onClose}>
      <p style={{ fontSize: 14, lineHeight: 1.5, color: C.textMuted }}>
        Receipts are read (never changed) from one Gmail label in <strong>{gmail.google_email ?? 'your account'}</strong>. It syncs every morning at 06:00 and whenever you press
        Sync now.
      </p>
      <div className={s.note} style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14 }}>
        <span>
          {gmail.label_name ? (
            <>
              Label <strong>“{gmail.label_name}”</strong> · last synced {syncedAgo(gmail.last_synced_at)}
              {gmail.last_sync_count != null && !lastError ? ` · ${gmail.last_sync_count} emails read` : ''}
            </>
          ) : (
            'No label chosen yet.'
          )}
        </span>
        {lastError && <span style={{ fontSize: 13, fontWeight: 700, color: C.redInk }}>Last sync failed: {lastError}</span>}
        {partial && <span style={{ fontSize: 13, fontWeight: 700, color: C.amberInk }}>Import still running in the background. It continues every couple of minutes until done.</span>}
      </div>
      <label className={s.field}>
        Label with your receipts
        <select className={s.select} value={pick} onChange={e => setPick(e.target.value)} disabled={!labels}>
          <option value="">{!labels ? 'Loading labels…' : labels.length ? 'Choose a label' : 'No labels yet. Create one in Gmail.'}</option>
          {labels?.map(l => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <span className={s.caption}>Tip: add Gmail filters that put receipts from your bank, e-wallets, ride and shopping apps under this label.</span>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {changed || !gmail.label_name ? (
          <button
            type="button"
            className={s.btnPrimary}
            disabled={!pick || !!busy}
            onClick={() =>
              run('label', async () => {
                const r = await chooseLabel(pick);
                await refreshImports();
                return resultText(r);
              })
            }
          >
            {busy === 'label' ? 'Importing… (up to 5 min)' : 'Save label & import'}
          </button>
        ) : (
          <button
            type="button"
            className={s.btnPrimary}
            disabled={!!busy}
            onClick={() =>
              run('sync', async () => {
                const r = await syncNow();
                await refreshImports();
                return resultText(r);
              })
            }
          >
            {busy === 'sync' ? 'Syncing… (up to 5 min)' : 'Sync now'}
          </button>
        )}
        {gmail.label_name && !changed && (
          <button
            type="button"
            className={s.btnOutline}
            disabled={!!busy}
            title="Clear imported transactions and read the label again with the current rules. Your category changes are kept."
            onClick={() =>
              run('reimport', async () => {
                if (!window.confirm('Re-import clears the imported transactions and reads the label again with the latest rules. Your category changes are kept. Continue?')) return '';
                const r = await reimportGmail();
                await refreshImports();
                return 'Re-imported. ' + resultText(r);
              })
            }
          >
            {busy === 'reimport' ? 'Re-importing… (up to 5 min)' : 'Re-import all'}
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
      </div>
      {msg && (
        <span role="status" style={{ fontSize: 14, color: C.accent800, background: C.accentTint, borderRadius: 12, padding: '10px 12px' }}>
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
