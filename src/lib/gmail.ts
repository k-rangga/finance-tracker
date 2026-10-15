import { run } from './gas';

export type SyncResult = { imported: number; skipped: number; scanned: number };

export const listLabels = () => run<string[]>('listLabels');
/** Saves the label and imports its last 62 days. */
export const chooseLabel = (name: string) => run<SyncResult>('chooseLabel', { name });
export const syncNow = () => run<SyncResult>('syncNow');
export const disconnectGmail = () => run<true>('disconnectGmail');
