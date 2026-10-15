import { useEffect, useState } from 'react';
import s from '../styles/ui.module.css';
import { Modal } from './ui';
import { useData } from '../lib/data';
import { chooseLabel, createKey, disconnectGmail, requestSync, SCRIPT_URL } from '../lib/gmail';
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

export function GmailDialog({ onClose }: { onClose: () => void }) {
  const { gmail, refreshImports } = useData();
  const [key, setKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pick, setPick] = useState(gmail?.label_name ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  // While the dialog is open, refresh status so the script's check-in and imports show up.
  useEffect(() => {
    const id = window.setInterval(() => void refreshImports().catch(() => undefined), 15000);
    return () => window.clearInterval(id);
  }, [refreshImports]);

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

  const linked = !!gmail?.script_seen_at;
  const lastError = gmail?.last_sync_status?.startsWith('error') ? gmail.last_sync_status.replace(/^error:\s*/, '') : null;

  const newKey = () =>
    run('key', async () => {
      setKey(await createKey());
      setCopied(false);
      await refreshImports();
    });

  return (
    <Modal title="Gmail sync" onClose={onClose} width={580}>
      <p style={{ fontSize: 14, lineHeight: 1.5, color: C.textMuted }}>
        Your own Google Apps Script reads one Gmail label (read-only) and sends those receipts here. It runs every morning, and within 10 minutes of Sync now.
      </p>

      {(!gmail || !linked || key) && (
        <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 14, fontSize: 14, lineHeight: 1.5 }}>
          <li>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span>Create a connection key. It is shown once.</span>
              {key ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <code style={{ background: C.bg, borderRadius: 10, padding: '10px 12px', fontSize: 13, wordBreak: 'break-all', flex: '1 1 260px' }}>{key}</code>
                  <button
                    type="button"
                    className={s.btnOutline}
                    onClick={() =>
                      navigator.clipboard
                        .writeText(key)
                        .then(() => setCopied(true))
                        .catch(() => setErr('Copy failed; select the key and copy it manually.'))
                    }
                  >
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              ) : (
                <button type="button" className={s.btnPrimary} style={{ alignSelf: 'flex-start' }} disabled={!!busy} onClick={newKey}>
                  {busy === 'key' ? 'Creating…' : gmail ? 'Create a new key' : 'Create connection key'}
                </button>
              )}
            </div>
          </li>
          <li>
            Open{' '}
            <a href={SCRIPT_URL} target="_blank" rel="noreferrer">
              your Apps Script
            </a>
            , go to <strong>Project Settings → Script Properties</strong> and add <code>INGEST_KEY</code> with the key as its value.
          </li>
          <li>
            In the editor, select <strong>setup</strong> and press <strong>Run</strong>. Approve the permissions (choose Advanced → Go to project if Google warns the script is unverified; it's yours).
          </li>
          <li>{linked ? 'Done. Your script has checked in.' : 'This dialog updates when the script checks in.'}</li>
        </ol>
      )}

      {gmail && linked && (
        <>
          <div className={s.note} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span>
              Linked to <strong>{gmail.google_email ?? 'your Gmail'}</strong> · script checked in {syncedAgo(gmail.script_seen_at)}
            </span>
            <span style={{ fontSize: 13, color: C.textMuted }}>
              {gmail.label_name
                ? `Label “${gmail.label_name}” · ${gmail.sync_requested ? 'sync requested, runs within 10 minutes' : `last synced ${syncedAgo(gmail.last_synced_at)}${gmail.last_sync_count != null && !lastError ? ` · ${gmail.last_sync_count} emails read` : ''}`}`
                : 'No label chosen yet'}
            </span>
            {lastError && <span style={{ fontSize: 13, fontWeight: 700, color: C.redInk }}>Last sync failed: {lastError}</span>}
          </div>
          <label className={s.field}>
            Label with your receipts
            <select className={s.select} value={pick} onChange={e => setPick(e.target.value)}>
              <option value="">{gmail.labels.length ? 'Choose a label' : 'No labels yet. Create one in Gmail.'}</option>
              {gmail.labels.map(l => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <span className={s.caption}>Tip: add Gmail filters that put receipts from your bank, e-wallets, ride and shopping apps under this label. New labels appear here within 10 minutes.</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {pick && pick !== gmail.label_name ? (
              <button
                type="button"
                className={s.btnPrimary}
                disabled={!!busy}
                onClick={() =>
                  run('label', async () => {
                    await chooseLabel(pick);
                    await refreshImports();
                    return `Saved. Receipts from “${pick}” (last 62 days) import within 10 minutes.`;
                  })
                }
              >
                {busy === 'label' ? 'Saving…' : 'Save label'}
              </button>
            ) : (
              <button
                type="button"
                className={s.btnPrimary}
                disabled={!!busy || !gmail.label_name || gmail.sync_requested}
                onClick={() =>
                  run('sync', async () => {
                    await requestSync();
                    await refreshImports();
                    return 'Sync requested. Your script runs it within 10 minutes.';
                  })
                }
              >
                {gmail.sync_requested ? 'Sync pending' : 'Sync now'}
              </button>
            )}
            {!key && (
              <button type="button" className={s.btnGhost} disabled={!!busy} onClick={newKey}>
                New key
              </button>
            )}
            <button
              type="button"
              className={s.btnGhost}
              disabled={!!busy}
              onClick={() =>
                run('disconnect', async () => {
                  await disconnectGmail();
                  setKey(null);
                  await refreshImports();
                  return 'Disconnected. Imported transactions are kept. Remove the script’s triggers if you no longer want it to run.';
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
