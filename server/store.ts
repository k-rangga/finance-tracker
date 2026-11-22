/**
 * Where the Apps Script code's tables live on Vercel: one user's rows in Supabase. It answers the same calls as
 * Sheets.js (read a table, upsert, delete, append) with the same results, so Code.js, Gmail.js and the rest run
 * as they are. Reads are cached for the request; writes go straight through (and update the cache).
 * MemoryStore does the same in memory, for tests.
 */
import { bodyText, syncFetch, syncFetchAll, type SyncRequest } from './bridge.js';

export type Row = Record<string, unknown>;
export type Tables = Record<string, string[]>;

/** A row as the Sheet code reads it: every column present, blank as null, numeric columns as numbers. */
export function fromDb(cols: string[], nums: string[], r: Row): Row {
  const o: Row = {};
  for (const c of cols) {
    const v = r[c];
    o[c] = v === '' || v == null ? null : nums.includes(c) ? Number(v) : String(v);
  }
  return o;
}

/** A row as stored: only the table's columns; blank is null, numbers stay numbers in numeric columns. */
export function toDb(cols: string[], nums: string[], obj: Row): Row {
  const o: Row = {};
  for (const c of cols) {
    const v = obj[c];
    if (v == null || v === '') o[c] = null;
    else if (nums.includes(c)) o[c] = Number.isFinite(Number(v)) ? Number(v) : null;
    else o[c] = String(v);
  }
  return o;
}

export abstract class Store {
  protected cache = new Map<string, Row[]>();
  props = new Map<string, string>();
  constructor(
    readonly tables: Tables,
    readonly numeric: Record<string, string[]>,
  ) {}

  protected cols = (t: string) => {
    const c = this.tables[t];
    if (!c) throw new Error('Unknown table: ' + t);
    return c;
  };
  protected nums = (t: string) => this.numeric[t] ?? [];

  protected abstract fetchTable(t: string): Row[];
  protected abstract writeUpsert(t: string, key: string, rows: Row[]): void;
  protected abstract writeDelete(t: string, key: string, values: string[]): void;
  protected abstract writeClear(t: string): void;
  protected abstract writeProp(key: string, value: string | null): void;

  /** Fill the cache ahead of time (Supabase: in parallel, before the Sheet code runs). */
  seed(t: string, rows: Row[]) {
    this.cache.set(
      t,
      rows.map(r => fromDb(this.cols(t), this.nums(t), r)),
    );
  }

  read(t: string): Row[] {
    let rows = this.cache.get(t);
    if (!rows) {
      rows = this.fetchTable(t).map(r => fromDb(this.cols(t), this.nums(t), r));
      this.cache.set(t, rows);
    }
    return rows.map(r => ({ ...r }));
  }

  upsert(t: string, key: string, obj: Row) {
    const row = toDb(this.cols(t), this.nums(t), obj);
    if (row[key] == null) throw new Error(`${t}: ${key} is required`);
    this.writeUpsert(t, key, [row]);
    const rows = this.cache.get(t);
    if (rows) {
      const v = fromDb(this.cols(t), this.nums(t), row);
      const i = rows.findIndex(r => String(r[key]) === String(row[key]));
      if (i >= 0) rows[i] = v;
      else rows.push(v);
    }
  }

  deleteIn(t: string, key: string, values: unknown[]): number {
    const want = new Set(values.map(String));
    if (!want.size) return 0;
    const before = this.read(t).filter(r => want.has(String(r[key]))).length;
    this.writeDelete(t, key, [...want]);
    const rows = this.cache.get(t);
    if (rows)
      this.cache.set(
        t,
        rows.filter(r => !want.has(String(r[key]))),
      );
    return before;
  }

  clear(t: string) {
    this.writeClear(t);
    this.cache.set(t, []);
  }

  /** Rows whose key isn't there yet; returns how many were added. */
  appendNew(t: string, key: string, objs: Row[]): number {
    const seen = new Set(this.read(t).map(r => String(r[key])));
    const add: Row[] = [];
    for (const o of objs) {
      const k = String(o[key]);
      if (seen.has(k)) continue;
      seen.add(k);
      add.push(toDb(this.cols(t), this.nums(t), o));
    }
    if (!add.length) return 0;
    this.writeUpsert(t, key, add);
    this.cache.get(t)!.push(...add.map(r => fromDb(this.cols(t), this.nums(t), r)));
    return add.length;
  }

  getProp(k: string): string | null {
    return this.props.has(k) ? this.props.get(k)! : null;
  }
  setProp(k: string, v: string | null) {
    if (v == null) this.props.delete(k);
    else this.props.set(k, v);
    this.writeProp(k, v);
  }
}

