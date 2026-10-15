/**
 * Gmail receipt import. Reads (never changes) one label chosen in the app.
 * Status lives in the `gmail` script property: { label, lastSyncedAt, lastStatus, lastCount }.
 */

const FIRST_SYNC_DAYS = 62; // first import covers this pay cycle and the previous one
const OVERLAP_DAYS = 2;
const MAX_THREADS = 500;
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

/** Import receipts under the chosen label since the last sync. Returns { imported, skipped, scanned }. */
function syncGmail_() {
  const g = gmailState_();
  if (!g.label) throw new Error('Choose a Gmail label first.');
  try {
    const label = GmailApp.getUserLabelByName(g.label);
    if (!label) throw new Error('Gmail label "' + g.label + '" not found. Choose another label.');
    const since = g.lastSyncedAt ? new Date(new Date(g.lastSyncedAt).getTime() - OVERLAP_DAYS * 864e5) : new Date(Date.now() - FIRST_SYNC_DAYS * 864e5);

    const rows = [];
    let scanned = 0;
    let skipped = 0;
    const now = new Date().toISOString();
    // Threads come newest first; stop once a page ends before `since`.
    for (let start = 0; start < MAX_THREADS; start += 100) {
      const threads = label.getThreads(start, 100);
      if (!threads.length) break;
      threads.forEach(t => {
        if (t.getLastMessageDate() < since) return;
        t.getMessages().forEach(m => {
          if (m.getDate() < since) return;
          scanned++;
          const subject = m.getSubject() || '';
          const from = m.getFrom() || '';
          const p = parseReceipt({ subject: subject, from: from, text: (m.getPlainBody() || '').slice(0, 20000) });
          if (!p) {
            skipped++;
            return;
          }
          rows.push({
            id: m.getId(),
            occurred_at: m.getDate().toISOString(),
            title: p.title,
            category: p.category,
            amount: p.amount,
            currency: p.currency,
            source: p.source,
            sender: from.slice(0, 200),
            subject: subject.slice(0, 300),
            imported_at: now,
          });
        });
      });
      if (threads[threads.length - 1].getLastMessageDate() < since) break;
    }

    // Already-imported messages keep their first parse; category fixes live in `overrides`.
    const imported = appendNew_('transactions', 'id', rows);
    setProps_('gmail', { label: g.label, lastSyncedAt: now, lastStatus: 'ok', lastCount: scanned });
    return { imported: imported, skipped: skipped, scanned: scanned };
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    setProps_('gmail', Object.assign({}, g, { lastStatus: 'error: ' + msg.slice(0, 200) }));
    throw new Error(msg);
  }
}

function ensureDailyTrigger_() {
  const has = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'dailySync');
  if (!has) ScriptApp.newTrigger('dailySync').timeBased().everyDays(1).atHour(SYNC_HOUR).create();
}
