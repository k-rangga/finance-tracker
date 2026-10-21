// Run: npm test. Loads the Apps Script files into a sandbox (names and numbers below are made up).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const dir = new URL('..', import.meta.url).pathname;
const sheets = {};
const ctx = {
  console,
  Utilities: { base64DecodeWebSafe: d => Buffer.from(d, 'base64url'), newBlob: b => ({ getDataAsString: () => Buffer.from(b).toString('utf8') }) },
  // Minimal stand-ins for Sheets.js so storeParsed_ can run.
  readTable_: n => (sheets[n] || []).slice(),
  deleteWhere_: (n, k, vals) => (sheets[n] = (sheets[n] || []).filter(r => !vals.includes(r[k]))),
  upsertRow_: (n, k, obj) => {
    const list = sheets[n] || [];
    const i = list.findIndex(r => r[k] === obj[k]);
    sheets[n] = i >= 0 ? list.map((r, j) => (j === i ? obj : r)) : [...list, obj];
  },
  appendNew_: (n, k, objs) => {
    const have = new Set((sheets[n] || []).map(r => r[k]));
    const add = objs.filter(o => !have.has(o[k]));
    sheets[n] = [...(sheets[n] || []), ...add];
    return add.length;
  },
};
vm.createContext(ctx);
for (const f of ['Parse.js', 'Gmail.js', 'Code.js']) vm.runInContext(fs.readFileSync(dir + f, 'utf8'), ctx, { filename: f });
const parse = (subject, from, text) => vm.runInContext('parseReceipt', ctx)({ subject, from, text });

const fwd = (from, subject, body) => `________________________________\nFrom: ${from}\nSent: Thursday, October 15, 2026 10:47:50 AM\nTo: someone@outlook.com\nSubject: ${subject}\n\n${body}`;
const ME = 'Budi Santoso <budi@outlook.com>';

