/**
 * Gmail receipt import. Reads (never changes) one label chosen in the app.
 * Status lives in the `gmail` script property: { label, lastSyncedAt, lastStatus, lastCount, rangeSince }.
 * `rangeSince` is set while a "Sync last 2 months" scan is still being read, so continuations keep its window.
 */

const FIRST_SYNC_DAYS = 62; // first import covers this pay cycle and the previous one
const RANGE_SYNC_DAYS = 62; // "Sync last 2 months"
const OVERLAP_DAYS = 2;
/** Automatic sync hours, Asia/Jakarta (TZ). The trigger fires hourly; other hours do nothing. */
const SYNC_HOURS = [0, 6, 8, 10, 12, 14, 16, 18, 20, 22];

function gmailState_() {
  return props_('gmail', {});
}

function gmailStatus_() {
  const g = gmailState_();
  return {
    google_email: Session.getEffectiveUser().getEmail(),
    label_name: g.label || null,
    last_synced_at: g.lastSyncedAt || null,
    last_sync_status: g.lastStatus || null,
    last_sync_count: g.lastCount == null ? null : g.lastCount,
  };
}

function listLabels_() {
  return GmailApp.getUserLabels()
    .map(l => l.getName())
    .sort((a, b) => a.localeCompare(b));
}

/** Choose the label and import its last 62 days right away. */
function chooseLabel_(name) {
  if (!name || !GmailApp.getUserLabelByName(name)) throw new Error('Gmail label "' + name + '" not found.');
  setProps_('gmail', { label: name });
  return syncGmail_();
}

function disconnectGmail_() {
  setProps_('gmail', {});
  return true;
}

/** True for an hour (0–23, Jakarta time) when the automatic sync runs. */
function isSyncHour_(hour) {
  return SYNC_HOURS.indexOf(hour) >= 0;
}

/**
 * Hourly trigger target. Apps Script can't pin a trigger to exact hours, so this runs every hour
 * and only syncs at SYNC_HOURS, unless an import is already running or waiting to continue.
 */
function scheduledSync() {
  if (!gmailState_().label) return;
  if (!isSyncHour_(Number(Utilities.formatDate(new Date(), TZ, 'H')))) return;
  const running = Number(PropertiesService.getScriptProperties().getProperty(RUN_FLAG) || 0);
  if (running && Date.now() - running < 6 * 60 * 1000) return;
  if (ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'continueSync')) return;
  syncGmail_();
}

/** Old daily trigger target: swap in the hourly trigger, then run as one. */
function dailySync() {
  ensureSyncTrigger_();
  scheduledSync();
}

/** Re-read the label's last 2 months; only receipts not imported yet are added (nothing is cleared). */
function syncRange_() {
  return syncGmail_({ since: Date.now() - RANGE_SYNC_DAYS * 864e5 });
}

const FETCH_BATCH = 25; // Gmail API requests per round (parallel when allowed)
const TIME_BUDGET_MS = 270 * 1000; // stop well before Apps Script's 6-minute limit
// messages.get costs 5 quota units; Gmail caps units per user per minute. ~200 messages a minute
// stays well under it, and a "quota exceeded" answer pauses the run instead of failing it.
const MS_PER_MESSAGE = 300;
const CONTINUE_AFTER_MS = 2 * 60 * 1000;
const RUN_FLAG = 'gmailSyncRunning';

const isQuota_ = e => /quota|rate ?limit|user-rate|too many requests|429/i.test(String(e && e.message ? e.message : e));

/**
 * Import receipts under the chosen label since the last sync, or since `opts.since` (ms) when given.
 * Returns { imported, skipped, duplicates, reversed, scanned, more, remaining, paused, busy }.
 * Lists message ids once, skips ids already imported or seen, then downloads the rest at a steady pace.
 * Whatever was read is always saved. If time runs out or Gmail asks to slow down, the rest is picked up
 * by a one-off trigger a couple of minutes later (repeating until done).
 */
