/**
 * Hyperliquid trading journal: your fills, read from Hyperliquid's public info API by wallet address (no key, no
 * login, read-only), kept in the perp_fills tab. The app merges them into trades.
 *
 * The address goes in the config tab of the data sheet (key `hyperliquid_address`). The API keeps your 10,000 most
 * recent fills and returns up to 2,000 per request, so a sync pages forward from the newest fill already saved.
 */

const HL_API = 'https://api.hyperliquid.xyz/info';
const HL_ADDRESS_KEY = 'hyperliquid_address';
const HL_PLACEHOLDER = '0xPASTE_YOUR_WALLET_ADDRESS_HERE';
/** Hourly runs sync at most this often. */
const HL_EVERY_MS = 6 * 60 * 60 * 1000;
/** Fill directions that move a position; anything else (settlements, prediction outcomes) isn't kept. */
const HL_DIRS = [
  'Open Long', 'Close Long', 'Open Short', 'Close Short', 'Long > Short', 'Short > Long', 'Buy', 'Sell',
  'Market Order Liquidation: Close Long', 'Market Order Liquidation: Close Short',
];

/** Once: the config tab gets a row for the wallet address, with a placeholder to replace. */
function ensurePerpConfig_() {
  if (props_('perpConfigV1', false)) return;
  if (!readTable_('config').some(r => r.key === HL_ADDRESS_KEY))
    upsertRow_('config', 'key', { key: HL_ADDRESS_KEY, value: HL_PLACEHOLDER, note: 'Your Hyperliquid wallet address (0x…, 42 characters). Read-only: it can only see your trades.' });
  setProps_('perpConfigV1', true);
}

/** The address from the config tab, or '' while it's still the placeholder (or not an address). */
function perpAddress_() {
  const row = readTable_('config').filter(r => r.key === HL_ADDRESS_KEY)[0];
  const v = String((row && row.value) || '').trim();
  return /^0x[0-9a-fA-F]{40}$/.test(v) ? v.toLowerCase() : '';
}

function hlPost_(body) {
  const res = UrlFetchApp.fetch(HL_API, { method: 'post', contentType: 'application/json', payload: JSON.stringify(body), muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('Hyperliquid: HTTP ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 200));
  return JSON.parse(res.getContentText());
}

/** Spot fills name their pair by index ("@107"): the pair's base token ("HYPE") reads better. */
function spotNames_() {
  const meta = hlPost_({ type: 'spotMeta' });
  const tokens = {};
  (meta.tokens || []).forEach(t => (tokens[t.index] = t.name));
  const out = {};
  (meta.universe || []).forEach(u => (out['@' + u.index] = tokens[u.tokens[0]] || u.name));
  return out;
}

/** "xyz:NBIS" (a builder-deployed market) → "NBIS (xyz)", as Hyperliquid's own export writes it. */
function perpCoin_(coin, spot) {
  if (coin.charAt(0) === '@') return (spot && spot[coin]) || coin;
  const m = coin.match(/^([a-z0-9]+):(.+)$/i);
  return m ? m[2] + ' (' + m[1] + ')' : coin;
}

/** New fills since the newest saved one. Returns { added, address, error? }. */
function syncPerps_() {
  const address = perpAddress_();
  if (!address) return { added: 0, address: '' };
  const saved = readColumn_('perp_fills', 'time').map(Number);
  let start = saved.length ? Math.max.apply(null, saved) : 0;
  let spot = null;
  let added = 0;
  // 2,000 per page; 10,000 is all the API keeps, so 6 pages is plenty.
  for (let page = 0; page < 6; page++) {
    const fills = hlPost_({ type: 'userFillsByTime', user: address, startTime: start, aggregateByTime: false });
    if (!fills.length) break;
    if (!spot && fills.some(f => String(f.coin).charAt(0) === '@')) spot = spotNames_();
    const rows = fills
      // Prediction-market outcomes ("BTC above … ? - Yes", or "#…" ids) aren't positions.
      .filter(f => HL_DIRS.indexOf(f.dir) >= 0 && !/\?| - (Yes|No)$|^#/.test(String(f.coin)))
      .map(f => ({
        tid: f.tid,
        time: f.time,
        coin: perpCoin_(String(f.coin), spot),
        dir: f.dir,
        px: f.px,
        sz: f.sz,
        fee: f.fee,
        closed_pnl: f.closedPnl,
        start_position: f.startPosition,
        hash: f.hash,
      }));
    added += appendNew_('perp_fills', 'tid', rows);
    const last = Math.max.apply(null, fills.map(f => f.time));
    if (fills.length < 2000 || last <= start) break;
    start = last;
  }
  setProps_('perpSyncedAt', Date.now());
  return { added: added, address: address };
}

/** From the hourly run: a sync when the last one is a few hours old. Never stops the Gmail sync. */
function scheduledPerpSync_() {
  try {
    if (Date.now() - Number(props_('perpSyncedAt', 0)) >= HL_EVERY_MS) syncPerps_();
  } catch (e) {
    console.log('Hyperliquid sync failed: ' + e);
  }
}

/** Everything the Perps tab shows: fills, your notes, the address state and the last sync. */
function perpState_() {
  const notes = {};
  readTable_('perp_notes').forEach(r => {
    notes[r.trade_id] = { setup: r.setup || '', mistakes: r.mistakes || '', rating: r.rating || 0, note: r.note || '' };
  });
  return {
    address: perpAddress_(),
    syncedAt: Number(props_('perpSyncedAt', 0)) || null,
    fills: readTable_('perp_fills').map(r => ({
      tid: r.tid, time: r.time, coin: r.coin, dir: r.dir, px: r.px, sz: r.sz, fee: r.fee, pnl: r.closed_pnl,
    })),
    notes: notes,
  };
}

function setPerpNote_(p) {
  const n = p.note;
  if (!n || (!n.setup && !n.mistakes && !n.rating && !n.note)) deleteRow_('perp_notes', 'trade_id', p.tradeId);
  else
    upsertRow_('perp_notes', 'trade_id', {
      trade_id: p.tradeId, setup: n.setup || '', mistakes: n.mistakes || '', rating: n.rating || '', note: n.note || '', updated_at: new Date().toISOString(),
    });
  return true;
}
