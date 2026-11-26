// Run: npm run test:server. The Apps Script backend through the Vercel engine, on an in-memory store
// (names and numbers are made up).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { bodyText, syncFetch } from './bridge.js';
import fs from 'node:fs';
import vm from 'node:vm';
import { load, runAction, runFunction, tableSpec, type RunContext } from './engine.js';
import { MemoryStore, SupabaseStore } from './store.js';

const spec = tableSpec();
const fresh = () => {
  const store = new MemoryStore(spec.tables, spec.numeric);
  const ctx: RunContext = { store, email: 'budi@example.com' };
  return { store, ctx };
};
let n = 0;
const ok = (name: string, fn: () => void | Promise<void>) =>
  Promise.resolve()
    .then(fn)
    .then(() => {
      n++;
      console.log('ok  ', name);
    });

const ME = 'Budi Santoso <budi@outlook.com>';
const fwd = (from: string, subject: string, body: string) => `________________________________\nFrom: ${from}\nSent: Sunday, August 30, 2026 8:23:20 AM\nTo: someone@outlook.com\nSubject: ${subject}\n\n${body}`;
const cardAlert = fwd(
  'KartuKreditBCA@klikbca.com',
  'Credit Card Transaction Notification',
  'Terima kasih telah bertransaksi menggunakan Kartu Kredit BCA:\nMerchant / ATM : Grab* A-9P7SEJAWX6SSAV\nJenis Transaksi : E-COMMERCE\nPada Tanggal : 30-08-2026 08:23:16 WIB\nSejumlah : IDR 16.000',
);

await ok('a new user loads: empty data, their email, the config row', () => {
  const { ctx, store } = fresh();
  runFunction(ctx, 'ensurePerpConfig_');
  const s = runAction(ctx, 'getState', { since: '2026-01-01' });
  assert.equal(s.email, 'budi@example.com');
  assert.deepEqual(s.txRows, []);
  assert.equal(s.settings, null);
  assert.equal(store.read('config')[0].key, 'hyperliquid_address');
  assert.equal(store.getProp('perpConfigV1'), 'true');
});

await ok('settings and a category fix are saved and read back', () => {
  const { ctx, store } = fresh();
  runAction(ctx, 'saveSettings', { settings: { name: 'Budi', income: 30000000 } });
  runAction(ctx, 'setOverride', { txId: 't1', category: 'Dining' });
  runAction(ctx, 'setRules', { rules: { 'Hero Kota Wisata': 'Groceries' } });
  const s = runAction(ctx, 'getState', {});
  assert.equal(s.settings.name, 'Budi');
  assert.deepEqual(s.recat, { t1: 'Dining' });
  assert.deepEqual(s.rules, { 'Hero Kota Wisata': 'Groceries' });
  runAction(ctx, 'setOverride', { txId: 't1', category: null });
  assert.equal(store.read('overrides').length, 0);
});

await ok('a card alert is parsed and stored once, numbers as numbers', () => {
  const { ctx, store } = fresh();
  const m = { id: 'm1', internalDate: String(Date.UTC(2026, 7, 30, 1, 23)), subject: 'FW: Credit Card Transaction Notification', from: ME, text: cardAlert };
  const p = runFunction(ctx, 'parseReceipt', { subject: m.subject, from: m.from, text: m.text });
  const r1 = runFunction(ctx, 'storeParsed_', [{ m, p }]);
  const r2 = runFunction(ctx, 'storeParsed_', [{ m, p }]);
  assert.equal(r1.imported, 1);
  assert.equal(r2.imported, 0);
  const tx = store.read('transactions');
  assert.equal(tx.length, 1);
  assert.equal(tx[0].amount, 16000);
  assert.equal(tx[0].account, 'CC BCA');
  const s = runAction(ctx, 'getState', { since: '2026-08-01' });
  assert.equal(s.txRows[0].title, 'Grab');
});

await ok('installments and notes round-trip', () => {
  const { ctx } = fresh();
  runAction(ctx, 'setInstallment', { txId: 'tv', plan: { start: '2026-12-18', amounts: [1050000, 1050000] } });
  runAction(ctx, 'setNote', { txId: 'tv', note: '  for the living room ' });
  const s = runAction(ctx, 'getState', {});
  assert.deepEqual(s.installments, { tv: { start: '2026-12-18', amounts: [1050000, 1050000] } });
  assert.equal(s.notes.tv, 'for the living room');
});