function syncGmail_(opts) {
  const started = Date.now();
  const g = gmailState_();
  if (!g.label) throw new Error('Choose a Gmail label first.');

  // One sync at a time (a background continuation may be running).
  const running = Number(PropertiesService.getScriptProperties().getProperty(RUN_FLAG) || 0);
  if (running && Date.now() - running < 6 * 60 * 1000) return { busy: true, imported: 0, skipped: 0, scanned: 0, more: true };
  PropertiesService.getScriptProperties().setProperty(RUN_FLAG, String(started));

  let parsed = [];
  try {
    const token = canFetch_() ? ScriptApp.getOAuthToken() : null;
    const labelId = labelIdByName_(token, g.label);
    // An explicit window, or an unfinished one (continueSync), wins over "since the last sync".
    const range = (opts && opts.since) || (g.rangeSince ? new Date(g.rangeSince).getTime() : 0);
    const since = range || (g.lastSyncedAt ? new Date(g.lastSyncedAt).getTime() - OVERLAP_DAYS * 864e5 : Date.now() - FIRST_SYNC_DAYS * 864e5);

    const ids = listMessageIds_(token, labelId, Math.floor(since / 1000));
    const have = {};
    readColumn_('transactions', 'id').forEach(id => (have[id] = true));
    readColumn_('skipped', 'id').forEach(id => (have[id] = true));
    const todo = ids.filter(id => !have[id]);

    let done = 0;
    let paused = false;
    while (done < todo.length && Date.now() - started < TIME_BUDGET_MS) {
      const t0 = Date.now();
      const batch = todo.slice(done, done + FETCH_BATCH);
      let msgs;
      try {
        msgs = fetchMessages_(token, batch);
      } catch (e) {
        if (!isQuota_(e)) throw e;
        paused = true; // Gmail asked us to slow down: keep what we have and continue later.
        break;
      }
      msgs.forEach(m => parsed.push({ m: m, p: parseReceipt({ subject: m.subject, from: m.from, text: m.text.slice(0, 20000) }) }));
      done += batch.length;
      const wait = batch.length * MS_PER_MESSAGE - (Date.now() - t0);
      if (wait > 0 && done < todo.length) Utilities.sleep(wait);
    }

    const r = storeParsed_(parsed);
    parsed = [];
    const more = done < todo.length;
    // Only move the sync window forward once everything in it has been read.
    setProps_('gmail', {
      label: g.label,
      lastSyncedAt: more ? g.lastSyncedAt || null : new Date().toISOString(),
      lastStatus: more ? 'partial' : 'ok',
      lastCount: ids.length,
      // Keep an unfinished window so the continuation reads the rest of it.
      rangeSince: more && range ? new Date(range).toISOString() : undefined,
    });
    if (more) scheduleContinue_();
    return { imported: r.imported, skipped: r.skipped, duplicates: r.duplicates, reversed: r.reversed, scanned: done, more: more, remaining: todo.length - done, paused: paused };
  } catch (e) {
    // Never lose emails already read in this run.
    if (parsed.length) storeParsed_(parsed);
    const msg = String(e && e.message ? e.message : e);
    if (isQuota_(e)) {
      setProps_('gmail', Object.assign({}, g, { lastStatus: 'partial' }, opts && opts.since ? { rangeSince: new Date(opts.since).toISOString() } : {}));
      scheduleContinue_();
      return { imported: 0, skipped: 0, scanned: 0, more: true, paused: true };
    }
    setProps_('gmail', Object.assign({}, g, { lastStatus: 'error: ' + msg.slice(0, 200) }));
    throw new Error(msg);
  } finally {
    PropertiesService.getScriptProperties().deleteProperty(RUN_FLAG);
  }
}

/** One-off trigger target: carry on an unfinished import. */
function continueSync() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'continueSync')
    .forEach(t => ScriptApp.deleteTrigger(t));
  if (gmailState_().label) syncGmail_();
}

