/**
 * Personal Spending Tracker — Gmail receipt sync.
 *
 * Runs as you and reads (never changes) the Gmail label you choose in the app,
 * then sends those emails to the app, which turns them into transactions.
 *
 * One-time setup:
 *   1. In the app, open Gmail sync and click "Create connection key".
 *   2. Here: Project Settings (gear) → Script Properties → add INGEST_KEY = that key.
 *   3. Run `setup` once and approve the permissions.
 * After that it syncs every morning, and within 10 minutes of a "Sync now" or label change in the app.
 */

const APP_URL = 'https://finance-tracker-gold.vercel.app';
const FIRST_SYNC_DAYS = 62; // first import covers this pay cycle and the previous one
const MAX_THREADS = 500;
const BATCH = 40;

/** Run once: checks the key, installs the triggers and does a first check-in. */
function setup() {
  key_();
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dailySync').timeBased().everyDays(1).atHour(6).create();
  ScriptApp.newTrigger('poll').timeBased().everyMinutes(10).create();
  const cfg = checkIn_();
  if (cfg.label) sync_(cfg);
  Logger.log(cfg.label ? 'Linked and synced label "' + cfg.label + '".' : 'Linked. Now choose a label in the app; it imports within 10 minutes.');
}

/** Daily trigger. */
function dailySync() {
  const cfg = checkIn_();
  if (cfg.label) sync_(cfg);
}

/** Every 10 minutes: refresh the label list and handle "Sync now" / label changes from the app. */
function poll() {
  const cfg = checkIn_();
  if (cfg.label && cfg.syncRequested) sync_(cfg);
}

/** Run by hand to sync immediately. */
function syncNow() {
  const cfg = checkIn_();
  if (!cfg.label) throw new Error('Choose a label in the app first.');
  sync_(cfg);
}

function checkIn_() {
  const labels = GmailApp.getUserLabels()
    .map(l => l.getName())
    .sort();
  return api_('poll', { email: Session.getActiveUser().getEmail(), labels: labels });
}

function sync_(cfg) {
  try {
    const label = GmailApp.getUserLabelByName(cfg.label);
    if (!label) throw new Error('Gmail label "' + cfg.label + '" not found. Choose another label in the app.');
    const since = cfg.since ? new Date(cfg.since) : new Date(Date.now() - FIRST_SYNC_DAYS * 864e5);

    const messages = [];
    // Threads come newest first; stop once a whole page is older than `since`.
    for (let start = 0; start < MAX_THREADS; start += 100) {
      const threads = label.getThreads(start, 100);
      if (!threads.length) break;
      threads.forEach(t => {
        if (t.getLastMessageDate() < since) return;
        t.getMessages().forEach(m => {
          if (m.getDate() < since) return;
          messages.push({
            id: m.getId(),
            date: m.getDate().toISOString(),
            subject: m.getSubject(),
            from: m.getFrom(),
            body: (m.getPlainBody() || '').slice(0, 20000),
          });
        });
      });
      if (threads[threads.length - 1].getLastMessageDate() < since) break;
    }

    let imported = 0;
    for (let i = 0; i < messages.length || i === 0; i += BATCH) {
      const last = i + BATCH >= messages.length;
      const r = api_('messages', { messages: messages.slice(i, i + BATCH), done: last, scanned: messages.length });
      imported += r.imported || 0;
      if (last) break;
    }
    Logger.log('Scanned ' + messages.length + ' emails, imported ' + imported + ' receipts.');
  } catch (e) {
    try {
      api_('messages', { error: String(e && e.message ? e.message : e) });
    } catch (ignored) {}
    throw e;
  }
}

function api_(path, body) {
  const r = UrlFetchApp.fetch(APP_URL + '/api/ingest/' + path, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + key_() },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  const text = r.getContentText();
  let json = {};
  try {
    json = JSON.parse(text || '{}');
  } catch (e) {}
  if (r.getResponseCode() >= 300) throw new Error(json.error || 'App returned ' + r.getResponseCode());
  return json;
}

function key_() {
  const k = PropertiesService.getScriptProperties().getProperty('INGEST_KEY');
  if (!k) throw new Error('Add the INGEST_KEY script property (Project Settings → Script Properties) with the key from the app, then run setup again.');
  return k.trim();
}
