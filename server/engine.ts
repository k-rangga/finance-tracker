/**
 * Runs the Apps Script backend (apps-script/*.js) on Vercel, unchanged: the same actions, receipt parsing, Gmail
 * import, Gemini and Hyperliquid code. It runs in its own sandbox per request with stand-ins for the Google
 * services it calls: the Sheet is one user's Supabase rows (see store.ts), Script properties are their `props`,
 * UrlFetchApp is a (synchronous) fetch, and Gmail and Drive are Google's REST APIs with the user's own token.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { bodyText, sleepSync, syncFetch, syncFetchAll, type SyncRequest, type SyncResponse } from './bridge.js';
import type { Store, Tables } from './store.js';

const FILES = ['Sheets.js', 'Parse.js', 'Code.js', 'Gmail.js', 'Gemini.js', 'Hyperliquid.js', 'Receipts.js'];
const TZ = 'Asia/Jakarta';
/** Script properties that are server secrets (Vercel environment variables), never per-user data. */
const SECRET_PROPS = ['GEMINI_API_KEY', 'GEMINI_MODEL', 'GEMINI_PLAN_MODEL', 'GEMINI_SEARCH'];

export const appsScriptDir = () => path.join(process.cwd(), 'apps-script');

let scripts: vm.Script[] | null = null;
function compiled() {
  if (scripts) return scripts;
  scripts = FILES.map(f => {
    let src = fs.readFileSync(path.join(appsScriptDir(), f), 'utf8');
    if (f === 'Gmail.js') {
      // The run's time budget comes from the request (Vercel's limit, not Apps Script's 6 minutes).
      const before = 'const TIME_BUDGET_MS = 270 * 1000;';
      if (!src.includes(before)) throw new Error('Gmail.js changed: update the TIME_BUDGET_MS patch in server/engine.ts');
      src = src.replace(before, 'const TIME_BUDGET_MS = __TIME_BUDGET_MS;');
    }
    return new vm.Script(src, { filename: f });
  });
  return scripts;
}

/** The Sheet's table list (Sheets.js TABLES / NUMERIC). */
export function tableSpec(): { tables: Tables; numeric: Record<string, string[]> } {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(appsScriptDir(), 'Sheets.js'), 'utf8') + '\n;this.TABLES = TABLES; this.NUMERIC = NUMERIC;', ctx);
  return JSON.parse(JSON.stringify({ tables: ctx.TABLES, numeric: ctx.NUMERIC }));
}

export type RunContext = {
  store: Store;
  /** The signed-in user's email. */
  email: string;
  /** Their Google connection, when made: an access token for Gmail and Drive. */
  google?: { token: string; email: string } | null;
  /** How long a Gmail import may read before stopping (the rest continues on the next sync). */
  timeBudgetMs?: number;
};

// ---- stand-ins for Apps Script services ----

type Blob = { getBytes(): Buffer; getDataAsString(): string; getContentType(): string; getName(): string; setName(n: string): Blob };
function newBlob(data: unknown, mime = 'application/octet-stream', name = ''): Blob {
  const bytes = Buffer.isBuffer(data) ? data : typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data as number[]);
  const b: Blob = {
    getBytes: () => bytes,
    getDataAsString: () => bytes.toString('utf8'),
    getContentType: () => mime,
    getName: () => name,
    setName: n => {
      name = n;
      return b;
    },
  };
  return b;
}

function response(r: SyncResponse) {
  return {
    getResponseCode: () => r.status,
    getContentText: () => bodyText(r),
    getHeaders: () => r.headers,
    getBlob: () => newBlob(Buffer.from(r.body, 'base64'), r.headers['content-type'] || 'application/octet-stream'),
  };
}

type FetchParams = { method?: string; headers?: Record<string, string>; payload?: unknown; contentType?: string; muteHttpExceptions?: boolean };
function toRequest(url: string, p: FetchParams = {}): SyncRequest {
  const headers: Record<string, string> = { ...(p.headers || {}) };
  let body: string | undefined;
  if (p.payload != null) {
    if (typeof p.payload === 'string') body = p.payload;
    else {
      body = new URLSearchParams(p.payload as Record<string, string>).toString();
      headers['Content-Type'] ??= 'application/x-www-form-urlencoded';
    }
    if (p.contentType) headers['Content-Type'] = p.contentType;
  }
  return { url, method: (p.method || (body != null ? 'post' : 'get')).toUpperCase(), headers, body };
}
function checked(url: string, p: FetchParams | undefined, r: SyncResponse) {
  if (r.status === 0) throw new Error('Request to ' + url.split('?')[0] + ' failed: ' + r.error);
  if (r.status >= 400 && !(p && p.muteHttpExceptions)) throw new Error('Request failed for ' + url.split('?')[0] + ' returned code ' + r.status + '. ' + bodyText(r).slice(0, 300));
  return response(r);
}

