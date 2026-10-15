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

function doGet() {
  ensureSetup_();
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(APP_TITLE)
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
    trades: readTable_('trades'),
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
  saveTrade: p => {
    upsertRow_('trades', 'id', Object.assign({}, p.trade, { created_at: p.trade.created_at || new Date().toISOString() }));
    return true;
  },
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
  ensureDailyTrigger_();
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