/** In memory, for tests and local runs. */
export class MemoryStore extends Store {
  db = new Map<string, Row[]>();
  protected fetchTable(t: string) {
    return (this.db.get(t) ?? []).map(r => ({ ...r }));
  }
  protected writeUpsert(t: string, key: string, rows: Row[]) {
    const list = this.db.get(t) ?? [];
    for (const r of rows) {
      const i = list.findIndex(x => String(x[key]) === String(r[key]));
      if (i >= 0) list[i] = { ...r };
      else list.push({ ...r });
    }
    this.db.set(t, list);
  }
  protected writeDelete(t: string, key: string, values: string[]) {
    const want = new Set(values);
    this.db.set(
      t,
      (this.db.get(t) ?? []).filter(r => !want.has(String(r[key]))),
    );
  }
  protected writeClear(t: string) {
    this.db.set(t, []);
  }
  protected writeProp() {}
}

const PAGE = 1000;
const CHUNK = 500;
/** PostgREST's `in.(…)` list: values in double quotes, with quotes and backslashes escaped. */
const inList = (vs: string[]) => '(' + vs.map(v => '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"').join(',') + ')';

/** One user's rows in Supabase, through its REST API with the server key (every query is filtered by user). */
export class SupabaseStore extends Store {
  constructor(
    tables: Tables,
    numeric: Record<string, string[]>,
    private url: string,
    private key: string,
    readonly userId: string,
  ) {
    super(tables, numeric);
  }

  private headers(extra: Record<string, string> = {}) {
    return { apikey: this.key, Authorization: 'Bearer ' + this.key, 'Content-Type': 'application/json', ...extra };
  }
  private rest = (path: string) => this.url.replace(/\/$/, '') + '/rest/v1/' + path;
  private mine = () => 'user_id=eq.' + encodeURIComponent(this.userId);

  private check(reqs: SyncRequest[]) {
    for (const r of syncFetchAll(reqs)) {
      if (r.status < 200 || r.status >= 300) throw new Error('Database error ' + r.status + ': ' + (r.error || bodyText(r)).slice(0, 300));
    }
  }

  private pageUrl(t: string, offset: number) {
    return this.rest(`${encodeURIComponent(t)}?${this.mine()}&select=*&order=seq.asc&limit=${PAGE}&offset=${offset}`);
  }

  protected fetchTable(t: string): Row[] {
    const out: Row[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const r = syncFetch({ url: this.pageUrl(t, offset), headers: this.headers() });
      if (r.status !== 200) throw new Error('Database error ' + r.status + ': ' + (r.error || bodyText(r)).slice(0, 300));
      const rows = JSON.parse(bodyText(r)) as Row[];
      out.push(...rows);
      if (rows.length < PAGE) return out;
    }
  }

  /** Load tables (and the user's props) in parallel before the Sheet code runs. */
  async prefetch(tables: string[], withProps = true) {
    const get = async (url: string) => {
      const r = await fetch(url, { headers: this.headers() });
      if (!r.ok) throw new Error('Database error ' + r.status + ': ' + (await r.text()).slice(0, 300));
      return (await r.json()) as Row[];
    };
    const all = async (t: string) => {
      const out: Row[] = [];
      for (let offset = 0; ; offset += PAGE) {
        const rows = await get(this.pageUrl(t, offset));
        out.push(...rows);
        if (rows.length < PAGE) return out;
      }
    };
    const [props, ...lists] = await Promise.all([
      withProps ? get(this.rest(`props?${this.mine()}&select=key,value`)) : Promise.resolve([]),
      ...tables.map(all),
    ]);
    for (const p of props) if (p.value != null) this.props.set(String(p.key), String(p.value));
    tables.forEach((t, i) => this.seed(t, lists[i]));
  }

  protected writeUpsert(t: string, key: string, rows: Row[]) {
    const reqs: SyncRequest[] = [];
    for (let i = 0; i < rows.length; i += CHUNK)
      reqs.push({
        url: this.rest(`${encodeURIComponent(t)}?on_conflict=user_id,${encodeURIComponent(key)}`),
        method: 'POST',
        headers: this.headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify(rows.slice(i, i + CHUNK).map(r => ({ ...r, user_id: this.userId }))),
      });
    this.check(reqs);
  }

  protected writeDelete(t: string, key: string, values: string[]) {
    const reqs: SyncRequest[] = [];
    for (let i = 0; i < values.length; i += 100)
      reqs.push({
        url: this.rest(`${encodeURIComponent(t)}?${this.mine()}&${encodeURIComponent(key)}=in.${encodeURIComponent(inList(values.slice(i, i + 100)))}`),
        method: 'DELETE',
        headers: this.headers({ Prefer: 'return=minimal' }),
      });
    this.check(reqs);
  }

  protected writeClear(t: string) {
    this.check([{ url: this.rest(`${encodeURIComponent(t)}?${this.mine()}`), method: 'DELETE', headers: this.headers({ Prefer: 'return=minimal' }) }]);
  }

  protected writeProp(k: string, v: string | null) {
    this.check([
      v == null
        ? { url: this.rest(`props?${this.mine()}&key=eq.${encodeURIComponent(k)}`), method: 'DELETE', headers: this.headers({ Prefer: 'return=minimal' }) }
        : {
            url: this.rest('props?on_conflict=user_id,key'),
            method: 'POST',
            headers: this.headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
            body: JSON.stringify([{ user_id: this.userId, key: k, value: v }]),
          },
    ]);
  }
}
