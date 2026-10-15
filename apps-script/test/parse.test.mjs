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
  appendNew_: (n, k, objs) => {
    const have = new Set((sheets[n] || []).map(r => r[k]));
    const add = objs.filter(o => !have.has(o[k]));
    sheets[n] = [...(sheets[n] || []), ...add];
    return add.length;
  },
};
vm.createContext(ctx);
for (const f of ['Parse.js', 'Gmail.js']) vm.runInContext(fs.readFileSync(dir + f, 'utf8'), ctx, { filename: f });
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
    { kind: 'spend', amount: 16000, title: 'Grab', source: 'Card receipt', ref: 'grab:A-9P7SEJAWX6SSAV' },
  ],
  [
    'BCA card reversal',
    parse('FW: Credit Card Reversal/Void Transaction Notification', ME, fwd('KartuKreditBCA@klikbca.com', 'Credit Card Reversal/Void Transaction Notification', 'Kami informasikan adanya transaksi reversal/void:\nMerchant / ATM : Grab* A-9QXN92HGWH3BAV\nSejumlah : IDR 9.000')),
    { kind: 'reversal', amount: 9000, ref: 'grab:A-9QXN92HGWH3BAV' },
  ],
  [
    'Grab ride receipt',
    parse('FW: Your Grab E-Receipt', ME, fwd('Grab <no-reply@grab.com>', 'Your Grab E-Receipt', 'Bike Standard\n[Grab]\nHope you enjoyed your ride!\nBooking ID: A-9P7SEJAWX6SSAV\nTotal Paid\nRp16.000\nBreakdown\nFare\n12.000')),
    { kind: 'spend', amount: 16000, title: 'Grab Bike Standard', category: 'Transport', source: 'Ride app email', ref: 'grab:A-9P7SEJAWX6SSAV' },
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
    { kind: 'spend', amount: 172000, title: 'Bakmi Kun - Kota Wisata', category: 'Dining', ref: 'grab:A-9SNARFAGWUHIAV' },
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
  console.log('ok   dedupe keeps the Grab receipt, drops card alert + repeat, reversal removes its charge');
} catch (e) {
  failed++;
  console.log('FAIL dedupe —', e.message, JSON.stringify(sheets.transactions?.map(r => r.id)));
}

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall passed');