const cases = [
  [
    'BCA journal QRIS → merchant',
    parse('FW: Internet Transaction Journal', ME, fwd('BCA <bca@bca.co.id>', 'Internet Transaction Journal', 'Hello BUDI SANTOSO,\nTransaction Type : QRIS Payment\nPayment to : Pentol Pak Joko\nTotal Payment : IDR 15,000.00\nReference No. : ABC123')),
    { kind: 'spend', amount: 15000, title: 'Pentol Pak Joko', category: 'Dining', source: 'Bank email' },
  ],
  [
    'BCA journal Flazz top-up → Transport',
    parse('FW: Internet Transaction Journal', ME, fwd('BCA <bca@bca.co.id>', 'Internet Transaction Journal', 'Hello BUDI SANTOSO,\nTransaction Type : Flazz Top Up\nTop Up Amount : IDR 50,000.00\nReference No. : X1')),
    { kind: 'spend', amount: 50000, category: 'Transport', title: 'Flazz top-up' },
  ],
  [
    'BCA journal transfer to self → Transfer',
    parse('FW: Internet Transaction Journal', ME, fwd('BCA <bca@bca.co.id>', 'Internet Transaction Journal', 'Hello BUDI SANTOSO,\nTransaction Type : Transfer to BCA Account\nBeneficiary Name : BUDI SANTOSO\nTransfer Amount : IDR 500,000.00\nReference No. : T9')),
    { kind: 'transfer', amount: 500000, category: 'Transfer' },
  ],
  [
    'BCA card alert for Grab → ref from booking id',
    parse('FW: Credit Card Transaction Notification', ME, fwd('KartuKreditBCA@klikbca.com', 'Credit Card Transaction Notification', 'Terima kasih telah bertransaksi menggunakan Kartu Kredit BCA:\nMerchant / ATM : Grab* A-9P7SEJAWX6SSAV\nJenis Transaksi : E-COMMERCE\nPada Tanggal : 30-08-2026 08:23:16 WIB\nSejumlah : IDR 16.000')),
    { kind: 'spend', amount: 16000, title: 'Grab', source: 'Card receipt', account: 'CC BCA', ref: 'grab:A-9P7SEJAWX6SSAV:16000' },
  ],
  [
    'BCA card reversal',
    parse('FW: Credit Card Reversal/Void Transaction Notification', ME, fwd('KartuKreditBCA@klikbca.com', 'Credit Card Reversal/Void Transaction Notification', 'Kami informasikan adanya transaksi reversal/void:\nMerchant / ATM : Grab* A-9QXN92HGWH3BAV\nSejumlah : IDR 9.000')),
    { kind: 'reversal', amount: 9000, ref: 'grab:A-9QXN92HGWH3BAV:9000' },
  ],
  [
    'Grab ride receipt',
    parse('FW: Your Grab E-Receipt', ME, fwd('Grab <no-reply@grab.com>', 'Your Grab E-Receipt', 'Bike Standard\n[Grab]\nHope you enjoyed your ride!\nBooking ID: A-9P7SEJAWX6SSAV\nTotal Paid\nRp16.000\nBreakdown\nFare\n12.000')),
    { kind: 'spend', amount: 16000, title: 'Grab Bike Standard', category: 'Transport', source: 'Ride app email', ref: 'grab:A-9P7SEJAWX6SSAV:16000' },
  ],
  [
    'blu debit card at a shop → spend',
    parse('FW: Your Transaction with blu Was Successful', ME, fwd('blu <receipts@blubybcadigital.id>', 'Your Transaction with blu Was Successful', '[Blu]\nHi Budi,\nThank you for using blu for your transaction.\nTotal\nRp600.000,00\n\n[https://bcadigital.co.id/email_/bank_/1-BCADigital.jpg]\nBudi Santoso\nbluAccount\n[https://bcadigital.co.id/email_/icon-arrow-grey-1.png]\n[https://bcadigital.co.id/email_/bank_/default_bank.jpg]\nTUNAS TOYOTA BODYREPAIR\nbluDebit Card\nTransaction Type\nEDC Debit\nblu Ref. No.\n000000000105\n#teamblu')),
    { kind: 'spend', amount: 600000, title: 'Tunas Toyota Bodyrepair', category: 'Transport' },
  ],
  [
    'blu transfer to own Mandiri → Transfer',
    parse('FW: Your blu Transaction was Successful', ME, fwd('blu <receipts@blubybcadigital.id>', 'Your blu Transaction was Successful', 'Hi Budi,\nThank you for using blu for your transaction.\nAmount\nRp100.000,00\n\n[img]\nBudi Santoso, S\nbluAccount\n[https://bcadigital.co.id/email_/icon-arrow-grey-1.png]\n[mandiri]\nBUDI SANTOSOS\nMANDIRI\nTransaction Type\nBI-FAST\nblu Ref. No.\n1787 6331\n#teamblu')),
    { kind: 'transfer', amount: 100000, category: 'Transfer' },
  ],
  [
    'blu incoming from own other bank → Transfer',
    parse('FW: Incoming Transaction to Your blu 💸', ME, fwd('blu <receipts@blubybcadigital.id>', 'Incoming Transaction to Your blu 💸', "[Blu]\nHi Budi,\nThere's an incoming transaction to your bluAccount. Here are the details:\nTransfer Amount\nRp600.000,00\n\n[logo]\nBUDI SANTOSO S\nSUPERBANK\n[https://bcadigital.co.id/email_/icon-arrow-grey-1.png]\n[img]\nBudi Santoso, S\nbluAccount\n#teamblu")),
    { kind: 'transfer', amount: 600000, category: 'Transfer' },
  ],
  [
    'blu incoming from someone else → Income',
    parse('FW: Incoming Transaction to Your blu 💸', ME, fwd('blu <receipts@blubybcadigital.id>', 'Incoming Transaction to Your blu 💸', "Hi Budi,\nThere's an incoming transaction to your bluAccount.\nTransfer Amount\nRp75.000,00\n\n[logo]\nSITI AMINAH\nBCA\n[https://bcadigital.co.id/email_/icon-arrow-grey-1.png]\n[img]\nBudi Santoso, S\nbluAccount\n#teamblu")),
    { kind: 'income', amount: 75000, category: 'Income', title: 'SITI AMINAH' },
  ],
  [
    'BCA journal transfer (Transfer Type) to own blu → Transfer',
    parse('FW: Internet Transaction Journal', ME, fwd('BCA <bca@bca.co.id>', 'Internet Transaction Journal', 'Hello BUDI SANTOSO,\nStatus : Successful\nTransfer Type : Transfer to BLU BY BCA DIGITAL\nBeneficiary Account\n  Beneficiary Name : BUDI SANTOSO, S\n  Beneficiary Bank : BLU BY BCA DIGITAL\nAmount : IDR 10,000,000.00\nFee : IDR 2,500.00\nReference No. : 20260925X')),
    { kind: 'transfer', amount: 10000000, category: 'Transfer' },
  ],
  [
    'BCA journal transfer to someone else → spend titled with their name',
    parse('FW: Internet Transaction Journal', ME, fwd('BCA <bca@bca.co.id>', 'Internet Transaction Journal', 'Hi BUDI SANTOSO,\nTransfer Type : Transfer to BCA Account\nBeneficiary Name : SITI AMINAH\nTransfer Amount : IDR 36,000.00\nReference No. : 95271')),
    { kind: 'spend', amount: 36000, title: 'SITI AMINAH' },
  ],
  [
    'GrabFood receipt (Indonesian) → restaurant + order id ref',
    parse('FW: Your Grab E-Receipt', ME, fwd('Grab <no-reply@grab.com>', 'Your Grab E-Receipt', '[E-receipt]\nSelamat menikmati makanan Anda!\nTOTAL\nRp 172000 TANGGAL | WAKTU\n26 Sep 26 09:47 +0700\nDetail Pesanan\nJenis Kendaraan:\nGrabFood\n\nPesanan ID\nA-9SNARFAGWUHIAV\n\nPesanan Dari:\nBakmi Kun - Kota Wisata\nRuko Fresh Market 5\nSubtotal Rp 336000\nTOTAL (INCL. TAX) Rp 172000')),
    { kind: 'spend', amount: 172000, title: 'Bakmi Kun - Kota Wisata', category: 'Dining', ref: 'grab:A-9SNARFAGWUHIAV:172000' },
  ],
  [
    'GrabMart (Indonesian) → charged total, not the tax-invoice total',
    parse('FW: Your Grab E-Receipt', ME, fwd('Grab <no-reply@grab.com>', 'Your Grab E-Receipt', '[E-receipt]\nTerima kasih sudah memesan dari kami!\nTotal harga\nRp 186100 Diantar pada\n13 Oct 26 09:44 +0700\nDetail Pesanan\nDipesan dengan:\nGrabMart\n\nNo. Order (Pesanan)\nA-9UTCL4GWWM8SAV\n\nDipesan dari:\nAEON Store - Kota Wisata\nSubtotal Rp 171100\nOngkos kirim Rp 15000\nTotal (Including tax) Rp 186100*\nFaktur PPN\nNomor faktur\nA-9UTCL4GWWM8SAV-1\nTotal Rp 176100\nPPN Rp 17451')),
    { amount: 186100, title: 'AEON Store - Kota Wisata', category: 'Groceries', ref: 'grab:A-9UTCL4GWWM8SAV:186100' },
  ],
  [
    'Grab tip → separate charge from the order',
    parse('FW: Your Grab E-Receipt', ME, fwd('Grab <no-reply@grab.com>', 'Your Grab E-Receipt', 'GrabFood\n[Grab]\nTerima kasih! Tip darimu sudah disalurkan ke pengemudimu.\nTotal\nRP 10000\nTip\nKode Booking: A-9U5HT82GWLW5AV\n10000')),
    { amount: 10000, title: 'Grab tip', category: 'Dining', ref: 'grab:A-9U5HT82GWLW5AV:10000' },
  ],
  [
    'BCA Virtual Account to own Pluang → Investment',
    parse('FW: Internet Transaction Journal', ME, fwd('BCA <bca@bca.co.id>', 'Internet Transaction Journal', 'Hello BUDI SANTOSO,\n\nTransfer Type : Transfer to BCA Virtual Account\nBCA Virtual Account No. : 1526\nName : BUDI SANTOSO\nCompany/Product Name : KLIRING KOMODITI INDONESIA PT / KKI-PLUANG\nPay Amount : IDR 3,000,000.00\nTotal Payment : IDR 3,000,000.00\nReference No. : 95271TVA')),
    { kind: 'transfer', amount: 3000000, title: 'Pluang', category: 'Investment' },
  ],
  [
    'BCA Virtual Account GoPay top-up in own name → stays Transfer',
    parse('FW: Internet Transaction Journal', ME, fwd('BCA <bca@bca.co.id>', 'Internet Transaction Journal', 'Hello BUDI SANTOSO,\n\nTransfer Type : Transfer to BCA Virtual Account\nBCA Virtual Account No. : 7001\nName : BUDI SANTOSO\nCompany/Product Name : GOPAY\nTotal Payment : IDR 200,000.00\nReference No. : 95271GPY')),
    { kind: 'transfer', amount: 200000, title: 'Gopay', category: 'Transfer' },
  ],
  [
    'Older stored row: transfer to Bibit saved as Transfer → Investment',
    { category: vm.runInContext('investmentCategory_', ctx)({ kind: 'transfer', category: 'Transfer', title: 'Bibit' }) },
    { category: 'Investment' },
  ],
  [
    'Older stored row: transfer to own account stays Transfer; Bibit spend is left alone',
    {
      own: vm.runInContext('investmentCategory_', ctx)({ kind: 'transfer', category: 'Transfer', title: 'BUDI SANTOSO' }),
      spend: vm.runInContext('investmentCategory_', ctx)({ kind: 'spend', category: 'Buffer', title: 'Bibit' }),
    },
    { own: 'Transfer', spend: 'Buffer' },
  ],
  [
    'BCA QRIS Transfer (Type of Transaction) to a person',
    parse('FW: Internet Transaction Journal', ME, fwd('BCA <bca@bca.co.id>', 'Internet Transaction Journal', 'Hello BUDI SANTOSO,\nType of Transaction : QRIS Transfer\nBeneficiary Name : SITI AMINAH\nSender Name : BUDI SANTOSO\nAmount : IDR 50,000.00\nFee : -\nReference No. : 95271QRS')),
    { kind: 'spend', amount: 50000, title: 'SITI AMINAH', category: 'Buffer' },
  ],
  [
    'QRIS at a feeder bus → Transport (category from the merchant name only)',
    parse('FW: Internet Transaction Journal', ME, fwd('BCA <bca@bca.co.id>', 'Internet Transaction Journal', 'Hello BUDI SANTOSO,\nTransaction Type : QRIS Payment\nPayment to : RMD SINAR JAYA FEEDER BUS\nAcquirer : DANA\nTotal Payment : IDR 15,000.00\nReference No. : Q1')),
    { amount: 15000, category: 'Transport' },
  ],
  [
    'BCA journal credit card bill → CC Payment transfer to the card',
    parse('FW: Internet Transaction Journal', ME, fwd('BCA <bca@bca.co.id>', 'Internet Transaction Journal', 'Hello BUDI SANTOSO,\nTransaction Type : Credit Card Payment\nPayment to : KARTU KREDIT BCA\nTotal Payment : IDR 1,830,000.00\nReference No. : CC1')),
    { kind: 'transfer', amount: 1830000, category: 'CC Payment', account: 'Bank', to_account: 'CC BCA' },
  ],
  [
    'Mandiri credit card payment email → CC Payment to CC Mandiri',
    parse('Pembayaran Kartu Kredit Berhasil', 'Livin by Mandiri <noreply.livin@bankmandiri.co.id>', 'Pembayaran kartu kredit Mandiri\nNominal : Rp 2.000.000'),
    { kind: 'transfer', amount: 2000000, category: 'CC Payment', account: 'Bank', to_account: 'CC Mandiri' },
  ],
  [
    'Older stored row: credit card payment saved as Transfer → CC Payment',
    vm.runInContext('accounts_', ctx)({ kind: 'transfer', category: 'Transfer', source: 'Bank email' }, 'bca@bca.co.id\nInternet Transaction Journal\nCredit card payment'),
    { category: 'CC Payment', account: 'Bank', to_account: 'CC BCA' },
  ],
  [
    'Older stored row: card receipt → card account',
    vm.runInContext('accounts_', ctx)({ kind: 'spend', category: 'Dining', source: 'Card receipt' }, 'KartuKreditBCA@klikbca.com\nCredit Card Transaction Notification\nTuku'),
    { category: 'Dining', account: 'CC BCA', to_account: '' },
  ],
  ['Newsletter → null', parse('Newsletter', 'News <n@x.com>', 'No amounts here'), null],
  ['Plain Netflix (not forwarded)', parse('Your Netflix bill', 'Netflix <info@netflix.com>', 'Amount charged: Rp 186.000\nPlan: Premium'), { amount: 186000, title: 'Netflix', category: 'Subscriptions' }],
];

