import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_SETTINGS, type Settings } from './settings';
import { addDays, startOfToday, toISO } from './format';
import type { Prices, Snap, Trade } from '../screens/invest/model';
import type { TxRow } from '../data/transactions';

export type GmailConnection = {
  google_email: string | null;
  label_name: string | null;
  /** Label names the Apps Script last reported. */
  labels: string[];
  /** Last time the Apps Script checked in; null until setup has run. */
  script_seen_at: string | null;
  sync_requested: boolean;
  last_synced_at: string | null;
  last_sync_status: string | null;
  last_sync_count: number | null;
};

/** Everything the app stores per user. */
export type UserData = {
  settings: Settings;
  recat: Record<string, string>;
  journal: Trade[];
  prices: Prices;
  snaps: Snap[];
  /** Imported Gmail receipts from the start of the previous pay cycle. */
  txRows: TxRow[];
  gmail: GmailConnection | null;
};

export type Backend = {
  load(since: Date): Promise<UserData>;
  /** Re-read imported transactions and Gmail status (after a sync). */
  loadImports(since: Date): Promise<Pick<UserData, 'txRows' | 'gmail'>>;
  saveSettings(s: Settings): Promise<void>;
  /** `category: null` removes the override. */
  setOverride(txId: string, category: string | null): Promise<void>;
  saveTrade(t: Trade): Promise<void>;
  savePrices(p: Prices): Promise<void>;
  saveSnapshot(s: Snap): Promise<void>;
};

const defaultPrices = (): Prices => ({ map: {}, at: toISO(addDays(startOfToday(), -4)) });

// ---------------------------------------------------------------- Supabase

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

const settingsRow = (s: Settings, pricesOn?: string) => ({
  income: s.income,
  currency: s.currency,
  warn_at: s.warnAt,
  invest_pct: s.investPct,
  idx_cap: s.idxCap,
  us_cap: s.usCap,
  crypto_cap: s.cryptoCap,
  fx_rate: s.fxRate,
  ...(pricesOn ? { prices_updated_on: pricesOn } : {}),
  updated_at: new Date().toISOString(),
});

function check<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

export function supabaseBackend(db: SupabaseClient): Backend {
  const loadImports = async (since: Date) => {
    const [tx, g] = await Promise.all([
      db.from('transactions').select('id, occurred_at, title, category, amount, currency, source').gte('occurred_at', since.toISOString()).order('occurred_at', { ascending: false }),
      db.from('gmail_connections').select('google_email, label_name, labels, script_seen_at, sync_requested, last_synced_at, last_sync_status, last_sync_count').maybeSingle(),
    ]);
    return { txRows: check(tx) as TxRow[], gmail: check(g) as GmailConnection | null };
  };
  return {
    loadImports,
    async load(since) {
      const [s, o, t, p, n, imports] = await Promise.all([
        db.from('user_settings').select('*').maybeSingle(),
        db.from('transaction_overrides').select('tx_id, category'),
        db.from('trades').select('*').order('buy_date', { ascending: false }),
        db.from('prices').select('ticker, price'),
        db.from('portfolio_snapshots').select('day, value, contributed').order('day'),
        loadImports(since),
      ]);
      const srow = check(s) as Record<string, unknown> | null;
      if (!srow) {
        // New account: start empty with default settings.
        check(await db.from('user_settings').upsert(settingsRow(DEFAULT_SETTINGS)));
        return { settings: DEFAULT_SETTINGS, recat: {}, journal: [], prices: defaultPrices(), snaps: [], ...imports };
      }
      return {
        ...imports,
        settings: {
          income: srow.income as number,
          currency: srow.currency as Settings['currency'],
          warnAt: srow.warn_at as number,
          investPct: srow.invest_pct as number,
          idxCap: srow.idx_cap as number,
          usCap: srow.us_cap as number,
          cryptoCap: srow.crypto_cap as number,
          fxRate: srow.fx_rate as number,
        },
        recat: Object.fromEntries((check(o) as { tx_id: string; category: string }[]).map(r => [r.tx_id, r.category])),
        journal: (check(t) as TradeRow[]).map(toTrade),
        prices: {
          map: Object.fromEntries((check(p) as { ticker: string; price: number }[]).map(r => [r.ticker, r.price])),
          at: (srow.prices_updated_on as string | null) ?? defaultPrices().at,
        },
        snaps: (check(n) as { day: string; value: number; contributed: number }[]).map(r => ({ d: r.day, v: r.value, c: r.contributed })),
      };
    },
    async saveSettings(s) {
      check(await db.from('user_settings').upsert(settingsRow(s)));
    },
    async setOverride(txId, category) {
      if (category == null) check(await db.from('transaction_overrides').delete().eq('tx_id', txId));
      else check(await db.from('transaction_overrides').upsert({ tx_id: txId, category, updated_at: new Date().toISOString() }));
    },
    async saveTrade(t) {
      check(await db.from('trades').upsert(toRow(t)));
    },
    async savePrices(p) {
      const rows = Object.entries(p.map).map(([ticker, price]) => ({ ticker, price }));
      if (rows.length) check(await db.from('prices').upsert(rows));
      check(await db.from('user_settings').update({ prices_updated_on: p.at }).not('user_id', 'is', null));
    },
    async saveSnapshot(s) {
      check(await db.from('portfolio_snapshots').upsert({ day: s.d, value: s.v, contributed: s.c }));
    },
  };
}
