/**
 * Copy everything from this spreadsheet (and the app's settings in Script properties) to Supabase, for the move
 * to Vercel. Run copyToSupabase() from the Apps Script editor once you've signed in to the Vercel app, after
 * setting these Script properties (Project Settings → Script properties):
 *   SUPABASE_URL               your project URL (https://….supabase.co)
 *   SUPABASE_SERVICE_ROLE_KEY  the project's secret key (keep it secret; delete it here when the move is done)
 *   SUPABASE_USER_ID           your user id: Supabase → Authentication → Users → your email → User UID
 * Safe to run again: rows are matched by their key and updated, never duplicated. Nothing here is changed.
 */

/** Script properties that are this script's own (keys, ids, run flags), not the app's data. */
const EXPORT_SKIP_PROPS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_USER_ID', 'SPREADSHEET_ID', 'GEMINI_API_KEY', 'GEMINI_MODEL', 'GEMINI_PLAN_MODEL', 'gmailSyncRunning'];

function copyToSupabase() {
  const props = PropertiesService.getScriptProperties();
  const url = String(props.getProperty('SUPABASE_URL') || '').replace(/\/$/, '');
  const key = props.getProperty('SUPABASE_SERVICE_ROLE_KEY');
  const user = props.getProperty('SUPABASE_USER_ID');
  if (!url || !key || !user) throw new Error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_USER_ID in Script properties first.');
  const post = (table, conflict, rows) => {
    for (let i = 0; i < rows.length; i += 500) {
      const r = UrlFetchApp.fetch(url + '/rest/v1/' + table + '?on_conflict=' + conflict, {
        method: 'post',
        contentType: 'application/json',
        headers: { apikey: key, Authorization: 'Bearer ' + key, Prefer: 'resolution=merge-duplicates,return=minimal' },
        payload: JSON.stringify(rows.slice(i, i + 500)),
        muteHttpExceptions: true,
      });
      if (r.getResponseCode() >= 300) throw new Error(table + ': ' + r.getResponseCode() + ' ' + r.getContentText().slice(0, 300));
    }
  };

  const counts = {};
  const repeats = {};
  Object.keys(TABLES).forEach(name => {
    const cols = TABLES[name];
    const nums = NUMERIC[name] || [];
    // A key can appear on more than one row of the Sheet; the first one is the row the app updates, so it's kept.
    const seen = {};
    const rows = readTable_(name)
      .filter(r => r[cols[0]] != null && r[cols[0]] !== '')
      .filter(r => {
        const k = String(r[cols[0]]);
        if (seen[k]) {
          repeats[name] = (repeats[name] || 0) + 1;
          return false;
        }
        return (seen[k] = true);
      })
      .map(r => {
        const o = { user_id: user };
        cols.forEach(c => {
          const v = r[c];
          o[c] = v == null || v === '' ? null : nums.indexOf(c) >= 0 ? (isFinite(Number(v)) ? Number(v) : null) : String(v);
        });
        return o;
      });
    post(name, 'user_id,' + cols[0], rows);
    counts[name] = rows.length;
  });

  const all = props.getProperties();
  const settings = Object.keys(all)
    .filter(k => EXPORT_SKIP_PROPS.indexOf(k) < 0)
    .map(k => ({ user_id: user, key: k, value: all[k] }));
  post('props', 'user_id,key', settings);
  counts.props = settings.length;

  Logger.log('Copied to Supabase: ' + JSON.stringify(counts));
  if (Object.keys(repeats).length) Logger.log('Repeated rows in the Sheet, copied once: ' + JSON.stringify(repeats));
  return counts;
}
