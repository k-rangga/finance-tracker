/**
 * Personal Spending Tracker — Apps Script web app.
 *
 * Index.html is the React app built by `npm run build` (one self-contained file).
 * The page calls `api(action, payload)` through google.script.run.
 * Data lives in a spreadsheet in the owner's Drive (created on first run; see Sheets.js).
 * Gmail receipts are read with GmailApp (see Gmail.js) and parsed by Parse.js.
 */

const TZ = 'Asia/Jakarta';
const APP_TITLE = 'Personal Spending Tracker';
/** Browser tab icon: the cat logo, assets/favicon.png on the repo's main branch. Apps Script needs a PNG URL. */
const FAVICON_URL = 'https://raw.githubusercontent.com/k-rangga/finance-tracker/main/assets/favicon.png';

function doGet() {
  ensureSetup_();
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(APP_TITLE)
    .setFaviconUrl(FAVICON_URL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/** Single entry point for the page. Errors reach the page as rejected promises. */
function api(action, payload) {
  const fn = ACTIONS[action];
  if (!fn) throw new Error('Unknown action: ' + action);
  return fn(payload || {});
}

const ACTIONS = {
  /** Everything the app needs on load. `since` = start of the previous pay cycle (ISO). */
  getState: p => ({
    email: Session.getEffectiveUser().getEmail(),
    settings: props_('settings', null),
    recat: overrides_(),
    links: links_(),
    shares: shares_(),
    notes: notes_(),
    removed: readTable_('removed').map(r => r.tx_id),
    installments: installments_(),
    trades: readTable_('trades'),
    updates: readTable_('trade_updates'),
    prices: props_('prices', null),
    snaps: readTable_('snapshots'),
    txRows: transactionsSince_(p.since),
    gmail: gmailStatus_(),
  }),
  getImports: p => ({ txRows: transactionsSince_(p.since), gmail: gmailStatus_() }),

  saveSettings: p => {
    setProps_('settings', p.settings);
    return true;
  },
  setOverride: p => {
    if (p.category == null) deleteRow_('overrides', 'tx_id', p.txId);
    else upsertRow_('overrides', 'tx_id', { tx_id: p.txId, category: p.category, updated_at: new Date().toISOString() });
    return true;
  },
  setLink: p => {
    if (p.expenseId == null) deleteRow_('links', 'income_id', p.incomeId);
    else upsertRow_('links', 'income_id', { income_id: p.incomeId, expense_id: p.expenseId, updated_at: new Date().toISOString() });
    return true;
  },
  setShare: p => {
    if (p.ratio == null) deleteRow_('shares', 'tx_id', p.txId);
    else upsertRow_('shares', 'tx_id', { tx_id: p.txId, ratio: p.ratio, updated_at: new Date().toISOString() });
    return true;
  },
  setNote: p => {
    const note = String(p.note || '').trim().slice(0, 500);
    if (!note) deleteRow_('notes', 'tx_id', p.txId);
    else upsertRow_('notes', 'tx_id', { tx_id: p.txId, note: note, updated_at: new Date().toISOString() });
    return true;
  },
  setInstallment: p => {
    if (!p.plan) deleteRow_('installments', 'tx_id', p.txId);
    else upsertRow_('installments', 'tx_id', { tx_id: p.txId, start: p.plan.start, amounts: JSON.stringify(p.plan.amounts), updated_at: new Date().toISOString() });
    return true;
  },
  setRemoved: p => {
    if (p.removed) upsertRow_('removed', 'tx_id', { tx_id: p.txId, removed_at: new Date().toISOString() });
    else deleteRow_('removed', 'tx_id', p.txId);
    return true;
  },
  saveTrade: p => {
    upsertRow_('trades', 'id', Object.assign({}, p.trade, { created_at: p.trade.created_at || new Date().toISOString() }));
    return true;
  },
  saveTradeUpdate: p => {
    upsertRow_('trade_updates', 'id', Object.assign({}, p.update, { created_at: p.update.created_at || new Date().toISOString() }));
    return true;
  },
  deleteTradeUpdate: p => {
    deleteRow_('trade_updates', 'id', p.id);
    return true;
  },
  /** Current prices from Google Finance for [{ tk, mk }] → { ticker: { price, at } }; unknown symbols are left out. */
  quotes: p => quotes_(p.items || []),
  savePrices: p => {
    setProps_('prices', p.prices);
    return true;
  },
  saveSnapshot: p => {
    upsertRow_('snapshots', 'day', p.snap);
    return true;
  },

  listLabels: () => listLabels_(),
  chooseLabel: p => chooseLabel_(p.name),
  syncNow: () => syncGmail_(),
  syncRange: () => syncRange_(),
  reimportGmail: () => reimportGmail_(),
  disconnectGmail: () => disconnectGmail_(),
};

/** First run: spreadsheet, tabs and the daily Gmail trigger. Also runnable from the editor. */
function setup() {
  ensureSetup_();
  Logger.log('Data spreadsheet: ' + ss_().getUrl());
}

function ensureSetup_() {
  ss_();
  ensureSyncTrigger_();
  // Once: merge card alerts with merchant receipts imported before the merge existed (later syncs do it themselves).
  if (!props_('cardMergeV1', false)) {
    restoreCardAccounts_();
    mergeCardDuplicates_();
    setProps_('cardMergeV1', true);
  }
}

function overrides_() {
  const out = {};
  readTable_('overrides').forEach(r => {
    out[r.tx_id] = r.category;
  });
  return out;
}

/** { incomeId: expenseId } */
function links_() {
  const out = {};
  readTable_('links').forEach(r => {
    out[r.income_id] = r.expense_id;
  });
  return out;
}

/** { txId: { start, amounts } } */
function installments_() {
  const out = {};
  readTable_('installments').forEach(r => {
    try {
      out[r.tx_id] = { start: String(r.start), amounts: JSON.parse(r.amounts).map(Number) };
    } catch (e) {
      // A row edited by hand into something unreadable is skipped rather than breaking the load.
    }
  });
  return out;
}

/** { txId: note } */
function notes_() {
  const out = {};
  readTable_('notes').forEach(r => {
    if (r.note) out[r.tx_id] = String(r.note);
  });
  return out;
}

/** { txId: ratio } */
function shares_() {
  const out = {};
  readTable_('shares').forEach(r => {
    out[r.tx_id] = Number(r.ratio);
  });
  return out;
}

function transactionsSince_(since) {
  const from = since ? new Date(since).getTime() : 0;
  return readTable_('transactions')
    .filter(r => new Date(r.occurred_at).getTime() >= from)
    .sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1))
    .map(r => {
      // Rows imported before accounts were stored get them from their sender, subject and title.
      const acc = accounts_(r, [r.sender, r.subject, r.title].join('\n'));
      // Broker transfers stored before the Investment category existed move to it too.
      const category = investmentCategory_({ kind: r.kind, category: acc.category, title: r.title });
      return { id: r.id, occurred_at: r.occurred_at, title: r.title, category: category, amount: r.amount, currency: r.currency, source: r.source, account: acc.account, to_account: acc.to_account || null };
    });
}