const UrlFetchApp = {
  fetch: (url: string, p?: FetchParams) => checked(url, p, syncFetch(toRequest(url, p))),
  fetchAll: (list: (FetchParams & { url: string })[]) => syncFetchAll(list.map(x => toRequest(x.url, x))).map((r, i) => checked(list[i].url, list[i], r)),
};

const Utilities = {
  sleep: sleepSync,
  base64Decode: (s: string) => Buffer.from(String(s), 'base64'),
  base64DecodeWebSafe: (s: string) => Buffer.from(String(s), 'base64url'),
  base64Encode: (b: Buffer | number[] | string) => (Buffer.isBuffer(b) ? b : typeof b === 'string' ? Buffer.from(b, 'utf8') : Buffer.from(b)).toString('base64'),
  newBlob,
  /** Only the patterns the code uses: 'H' (hour) and 'yyyy-MM-dd'. */
  formatDate: (d: Date, tz: string, fmt: string) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', { timeZone: tz || TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
        .formatToParts(new Date(d))
        .map(p => [p.type, p.value]),
    );
    if (fmt === 'H') return String(Number(parts.hour));
    if (fmt === 'yyyy-MM-dd') return `${parts.year}-${parts.month}-${parts.day}`;
    throw new Error('Utilities.formatDate: unsupported format ' + fmt);
  },
};