function scheduleContinue_() {
  const pending = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'continueSync');
  if (!pending) ScriptApp.newTrigger('continueSync').timeBased().after(CONTINUE_AFTER_MS).create();
}

/** Receipts from the merchant beat card or bank alerts for the same purchase. */
const SOURCE_RANK = { 'Ride app email': 3, 'Marketplace email': 3, 'Billing email': 3, 'Bank email': 2, 'E-wallet email': 2, 'Card receipt': 1 };
const rank_ = s => SOURCE_RANK[s] || 2;

/**
 * Save parsed messages: one transaction per purchase (shared `ref` = same purchase, best source kept),
 * reversals remove the charge they cancel, and everything else is noted in `skipped` so it isn't read again.
 */
function storeParsed_(parsed) {
  const now = new Date().toISOString();
  const existing = readTable_('transactions');
  const byRef = {};
  existing.forEach(r => {
    if (r.ref) byRef[r.ref] = { id: r.id, source: r.source, account: r.account, stored: true };
  });
  const rows = {};
  const skipped = [];
  const replaced = [];
  const reversals = [];
  let duplicates = 0;
  parsed
    .slice()
    .sort((a, b) => Number(a.m.internalDate) - Number(b.m.internalDate))
    .forEach(x => {
      const m = x.m;
      const p = x.p;
      const skip = reason => skipped.push({ id: m.id, subject: m.subject.slice(0, 300), seen_at: now, reason: reason });
      if (!p) return skip('no amount');
      if (p.kind === 'reversal') {
        reversals.push(p.ref);
        return skip('reversal of ' + (p.ref || 'unknown charge'));
      }
      const row = {
        id: m.id,
        occurred_at: new Date(Number(m.internalDate)).toISOString(),
        title: p.title,
        category: p.category,
        amount: p.amount,
        currency: p.currency,
        source: p.source,
        sender: m.from.slice(0, 200),
        subject: m.subject.slice(0, 300),
        imported_at: now,
        ref: p.ref,
        kind: p.kind,
        account: p.account,
        to_account: p.to_account,
      };
      const prev = p.ref && byRef[p.ref];
      if (prev) {
        duplicates++;
        if (rank_(row.source) <= rank_(prev.source)) return skip('duplicate of ' + prev.id);
        // This email describes the purchase better (e.g. the Grab receipt after the card alert): swap it in,
        // on the card if the alert was a card charge, so it still counts on the card.
        if (prev.source === 'Card receipt' && prev.account) row.account = prev.account;
        if (prev.stored) replaced.push(prev.id);
        else delete rows[prev.id];
        skipped.push({ id: prev.id, subject: '', seen_at: now, reason: 'duplicate of ' + row.id });
      }
      if (p.ref) byRef[p.ref] = { id: row.id, source: row.source, account: row.account, stored: false };
      rows[row.id] = row;
    });

  // A reversal cancels the charge with the same reference, whether stored before or in this batch.
  let reversed = 0;
  reversals.filter(Boolean).forEach(ref => {
    const hit = byRef[ref];
    if (!hit) return;
    reversed++;
    if (hit.stored) replaced.push(hit.id);
    else delete rows[hit.id];
    skipped.push({ id: hit.id, subject: '', seen_at: now, reason: 'reversed' });
    delete byRef[ref];
  });

  if (replaced.length) deleteWhere_('transactions', 'id', replaced);
  const list = Object.keys(rows).map(k => rows[k]);
  const imported = appendNew_('transactions', 'id', list);
  appendNew_('skipped', 'id', skipped);
  // Card alerts and merchant receipts for the same purchase carry different codes, so refs don't catch them.
  const merged = mergeCardDuplicates_() + mergeTransferDuplicates_();
  return { imported: imported, skipped: skipped.length, duplicates: duplicates + merged, reversed: reversed };
}

// ---- card alert + merchant receipt for the same purchase ----

