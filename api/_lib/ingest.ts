import { createHash, randomBytes } from 'node:crypto';
import { check, db, HttpError } from './server.js';

export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');
export const newKey = () => 'pst_' + randomBytes(24).toString('base64url');

/** Resolve the user from the Apps Script's `Authorization: Bearer <connection key>`. */
export async function requireKey(req: Request): Promise<string> {
  const key = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!key) throw new HttpError(401, 'Missing connection key.');
  const row = check(await db().from('gmail_connections').select('user_id').eq('key_hash', hashKey(key)).maybeSingle()) as { user_id: string } | null;
  if (!row) throw new HttpError(401, 'Connection key not recognised. Create a new key in the app and update the INGEST_KEY script property.');
  return row.user_id;
}