// ---- Google Finance quotes ----
// Apps Script has no Google Finance API, so prices come from the GOOGLEFINANCE spreadsheet function on a
// hidden `quotes` tab. Data can be delayed up to 20 minutes; small IDX caps may return #N/A (left out).

/** IDX:BBCA, the US ticker as stored (or EXCHANGE:TICKER), CURRENCY:BTCUSD. */
function financeSymbol_(mk, tk) {
  tk = String(tk || '').trim().toUpperCase();
  if (tk.indexOf(':') >= 0) return tk;
  if (mk === 'IDX') return 'IDX:' + tk;
  if (mk === 'Crypto') return 'CURRENCY:' + tk + 'USD';
  return tk;
}

/** A quote cell's value as a price, or null for #N/A, blanks and anything not yet loaded. */
function quotePrice_(v) {
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
  return isFinite(n) && n > 0 ? n : null;
}

function quotes_(items) {
  const out = {};
  if (!items.length) return out;
  const book = ss_();
  let sh = book.getSheetByName('quotes');
  if (!sh) {
    sh = book.insertSheet('quotes');
    sh.hideSheet();
  }
  sh.clear();
  const n = items.length;
  sh.getRange(1, 1, n, 2).setNumberFormat('@').setValues(items.map(i => [String(i.tk), financeSymbol_(i.mk, i.tk)]));
  sh.getRange(1, 3, n, 1).setFormulas(items.map((_, k) => ['=IFERROR(GOOGLEFINANCE(B' + (k + 1) + ',"price"),"")']));
  // GOOGLEFINANCE fills in after a recalculation; give slow symbols a couple more tries.
  let vals = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    SpreadsheetApp.flush();
    vals = sh.getRange(1, 1, n, 3).getValues();
    if (!vals.some(r => /loading/i.test(String(r[2])))) break;
    Utilities.sleep(1500);
  }
  const at = new Date().toISOString();
  vals.forEach(r => {
    const price = quotePrice_(r[2]);
    if (price != null) out[r[0]] = { price: price, at: at };
  });
  return out;
}

// ---- script properties (small JSON values) ----

function props_(key, fallback) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  if (v == null) return fallback;
  try {
    return JSON.parse(v);
  } catch (e) {
    return fallback;
  }
}

function setProps_(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(value));
}
