/**
 * One user's request through the Apps Script engine: load what the action reads (in parallel), connect Google
 * when it needs Gmail or Drive, run it, and return its result.
 */
import { runAction, runFunction, tableSpec, type RunContext } from './engine.js';
import { serviceKey, supabaseUrl } from './env.js';
import { accessToken, hasGoogle } from './google.js';
import { SupabaseStore } from './store.js';
import type { User } from './auth.js';

let spec: ReturnType<typeof tableSpec> | null = null;
export const store = (userId: string) => {
  spec ??= tableSpec();
  return new SupabaseStore(spec.tables, spec.numeric, supabaseUrl(), serviceKey(), userId);
};

const GMAIL_TABLES = ['transactions', 'skipped', 'overrides', 'shares', 'notes', 'links', 'removed', 'installments'];
/** Tables each action reads, loaded together before it runs (anything else loads when first read). */
const PREFETCH: Record<string, string[]> = {
  getState: [
    'removed', 'overrides', 'links', 'shares', 'notes', 'installments', 'category_rules', 'subs', 'receipts',
    'subscriptions', 'trades', 'trade_updates', 'snapshots', 'transactions', 'config',
  ],
  getImports: ['transactions'],
  getPerps: ['perp_fills', 'perp_funding', 'perp_notes', 'config'],
  syncPerps: ['perp_fills', 'perp_funding', 'perp_notes', 'config'],
  chooseLabel: GMAIL_TABLES,
  syncNow: GMAIL_TABLES,
  syncRange: GMAIL_TABLES,
  reimportGmail: GMAIL_TABLES,
  getGuesses: ['cat_guesses'],
  setRules: ['category_rules'],
};
/** Actions that read Gmail or Drive. */
const GOOGLE = new Set(['listLabels', 'chooseLabel', 'syncNow', 'syncRange', 'reimportGmail', 'attachReceipt', 'getReceipt', 'removeReceipt']);

export async function runForUser(user: User, action: string, payload: unknown, timeBudgetMs = 240_000) {
  const s = store(user.id);
  const [google, connected] = await Promise.all([
    GOOGLE.has(action) ? accessToken(user.id) : Promise.resolve(null),
    action === 'getState' || action === 'getImports' ? hasGoogle(user.id) : Promise.resolve(false),
    s.prefetch(PREFETCH[action] ?? []),
  ]);
  const ctx: RunContext = { store: s, email: user.email, google, timeBudgetMs };
  // First load for a new user: the config tab's wallet-address row (Apps Script did this in doGet).
  if (action === 'getState') runFunction(ctx, 'ensurePerpConfig_');
  const result = runAction(ctx, action, payload);
  if ((action === 'getState' || action === 'getImports') && result && result.gmail) result.gmail.google_connected = connected;
  return result;
}

/** The hourly job for one user: Hyperliquid every few hours, Gmail at the usual hours (or to finish an import). */
export async function hourlyForUser(user: User, timeBudgetMs: number) {
  const s = store(user.id);
  const [google] = await Promise.all([accessToken(user.id), s.prefetch([...GMAIL_TABLES, 'config', 'perp_fills', 'perp_funding'])]);
  const ctx: RunContext = { store: s, email: user.email, google, timeBudgetMs };
  const gmail = JSON.parse(s.getProp('gmail') || '{}') as { label?: string; lastStatus?: string };
  if (!google || !gmail.label) return runFunction(ctx, 'scheduledPerpSync_');
  // An import that ran out of time carries on now; otherwise the usual schedule decides.
  if (gmail.lastStatus !== 'partial') return runFunction(ctx, 'scheduledSync');
  runFunction(ctx, 'scheduledPerpSync_');
  return runFunction(ctx, 'syncGmail_');
}
