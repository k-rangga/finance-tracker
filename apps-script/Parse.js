/**
 * Turn a receipt email into a transaction. Used by Gmail.js; tested by test/parse.test.mjs.
 *
 * parseReceipt({ subject, from, text }) → null (not a transaction) or
 *   { kind, amount, currency, title, category, source, ref }
 * kind: 'spend' | 'income' | 'transfer' | 'reversal'
 * ref:  a reference shared by emails about the same purchase (e.g. a Grab booking id that also
 *       appears in the card alert), used to drop duplicates and match reversals. May be ''.
 *
 * Handles emails forwarded from another mailbox: the original From/Subject inside the body win.
 * Specific formats first (BCA journal, BCA credit card, blu, Grab), then a generic fallback.
 * Category names must match src/data/categories.ts.
 */

const TRANSFER = 'Transfer';
/** Grab booking/order code, e.g. A-9SNARFAGWUHIAV (the card alert shows it as "Grab* A-…"). */
const GRAB_CODE = /\bA-[A-Z0-9]{10,}\b/;
const INCOME = 'Income';

const CATEGORY_RULES = [
  ['Housing', /\b(sewa|rent|kost?|apartemen|apartment|ipl|mortgage|kpr)\b/i],
  ['Insurance', /\b(asuransi|insurance|premi|prudential|allianz|axa|manulife|bpjs)\b/i],
  ['Utilities', /\b(pln|listrik|electricity|token listrik|pdam|water bill|indihome|biznet|first ?media|myrepublic|pulsa|paket data|gas bill|pgn|telkomsel)\b/i],
  ['Subscriptions', /\b(netflix|spotify|youtube premium|apple\.com\/bill|icloud|google (one|play)|disney|vidio|prime video|chatgpt|openai|anthropic|claude|subscription|langganan|membership)\b/i],
  ['Groceries', /\b(grabmart|supermarket|hypermart|superindo|alfamart|alfamidi|indomaret|ranch market|lotte mart|transmart|hero|sayurbox|segari|astro|grocer|groceries|fresh market|carrefour|aeon|lawson|family ?mart|circle ?k|buah|fruit|sayur|minimarket)\b/i],
  ['Dining', /\b(grabfood|gofood|shopeefood|restaurant|restoran|resto|rm|cafe|caf[eé]|coffee|kopi|tuku|starbucks|mcdonald|kfc|bakery|patisserie|dining|warung|bakso|pentol|mie|bakmi|kwetiau|nasi|ayam|bebek|geprek|pecel|padang|sate|soto|martabak|kebab|roti|dimsum|sushi|ramen|pizza|burger|bowls?|boba|chatime|teh|tea|food ?court|food)\b/i],
  ['Transport', /\b(goride|gocar|grabbike|grabcar|bluebird|taxi|taksi|krl|mrt|lrt|stasiun|transjakarta|busway|bus|feeder|damri|commuter|pertamina|shell|spbu|bensin|fuel|bbm|parkir|parking|e-?toll|tol|flazz|e-?money|tapcash|brizzi|kai|tiket kereta|toyota|honda|bengkel|bodyrepai\w*)\b/i],
  ['Shopping', /\b(tokopedia|shopee|lazada|blibli|zalora|bukalapak|amazon|uniqlo|ikea|ace hardware|pesanan|order|grabexpress)\b/i],
];

const SOURCE_RULES = [
  ['Ride app email', /\b(grab|gojek|bluebird|maxim)\b/i],
  ['Card receipt', /\b(kartu ?kredit|credit card|kartukreditbca)\b/i],
  ['E-wallet email', /\b(gopay|ovo|dana|shopeepay|linkaja)\b/i],
  ['Marketplace email', /\b(tokopedia|shopee|lazada|blibli|zalora|bukalapak|amazon)\b/i],
  ['Bank email', /\b(bca|blu|mandiri|bni|bri|cimb|permata|jenius|jago|seabank|superbank|danamon|ocbc)\b/i],
  ['Payroll email', /\b(gaji|salary|payroll|payslip)\b/i],
  ['Billing email', /\b(netflix|spotify|apple|google|disney|vidio|subscription|langganan|invoice)\b/i],
];