await ok('Hyperliquid address can be set from the app', () => {
  const { ctx, store } = fresh();
  assert.throws(() => runAction(ctx, 'setPerpAddress', { address: 'nope' }), /wallet address/);
  runAction(ctx, 'setPerpAddress', { address: '0x' + 'ab'.repeat(20) });
  assert.equal(store.read('config')[0].value, '0x' + 'ab'.repeat(20));
});

await ok('Gmail without a Google connection says so', () => {
  const { ctx, store } = fresh();
  store.setProp('gmail', JSON.stringify({ label: 'Receipts' }));
  assert.throws(() => runAction(ctx, 'syncNow', {}), /google_not_connected/);
});

await ok('Jakarta hour for the sync schedule', () => {
  const { ctx } = fresh();
  ctx.store.setProp('x', '1');
  // Every 2 hours in Asia/Jakarta: even hours sync, odd hours skip.
  assert.equal(runFunction(ctx, 'isSyncHour_', 0), true);
  assert.equal(runFunction(ctx, 'isSyncHour_', 6), true);
  assert.equal(runFunction(ctx, 'isSyncHour_', 22), true);
  assert.equal(runFunction(ctx, 'isSyncHour_', 1), false);
  assert.equal(runFunction(ctx, 'isSyncHour_', 7), false);
  assert.equal(runFunction(ctx, 'isSyncHour_', 23), false);
});

await ok('synchronous fetch reaches a server and returns its body', async () => {
  const srv = spawn(process.execPath, ['-e', "require('http').createServer((q,s)=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>s.end(q.method+':'+b))}).listen(0,function(){console.log(this.address().port)})"]);
  const port = await new Promise<string>(r => srv.stdout.once('data', d => r(String(d).trim())));
  try {
    const r = syncFetch({ url: `http://127.0.0.1:${port}/`, method: 'POST', body: 'hello' });
    assert.equal(r.status, 200);
    assert.equal(bodyText(r), 'POST:hello');
  } finally {
    srv.kill();
  }
});

/** A tiny stand-in for Supabase's REST API (eq / in filters, paging, upsert on conflict, delete). */
const FAKE_REST = `
const http = require('http'); const db = {};
http.createServer((q, s) => { let b = ''; q.on('data', c => (b += c)); q.on('end', () => {
  const u = new URL(q.url, 'http://x'); const t = decodeURIComponent(u.pathname.replace('/rest/v1/', ''));
  if (q.headers.apikey !== 'k') { s.statusCode = 401; return s.end('no key'); }
  const rows = db[t] || (db[t] = []); const p = u.searchParams;
  const keep = r => { for (const [k, v] of p) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k)) continue;
    if (v.startsWith('eq.') && String(r[k]) !== v.slice(3)) return false;
    if (v.startsWith('in.') && !JSON.parse('[' + v.slice(4, -1) + ']').includes(String(r[k]))) return false;
  } return true; };
  if (q.method === 'GET') { const off = +(p.get('offset') || 0), lim = +(p.get('limit') || 1000);
    s.setHeader('content-type', 'application/json'); return s.end(JSON.stringify(rows.filter(keep).slice(off, off + lim))); }
  if (q.method === 'POST') { const keys = (p.get('on_conflict') || '').split(',');
    for (const r of JSON.parse(b)) { const i = rows.findIndex(x => keys.every(k => String(x[k]) === String(r[k])));
      if (i >= 0) rows[i] = { ...rows[i], ...r }; else rows.push({ seq: rows.length + 1, ...r }); }
    s.statusCode = 201; return s.end(); }
  if (q.method === 'DELETE') { db[t] = rows.filter(r => !keep(r)); s.statusCode = 204; return s.end(); }
}); }).listen(0, function () { console.log(this.address().port); });`;