let failed = 0;
for (const [name, got, want] of cases) {
  try {
    if (want === null) assert.equal(got, null);
    else for (const [k, v] of Object.entries(want)) assert.equal(got?.[k], v, `${k}: got ${JSON.stringify(got?.[k])}`);
    console.log('ok  ', name);
  } catch (e) {
    failed++;
    console.log('FAIL', name, '—', e.message, '\n     ', JSON.stringify(got));
  }
}

// Google Finance symbols and quote cells.
{
  const sym = vm.runInContext('financeSymbol_', ctx);
  assert.equal(sym('IDX', 'sini'), 'IDX:SINI');
  assert.equal(sym('US', 'AAPL'), 'AAPL');
  assert.equal(sym('US', 'NASDAQ:GOOGL'), 'NASDAQ:GOOGL');
  assert.equal(sym('Crypto', 'BTC'), 'CURRENCY:BTCUSD');
  const price = vm.runInContext('quotePrice_', ctx);
  assert.equal(price(7900), 7900);
  assert.equal(price('#N/A'), null);
  assert.equal(price(''), null);
  assert.equal(price('Loading...'), null);
  console.log('ok   Google Finance symbols (IDX:, CURRENCY:…USD) and #N/A / blank quotes are skipped');
}

// Automatic sync hours (Asia/Jakarta): 00, 06, 08 … 22; the hourly trigger does nothing at other hours.
{
  const isSyncHour = vm.runInContext('isSyncHour_', ctx);
  const on = [...Array(24).keys()].filter(isSyncHour);
  assert.deepEqual(on, [0, 6, 8, 10, 12, 14, 16, 18, 20, 22]);
  console.log('ok   automatic sync runs at 00, 06, 08, 10, 12, 14, 16, 18, 20, 22');
}