function google(ctx: RunContext) {
  const token = () => {
    if (!ctx.google) throw new Error('google_not_connected: Connect your Google account first (Settings → Gmail).');
    return ctx.google.token;
  };
  const call = (url: string, init: Omit<SyncRequest, 'url'> = {}) => {
    const r = syncFetch({ url, ...init, headers: { Authorization: 'Bearer ' + token(), ...(init.headers || {}) } });
    if (r.status < 200 || r.status >= 300) throw new Error('Google ' + r.status + ': ' + (r.error || bodyText(r)).slice(0, 300));
    return r;
  };
  const json = (url: string, init?: Omit<SyncRequest, 'url'>) => JSON.parse(bodyText(call(url, init)));
  const DRIVE = 'https://www.googleapis.com/drive/v3/files/';

  const file = (meta: { id: string; name?: string; mimeType?: string }) => {
    const info = () => (meta.name != null ? meta : (meta = { ...meta, ...json(DRIVE + meta.id + '?fields=id,name,mimeType&supportsAllDrives=true') }));
    return {
      getId: () => meta.id,
      getName: () => info().name,
      getBlob: () => {
        const m = info();
        const r = call(DRIVE + meta.id + '?alt=media&supportsAllDrives=true');
        return newBlob(Buffer.from(r.body, 'base64'), m.mimeType, m.name);
      },
      setTrashed: (t: boolean) => {
        call(DRIVE + meta.id + '?supportsAllDrives=true', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: !!t }) });
      },
    };
  };

  const DriveApp = {
    getRootFolder: () => ({ getName: () => 'My Drive' }),
    getFileById: (id: string) => file({ id }),
    getFolderById: (folderId: string) => ({
      getId: () => folderId,
      createFile: (blob: Blob) => {
        const boundary = 'b' + Math.random().toString(36).slice(2);
        const meta = JSON.stringify({ name: blob.getName() || 'receipt', mimeType: blob.getContentType(), parents: [folderId] });
        const body = Buffer.concat([
          Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${blob.getContentType()}\r\n\r\n`),
          blob.getBytes(),
          Buffer.from(`\r\n--${boundary}--`),
        ]);
        const r = call('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,mimeType', {
          method: 'POST',
          headers: { 'Content-Type': 'multipart/related; boundary=' + boundary },
          body: body.toString('base64'),
          bodyIsBase64: true,
        });
        return file(JSON.parse(bodyText(r)));
      },
    }),
  };

  const labels = () => (json('https://gmail.googleapis.com/gmail/v1/users/me/labels').labels || []) as { id: string; name: string; type: string }[];
  const label = (l: { name: string }) => ({ getName: () => l.name });
  const GmailApp = {
    getUserLabels: () => labels().filter(l => l.type === 'user').map(label),
    getUserLabelByName: (name: string) => {
      const l = labels().find(x => x.name === name);
      return l ? label(l) : null;
    },
  };
  return { token, DriveApp, GmailApp };
}

function sandbox(ctx: RunContext) {
  const { store } = ctx;
  const g = google(ctx);
  const props = {
    getProperty: (k: string) => (SECRET_PROPS.includes(k) ? (process.env[k] ?? null) : store.getProp(k)),
    setProperty: (k: string, v: unknown) => {
      if (SECRET_PROPS.includes(k)) throw new Error(k + ' is set in Vercel, not by the app.');
      store.setProp(k, String(v));
    },
    deleteProperty: (k: string) => store.setProp(k, null),
  };
  const noTrigger = { timeBased: () => noTrigger, after: () => noTrigger, everyHours: () => noTrigger, everyDays: () => noTrigger, atHour: () => noTrigger, create: () => null };
  const lock = { waitLock: () => {}, tryLock: () => true, releaseLock: () => {} };
  const user = { getEmail: () => ctx.google?.email || ctx.email };
  const unavailable = (name: string) =>
    new Proxy(
      {},
      {
        get: () => {
          throw new Error(name + ' is not available on Vercel.');
        },
      },
    );
  return {
    console,
    __TIME_BUDGET_MS: ctx.timeBudgetMs ?? 240_000,
    Logger: { log: (...a: unknown[]) => console.log(...a) },
    UrlFetchApp,
    Utilities,
    PropertiesService: { getScriptProperties: () => props, getUserProperties: () => props },
    Session: { getEffectiveUser: () => user, getActiveUser: () => user, getScriptTimeZone: () => TZ },
    LockService: { getScriptLock: () => lock, getUserLock: () => lock },
    ScriptApp: {
      getOAuthToken: g.token,
      AuthMode: { FULL: 'FULL' },
      AuthorizationStatus: { NOT_REQUIRED: 'NOT_REQUIRED', REQUIRED: 'REQUIRED' },
      getAuthorizationInfo: () => ({ getAuthorizationStatus: () => 'NOT_REQUIRED' }),
      getProjectTriggers: () => [],
      deleteTrigger: () => {},
      newTrigger: () => noTrigger,
    },
    DriveApp: g.DriveApp,
    GmailApp: g.GmailApp,
    SpreadsheetApp: unavailable('SpreadsheetApp'),
    HtmlService: unavailable('HtmlService'),
  };
}

/** A sandbox with the Apps Script code loaded and its Sheet functions pointed at the store. */
export function load(ctx: RunContext) {
  const box = vm.createContext(sandbox(ctx));
  for (const s of compiled()) s.runInContext(box);
  const { store } = ctx;
  Object.assign(box, {
    ss_: () => {
      throw new Error('No spreadsheet on Vercel.');
    },
    tab_: () => {
      throw new Error('No spreadsheet on Vercel.');
    },
    withLock_: (fn: () => unknown) => fn(),
    readTable_: (name: string) => store.read(name),
    readColumn_: (name: string, key: string) => store
      .read(name)
      .map(r => (r[key] == null ? '' : String(r[key])))
      .filter(Boolean),
    upsertRow_: (name: string, key: string, obj: Record<string, unknown>) => store.upsert(name, key, obj),
    deleteRow_: (name: string, key: string, value: unknown) => {
      store.deleteIn(name, key, [value]);
    },
    deleteWhere_: (name: string, key: string, values: unknown[]) => store.deleteIn(name, key, values),
    clearTable_: (name: string) => store.clear(name),
    appendNew_: (name: string, key: string, objs: Record<string, unknown>[]) => store.appendNew(name, key, objs),
  });
  return box;
}

/** Plain data out of the sandbox (its objects belong to another realm). */
const plain = (v: unknown) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

/** Run one of the page's actions (Code.js ACTIONS), as `api(action, payload)` does in Apps Script. */
export function runAction(ctx: RunContext, action: string, payload: unknown) {
  const box = load(ctx);
  box.__action = action;
  box.__payload = JSON.parse(JSON.stringify(payload ?? {}));
  return plain(vm.runInContext('api(__action, __payload)', box));
}

/** Call a top-level Apps Script function by name (the hourly sync, setup steps). */
export function runFunction(ctx: RunContext, name: string, ...args: unknown[]) {
  const box = load(ctx);
  if (typeof box[name] !== 'function') throw new Error('No function ' + name);
  box.__args = JSON.parse(JSON.stringify(args));
  return plain(vm.runInContext(`${name}.apply(null, __args)`, box));
}