await ok('Supabase store: per-user rows, paging past 1000, upsert and delete', async () => {
  const srv = spawn(process.execPath, ['-e', FAKE_REST]);
  const port = await new Promise<string>(r => srv.stdout.once('data', d => r(String(d).trim())));
  const url = `http://127.0.0.1:${port}`;
  const mk = (user: string) => new SupabaseStore(spec.tables, spec.numeric, url, 'k', user);
  try {
    const a = mk('u1');
    const ctx: RunContext = { store: a, email: 'a@example.com' };
    runAction(ctx, 'saveSettings', { settings: { name: 'A' } });
    runAction(ctx, 'setOverride', { txId: 'x"1', category: 'Dining' });
    const rows = Array.from({ length: 1500 }, (_, i) => ({ id: 'm' + i, occurred_at: '2026-08-30T01:00:00Z', title: 'Shop ' + i, category: 'Buffer', amount: i + 0.5, currency: 'IDR' }));
    assert.equal(a.appendNew('transactions', 'id', rows), 1500);

    const again = mk('u1');
    await again.prefetch(['transactions', 'overrides']);
    const s = runAction({ store: again, email: 'a@example.com' }, 'getState', {});
    assert.equal(s.settings.name, 'A');
    assert.equal(s.txRows.length, 1500);
    assert.equal(again.read('transactions').find(r => r.id === 'm7')!.amount, 7.5);
    assert.deepEqual(s.recat, { 'x"1': 'Dining' });
    runAction({ store: again, email: 'a@example.com' }, 'setOverride', { txId: 'x"1', category: null });
    assert.equal(mk('u1').read('overrides').length, 0);

    // The one-time copy from the Sheet (Export.js), run in the Apps Script sandbox with u3's Sheet in memory.
    const sheet = new MemoryStore(spec.tables, spec.numeric);
    const sheetCtx: RunContext = { store: sheet, email: 'c@example.com' };
    runAction(sheetCtx, 'saveSettings', { settings: { name: 'C' } });
    runAction(sheetCtx, 'setNote', { txId: 'n1', note: 'lunch' });
    // The same id twice in the Sheet (put in directly; the store itself never makes repeats): copied once, the first.
    sheet.db.set('transactions', [
      { id: 't9', occurred_at: '2026-08-30T01:00:00Z', title: 'Kopi', category: 'Cafe', amount: 25000, currency: 'IDR' },
      { id: 't9', occurred_at: '2026-08-31T01:00:00Z', title: 'Kopi again', category: 'Cafe', amount: 99, currency: 'IDR' },
    ]);
    sheet.setProp('SUPABASE_URL', url);
    sheet.setProp('SUPABASE_SERVICE_ROLE_KEY', 'k');
    sheet.setProp('SUPABASE_USER_ID', 'u3');
    sheet.setProp('GEMINI_KEY_LIKE', 'kept');
    const box = load(sheetCtx);
    vm.runInContext(fs.readFileSync('apps-script/Export.js', 'utf8'), box);
    // Apps Script's getProperties(), which the sandbox's stand-in doesn't need elsewhere.
    vm.runInContext('PropertiesService.getScriptProperties().getProperties = () => (' + JSON.stringify(Object.fromEntries(sheet.props)) + ')', box);
    const counts = JSON.parse(JSON.stringify(vm.runInContext('copyToSupabase()', box)));
    assert.equal(counts.transactions, 1);
    assert.equal(counts.notes, 1);
    const copied = mk('u3');
    await copied.prefetch(['transactions', 'notes']);
    const c = runAction({ store: copied, email: 'c@example.com' }, 'getState', {});
    assert.equal(c.settings.name, 'C');
    assert.equal(c.notes.n1, 'lunch');
    assert.equal(c.txRows.length, 1);
    assert.equal(c.txRows[0].amount, 25000);
    assert.equal(copied.getProp('SUPABASE_SERVICE_ROLE_KEY'), null);
    assert.equal(copied.getProp('GEMINI_KEY_LIKE'), 'kept');

    const other = mk('u2');
    await other.prefetch(['transactions']);
    assert.equal(other.read('transactions').length, 0);
    assert.equal(runAction({ store: other, email: 'b@example.com' }, 'getState', {}).settings, null);
  } finally {
    srv.kill();
  }
});

console.log(`\nall passed (${n})`);
process.exit(0);
