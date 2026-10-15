import { run } from './gas';

/** `more`: stopped before the Apps Script time limit; `remaining` emails are read on the next run. */
export type SyncResult = { imported: number; skipped: number; scanned: number; duplicates?: number; reversed?: number; more?: boolean; remaining?: number };

export const listLabels = () => run<string[]>('listLabels');
/** Saves the label and imports its last 62 days. */
export const chooseLabel = (name: string) => run<SyncResult>('chooseLabel', { name });
export const syncNow = () => run<SyncResult>('syncNow');
/** Clears imported transactions and reads the label again with the current rules (category fixes are kept). */
export const reimportGmail = () => run<SyncResult>('reimportGmail');
export const disconnectGmail = () => run<true>('disconnectGmail');
