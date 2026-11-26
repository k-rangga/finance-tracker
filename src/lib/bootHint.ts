import { categoryByName } from '../data/categories';
import type { Budget } from './budget';
import type { Cycle } from './cycle';
import type { PlanView } from './installments';
import type { Settings } from './settings';
import { storage } from './storage';

const BOOT_KEY = 'moneyTracker.bootHint';

export type BootAura = 'clay' | 'good' | 'payday';

export type BootHint = {
  name: string;
  quiet: boolean;
  lang: 'en' | 'id';
  reflections: string[];
  isPayday?: boolean;
  aura?: BootAura;
  updatedAt: string;
};

const FALLBACK_EN = [
  'Quiet consistency beats grand resets.',
  'Every clear picture starts with one calm look.',
  'Small, steady choices carry the whole month.',
];

const FALLBACK_ID = [
  'Konsistensi yang tenang selalu mengalahkan perubahan drastis.',
  'Gambaran yang jernih selalu dimulai dari satu lihatan santai.',
  'Langkah kecil yang teratur menjaga ritme sepanjang bulan.',
];

/**
 * Derive short, privacy-safe, calm reflections directly from the user's real spending and saving behavior.
 * Stored locally so the very next initial load greets them with something genuinely theirs before data arrives.
 */
export function buildBootHint({
  cycle,
  budget: b,
  settings,
  plans,
}: {
  cycle: Cycle;
  budget: Budget;
  settings: Settings;
  plans: PlanView[];
}): BootHint {
  const id = settings.maxieLanguage === 'id';
  const reflections: string[] = [];

  // 1. Zero-spend days habit this cycle
  const daysSoFar = Math.min(cycle.dayIdx + 1, cycle.cycleDays);
  const spendByDay = new Array<number>(daysSoFar).fill(0);
  for (const t of b.txs) {
    if (t.offset >= 0 && t.offset < daysSoFar && !t.isIncome && !t.isTransfer && categoryByName(t.cat)) {
      spendByDay[t.offset] += t.net;
    }
  }
  const zeroDays = spendByDay.filter(v => v <= 0).length;
  if (cycle.dayN >= 3 && zeroDays >= 2) {
    reflections.push(
      id
        ? `Sudah ${zeroDays} hari nol pengeluaran di siklus ini — ketenangan kecil yang berarti.`
        : `You've kept ${zeroDays} zero-spend days this cycle — quiet restraint adds up.`,
    );
  }

  // 2. Savings milestone or steady saving ratio
  const hitSavings = b.savingsTarget > 0 && b.saved >= b.savingsTarget;
  if (hitSavings) {
    reflections.push(
      id
        ? `Target tabungan ${Math.round(b.savedPct)}% sudah tercapai — langkah tenang untuk masa depan.`
        : `Savings goal already reached at ${Math.round(b.savedPct)}% — your future self thanks you.`,
    );
  } else if (b.savedPct >= 15) {
    reflections.push(
      id
        ? `Sudah menyisihkan ${Math.round(b.savedPct)}% sejauh ini — kebiasaan baik tumbuh pelan-pelan.`
        : `Setting aside ${Math.round(b.savedPct)}% so far — steady habits compound quietly.`,
    );
  }

  // 3. Biggest everyday improvement vs last cycle at the same point
  const improved = b.cats
    .filter(c => c.type === 'variable' && c.lastSameDays > 0 && c.spent < c.lastSameDays * 0.85)
    .map(c => ({ name: c.name, pct: Math.round(((c.lastSameDays - c.spent) / c.lastSameDays) * 100) }))
    .sort((a, z) => z.pct - a.pct)[0];
  if (improved && cycle.dayN >= 4) {
    reflections.push(
      id
        ? `Pengeluaran ${improved.name} lebih ringan ${improved.pct}% dari siklus lalu di hari yang sama.`
        : `${improved.name} is ${improved.pct}% lighter than last cycle at this point — gentle progress.`,
    );
  }

  // 4. Clean Buffer habit
  const bufferCount = b.txs.filter(t => t.cat === 'Buffer' && !t.isIncome && !t.isTransfer).length;
  if (b.txs.length > 0 && bufferCount === 0) {
    reflections.push(
      id
        ? 'Tidak ada transaksi menunggu di Buffer — catatan rapi bikin pikiran tenang.'
        : 'Nothing waiting in Buffer — a tidy ledger makes a calm mind.',
    );
  }

  // 5. Finishing installment countdown (1–2 payments remaining)
  const almostFree = plans
    .map(p => ({ title: p.title, rem: p.payments.filter(x => !x.paid).length }))
    .filter(x => x.rem >= 1 && x.rem <= 2)
    .sort((a, z) => a.rem - z.rem)[0];
  if (almostFree) {
    reflections.push(
      id
        ? `Tinggal ${almostFree.rem} cicilan lagi untuk ${almostFree.title} — ruang lega segera bertambah.`
        : `Only ${almostFree.rem} ${almostFree.rem === 1 ? 'payment' : 'payments'} left on ${almostFree.title} — extra breathing room ahead.`,
    );
  }

  // 6. Overall pace or payday rhythm
  const left = b.budget - b.spent - b.fixedDue;
  if (left < 0) {
    reflections.push(
      id
        ? 'Sedikit di atas rencana pekan ini — satu hari tenang akan mengembalikan ritmemu.'
        : 'Slightly above plan this week — one quiet day brings the rhythm right back.',
    );
  } else if (cycle.daysLeft <= 5 && b.txs.length > 0) {
    reflections.push(
      id
        ? `${cycle.daysLeft + 1} hari menuju gajian dengan ruang lega — penutup siklus yang tenang.`
        : `${cycle.daysLeft + 1} days to payday with comfortable room left — finishing with ease.`,
    );
  } else if (cycle.dayN >= 4 && b.paceToday > 0 && b.spent <= b.paceToday) {
    reflections.push(
      id
        ? `Ritmemu lebih tenang dari kecepatan normal hari ke-${cycle.dayN}.`
        : `Cruising comfortably ahead of your usual day-${cycle.dayN} pace.`,
    );
  }

  // 7. Gentle nod to top everyday category if list is still short
  if (reflections.length < 2) {
    const topVar = b.cats
      .filter(c => c.type === 'variable' && c.spent > 0)
      .sort((a, z) => z.spent - a.spent)[0];
    if (topVar) {
      reflections.push(
        id
          ? `${topVar.name} jadi ritme harian utamamu belakangan ini — nikmati dengan santai.`
          : `${topVar.name} has been your main everyday rhythm lately — enjoy it mindfully.`,
      );
    }
  }

  const isPayday = cycle.dayN === 1;
  const underPace = cycle.dayN >= 4 && b.paceToday > 0 && b.spent <= b.paceToday * 0.92;
  const aura: BootAura = isPayday ? 'payday' : hitSavings || (zeroDays >= 3 && left >= 0) || (underPace && left >= 0) ? 'good' : 'clay';

  return {
    name: settings.name.trim(),
    quiet: !!settings.quietMode,
    lang: id ? 'id' : 'en',
    reflections: reflections.slice(0, 5),
    isPayday,
    aura,
    updatedAt: new Date().toISOString(),
  };
}

export function readBootHint(): BootHint | null {
  return storage.get<BootHint | null>(BOOT_KEY, null);
}

export function writeBootHint(hint: BootHint) {
  storage.set(BOOT_KEY, hint);
}

/** Pick one reflection calmly based on the hour + day so each visit feels fresh without flickering mid-load. */
export function pickBootReflection(hint: BootHint | null, now = new Date()): string {
  const pool = hint?.reflections?.length ? hint.reflections : hint?.lang === 'id' ? FALLBACK_ID : FALLBACK_EN;
  const seed = now.getDate() * 3 + Math.floor(now.getHours() / 6);
  return pool[seed % pool.length];
}
