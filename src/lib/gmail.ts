import { run } from './gas';

/** `more`: stopped before the Apps Script time limit; `remaining` emails are read on the next run. */
export type SyncResult = { imported: number; skipped: number; scanned: number; more?: boolean; remaining?: number };

export const listLabels = () => run<string[]>('listLabels');
/** Saves the label and imports its last 62 days. */
export const chooseLabel = (name: string) => run<SyncResult>('chooseLabel', { name });
export const syncNow = () => run<SyncResult>('syncNow');
export const disconnectGmail = () => run<true>('disconnectGmail');
