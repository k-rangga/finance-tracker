import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import s from '../styles/ui.module.css';
import { Modal } from './ui';
import { backend, type Receipt, type ReceiptFile } from '../lib/backend';
import { receiptUrl } from '../lib/receipt';
import { C } from '../lib/tokens';

/** Receipts already opened this session: showing one again is instant. */
const cache = new Map<string, ReceiptFile>();

type Props = {
  txId: string;
  receipt: Receipt;
  /** "Kopi Kenangan · 31 Oct". */
  title: string;
  onClose: () => void;
};

/** The receipt photo or PDF, shown over the page instead of opening Drive in another tab. */
export function ReceiptPreview({ txId, receipt, title, onClose }: Props) {
  const key = txId + ':' + receipt.fileId;
  const [file, setFile] = useState<ReceiptFile | null>(cache.get(key) ?? null);
  const [error, setError] = useState('');
  const [src, setSrc] = useState('');

  useEffect(() => {
    if (file) return;
    let live = true;
    backend
      .getReceipt(txId)
      .then(f => {
        cache.set(key, f);
        if (live) setFile(f);
      })
      .catch(e => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [key, txId, file]);

  // A blob URL rather than a data URL: PDFs only display from one, and it's lighter for big photos.
  useEffect(() => {
    if (!file) return;
    const bytes = Uint8Array.from(atob(file.data), ch => ch.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: file.mime }));
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const isImage = file?.mime.startsWith('image/');
  const drive = receiptUrl(receipt);

  return createPortal(
    <Modal title={title} onClose={onClose} width={640}>
      <div className={s.receiptView}>
        {error ? (
          <span style={{ color: 'var(--red-ink)', fontSize: 14 }}>Couldn't load the receipt: {error}</span>
        ) : !src ? (
          <span style={{ color: C.textMuted, fontSize: 14 }}>Loading receipt…</span>
        ) : isImage ? (
          <img src={src} alt={`Receipt: ${receipt.name}`} />
        ) : (
          <iframe src={src} title={`Receipt: ${receipt.name}`} />
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 13, color: C.textMuted }}>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{receipt.name}</span>
        {!drive.startsWith('data:') && (
          <a href={drive} target="_blank" rel="noopener noreferrer" style={{ color: C.accent800, fontWeight: 600, whiteSpace: 'nowrap' }}>
            Open in Drive
          </a>
        )}
      </div>
    </Modal>,
    document.body,
  );
}
