import { handler, requireUser } from '../_lib/server.js';
import { syncUser } from '../_lib/sync.js';

/** POST → sync now. */
export const POST = handler(async req => Response.json(await syncUser((await requireUser(req)).id)));
