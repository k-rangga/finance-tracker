/**
 * Receipts: photos or PDFs saved to a Google Drive folder you choose (Settings → Receipts folder), named
 * "YYYYMMDD_<transaction id>_<merchant>", and linked to their transaction in the receipts tab.
 *
 * Writing into a folder you made needs the Drive permission. The web app runs as you, so after a deploy that
 * adds it, run authorizeDrive() once from the Apps Script editor and approve.
 */

/** Run once from the editor to grant Drive access. */
function authorizeDrive() {
  Logger.log('Drive access OK: ' + DriveApp.getRootFolder().getName());
}

/** "https://drive.google.com/drive/folders/<id>?usp=…" or the bare id → the id. */
function folderId_(link) {
  const s = String(link || '').trim();
  const m = s.match(/\/folders\/([\w-]+)/) || s.match(/[?&]id=([\w-]+)/);
  return m ? m[1] : /^[\w-]{20,}$/.test(s) ? s : '';
}

function receiptFolder_() {
  const settings = props_('settings', null) || {};
  const id = folderId_(settings.receiptsFolder);
  if (!id) throw new Error('Set your receipts folder first: Settings → Receipts folder.');
  return DriveApp.getFolderById(id);
}

/** { txId: { fileId, name } }. */
function receipts_() {
  const out = {};
  readTable_('receipts').forEach(r => {
    out[r.tx_id] = { fileId: r.file_id, name: r.name };
  });
  return out;
}

/** p: { txId, name, mime, data (base64) }. Replaces the transaction's earlier receipt (moved to Drive's trash). */
function attachReceipt_(p) {
  if (!p.txId || !p.data) throw new Error('Nothing to save.');
  const folder = receiptFolder_();
  const blob = Utilities.newBlob(Utilities.base64Decode(p.data), p.mime || 'image/jpeg', String(p.name || 'receipt').slice(0, 150));
  const file = folder.createFile(blob);
  const old = readTable_('receipts').filter(r => r.tx_id === p.txId)[0];
  if (old) trashFile_(old.file_id);
  upsertRow_('receipts', 'tx_id', { tx_id: p.txId, file_id: file.getId(), name: file.getName(), mime: blob.getContentType(), uploaded_at: new Date().toISOString() });
  return { fileId: file.getId(), name: file.getName() };
}

/** The receipt goes to Drive's trash (recoverable there for 30 days), and is unlinked. */
function removeReceipt_(p) {
  const old = readTable_('receipts').filter(r => r.tx_id === p.txId)[0];
  if (old) trashFile_(old.file_id);
  deleteRow_('receipts', 'tx_id', p.txId);
  return true;
}

function trashFile_(id) {
  try {
    DriveApp.getFileById(id).setTrashed(true);
  } catch (e) {
    // Already gone or moved: nothing to clean up.
  }
}