// De-duplication: card alert then Grab receipt for the same booking, a repeat forward, and a reversal.
const msg = (id, t, subject, from, body) => ({ m: { id, internalDate: String(Date.parse(t)), subject, from, text: body }, p: parse(subject, from, body) });
const card = b => fwd('KartuKreditBCA@klikbca.com', 'Credit Card Transaction Notification', `Kartu Kredit BCA\nMerchant / ATM : Grab* ${b}\nSejumlah : IDR 16.000`);
const grab = b => fwd('Grab <no-reply@grab.com>', 'Your Grab E-Receipt', `Bike Standard\nHope you enjoyed your ride!\nBooking ID: ${b}\nTotal Paid\nRp16.000`);
const store = vm.runInContext('storeParsed_', ctx);
const r1 = store([
  msg('c1', '2026-08-30T01:23:45Z', 'FW: Credit Card Transaction Notification', ME, card('A-AAAAAAAAAA1')),
  msg('g1', '2026-08-30T01:35:33Z', 'FW: Your Grab E-Receipt', ME, grab('A-AAAAAAAAAA1')),
  msg('g1b', '2026-08-30T01:35:33Z', 'FW: Your Grab E-Receipt', ME, grab('A-AAAAAAAAAA1')),
  msg('c2', '2026-09-05T08:00:00Z', 'FW: Credit Card Transaction Notification', ME, card('A-BBBBBBBBBB2')),
]);
// Next sync: the reversal for c2 arrives.
const r2 = store([
  msg('v2', '2026-09-05T08:41:57Z', 'FW: Credit Card Reversal/Void Transaction Notification', ME, fwd('KartuKreditBCA@klikbca.com', 'Credit Card Reversal/Void Transaction Notification', 'Kartu Kredit BCA reversal\nMerchant / ATM : Grab* A-BBBBBBBBBB2\nSejumlah : IDR 16.000')),
]);
try {
  assert.deepEqual(sheets.transactions.map(r => r.id), ['g1']);
  assert.equal(r1.duplicates, 2);
  assert.equal(r2.reversed, 1);
  assert.equal(sheets.transactions[0].account, 'CC BCA', 'receipt that replaced the card alert stays on the card');
  console.log('ok   dedupe keeps the Grab receipt (on the card), drops card alert + repeat, reversal removes its charge');
} catch (e) {
  failed++;
  console.log('FAIL dedupe —', e.message, JSON.stringify(sheets.transactions?.map(r => r.id)));
}

