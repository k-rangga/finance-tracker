/**
 * Gmail receipt import. Reads (never changes) one label chosen in the app.
 * Status lives in the `gmail` script property: { label, lastSyncedAt, lastStatus, lastCount }.
 */

const FIRST_SYNC_DAYS = 62; // first import covers this pay cycle and the previous one
const OVERLAP_DAYS = 2;
const SYNC_HOUR = 6;

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

/** Daily trigger target. */
function dailySync() {
  if (gmailState_().label) syncGmail_();
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
 * Import receipts under the chosen label since the last sync.
 * Returns { imported, skipped, duplicates, reversed, scanned, more, remaining, paused, busy }.
 * Lists message ids once, skips ids already imported or seen, then downloads the rest at a steady pace.
 * Whatever was read is always saved. If time runs out or Gmail asks to slow down, the rest is picked up
 * by a one-off trigger a couple of minutes later (repeating until done).
 */
function syncGmail_() {
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
    const since = g.lastSyncedAt ? new Date(g.lastSyncedAt).getTime() - OVERLAP_DAYS * 864e5 : Date.now() - FIRST_SYNC_DAYS * 864e5;

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
    setProps_('gmail', { label: g.label, lastSyncedAt: more ? g.lastSyncedAt || null : new Date().toISOString(), lastStatus: more ? 'partial' : 'ok', lastCount: ids.length });
    if (more) scheduleContinue_();
    return { imported: r.imported, skipped: r.skipped, duplicates: r.duplicates, reversed: r.reversed, scanned: done, more: more, remaining: todo.length - done, paused: paused };
  } catch (e) {
    // Never lose emails already read in this run.
    if (parsed.length) storeParsed_(parsed);
    const msg = String(e && e.message ? e.message : e);
    if (isQuota_(e)) {
      setProps_('gmail', Object.assign({}, g, { lastStatus: 'partial' }));
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
    if (r.ref) byRef[r.ref] = { id: r.id, source: r.source, stored: true };
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
      };
      const prev = p.ref && byRef[p.ref];
      if (prev) {
        duplicates++;
        if (rank_(row.source) <= rank_(prev.source)) return skip('duplicate of ' + prev.id);
        // This email describes the purchase better (e.g. the Grab receipt after the card alert): swap it in.
        if (prev.stored) replaced.push(prev.id);
        else delete rows[prev.id];
        skipped.push({ id: prev.id, subject: '', seen_at: now, reason: 'duplicate of ' + row.id });
      }
      if (p.ref) byRef[p.ref] = { id: row.id, source: row.source, stored: false };
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
  return { imported: imported, skipped: skipped.length, duplicates: duplicates, reversed: reversed };
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

function ensureDailyTrigger_() {
  const has = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'dailySync');
  if (!has) ScriptApp.newTrigger('dailySync').timeBased().everyDays(1).atHour(SYNC_HOUR).create();
}
