import type { SupabaseClient } from '@supabase/supabase-js';
import { KEYS, storage } from './storage';
import { DEFAULT_SETTINGS, type Settings } from './settings';
import { addDays, startOfToday, toISO } from './format';
import { SEED_JOURNAL, type Prices, type Snap, type Trade } from '../screens/invest/model';

/** Everything the app stores per user. */
export type UserData = {
  settings: Settings;
  recat: Record<string, string>;
  journal: Trade[];
  prices: Prices;
  snaps: Snap[];
};

export type Backend = {
  mode: 'local' | 'cloud';
  load(): Promise<UserData>;
  saveSettings(s: Settings): Promise<void>;
  /** `category: null` removes the override. */
  setOverride(txId: string, category: string | null): Promise<void>;
  saveTrade(t: Trade): Promise<void>;
  savePrices(p: Prices): Promise<void>;
  saveSnapshot(s: Snap): Promise<void>;
};

const defaultPrices = (): Prices => ({ map: {}, at: toISO(addDays(startOfToday(), -4)) });

// ---------------------------------------------------------------- browser storage

export const localBackend: Backend = {
  mode: 'local',
  async load() {
    return {
      settings: { ...DEFAULT_SETTINGS, ...storage.get<Partial<Settings>>(KEYS.settings, {}) },
      recat: storage.get(KEYS.recat, {}),
      journal: storage.get(KEYS.journal, SEED_JOURNAL),
      prices: storage.get(KEYS.prices, defaultPrices()),
      snaps: storage.get(KEYS.snaps, []),
    };
  },
  async saveSettings(s) {
    storage.set(KEYS.settings, s);
  },
  async setOverride(txId, category) {
    const r = storage.get<Record<string, string>>(KEYS.recat, {});
    if (category == null) delete r[txId];
    else r[txId] = category;
    storage.set(KEYS.recat, r);
  },
  async saveTrade(t) {
    const j = storage.get<Trade[]>(KEYS.journal, SEED_JOURNAL);
    const i = j.findIndex(x => x.id === t.id);
    storage.set(KEYS.journal, i < 0 ? [t, ...j] : j.map(x => (x.id === t.id ? t : x)));
  },
  async savePrices(p) {
    storage.set(KEYS.prices, p);
  },
  async saveSnapshot(s) {
    const list = storage.get<Snap[]>(KEYS.snaps, []).filter(x => x.d !== s.d);
    list.push(s);
    list.sort((a, b) => a.d.localeCompare(b.d));
    storage.set(KEYS.snaps, list);
  },
};

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
  return {
    mode: 'cloud',
    async load() {
      const [s, o, t, p, n] = await Promise.all([
        db.from('user_settings').select('*').maybeSingle(),
        db.from('transaction_overrides').select('tx_id, category'),
        db.from('trades').select('*').order('buy_date', { ascending: false }),
        db.from('prices').select('ticker, price'),
        db.from('portfolio_snapshots').select('day, value, contributed').order('day'),
      ]);
      const srow = check(s) as Record<string, unknown> | null;
      if (!srow) return importLocal(db);
      return {
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

/**
 * First sign-in: copy what this browser already has (settings, category fixes,
 * journal edits, prices, snapshots) into the new account. Nothing local → empty account.
 */
async function importLocal(db: SupabaseClient): Promise<UserData> {
  const has = (k: string) => storage.getRaw(k) != null;
  const local = await localBackend.load();
  const data: UserData = {
    settings: local.settings,
    recat: has(KEYS.recat) ? local.recat : {},
    journal: has(KEYS.journal) ? local.journal : [],
    prices: has(KEYS.prices) ? local.prices : defaultPrices(),
    snaps: has(KEYS.snaps) ? local.snaps : [],
  };
  const overrides = Object.entries(data.recat).map(([tx_id, category]) => ({ tx_id, category }));
  const prices = Object.entries(data.prices.map).map(([ticker, price]) => ({ ticker, price }));
  const snaps = data.snaps.map(s => ({ day: s.d, value: s.v, contributed: s.c }));
  if (overrides.length) check(await db.from('transaction_overrides').upsert(overrides));
  if (data.journal.length) check(await db.from('trades').upsert(data.journal.map(toRow)));
  if (prices.length) check(await db.from('prices').upsert(prices));
  if (snaps.length) check(await db.from('portfolio_snapshots').upsert(snaps));
  // Settings last: its presence marks the account as initialised.
  check(await db.from('user_settings').upsert(settingsRow(data.settings, has(KEYS.prices) ? data.prices.at : undefined)));
  return data;
}