// Card alert and Grab receipt with different codes: matched by amount, time and merchant instead.
for (const k of Object.keys(sheets)) delete sheets[k];
sheets.overrides = [{ tx_id: 'c3', category: 'Dining', updated_at: 'x' }];
sheets.links = [{ income_id: 'in1', expense_id: 'c3', updated_at: 'x' }];
const r3 = store([
  msg('c3', '2026-09-10T05:29:00Z', 'FW: Credit Card Transaction Notification', ME, card('A-CCCCCCCCCC3')),
  msg('g3', '2026-09-10T05:48:00Z', 'FW: Your Grab E-Receipt', ME, grab('A-DDDDDDDDDD4')),
  // Same amount, five hours later: a different ride.
  msg('g5', '2026-09-10T10:30:00Z', 'FW: Your Grab E-Receipt', ME, grab('A-EEEEEEEEEE5')),
]);
try {
  assert.deepEqual(sheets.transactions.map(r => r.id).sort(), ['g3', 'g5']);
  assert.equal(sheets.transactions.find(r => r.id === 'g3').account, 'CC BCA');
  assert.equal(sheets.transactions.find(r => r.id === 'g5').account, 'Bank');
  assert.deepEqual(sheets.overrides.map(o => o.tx_id), ['g3'], 'category fix moves to the receipt');
  assert.equal(sheets.links[0].expense_id, 'g3', 'reimbursement link moves to the receipt');
  assert.ok(sheets.skipped.some(k => k.id === 'c3' && k.reason === 'duplicate of g3'), 'alert is not imported again');
  assert.equal(r3.duplicates, 1);
  console.log('ok   card alert + merchant receipt with different codes merge onto the card; a later same-amount ride stays');
} catch (e) {
  failed++;
  console.log('FAIL card merge —', e.message, JSON.stringify(sheets.transactions));
}

// Receipts that replaced a card alert before accounts were carried over go back on the card; repeat forwards don't count.
for (const k of Object.keys(sheets)) delete sheets[k];
sheets.transactions = [
  { id: 'g6', source: 'Ride app email', kind: 'spend', ref: 'grab:A-FFFFFFFFFF6:16000', account: 'Bank', amount: 16000 },
  { id: 'g7', source: 'Ride app email', kind: 'spend', ref: 'grab:A-GGGGGGGGGG7:16000', account: 'Bank', amount: 16000 },
];
sheets.skipped = [
  { id: 'c6', subject: '', reason: 'duplicate of g6' },
  { id: 'g7b', subject: 'FW: Your Grab E-Receipt', reason: 'duplicate of g7' },
];
try {
  assert.equal(vm.runInContext('restoreCardAccounts_', ctx)(), 1);
  assert.equal(sheets.transactions.find(r => r.id === 'g6').account, 'CC BCA');
  assert.equal(sheets.transactions.find(r => r.id === 'g7').account, 'Bank');
  console.log('ok   receipts that replaced a card alert earlier go back on the card');
} catch (e) {
  failed++;
  console.log('FAIL restore card accounts —', e.message, JSON.stringify(sheets.transactions));
}

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall passed');
