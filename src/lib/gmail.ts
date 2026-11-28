import { run } from './gas';

/** Special label stored in Gmail state for zero-setup Smart Receipt Scan (no manual label/filter needed). */
export const AUTO_LABEL = '__auto__';

/** Copy-pasteable Gmail search filter for users who prefer routing receipts into a dedicated label. */
export const SMART_FILTER_QUERY =
  'from:(bca.co.id OR klikbca.com OR blubybcadigital.id OR bankmandiri.co.id OR superbank.id OR jago.com OR seabank.co.id OR grab.com OR gojek.com OR tokopedia.com OR shopee.co.id OR pluang.com OR bibit.id)';

/** Read-only sender domains used by Smart Receipt Scan, surfaced cleanly in the privacy panel. */
export const TRUSTED_RECEIPT_DOMAINS = [
  'bca.co.id',
  'klikbca.com',
  'blubybcadigital.id',
  'bankmandiri.co.id',
  'superbank.id',
  'jago.com',
  'seabank.co.id',
  'bni.co.id',
  'bri.co.id',
  'cimbniaga.co.id',
  'permatabank.com',
  'jenius.com',
  'ocbc.id',
  'danamon.co.id',
  'grab.com',
  'gojek.com',
  'gopay.co.id',
  'ovo.id',
  'dana.id',
  'flip.id',
  'tokopedia.com',
  'shopee.co.id',
  'blibli.com',
  'traveloka.com',
  'tiket.com',
  'pluang.com',
  'bibit.id',
  'ajaib.co.id',
  'stockbit.com',
];

/** Friendly display name for the configured Gmail source. */
export const labelDisplay = (name: string | null | undefined) => (!name ? '' : name === AUTO_LABEL ? 'Smart Receipt Scan' : `“${name}”`);

/** `more`: not finished (time or Gmail's per-minute limit); `busy`: another sync is running. */
export type SyncResult = { imported: number; skipped: number; scanned: number; duplicates?: number; reversed?: number; more?: boolean; remaining?: number; paused?: boolean; busy?: boolean };

export type GmailPreviewSample = { from: string; subject: string; date?: string };
export type GmailPreview = { count: number; label: string; days: number; samples?: GmailPreviewSample[] };

export const listLabels = () => run<string[]>('listLabels');
/** Fast dry-run count + sample headers in the last 62 days (defaults to Smart Receipt Scan). */
export const previewGmail = (name?: string) => run<GmailPreview>('previewGmail', { name: name || AUTO_LABEL });
/** Saves the label (or '__auto__' for Smart Receipt Scan) and imports its last 62 days. */
export const chooseLabel = (name: string) => run<SyncResult>('chooseLabel', { name });
export const setGmailPaused = (paused: boolean) => run<unknown>('setGmailPaused', { paused });
export const syncNow = () => run<SyncResult>('syncNow');
/** Re-reads the last 2 months; adds only receipts that aren't imported yet (nothing is cleared). */
export const syncRange = () => run<SyncResult>('syncRange');
/** Clears imported transactions and reads again with the current rules (category fixes are kept). */
export const reimportGmail = () => run<SyncResult>('reimportGmail');
export const disconnectGmail = () => run<true>('disconnectGmail');
/** Vercel only: Google's consent screen — defaults to read-only Gmail; passes `includeDrive` only when needed. */
export const googleConnectUrl = (includeDrive = false) =>
  run<{ url: string }>('googleConnectUrl', includeDrive ? { includeDrive: true } : undefined);
export const googleDisconnect = () => run<true>('googleDisconnect');

/**
 * Runs an import/sync call and automatically continues subsequent batches when `more` is true
 * (and Gmail hasn't asked to pause), reporting cumulative live progress to `onProgress`.
 */
export async function syncAllBatches(
  firstRun: () => Promise<SyncResult>,
  onProgress?: (acc: SyncResult, round: number) => void,
  maxRounds = 6,
): Promise<SyncResult> {
  let acc: SyncResult = { imported: 0, skipped: 0, scanned: 0, duplicates: 0, reversed: 0 };
  for (let round = 1; round <= maxRounds; round++) {
    const r = round === 1 ? await firstRun() : await syncNow();
    if (r.busy) return round === 1 ? r : { ...acc, more: true };
    acc = {
      imported: acc.imported + (r.imported || 0),
      skipped: acc.skipped + (r.skipped || 0),
      scanned: acc.scanned + (r.scanned || 0),
      duplicates: (acc.duplicates || 0) + (r.duplicates || 0),
      reversed: (acc.reversed || 0) + (r.reversed || 0),
      more: r.more,
      remaining: r.remaining,
      paused: r.paused,
    };
    onProgress?.(acc, round);
    if (!r.more || r.paused) break;
  }
  return acc;
}
