/**
 * Unit tests for server/account.ts: soft-delete anonymized learnings extraction and inactive auth user checks.
 * Run with `npm run test:account`.
 */
import assert from 'node:assert/strict';
import { archivedEmailFor, buildArchivedLearnings, hashEmail, isInactiveAuthUser } from './account.js';

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log('ok  ', name);
};

test('buildArchivedLearnings preserves rules, feedback, and trigger counts without leaking PII', () => {
  const out = buildArchivedLearnings({
    settings: {
      name: 'Rangga Secret Name',
      income: 30_000_000,
      ownAccountNames: 'BCA Kalaka',
      maxieLanguage: 'id',
      notSubscriptions: ['spotify-single'],
      notInstallments: ['bca-oneoff'],
      notFixedBills: ['pln-old'],
      chatFeedback: [{ q: 'How is dining?', a: 'Steady pace.', good: true, at: '2026-11-28T00:00:00Z' }],
      joyChecks: {
        tx1: { vote: 'skip', trigger: 'fomo', at: '2026-11-27' },
        tx2: { vote: 'skip', trigger: 'fomo', at: '2026-11-28' },
        tx3: { vote: 'worth', trigger: 'need', at: '2026-11-28' },
      },
    },
    rules: [
      { merchant: 'Kopi Kenangan', category: 'Cafe', sub: 'Coffee' },
      { merchant: 'Grand Lucky', category: 'Groceries', sub: null },
    ],
    now: new Date('2026-11-28T06:00:00Z'),
  });

  assert.equal(out.archivedAt, '2026-11-28T06:00:00.000Z');
  assert.equal(out.preferredLanguage, 'id');
  assert.equal(out.merchantRules['kopi kenangan'], 'Cafe');
  assert.equal(out.merchantSubRules['kopi kenangan'], 'Coffee');
  assert.equal(out.merchantRules['grand lucky'], 'Groceries');
  assert.deepEqual(out.joyTriggerCounts, { fomo: 2 });
  assert.equal(out.chatFeedback.length, 1);

  const json = JSON.stringify(out);
  assert.equal(json.includes('Rangga Secret Name'), false);
  assert.equal(json.includes('30000000'), false);
  assert.equal(json.includes('BCA Kalaka'), false);
});

test('isInactiveAuthUser blocks inactive app_metadata or future banned_until', () => {
  assert.equal(isInactiveAuthUser({ app_metadata: { status: 'inactive' } }), true);
  assert.equal(isInactiveAuthUser({ banned_until: new Date(Date.now() + 86_400_000).toISOString() }), true);
  assert.equal(isInactiveAuthUser({ banned_until: new Date(Date.now() - 86_400_000).toISOString() }), false);
  assert.equal(isInactiveAuthUser({ app_metadata: { status: 'active' } }), false);
  assert.equal(isInactiveAuthUser({}), false);
});

test('archivedEmailFor generates deterministic non-routable placeholder email', () => {
  const ts = new Date('2026-11-28T06:00:00Z');
  const out = archivedEmailFor('AB12-CD34-EF56', ts);
  assert.equal(out, `inactive+ab12cd34+${ts.getTime()}@deleted.maxie.local`);
  assert.equal(archivedEmailFor('---', ts), `inactive+user+${ts.getTime()}@deleted.maxie.local`);
});

test('hashEmail normalizes case/whitespace to a fixed 16-char hex digest', () => {
  const a = hashEmail('  Rangga@Example.COM ');
  const b = hashEmail('rangga@example.com');
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.notEqual(a, hashEmail('other@example.com'));
});

console.log(`\nall passed (${passed})`);