/** The merchant's receipt comes this long after the card alert (or a little before). */
const CARD_MATCH_AFTER_MS = 2 * 3600e3;
const CARD_MATCH_BEFORE_MS = 30 * 60e3;

/** A merchant receipt may show the price before the admin fee the bank charged on top (e.g. Tokopedia bills). */
const FEE_MAX_IDR = 10000;

/**
 * Pairs of { card, receipt } rows that describe one purchase: an alert from the card or bank ("Grab",
 * "Tokopedia") and the merchant's own receipt ("Tianlala – Oregon Square", "Tokopedia | Tagihan Listrik · …")
 * with the same amount (or the receipt up to an admin fee less), the receipt within the window around the
 * alert, and the alert's merchant named in the receipt. Nearest pairs win; each row pairs once.
 */
function pairCardDuplicates_(rows) {
  const at = r => new Date(r.occurred_at).getTime();
  const brand = r => (String(r.title).toLowerCase().match(/[a-z0-9]+/) || [''])[0];
  const cards = rows.filter(r => (r.source === 'Card receipt' || r.source === 'Bank email' || r.source === 'E-wallet email') && brand(r).length >= 3);
  // Card alerts only pair with purchases; a bank alert can also be a bill paid through the merchant (a card payment).
  const receipts = rows.filter(r => rank_(r.source) === 3);
  const pairs = [];
  cards.forEach(c => {
    const b = brand(c);
    receipts.forEach(r => {
      if (c.source === 'Card receipt' && (c.kind === 'transfer' || r.kind === 'transfer')) return;
      const dt = at(r) - at(c);
      if (dt < -CARD_MATCH_BEFORE_MS || dt > CARD_MATCH_AFTER_MS) return;
      const fee = Number(c.amount) - Number(r.amount);
      const feeOk = c.source === 'Bank email' && r.currency === 'IDR' && fee > 0 && fee <= FEE_MAX_IDR;
      if ((Math.abs(fee) > 0.005 && !feeOk) || r.currency !== c.currency) return;
      if ([r.sender, r.title, r.ref].join(' ').toLowerCase().indexOf(b) < 0) return;
      pairs.push({ card: c, receipt: r, gap: Math.abs(dt) });
    });
  });
  pairs.sort((x, y) => x.gap - y.gap);
  const used = {};
  return pairs.filter(p => {
    if (used[p.card.id] || used[p.receipt.id]) return false;
    used[p.card.id] = used[p.receipt.id] = true;
    return true;
  });
}

/**
 * Keep the merchant's receipt for each card + receipt pair, on the card's account (so it still counts on the
 * card), and drop the card alert. Your category fix, reimbursement link or share on the alert moves to the
 * receipt. Returns how many alerts were merged.
 */
function mergeCardDuplicates_() {
  const pairs = pairCardDuplicates_(readTable_('transactions'));
  pairs.forEach(p => {
    // The receipt keeps its detail, on the alert's account and at the amount that actually left (fee included).
    const fix = {};
    if (p.receipt.account !== p.card.account && p.receipt.kind !== 'transfer') fix.account = p.card.account;
    if (Number(p.receipt.amount) !== Number(p.card.amount)) fix.amount = p.card.amount;
    if (Object.keys(fix).length) upsertRow_('transactions', 'id', Object.assign({}, p.receipt, fix));
  });
  return dropDuplicates_(pairs.map(p => ({ keep: p.receipt, drop: p.card })));
}

/**
 * Drop each pair's `drop` row and keep `keep`. Your category fix (unless `keepCategory`), reimbursement link or
 * share or note on the dropped row moves to the kept one, and the dropped email is noted in `skipped` so it isn't imported again.
 */
