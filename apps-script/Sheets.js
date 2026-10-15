/**
 * Spreadsheet storage. One tab per table, header row first, every cell stored as plain text
 * (so dates and ids are never reformatted by Sheets). Numeric columns are converted on read.
 * The spreadsheet is created in the owner's Drive on first run; its ID is kept in the
 * SPREADSHEET_ID script property — set that property to use an existing spreadsheet instead.
 */

const TABLES = {
  transactions: ['id', 'occurred_at', 'title', 'category', 'amount', 'currency', 'source', 'sender', 'subject', 'imported_at', 'ref', 'kind', 'account', 'to_account'],
  overrides: ['tx_id', 'category', 'updated_at'],
  /** Reimbursements: an incoming transfer that pays you back for (part of) an expense. */
  links: ['income_id', 'expense_id', 'updated_at'],
  trades: [
    'id', 'market', 'ticker', 'name', 'buy_date', 'price', 'quantity', 'fee', 'style', 'conviction', 'target', 'stop',
    'catalyst', 'catalyst_date', 'thesis', 'tags', 'leverage', 'direction',
    'exit_price', 'exit_date', 'followed_plan', 'rating', 'lesson', 'created_at',
  ],
  snapshots: ['day', 'value', 'contributed'],
  /** Gmail messages already read that weren't receipts, so they aren't downloaded again. */
  skipped: ['id', 'subject', 'seen_at', 'reason'],
};

const NUMERIC = {
  transactions: ['amount'],
  trades: ['price', 'quantity', 'fee', 'conviction', 'target', 'stop', 'leverage', 'exit_price', 'rating'],
  snapshots: ['value', 'contributed'],
};

let SS_ = null;

function ss_() {
  if (SS_) return SS_;
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SPREADSHEET_ID');
  if (id) {
    SS_ = SpreadsheetApp.openById(id);
  } else {
    SS_ = SpreadsheetApp.create(APP_TITLE + ' — data');
    props.setProperty('SPREADSHEET_ID', SS_.getId());
  }
  Object.keys(TABLES).forEach(name => tab_(name));
  const blank = SS_.getSheetByName('Sheet1');
  if (blank && SS_.getSheets().length > 1) SS_.deleteSheet(blank);
  return SS_;
}

function tab_(name) {
  const book = SS_ || ss_();
  let sh = book.getSheetByName(name);
  if (!sh) {
    sh = book.insertSheet(name);
    sh.getRange(1, 1, sh.getMaxRows(), TABLES[name].length).setNumberFormat('@');
    sh.getRange(1, 1, 1, TABLES[name].length).setValues([TABLES[name]]).setFontWeight('bold');
    sh.setFrozenRows(1);
  } else {
    // Columns are only ever added at the end; bring an older header row up to date.
    const cols = TABLES[name];
    const head = sh.getRange(1, 1, 1, cols.length).getValues()[0].map(String);
    if (head.join('|') !== cols.join('|')) sh.getRange(1, 1, 1, cols.length).setNumberFormat('@').setValues([cols]).setFontWeight('bold');
  }
  return sh;
}

/** All rows as objects keyed by header; '' becomes null and numeric columns become numbers. */
function readTable_(name) {
  const sh = tab_(name);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const cols = TABLES[name];
  const nums = NUMERIC[name] || [];
  return sh
    .getRange(2, 1, last - 1, cols.length)
    .getValues()
    .filter(r => r[0] !== '')
    .map(r => {
      const o = {};
      cols.forEach((c, i) => {
        const v = r[i];
        o[c] = v === '' || v == null ? null : nums.indexOf(c) >= 0 ? Number(v) : String(v);
      });
      return o;
    });
}

/** One column's values (as strings), without the header. */
function readColumn_(name, key) {
  const sh = tab_(name);
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh
    .getRange(2, TABLES[name].indexOf(key) + 1, last - 1, 1)
    .getValues()
    .map(r => String(r[0]))
    .filter(Boolean);
}

function rowOf_(name, obj) {
  return TABLES[name].map(c => (obj[c] == null ? '' : String(obj[c])));
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/** Insert or replace the row whose `key` column equals obj[key]. */
function upsertRow_(name, key, obj) {
  return withLock_(() => {
    const sh = tab_(name);
    const col = TABLES[name].indexOf(key) + 1;
    const last = sh.getLastRow();
    const keys = last > 1 ? sh.getRange(2, col, last - 1, 1).getValues().map(r => String(r[0])) : [];
    const i = keys.indexOf(String(obj[key]));
    const row = rowOf_(name, obj);
    const at = i >= 0 ? i + 2 : last + 1;
    sh.getRange(at, 1, 1, row.length).setNumberFormat('@').setValues([row]);
  });
}

function deleteRow_(name, key, value) {
  return withLock_(() => {
    const sh = tab_(name);
    const col = TABLES[name].indexOf(key) + 1;
    const last = sh.getLastRow();
    if (last < 2) return;
    const keys = sh.getRange(2, col, last - 1, 1).getValues().map(r => String(r[0]));
    for (let i = keys.length - 1; i >= 0; i--) if (keys[i] === String(value)) sh.deleteRow(i + 2);
  });
}

/** Delete every data row whose `key` column is in `values`. */
function deleteWhere_(name, key, values) {
  const want = {};
  values.forEach(v => (want[String(v)] = true));
  return withLock_(() => {
    const sh = tab_(name);
    const last = sh.getLastRow();
    if (last < 2) return 0;
    const keys = sh.getRange(2, TABLES[name].indexOf(key) + 1, last - 1, 1).getValues().map(r => String(r[0]));
    let n = 0;
    for (let i = keys.length - 1; i >= 0; i--)
      if (want[keys[i]]) {
        sh.deleteRow(i + 2);
        n++;
      }
    return n;
  });
}

/** Remove all data rows, keeping the header. */
function clearTable_(name) {
  return withLock_(() => {
    const sh = tab_(name);
    const last = sh.getLastRow();
    if (last > 1) sh.getRange(2, 1, last - 1, sh.getLastColumn()).clearContent();
  });
}

/** Append rows whose key isn't already present. Returns how many were added. */
function appendNew_(name, key, objs) {
  if (!objs.length) return 0;
  return withLock_(() => {
    const sh = tab_(name);
    const col = TABLES[name].indexOf(key) + 1;
    const last = sh.getLastRow();
    const seen = {};
    if (last > 1) sh.getRange(2, col, last - 1, 1).getValues().forEach(r => (seen[String(r[0])] = true));
    const rows = [];
    objs.forEach(o => {
      const k = String(o[key]);
      if (seen[k]) return;
      seen[k] = true;
      rows.push(rowOf_(name, o));
    });
    if (rows.length) sh.getRange(last + 1, 1, rows.length, TABLES[name].length).setNumberFormat('@').setValues(rows);
    return rows.length;
  });
}
