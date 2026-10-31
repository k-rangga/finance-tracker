import type { TxView } from './budget';
import { tidyName } from './format';

/** Photos are shrunk to this many pixels on the long side: still readable, a few hundred KB. */
const MAX_SIDE = 1600;
/** PDFs (and anything that isn't a photo) are uploaded as they are, up to this size. */
const MAX_BYTES = 10 * 1024 * 1024;

/** The transaction a receipt belongs to: an installment payment's is its purchase's. */
export const receiptTxId = (t: TxView) => t.plan?.of ?? t.id;

/** "20261031_<transaction id>_Kopi Kenangan.jpg": the transaction's date, its id and the merchant. */
export function receiptName(t: TxView, ext: string) {
  const d = t.date;
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  // Characters Drive or other systems choke on, and runs of spaces.
  const name = tidyName(t.title).replace(/[\\/:*?"<>|#%]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Receipt';
  return `${ymd}_${receiptTxId(t)}_${name}.${ext}`;
}

/** A picked file as base64 for upload: photos shrunk to JPEG, other files as they are. */
export async function readReceipt(file: File): Promise<{ mime: string; ext: string; data: string }> {
  if (file.type.startsWith('image/') && file.type !== 'image/gif') {
    const img = await loadImage(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext('2d')!;
    // White behind transparent PNGs, which JPEG would otherwise turn black.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { mime: 'image/jpeg', ext: 'jpg', data: canvas.toDataURL('image/jpeg', 0.82).split(',')[1] };
  }
  if (file.size > MAX_BYTES) throw new Error('That file is over 10 MB. Try a photo or a smaller PDF.');
  const ext = (file.name.split('.').pop() || 'pdf').toLowerCase().slice(0, 5);
  const data = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(new Error("Couldn't read that file."));
    r.readAsDataURL(file);
  });
  return { mime: file.type || 'application/octet-stream', ext, data };
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Couldn't open that photo. Try a JPEG or PNG."));
    };
    img.src = url;
  });
}

/** Where a saved receipt opens: Drive's viewer (dev receipts carry their own image). */
export const receiptUrl = (r: { fileId: string; url?: string }) => r.url ?? `https://drive.google.com/file/d/${r.fileId}/view`;