function dropDuplicates_(pairs) {
  if (!pairs.length) return 0;
  const now = new Date().toISOString();
  const overrides = readTable_('overrides');
  const shares = readTable_('shares');
  const notes = readTable_('notes');
  const links = readTable_('links');
  const removed = readTable_('removed');
  const installments = readTable_('installments');
  pairs.forEach(p => {
    const from = p.drop.id;
    const to = p.keep.id;
    const ov = overrides.filter(o => o.tx_id === from)[0];
    if (ov && !p.keepCategory && !overrides.some(o => o.tx_id === to)) upsertRow_('overrides', 'tx_id', { tx_id: to, category: ov.category, updated_at: now });
    const sh = shares.filter(x => x.tx_id === from)[0];
    if (sh && !shares.some(x => x.tx_id === to)) upsertRow_('shares', 'tx_id', { tx_id: to, ratio: sh.ratio, updated_at: now });
    const note = notes.filter(x => x.tx_id === from)[0];
    if (note && !notes.some(x => x.tx_id === to)) upsertRow_('notes', 'tx_id', { tx_id: to, note: note.note, updated_at: now });
    links.filter(l => l.expense_id === from).forEach(l => upsertRow_('links', 'income_id', { income_id: l.income_id, expense_id: to, updated_at: now }));
    links.filter(l => l.income_id === from).forEach(l => upsertRow_('links', 'income_id', { income_id: to, expense_id: l.expense_id, updated_at: now }));
    if (removed.some(x => x.tx_id === from) && !removed.some(x => x.tx_id === to)) upsertRow_('removed', 'tx_id', { tx_id: to, removed_at: now });
    const plan = installments.filter(x => x.tx_id === from)[0];
    if (plan && !installments.some(x => x.tx_id === to)) upsertRow_('installments', 'tx_id', Object.assign({}, plan, { tx_id: to, updated_at: now }));
  });
  const gone = pairs.map(p => p.drop.id);
  deleteWhere_('transactions', 'id', gone);
  deleteWhere_('overrides', 'tx_id', gone);
  deleteWhere_('shares', 'tx_id', gone);
  deleteWhere_('notes', 'tx_id', gone);
  deleteWhere_('links', 'income_id', gone);
  deleteWhere_('removed', 'tx_id', gone);
  deleteWhere_('installments', 'tx_id', gone);
  appendNew_('skipped', 'id', pairs.map(p => ({ id: p.drop.id, subject: String(p.drop.subject || '').slice(0, 300), seen_at: now, reason: 'duplicate of ' + p.keep.id })));
  return pairs.length;
}

// ---- both sides of one move between your own accounts ----

/** The sending and receiving banks' emails for one transfer arrive this close together. */
const TRANSFER_MATCH_MS = 15 * 60e3;
/** A name with punctuation and spacing ignored: "KALAKA RANGGA, S" and "Kalaka Rangga S" match. */
const nameKey_ = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
/** Which parser read the email ("bca", "blu", …): the two sides of a transfer come from different ones. */
const refSource_ = r => String(r.ref || '').split(':')[0];

/** A card bill payment and the same money told again as a transfer arrive this close together. */
const CC_MATCH_MS = 10 * 60e3;

/**
 * Pairs of { keep, drop } rows that are one transfer told twice:
 * - the bank it left and the bank it reached: same amount and name (punctuation ignored), minutes apart,
 *   read by different parsers (two BCA journals are two transfers, never merged); the earlier one is kept;
 * - a card bill payment and a transfer of the same amount minutes apart (e.g. "Credit card payment" and a
 *   "Tokopedia" journal for paying the card): the card payment is kept, since it's what moves the card's bill.
 * A row counts as a transfer when it was imported as one or you moved it to Transfer (`cats`: your fixes).
 * Nearest pairs win; each row pairs once.
 */
