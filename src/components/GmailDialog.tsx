import { useEffect, useState } from 'react';
import s from '../styles/ui.module.css';
import { Modal } from './ui';
import { useData } from '../lib/data';
import { chooseLabel, connectGmail, disconnectGmail, listLabels, syncNow, type GmailLabel, type SyncResult } from '../lib/gmail';
import { C } from '../lib/tokens';

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
  `Imported ${r.imported} ${r.imported === 1 ? 'receipt' : 'receipts'}` + (r.skipped ? ` · ${r.skipped} ${r.skipped === 1 ? 'email' : 'emails'} had no amount and were skipped` : '') + '.';

export function GmailDialog({ onClose, notice }: { onClose: () => void; notice?: string }) {
  const { gmail, refreshImports } = useData();
  const [labels, setLabels] = useState<GmailLabel[] | null>(null);
  const [pick, setPick] = useState(gmail?.label_id ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState(notice ?? '');

  useEffect(() => {
    if (!gmail) return;
    listLabels()
      .then(setLabels)
      .catch(e => setErr(e instanceof Error ? e.message : String(e)));
  }, [gmail]);

  const run = async (what: string, fn: () => Promise<string | void>) => {
    setBusy(what);
    setErr('');
    setMsg('');
    try {
      const m = await fn();
      if (m) setMsg(m);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const save = () =>
    run('label', async () => {
      const l = labels?.find(x => x.id === pick);
      if (!l) throw new Error('Choose a label.');
      const r = await chooseLabel(l);
      await refreshImports();
      return resultText(r);
    });

  const lastError = gmail?.last_sync_status?.startsWith('error') ? gmail.last_sync_status.replace(/^error:\s*/, '') : null;

  return (
    <Modal title="Gmail sync" onClose={onClose}>
      <p style={{ fontSize: 14, lineHeight: 1.5, color: C.textMuted }}>
        Receipts are imported from one Gmail label, every day and whenever you press Sync now. Access is read-only; you can disconnect at any time.
      </p>

      {!gmail ? (
        <button type="button" className={s.btnPrimary} style={{ alignSelf: 'flex-start' }} disabled={!!busy} onClick={() => run('connect', connectGmail)}>
          {busy === 'connect' ? 'Opening Google…' : 'Connect Gmail'}
        </button>
      ) : (
        <>
          <div className={s.note} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span>
              Connected as <strong>{gmail.google_email ?? 'your Google account'}</strong>
            </span>
            <span style={{ fontSize: 13, color: C.textMuted }}>
              {gmail.label_name
                ? `Label “${gmail.label_name}” · last synced ${syncedAgo(gmail.last_synced_at)}${gmail.last_sync_count != null && !lastError ? ` · ${gmail.last_sync_count} imported` : ''}`
                : 'No label chosen yet'}
            </span>
            {lastError && <span style={{ fontSize: 13, fontWeight: 700, color: C.redInk }}>Last sync failed: {lastError}</span>}
          </div>
          <label className={s.field}>
            Label with your receipts
            <select className={s.select} value={pick} onChange={e => setPick(e.target.value)} disabled={!labels}>
              <option value="">{labels ? 'Choose a label' : 'Loading labels…'}</option>
              {labels?.map(l => (
                <option key={l.id} value={l.id}>
                  {l.name}
                  {l.system ? ' (Gmail)' : ''}
                </option>
              ))}
            </select>
          </label>
          <span className={s.caption}>Tip: create a Gmail filter that puts receipts from your bank, e-wallets, ride and shopping apps under one label.</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {pick !== (gmail.label_id ?? '') || !gmail.label_id ? (
              <button type="button" className={s.btnPrimary} disabled={!pick || !!busy} onClick={save}>
                {busy === 'label' ? 'Importing…' : 'Save label & import'}
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
                {busy === 'sync' ? 'Syncing…' : 'Sync now'}
              </button>
            )}
            <button
              type="button"
              className={s.btnGhost}
              disabled={!!busy}
              onClick={() =>
                run('disconnect', async () => {
                  await disconnectGmail();
                  await refreshImports();
                  return 'Gmail disconnected. Imported transactions are kept.';
                })
              }
            >
              Disconnect
            </button>
          </div>
        </>
      )}
      {msg && (
        <span role="status" style={{ fontSize: 14, color: C.accent800, background: C.accentTint, borderRadius: 12, padding: '10px 12px' }}>
          {msg}
        </span>
      )}
      {err && (
        <span className={s.error} role="alert">
          {err}
        </span>
      )}
    </Modal>
  );
}