const TOTAL_WORDS = /(grand total|total bayar|total pembayaran|total tagihan|total payment|total paid|total amount|amount paid|top up amount|transfer amount|jumlah (?:bayar|pembayaran|tagihan|transfer)?|nominal|sejumlah|total|tagihan|amount|charged|dibayar|paid)\s*[:\-]?\s*$/i;

// ---------------------------------------------------------------- entry point

function parseReceipt(e) {
  const fwd = unwrapForward_(e);
  const subject = fwd.subject;
  const from = fwd.from;
  const text = fwd.text;
  const hay = subject + '\n' + from + '\n' + text;
  const specific = parseBcaJournal_(subject, text) || parseBcaCard_(subject, text) || parseBlu_(subject, text) || parseGrab_(subject, from, text);
  const p = specific || parseGeneric_(subject, from, text);
  if (!p || !(p.amount > 0)) return null;
  return {
    kind: p.kind || 'spend',
    amount: p.amount,
    currency: p.currency || 'IDR',
    title: clip_(p.title || titleFrom_(subject, from), 60),
    category: p.category || categoryOf_(p.kind, hay),
    source: p.source || sourceOf_(hay),
    ref: p.ref || '',
  };
}

// ---------------------------------------------------------------- forwarded mail

/** Forwarded emails ("FW: …") carry the original From/Subject in the body; use those. */
function unwrapForward_(e) {
  let subject = String(e.subject || '');
  let from = String(e.from || '');
  const text = String(e.text || '');
  if (/^\s*(fw|fwd)\s*:/i.test(subject) || /^\s*_{5,}\s*$/m.test(text.slice(0, 400))) {
    const head = text.slice(0, 1500);
    const f = head.match(/^\s*(?:From|Dari)\s*:\s*(.+)$/im);
    const s = head.match(/^\s*(?:Subject|Subjek|Perihal)\s*:\s*(.+)$/im);
    if (f) from = f[1].trim();
    if (s) subject = s[1].trim();
  }
  subject = subject.replace(/^\s*((fw|fwd|re)\s*:\s*)+/i, '').trim();
  return { subject: subject, from: from, text: text };
}

// ---------------------------------------------------------------- specific formats

/** "Key : Value" lines (BCA style). */
function fields_(text) {
  const out = {};
  text.split('\n').forEach(line => {
    const m = line.match(/^\s*([A-Za-z][A-Za-z /.()-]{1,40}?)\s*:\s*(.+?)\s*$/);
    if (m && !(m[1].toLowerCase() in out)) out[m[1].toLowerCase()] = m[2];
  });
  return out;
}

/** "Hello KALAKA RANGGA S," / "Hi Kalaka," — the account holder, for spotting transfers to yourself. */
function holder_(text) {
  const m = text.match(/^\s*(?:hello|hi|halo|dear|yth\.?)\s+([^,\n]{2,60}),/im);
  return m ? m[1].trim() : '';
}

const letters_ = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

/** True when a counterparty name looks like the account holder (e.g. "KALAKA RANGGAS" vs "Kalaka Rangga, S"). */
function isSelf_(name, holderNames) {
  const n = letters_(name);
  if (n.length < 4) return false;
  return holderNames.some(h => {
    const x = letters_(h);
    return x.length >= 4 && (n === x || n.indexOf(x) === 0 || x.indexOf(n) === 0);
  });
}

