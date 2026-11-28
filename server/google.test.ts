/**
 * Unit tests for server/google.ts: least-privilege OAuth scopes, AES-256-GCM token encryption/decryption
 * (including random IVs, tamper detection, legacy plaintext fallback, and key rotation), and HMAC state verification.
 * Run with `npm run test:google`.
 */
import assert from 'node:assert/strict';
import {
  GOOGLE_DRIVE_SCOPE,
  GOOGLE_GMAIL_SCOPES,
  authUrl,
  decryptToken,
  encryptToken,
  userFromState,
} from './google.js';

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log('ok  ', name);
};

process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-secret-for-unit-tests';
process.env.TOKEN_ENCRYPTION_KEY = 'dedicated-token-encryption-key-32bytes!';

test('default authUrl requests ONLY gmail.readonly (no Google Drive scope)', () => {
  assert.deepEqual(GOOGLE_GMAIL_SCOPES, ['openid', 'email', 'https://www.googleapis.com/auth/gmail.readonly']);
  const url = new URL(authUrl('user-123', 'https://maxie.example.com'));
  const scope = url.searchParams.get('scope') ?? '';
  assert.match(scope, /gmail\.readonly/);
  assert.equal(scope.includes('drive'), false);

  const state = url.searchParams.get('state') ?? '';
  assert.equal(userFromState(state), 'user-123');
  assert.equal(userFromState(state.slice(0, -2) + 'xx'), null);
});

test('authUrl({ includeDrive: true }) requests narrow drive.file scope, never full drive', () => {
  const url = new URL(authUrl('user-123', 'https://maxie.example.com', { includeDrive: true }));
  const scopes = (url.searchParams.get('scope') ?? '').split(/\s+/);
  assert.ok(scopes.includes(GOOGLE_DRIVE_SCOPE));
  assert.equal(scopes.includes('https://www.googleapis.com/auth/drive'), false);
});

test('encryptToken uses AES-256-GCM with unique random IVs and detects tampering', () => {
  const plain = '1//0g_sample_google_refresh_token_secret';
  const enc1 = encryptToken(plain);
  const enc2 = encryptToken(plain);
  assert.ok(enc1.startsWith('enc:v1:'));
  assert.notEqual(enc1, enc2); // unique random 12-byte IV each time

  const dec = decryptToken(enc1);
  assert.equal(dec.value, plain);
  assert.equal(dec.needsReencrypt, false);

  // Tamper with ciphertext character -> GCM authentication tag must throw
  const parts = enc1.split(':');
  parts[4] = parts[4].slice(0, -2) + (parts[4].endsWith('AA') ? 'BB' : 'AA');
  assert.throws(() => decryptToken(parts.join(':')));
});

test('decryptToken handles legacy plaintext rows and key rotation via fallback secret', () => {
  const legacy = '1//legacy-plaintext-refresh-token';
  const dLegacy = decryptToken(legacy);
  assert.equal(dLegacy.value, legacy);
  assert.equal(dLegacy.needsReencrypt, true);

  // Token encrypted with older service role secret before TOKEN_ENCRYPTION_KEY was added
  const encryptedWithOldKey = encryptToken('1//rotated-token', process.env.SUPABASE_SERVICE_ROLE_KEY);
  const dRotated = decryptToken(
    encryptedWithOldKey,
    process.env.TOKEN_ENCRYPTION_KEY,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
  assert.equal(dRotated.value, '1//rotated-token');
  assert.equal(dRotated.needsReencrypt, true);
});

console.log(`\nall passed (${passed})`);
