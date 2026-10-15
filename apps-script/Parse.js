/**
 * Turn a receipt email into a transaction: amount, currency, category and source.
 * Heuristic and Indonesia-first (Rp / IDR formats, local merchants and banks).
 * Category names must match src/data/categories.ts. Used by Gmail.js.
 */

const CATEGORY_RULES = [
  ['Income', /\b(gaji|salary|payroll|payslip|slip gaji|thr)\b/i],
  ['Housing', /\b(sewa|rent|kost?|apartemen|apartment|ipl|mortgage|kpr)\b/i],
  ['Insurance', /\b(asuransi|insurance|premi|prudential|allianz|axa|manulife|bpjs)\b/i],
  ['Utilities', /\b(pln|listrik|electricity|token listrik|pdam|water bill|indihome|biznet|first ?media|myrepublic|internet|pulsa|paket data|gas bill|pgn)\b/i],
  ['Subscriptions', /\b(netflix|spotify|youtube premium|apple\.com\/bill|icloud|google (one|play)|disney|vidio|prime video|chatgpt|subscription|langganan|membership)\b/i],
  ['Dining', /\b(gofood|grabfood|shopeefood|restaurant|restoran|resto|cafe|caf[eé]|coffee|kopi|starbucks|mcdonald|kfc|bakery|dining)\b/i],
  ['Transport', /\b(goride|gocar|grabbike|grabcar|grab ?ride|bluebird|taxi|taksi|krl|mrt|lrt|transjakarta|commuter|pertamina|shell|bensin|fuel|bbm|parkir|parking|e-?toll|tol|kai|tiket kereta)\b/i],
  ['Groceries', /\b(supermarket|hypermart|superindo|alfamart|alfamidi|indomaret|ranch market|lotte mart|transmart|hero|sayurbox|segari|astro|grocer|groceries|fresh market|carrefour)\b/i],
  ['Shopping', /\b(tokopedia|shopee|lazada|blibli|zalora|bukalapak|amazon|uniqlo|ikea|ace hardware|pesanan|order)\b/i],
];

const SOURCE_RULES = [
  ['Payroll email', /\b(gaji|salary|payroll|payslip)\b/i],
  ['Ride app email', /\b(gojek|goride|gocar|grab|bluebird|maxim)\b/i],
  ['E-wallet email', /\b(gopay|ovo|dana|shopeepay|linkaja)\b/i],
  ['Marketplace email', /\b(tokopedia|shopee|lazada|blibli|zalora|bukalapak|amazon)\b/i],
  ['Utility email', /\b(pln|pdam|indihome|biznet|first ?media|telkomsel|xl|pgn)\b/i],
  ['Insurer email', /\b(asuransi|insurance|prudential|allianz|axa|manulife|bpjs)\b/i],
  ['Billing email', /\b(netflix|spotify|apple|google|disney|vidio|subscription|langganan|invoice)\b/i],
  ['Card receipt', /\b(kartu (kredit|debit)|credit card|debit card|card ending|visa|mastercard)\b/i],
  ['Bank email', /\b(bca|mandiri|bni|bri|cimb|permata|jenius|jago|seabank|blu|danamon|ocbc|transfer)\b/i],
];

const TOTAL_WORDS = /(grand total|total bayar|total pembayaran|total tagihan|total payment|total amount|amount paid|jumlah (?:bayar|pembayaran|tagihan|transfer)?|nominal|total|tagihan|amount|charged|dibayar|paid)\s*[:\-]?\s*$/i;

/** Parse "1.250.000", "1,250,000.00", "135.000,00", "36000" into a number. */
function parseNumber_(raw, idr) {
  let s = raw.replace(/\s/g, '');
  const m = s.match(/^(.*?)([.,])(\d{1,2})$/);
  let dec = '';
  // A trailing ".dd" / ",dd" is a decimal part, unless it is a thousands group (exactly 3 digits never matches here).
  if (m) {
    s = m[1];
    dec = m[3];
  }
  const int = s.replace(/[.,]/g, '');
  if (!/^\d+$/.test(int)) return NaN;
  const v = Number(int + (dec ? '.' + dec : ''));
  return idr ? Math.round(v) : v;
}

function findAmounts_(text) {
  const hits = [];
  const re = /(Rp\.?|IDR|USD|US\$|\$)\s?(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/gi;
  for (const m of text.matchAll(re)) {
    const sym = m[1].toUpperCase();
    const idr = sym.startsWith('RP') || sym === 'IDR';
    const amount = parseNumber_(m[2], idr);
    if (!(amount > 0)) continue;
    const before = text.slice(Math.max(0, m.index - 40), m.index);
    hits.push({ amount, currency: idr ? 'IDR' : 'USD', index: m.index, keyed: TOTAL_WORDS.test(before) });
  }
  return hits;
}

const GENERIC_SENDER = /\b(no-?reply|noreply|notifications?|info|support|hr|payroll|bank|bca|mandiri|bni|bri|cimb|permata|jenius|jago)\b/i;

/** The sender's display name is usually the merchant; banks and generic senders fall back to the subject. */
function cleanTitle_(subject, from) {
  const sender = from.replace(/<.*>/, '').replace(/"/g, '').trim();
  if (sender && !sender.includes('@') && !GENERIC_SENDER.test(sender)) return sender.length > 60 ? sender.slice(0, 57) + '…' : sender;
  const s = subject
    .replace(/^(re|fwd?):\s*/i, '')
    .replace(/\b(your|e-?receipt|receipt|struk|bukti (pembayaran|transaksi)|invoice|tagihan|notifikasi|notification|transaksi berhasil|payment (confirmation|successful))\b[:\s-]*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const t = s.length >= 3 ? s : sender || subject;
  return t.length > 60 ? t.slice(0, 57).trimEnd() + '…' : t;
}

function parseReceipt(e) {
  const hay = `${e.subject}\n${e.from}\n${e.text}`;
  const hits = findAmounts_(`${e.subject}\n${e.text}`);
  if (!hits.length) return null;
  // Prefer an amount labelled "total"/"jumlah"/"nominal"; the last labelled one is usually the grand total.
  const keyed = hits.filter(h => h.keyed);
  const pick = keyed.length ? keyed[keyed.length - 1] : hits[0];
  const category = CATEGORY_RULES.find(([, re]) => re.test(hay))?.[0] ?? 'Buffer';
  const source = SOURCE_RULES.find(([, re]) => re.test(hay))?.[0] ?? 'Email receipt';
  return { amount: pick.amount, currency: pick.currency, title: cleanTitle_(e.subject, e.from), category, source };
}