function parseBcaJournal_(subject, text) {
  if (!/internet transaction journal|mybca|klikbca/i.test(subject + text.slice(0, 600)) || !/(transaction|transfer) type\s*:|type of transaction\s*:/i.test(text)) return null;
  const f = fields_(text);
  const type = f['transaction type'] || f['transfer type'] || f['type of transaction'] || '';
  const amt = money_(f['total payment'] || f['top up amount'] || f['transfer amount'] || f['amount'] || f['total'] || f['nominal'] || '');
  if (!amt) return null;
  const to = f['payment to'] || f['beneficiary name'] || f['receiver name'] || f['recipient name'] || f['to account name'] || f['account name'] || f['merchant name'] || '';
  const ref = f['reference no.'] || f['reference no'] || f['rrn'] || '';
  const base = { amount: amt.amount, currency: amt.currency, source: 'Bank email', ref: 'bca:' + ref };
  if (/flazz|e-?money|tapcash|brizzi/i.test(type)) return Object.assign(base, { title: 'Flazz top-up', category: 'Transport' });
  if (/top ?up/i.test(type)) return Object.assign(base, { kind: 'transfer', title: (to || type).trim() });
  if (/virtual account/i.test(type)) {
    // e.g. "KLIRING KOMODITI INDONESIA PT / KKI-PLUANG" paid under your own name: money into your own
    // investment or e-wallet account, not spending. A VA in someone else's name is a bill.
    const company = f['company/product name'] || f['company name'] || f['product name'] || '';
    const self = isSelf_(f['name'] || '', [holder_(text)]) || INVESTING.test(company);
    return Object.assign(base, { kind: self ? 'transfer' : 'spend', title: vaTitle_(company) || type, category: self ? TRANSFER : categoryOfName_(company) });
  }
  if (/transfer/i.test(type)) {
    const self = isSelf_(to, [holder_(text)]);
    return Object.assign(base, { kind: self ? 'transfer' : 'spend', title: to || type, category: self ? TRANSFER : categoryOfName_(to) });
  }
  if (/credit card|kartu kredit/i.test(type + to)) return Object.assign(base, { kind: 'transfer', title: 'Credit card payment' });
  return Object.assign(base, { title: to || type, category: categoryOfName_(to) });
}

/** Investment and e-wallet providers: paying into them moves your own money. */
const INVESTING = /\b(pluang|bibit|ajaib|stockbit|ipot|indo ?premier|bareksa|tokocrypto|pintu|indodax|reku|mirae|sinarmas sekuritas|motion trade|gopay|ovo|dana|shopeepay|linkaja|flip)\b/i;

/** "KLIRING KOMODITI INDONESIA PT / KKI-PLUANG" → "Pluang"; otherwise the company name in title case. */
function vaTitle_(company) {
  const known = company.match(INVESTING);
  if (known) return known[1].charAt(0).toUpperCase() + known[1].slice(1).toLowerCase();
  return merchantName_(company.split('/')[0]);
}

function parseBcaCard_(subject, text) {
  if (!/credit card .*notification|kartu ?kredit/i.test(subject + text.slice(0, 600)) || !/merchant\s*\/\s*atm\s*:/i.test(text)) return null;
  const f = fields_(text);
  const merchant = (f['merchant / atm'] || '').trim();
  const amt = money_(f['sejumlah'] || f['amount'] || '');
  if (!amt) return null;
  const booking = merchant.match(GRAB_CODE);
  const kind = /reversal|void/i.test(subject) ? 'reversal' : 'spend';
  return {
    kind: kind,
    amount: amt.amount,
    currency: amt.currency,
    title: merchantName_(merchant),
    category: /^grab\b/i.test(merchant) ? 'Transport' : categoryOfName_(merchant),
    source: 'Card receipt',
    ref: booking ? 'grab:' + booking[0] + ':' + amt.amount : 'card:' + letters_(merchant) + ':' + amt.amount + ':' + (f['pada tanggal'] || '').slice(0, 16),
  };
}