function pairTransferDuplicates_(rows, cats) {
  const at = r => new Date(r.occurred_at).getTime();
  const catOf = r => (cats && cats[r.id]) || r.category;
  const isCc = r => catOf(r) === CC_PAYMENT;
  const isMove = r => r.kind === 'transfer' || catOf(r) === TRANSFER || isCc(r);
  const xs = rows.filter(isMove).sort((a, b) => at(a) - at(b));
  const pairs = [];
  xs.forEach((a, i) => {
    for (let j = i + 1; j < xs.length; j++) {
      const b = xs[j];
      const gap = at(b) - at(a);
      if (gap > Math.max(TRANSFER_MATCH_MS, CC_MATCH_MS)) break;
      if (Math.abs(Number(a.amount) - Number(b.amount)) > 0.005 || a.currency !== b.currency) continue;
      if (isCc(a) !== isCc(b)) {
        // A card payment's category is fixed, so the other row's category fix isn't carried over.
        if (gap <= CC_MATCH_MS) pairs.push(Object.assign(isCc(a) ? { keep: a, drop: b } : { keep: b, drop: a }, { gap: gap, keepCategory: true }));
        continue;
      }
      if (gap > TRANSFER_MATCH_MS || isCc(a) || nameKey_(a.title).length < 3) continue;
      if (nameKey_(a.title) !== nameKey_(b.title) || refSource_(a) === refSource_(b)) continue;
      pairs.push({ keep: a, drop: b, gap: gap });
    }
  });
  pairs.sort((x, y) => x.gap - y.gap);
  const used = {};
  return pairs.filter(p => {
    if (used[p.keep.id] || used[p.drop.id]) return false;
    used[p.keep.id] = used[p.drop.id] = true;
    return true;
  });
}

/** Merge transfers between your own accounts that were imported from both banks' emails. Returns how many. */
function mergeTransferDuplicates_() {
  const cats = {};
  readTable_('overrides').forEach(o => {
    cats[o.tx_id] = o.category;
  });
  return dropDuplicates_(pairTransferDuplicates_(readTable_('transactions'), cats));
}

/**
 * Receipts that replaced a card alert by booking code before accounts were carried over lost the card.
 * The `skipped` log still says which receipt replaced which alert (alert subject blank, or a card subject),
 * so put those receipts back on the card. Repeat forwards of the same receipt keep their own subject and are left alone.
 */
function restoreCardAccounts_() {
  const fromCard = {};
  readTable_('skipped').forEach(k => {
    const m = String(k.reason || '').match(/^duplicate of (.+)$/);
    const subj = String(k.subject || '');
    if (m && (subj === '' || /credit card|kartu kredit/i.test(subj))) fromCard[m[1]] = subj;
  });
  let n = 0;
  readTable_('transactions').forEach(r => {
    if (!(r.id in fromCard) || rank_(r.source) !== 3 || r.kind === 'transfer' || /^CC /.test(r.account || '')) return;
    // A blank subject only ever comes from a swap, and only card alerts share a booking code with a receipt.
    if (fromCard[r.id] === '' && !/^grab:/.test(r.ref || '')) return;
    upsertRow_('transactions', 'id', Object.assign({}, r, { account: cardAccount_(fromCard[r.id] || 'BCA') }));
    n++;
  });
  return n;
}

/** Rebuild the transactions tab from Gmail with the current rules. Category fixes (overrides) are kept. */
function reimportGmail_() {
  const g = gmailState_();
  if (!g.label) throw new Error('Choose a Gmail label first.');
  clearTable_('transactions');
  clearTable_('skipped');
  setProps_('gmail', { label: g.label });
  return syncGmail_();
}

// ---- Gmail API ----
// With the script.external_request permission approved, messages are downloaded in parallel through
// UrlFetchApp (fast). Until then (token = null) the Gmail advanced service fetches them one by one,
// which only needs the gmail.readonly permission.

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me/';

/** True once the owner has approved script.external_request (UrlFetchApp). */
function canFetch_() {
  try {
    return ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL).getAuthorizationStatus() === ScriptApp.AuthorizationStatus.NOT_REQUIRED;
  } catch (e) {
    return false;
  }
}

/** Run once from the editor to approve the permission that makes imports fast. */
function authorize() {
  UrlFetchApp.fetch('https://www.google.com/generate_204', { muteHttpExceptions: true });
  Logger.log('Fast Gmail import is enabled.');
}

