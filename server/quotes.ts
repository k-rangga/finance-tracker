/**
 * Current prices for the Investment journal, from Yahoo Finance (Google Finance only works inside a Sheet).
 * Same contract as the Apps Script `quotes` action: [{ tk, mk }] → { ticker: { price, at } }; symbols Yahoo doesn't
 * know are left out, and the page asks for those by hand as before.
 */
type Item = { tk: string; mk: string };

/** BBCA (IDX) → BBCA.JK, BTC (Crypto) → BTC-USD, NASDAQ:AAPL or AAPL (US) → AAPL. */
export function yahooSymbol(mk: string, tk: string) {
  const t = String(tk || '').trim().toUpperCase();
  const bare = t.includes(':') ? t.split(':').pop()! : t;
  if (mk === 'IDX') return bare.endsWith('.JK') ? bare : bare + '.JK';
  if (mk === 'Crypto') return bare.replace(/USD$/, '') + '-USD';
  return bare;
}

export async function quotes(items: Item[]) {
  const at = new Date().toISOString();
  const out: Record<string, { price: number; at: string }> = {};
  await Promise.all(
    items.slice(0, 60).map(async i => {
      try {
        const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol(i.mk, i.tk))}?range=1d&interval=1d`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (finance-tracker)' },
        });
        if (!r.ok) return;
        const d = (await r.json()) as { chart?: { result?: { meta?: { regularMarketPrice?: number } }[] } };
        const price = d.chart?.result?.[0]?.meta?.regularMarketPrice;
        if (typeof price === 'number' && price > 0) out[i.tk] = { price, at };
      } catch {
        // Unknown or unreachable: left out, like #N/A in the Sheet.
      }
    }),
  );
  return out;
}