function parseBlu_(subject, text) {
  if (!/blu/i.test(subject) || !/bcadigital|#teamblu|bluaccount/i.test(text)) return null;
  const incoming = /incoming transaction/i.test(subject);
  const lines = text.split('\n').map(l => l.trim()).filter(l => l && !/^\[.*\]$/.test(l) && !/^</.test(l));
  const amtLine = text.match(/(?:^|\n)\s*(?:Total|Transfer Amount|Amount)\s*\n\s*(Rp[\d.,]+)/i);
  const amt = money_(amtLine ? amtLine[1] : '');
  if (!amt) return null;
  // Names appear as "<from name> … bluAccount … <to name>"; the arrow image sits between them.
  const arrow = text.split('\n').findIndex(l => /icon-arrow/i.test(l));
  const before = arrow > 0 ? text.split('\n').slice(0, arrow).map(l => l.trim()).filter(l => l && !/^\[/.test(l)) : [];
  const after = arrow > 0 ? text.split('\n').slice(arrow + 1).map(l => l.trim()).filter(l => l && !/^\[/.test(l)) : [];
  const greet = holder_(text);
  const typeLine = text.match(/Transaction Type\s*\n\s*(.+)/i);
  const type = typeLine ? typeLine[1].trim() : '';
  const refLine = text.match(/blu Ref\. No\.\s*\n\s*(.+)/i);
  const base = { amount: amt.amount, currency: amt.currency, source: 'Bank email', ref: refLine ? 'blu:' + refLine[1].replace(/\s/g, '') : '' };
  if (incoming) {
    // "KALAKA RANGGA S / SUPERBANK → Kalaka Rangga, S / bluAccount": sender is the first name before the arrow.
    const senderName = before.filter(l => !/^(hi|there|transfer amount|rp)/i.test(l)).slice(-2)[0] || '';
    const accountName = after[0] || greet;
    const self = isSelf_(senderName, [accountName, greet]);
    return Object.assign(base, { kind: self ? 'transfer' : 'income', title: senderName || 'Incoming transfer' });
  }
  const own = before.filter(l => !/^(hi|thank|total|amount|rp)/i.test(l)).slice(-2)[0] || greet;
  const to = after[0] || '';
  const self = isSelf_(to, [own, greet]);
  void lines;
  return Object.assign(base, { kind: self ? 'transfer' : 'spend', title: merchantName_(to) || type || 'blu payment', category: self ? TRANSFER : categoryOfName_(to) });
}

function parseGrab_(subject, from, text) {
  if (!/grab/i.test(from) || !/receipt/i.test(subject)) return null;
  // The amount actually charged, in order of preference (rides, food, mart, tips). The tax invoice further down
  // repeats a "Total" without delivery fees, so labelled totals come first.
  const amtRaw =
    (text.match(/Total harga\s*\n?\s*Rp\.?\s?([\d.,]+)/i) ||
      text.match(/Total \((?:incl\.?|including) tax\)\s*Rp\.?\s?([\d.,]+)/i) ||
      text.match(/Total(?: Paid)?\s*\n\s*(?:Rp\.?\s?)?([\d.,]+)/i) ||
      [])[1];
  const amt = money_(amtRaw ? 'Rp' + amtRaw : '');
  if (!amt) return null;
  // Grab booking/order codes look like A-9SNARFAGWUHIAV, whatever the label ("Booking ID", "Pesanan ID",
  // "No. Order (Pesanan)", "Kode Booking"). The card alert shows the same code as its merchant.
  const booking = text.match(GRAB_CODE);
  const vehicle = (text.match(/(?:Jenis Kendaraan|Dipesan dengan)\s*:?\s*\n?\s*([^\n]+)/i) || [])[1] || '';
  const shop = ((text.match(/(?:Pesanan Dari|Dipesan dari|Order(?:ed)? from)\s*:?\s*\n?\s*([^\n]{2,80})/i) || [])[1] || '').trim();
  const firstLine = text.split('\n').map(l => l.trim()).filter(l => l && !/^[_\[<]|^(from|sent|to|subject)\s*:/i.test(l))[0] || '';
  const tip = /\btip\b/i.test(text.slice(0, 1500)) && /tip darimu|your tip|tip for/i.test(text);
  let category = 'Transport';
  let title = 'Grab ' + (firstLine.match(/bike|car|taxi/i) ? firstLine : 'ride');
  if (/mart/i.test(vehicle) || (/grabmart/i.test(text.slice(0, 2000)) && !/enjoyed your ride/i.test(text))) {
    category = 'Groceries';
    title = shop || 'GrabMart';
  } else if (/food/i.test(vehicle) || /food/i.test(firstLine) || shop || (/grabfood|menikmati makanan|enjoy your (food|meal)/i.test(text.slice(0, 2000)) && !/enjoyed your ride/i.test(text))) {
    category = 'Dining';
    title = shop || 'GrabFood';
  } else if (/grabexpress|express|delivery/i.test(firstLine)) {
    category = 'Shopping';
    title = 'GrabExpress';
  }
  if (tip) title = 'Grab tip';
  // Ref includes the amount: a tip reuses the order's booking code but is a separate charge.
  return { amount: amt.amount, currency: amt.currency, title: title, category: category, source: 'Ride app email', ref: booking ? 'grab:' + booking[0].toUpperCase() + ':' + amt.amount : '' };
}

// ---------------------------------------------------------------- generic fallback

function parseGeneric_(subject, from, text) {
  const hits = findAmounts_(subject + '\n' + text);
  if (!hits.length) return null;
  // Prefer an amount labelled "total"/"jumlah"/"nominal"; the last labelled one is usually the grand total.
  const keyed = hits.filter(h => h.keyed);
  const pick = keyed.length ? keyed[keyed.length - 1] : hits[0];
  const hay = subject + '\n' + from + '\n' + text;
  const kind = /\b(gaji|salary|payroll|payslip|slip gaji|thr)\b/i.test(hay) ? 'income' : 'spend';
  return { kind: kind, amount: pick.amount, currency: pick.currency, title: titleFrom_(subject, from) };
}

/** Parse "1.250.000", "1,250,000.00", "135.000,00", "36000" into a number. */
function parseNumber_(raw, idr) {
  let s = String(raw).replace(/\s/g, '');
  const m = s.match(/^(.*?)([.,])(\d{1,2})$/);
  let dec = '';
  if (m) {
    s = m[1];
    dec = m[3];
  }
  const int = s.replace(/[.,]/g, '');
  if (!/^\d+$/.test(int)) return NaN;
  const v = Number(int + (dec ? '.' + dec : ''));
  return idr ? Math.round(v) : v;
}

/** "IDR 50,000.00", "Rp600.000,00", "IDR 16.000", "$49.90" → { amount, currency } or null. */
function money_(s) {
  const h = findAmounts_(String(s))[0];
  return h ? { amount: h.amount, currency: h.currency } : null;
}

function findAmounts_(text) {
  const hits = [];
  const re = /(Rp\.?|IDR|USD|US\$|\$)\s?(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/gi;
  let m;
  while ((m = re.exec(text))) {
    const sym = m[1].toUpperCase();
    const idr = sym.indexOf('RP') === 0 || sym === 'IDR';
    const amount = parseNumber_(m[2], idr);
    if (!(amount > 0)) continue;
    const before = text.slice(Math.max(0, m.index - 40), m.index);
    hits.push({ amount: amount, currency: idr ? 'IDR' : 'USD', index: m.index, keyed: TOTAL_WORDS.test(before) });
  }
  return hits;
}

// ---------------------------------------------------------------- naming & categories

/** Category from a merchant or payee name only (bank emails are mostly boilerplate). */
function categoryOfName_(name) {
  const r = CATEGORY_RULES.filter(x => x[1].test(String(name || '')))[0];
  return r ? r[0] : 'Buffer';
}

function categoryOf_(kind, hay) {
  if (kind === 'transfer') return TRANSFER;
  if (kind === 'income') return INCOME;
  const r = CATEGORY_RULES.filter(x => x[1].test(hay))[0];
  return r ? r[0] : 'Buffer';
}

function sourceOf_(hay) {
  const r = SOURCE_RULES.filter(x => x[1].test(hay))[0];
  return r ? r[0] : 'Email receipt';
}

/** "Grab* A-9P7SEJAWX6SSAV" → "Grab"; "TUNAS TOYOTA BODYREPAI JA" → "Tunas Toyota Bodyrepai Ja". */
function merchantName_(m) {
  const s = String(m || '')
    .replace(/\*.*$/, '')
    .replace(/\bA-[A-Z0-9]{8,}\b/g, '')
    .trim();
  if (!s) return '';
  return s === s.toUpperCase() ? s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : s;
}

const GENERIC_SENDER = /\b(no-?reply|noreply|notifications?|info|support|hr|payroll|bank|bca|mandiri|bni|bri|cimb|permata|jenius|jago)\b/i;

/** The sender's display name is usually the merchant; banks and generic senders fall back to the subject. */
function titleFrom_(subject, from) {
  const sender = String(from).replace(/<.*>/, '').replace(/"/g, '').trim();
  if (sender && sender.indexOf('@') < 0 && !GENERIC_SENDER.test(sender)) return sender;
  const s = String(subject)
    .replace(/\b(your|e-?receipt|receipt|struk|bukti (pembayaran|transaksi)|invoice|tagihan|notifikasi|notification|transaksi berhasil|payment (confirmation|successful))\b[:\s-]*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length >= 3 ? s : sender || subject;
}

function clip_(s, n) {
  s = String(s || '').trim();
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
}