function gmailGet_(token, path) {
  const r = UrlFetchApp.fetch(GMAIL_API + path, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error('Gmail API ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 200));
  return JSON.parse(r.getContentText());
}

function labelIdByName_(token, name) {
  const labels = token ? gmailGet_(token, 'labels').labels : Gmail.Users.Labels.list('me').labels;
  const l = (labels || []).filter(x => x.name === name)[0];
  if (!l) throw new Error('Gmail label "' + name + '" not found. Choose another label.');
  return l.id;
}

function listMessageIds_(token, labelId, afterEpoch) {
  const ids = [];
  let page = '';
  do {
    const r = token
      ? gmailGet_(token, 'messages?maxResults=500&labelIds=' + encodeURIComponent(labelId) + '&q=' + encodeURIComponent('after:' + afterEpoch) + (page ? '&pageToken=' + page : ''))
      : Gmail.Users.Messages.list('me', { labelIds: [labelId], q: 'after:' + afterEpoch, maxResults: 500, pageToken: page || undefined });
    (r.messages || []).forEach(m => ids.push(m.id));
    page = r.nextPageToken || '';
  } while (page && ids.length < 5000);
  return ids;
}

/** Download messages: in parallel when allowed (rate-limited ones retried once), else one by one. */
function fetchMessages_(token, ids) {
  if (!token) return ids.map(id => toMessage_(Gmail.Users.Messages.get('me', id, { format: 'full' })));
  const req = id => ({ url: GMAIL_API + 'messages/' + id + '?format=full', headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  const out = [];
  let pending = ids;
  for (let attempt = 0; attempt < 2 && pending.length; attempt++) {
    if (attempt) Utilities.sleep(1500);
    const res = UrlFetchApp.fetchAll(pending.map(req));
    const retry = [];
    res.forEach((r, i) => {
      const code = r.getResponseCode();
      if (code === 200) out.push(toMessage_(JSON.parse(r.getContentText())));
      else if (code === 429 || code >= 500) retry.push(pending[i]);
      else if (code !== 404) throw new Error('Gmail API ' + code + ': ' + r.getContentText().slice(0, 200));
    });
    pending = retry;
  }
  if (pending.length) throw new Error('Gmail is rate-limiting requests. Try Sync now again in a minute.');
  return out;
}

function toMessage_(m) {
  const headers = (m.payload && m.payload.headers) || [];
  const header = n => (headers.filter(h => h.name.toLowerCase() === n)[0] || {}).value || '';
  const plain = [];
  const html = [];
  const walk = p => {
    if (!p) return;
    if (p.body && p.body.data) {
      if (p.mimeType === 'text/plain') plain.push(decode_(p.body.data));
      else if (p.mimeType === 'text/html') html.push(decode_(p.body.data));
    }
    (p.parts || []).forEach(walk);
  };
  walk(m.payload);
  const text = plain.length ? plain.join('\n') : htmlToText_(html.join('\n'));
  return { id: m.id, internalDate: m.internalDate, subject: header('subject'), from: header('from'), text: text || m.snippet || '' };
}

/** Body data is a base64url string from the REST API and a byte array from the advanced service. */
function decode_(data) {
  const bytes = typeof data === 'string' ? Utilities.base64DecodeWebSafe(data) : data;
  return Utilities.newBlob(bytes).getDataAsString('UTF-8');
}

function htmlToText_(h) {
  return h
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|td|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, ' ');
}

/** One hourly `scheduledSync` trigger (idempotent; runs on every page load). Replaces the old daily trigger. */
function ensureSyncTrigger_() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.filter(t => t.getHandlerFunction() === 'dailySync').forEach(t => ScriptApp.deleteTrigger(t));
  const hourly = triggers.filter(t => t.getHandlerFunction() === 'scheduledSync');
  hourly.slice(1).forEach(t => ScriptApp.deleteTrigger(t));
  if (!hourly.length) ScriptApp.newTrigger('scheduledSync').timeBased().everyHours(1).create();
}
