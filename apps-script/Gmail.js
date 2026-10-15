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

const FETCH_BATCH = 25; // parallel Gmail API requests per round
const TIME_BUDGET_MS = 270 * 1000; // stop well before Apps Script's 6-minute limit

/**
 * Import receipts under the chosen label since the last sync. Returns { imported, skipped, scanned, more }.
 * Lists message ids once, skips ids already in the sheet, then downloads the rest in parallel
 * through the Gmail API. If time runs out it saves what it has and reports `more: true`;
 * the next run continues because finished ids are skipped.
 */
function syncGmail_() {
  const started = Date.now();
  const g = gmailState_();
  if (!g.label) throw new Error('Choose a Gmail label first.');
  try {
    const token = ScriptApp.getOAuthToken();
    const labelId = labelIdByName_(token, g.label);
    const since = g.lastSyncedAt ? new Date(g.lastSyncedAt).getTime() - OVERLAP_DAYS * 864e5 : Date.now() - FIRST_SYNC_DAYS * 864e5;

    const ids = listMessageIds_(token, labelId, Math.floor(since / 1000));
    const have = {};
    readColumn_('transactions', 'id').forEach(id => (have[id] = true));
    readColumn_('skipped', 'id').forEach(id => (have[id] = true));
    const todo = ids.filter(id => !have[id]);

    const rows = [];
    const notReceipts = [];
    let skipped = 0;
    let done = 0;
    const now = new Date().toISOString();
    while (done < todo.length && Date.now() - started < TIME_BUDGET_MS) {
      const batch = todo.slice(done, done + FETCH_BATCH);
      fetchMessages_(token, batch).forEach(m => {
        const p = parseReceipt({ subject: m.subject, from: m.from, text: m.text.slice(0, 20000) });
        if (!p) {
          skipped++;
          notReceipts.push({ id: m.id, subject: m.subject.slice(0, 300), seen_at: now });
          return;
        }
        rows.push({
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
        });
      });
      done += batch.length;
    }

    // Already-imported messages keep their first parse; category fixes live in `overrides`.
    const imported = appendNew_('transactions', 'id', rows);
    appendNew_('skipped', 'id', notReceipts);
    const more = done < todo.length;
    // Only move the sync window forward once everything in it has been read.
    setProps_('gmail', { label: g.label, lastSyncedAt: more ? g.lastSyncedAt || null : now, lastStatus: more ? 'partial' : 'ok', lastCount: ids.length });
    return { imported: imported, skipped: skipped, scanned: done, more: more, remaining: todo.length - done };
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    setProps_('gmail', Object.assign({}, g, { lastStatus: 'error: ' + msg.slice(0, 200) }));
    throw new Error(msg);
  }
}

// ---- Gmail REST API (via the script's own OAuth token) ----

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me/';

function gmailGet_(token, path) {
  const r = UrlFetchApp.fetch(GMAIL_API + path, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error('Gmail API ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 200));
  return JSON.parse(r.getContentText());
}

function labelIdByName_(token, name) {
  const l = (gmailGet_(token, 'labels').labels || []).filter(x => x.name === name)[0];
  if (!l) throw new Error('Gmail label "' + name + '" not found. Choose another label.');
  return l.id;
}

function listMessageIds_(token, labelId, afterEpoch) {
  const ids = [];
  let page = '';
  do {
    const r = gmailGet_(token, 'messages?maxResults=500&labelIds=' + encodeURIComponent(labelId) + '&q=' + encodeURIComponent('after:' + afterEpoch) + (page ? '&pageToken=' + page : ''));
    (r.messages || []).forEach(m => ids.push(m.id));
    page = r.nextPageToken || '';
  } while (page && ids.length < 5000);
  return ids;
}

/** Download messages in parallel; rate-limited ones are retried once. */
function fetchMessages_(token, ids) {
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

function decode_(data) {
  return Utilities.newBlob(Utilities.base64DecodeWebSafe(data)).getDataAsString('UTF-8');
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
