/**
 * Synchronous HTTP for the Apps Script code, which calls UrlFetchApp and expects an answer on the next line.
 * A worker thread does the (async) fetches while this thread waits on a shared flag, so the old code runs
 * unchanged. Bodies travel as base64 so files (receipts) survive the trip.
 */
import { MessageChannel, receiveMessageOnPort, Worker } from 'node:worker_threads';

export type SyncRequest = { url: string; method?: string; headers?: Record<string, string>; body?: string; bodyIsBase64?: boolean };
export type SyncResponse = { status: number; headers: Record<string, string>; body: string; error?: string };

const WORKER = `
const { parentPort } = require('node:worker_threads');
parentPort.on('message', async ({ reqs, port, signal }) => {
  const out = await Promise.all(reqs.map(async r => {
    try {
      const body = r.body == null ? undefined : r.bodyIsBase64 ? Buffer.from(r.body, 'base64') : r.body;
      const isGemini = String(r.url || '').includes('generativelanguage.googleapis.com');
      const res = await fetch(r.url, {
        method: r.method || 'GET',
        headers: r.headers,
        body,
        signal: AbortSignal.timeout(isGemini ? 22_000 : 60_000),
      });
      const buf = Buffer.from(await res.arrayBuffer());
      return { status: res.status, headers: Object.fromEntries(res.headers), body: buf.toString('base64') };
    } catch (e) {
      const name = e && e.name ? String(e.name) : '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        const msg = JSON.stringify({ error: { message: 'Model request timed out' } });
        return { status: 504, headers: {}, body: Buffer.from(msg).toString('base64') };
      }
      return { status: 0, headers: {}, body: '', error: String((e && e.message) || e) };
    }
  }));
  port.postMessage(out);
  Atomics.store(signal, 0, 1);
  Atomics.notify(signal, 0);
});
`;

let worker: Worker | null = null;
const TIMEOUT_MS = 120_000;

/** Run requests in parallel and wait for all of them. */
export function syncFetchAll(reqs: SyncRequest[]): SyncResponse[] {
  if (!reqs.length) return [];
  if (!worker) {
    worker = new Worker(WORKER, { eval: true });
    worker.unref();
  }
  const signal = new Int32Array(new SharedArrayBuffer(4));
  const { port1, port2 } = new MessageChannel();
  worker.postMessage({ reqs, port: port2, signal }, [port2]);
  const waited = Atomics.wait(signal, 0, 0, TIMEOUT_MS);
  const msg = receiveMessageOnPort(port1);
  port1.close();
  if (waited === 'timed-out' || !msg) throw new Error('A request took too long. Try again.');
  return msg.message as SyncResponse[];
}

export const syncFetch = (req: SyncRequest) => syncFetchAll([req])[0];

/** Text of a response body. */
export const bodyText = (r: SyncResponse) => Buffer.from(r.body, 'base64').toString('utf8');

/** Block this thread for `ms` (Utilities.sleep). */
export function sleepSync(ms: number) {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
