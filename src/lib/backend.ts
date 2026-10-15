import { run } from './gas';
import { DEFAULT_SETTINGS, type Settings } from './settings';
import { addDays, startOfToday, toISO } from './format';
import type { Prices, Snap, Trade } from '../screens/invest/model';
import type { TxRow } from '../data/transactions';

export type GmailConnection = {
  google_email: string | null;
  label_name: string | null;
  last_synced_at: string | null;
  last_sync_status: string | null;
  last_sync_count: number | null;
};

/** Everything the app stores (in the Apps Script's spreadsheet and script properties). */
export type UserData = {
  /** The Google account the web app runs as. */
  email: string | null;
  settings: Settings;
  recat: Record<string, string>;
  /** Reimbursements: { incomeId: expenseId }. */
  links: Record<string, string>;
  /** Your share of an expense as a fraction of its amount: { txId: 0–1 }. */
  shares: Record<string, number>;
  journal: Trade[];
  prices: Prices;
  snaps: Snap[];
  /** Imported Gmail receipts from the start of the previous pay cycle. */
  txRows: TxRow[];
  gmail: GmailConnection;
};

export type Backend = {
  load(since: Date): Promise<UserData>;
  /** Re-read imported transactions and Gmail status (after a sync). */
  loadImports(since: Date): Promise<Pick<UserData, 'txRows' | 'gmail'>>;
  saveSettings(s: Settings): Promise<void>;
  /** `category: null` removes the override. */
  setOverride(txId: string, category: string | null): Promise<void>;
  /** `expenseId: null` removes the link. */
  setLink(incomeId: string, expenseId: string | null): Promise<void>;
  /** `ratio: null` counts the full amount again. */
  setShare(txId: string, ratio: number | null): Promise<void>;
  saveTrade(t: Trade): Promise<void>;
  savePrices(p: Prices): Promise<void>;
  saveSnapshot(s: Snap): Promise<void>;
};

const defaultPrices = (): Prices => ({ map: {}, at: toISO(addDays(startOfToday(), -4)) });

// ---------------------------------------------------------------- Apps Script

type TradeRow = {
  id: string;
  market: Trade['mk'];
  ticker: string;
  name: string;
  buy_date: string;
  price: number;
  quantity: number;
  fee: number | null;
  style: Trade['st'];
  conviction: Trade['cv'];
  target: number | null;
  stop: number | null;
  catalyst: string | null;
  catalyst_date: string | null;
  thesis: string;
  tags: string | null;
  leverage: number | null;
  direction: 'Long' | 'Short' | null;
  exit_price: number | null;
  exit_date: string | null;
  followed_plan: 'Yes' | 'Partly' | 'No' | null;
  rating: number | null;
  lesson: string | null;
};

const u = <T>(v: T | null) => (v == null ? undefined : v);

const toTrade = (r: TradeRow): Trade => ({
  id: r.id,
  mk: r.market,
  tk: r.ticker,
  nm: r.name,
  d: r.buy_date,
  px: r.price,
  q: r.quantity,
  fee: u(r.fee),
  st: r.style,
  cv: r.conviction,
  tg: u(r.target),
  sl: u(r.stop),
  cat: u(r.catalyst),
  cd: u(r.catalyst_date),
  th: r.thesis,
  tags: u(r.tags),
  lev: u(r.leverage),
  dir: u(r.direction),
  ex: r.exit_price != null && r.exit_date ? { px: r.exit_price, d: r.exit_date, fp: u(r.followed_plan), rt: u(r.rating), ls: u(r.lesson) } : undefined,
});

const toRow = (t: Trade): TradeRow => ({
  id: t.id,
  market: t.mk,
  ticker: t.tk,
  name: t.nm ?? '',
  buy_date: t.d,
  price: t.px,
  quantity: t.q,
  fee: t.fee ?? null,
  style: t.st,
  conviction: t.cv,
  target: t.tg ?? null,
  stop: t.sl ?? null,
  catalyst: t.cat || null,
  catalyst_date: t.cd || null,
  thesis: t.th ?? '',
  tags: t.tags || null,
  leverage: t.lev && t.lev > 1 ? t.lev : null,
  direction: t.lev && t.lev > 1 ? (t.dir ?? 'Long') : null,
  exit_price: t.ex?.px ?? null,
  exit_date: t.ex?.d ?? null,
  followed_plan: t.ex?.fp ?? null,
  rating: t.ex?.rt ?? null,
  lesson: t.ex?.ls ?? null,
});

type State = {
  email: string | null;
  settings: Settings | null;
  recat: Record<string, string>;
  links?: Record<string, string>;
  shares?: Record<string, number>;
  trades: TradeRow[];
  prices: Prices | null;
  snaps: { day: string; value: number; contributed: number }[];
  txRows: TxRow[];
  gmail: GmailConnection;
};

/** Server calls go to `api()` in apps-script/Code.js. */
export const backend: Backend = {
  async load(since) {
    const s = await run<State>('getState', { since: since.toISOString() });
    return {
      email: s.email,
      settings: { ...DEFAULT_SETTINGS, ...(s.settings ?? {}) },
      recat: s.recat,
      links: s.links ?? {},
      shares: s.shares ?? {},
      journal: s.trades.map(toTrade).sort((a, b) => b.d.localeCompare(a.d)),
      prices: s.prices ?? defaultPrices(),
      snaps: s.snaps.map(r => ({ d: r.day, v: r.value, c: r.contributed })).sort((a, b) => a.d.localeCompare(b.d)),
      txRows: s.txRows,
      gmail: s.gmail,
    };
  },
  loadImports: since => run('getImports', { since: since.toISOString() }),
  saveSettings: async settings => void (await run('saveSettings', { settings })),
  setOverride: async (txId, category) => void (await run('setOverride', { txId, category })),
  setLink: async (incomeId, expenseId) => void (await run('setLink', { incomeId, expenseId })),
  setShare: async (txId, ratio) => void (await run('setShare', { txId, ratio })),
  saveTrade: async t => void (await run('saveTrade', { trade: toRow(t) })),
  savePrices: async prices => void (await run('savePrices', { prices })),
  saveSnapshot: async s => void (await run('saveSnapshot', { snap: { day: s.d, value: s.v, contributed: s.c } })),
};
