import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import s from '../styles/ui.module.css';
import { IC, Icon } from './Icon';
import { Logo, type MaxieMood } from './Logo';
import { askGemini, chatContext, extractFollowUps, modelLabel, type ChatAction, type ChatMessage } from '../lib/chat';
import type { Budget, TxView } from '../lib/budget';
import type { Cycle } from '../lib/cycle';
import type { FixedBillStatus } from '../lib/fixedBills';
import { useData } from '../lib/data';
import { useSettings } from '../lib/settings';
import { useVisualViewport } from '../lib/useVisualViewport';
import { useSetLimits } from '../lib/limits';
import { onVercel } from '../lib/supabase';
import { C } from '../lib/tokens';
import { CATEGORIES, categoryByName, categoryLabel, OTHER_CATEGORIES } from '../data/categories';
import { merchantKey } from '../data/transactions';
import { tidyName, toISO } from '../lib/format';
import { paceInsight, weekendSafeSplit } from '../lib/pace';
import { newJournalId, saveJournalEntry } from '../lib/journal';
import { startChallenge } from '../screens/categoriesExtras';
import type { FortAssetsAlert, ImpulseSummary, LifestyleCreepSignal, WealthSnapshot } from '../lib/wealth';

/** Stop waiting after this long; per-model fetches abort at 22s and fall back automatically. */
const TIMEOUT_MS = 45_000;

/** What Maxie is doing, by how long it's been working: playful and warm, zero emojis. */
export const thinkingLabel = (secs: number, deep = false) =>
  secs < 2
    ? deep
      ? 'Taking a closer look…'
      : 'Sniffing through your cycle…'
    : secs < 5
      ? deep
        ? 'Comparing your categories…'
        : 'Checking the numbers…'
      : secs < 10
        ? deep
          ? 'Double-checking the details…'
          : 'Putting it together…'
        : secs < 20
          ? 'Almost there…'
          : 'Still working — deeper questions can take a little longer…';

/** Fallback husky mood when the model omits an explicit mood field. */
function inferMood(text: string): MaxieMood {
  if (/over (?:budget|plan|limit)|tight|lewat rencana|ketat|cut back/i.test(text)) return 'steady';
  if (/sort|buffer|uncategorized|check|let'?s look|banding/i.test(text)) return 'curious';
  return 'happy';
}

/** Three small crescents that blink in turn (Maxie ThinkingIndicator). */
export function ThinkingArcs() {
  return (
    <span className={s.thinkArcs} aria-hidden="true">
      {[0, 1, 2].map(i => (
        <svg key={i} className={s.thinkArc} style={{ animationDelay: i * 180 + 'ms' }} width={14} height={8} viewBox="0 0 14 8">
          <path d="M2 2q5 5 10 0" />
        </svg>
      ))}
    </span>
  );
}

type StoredChat = { messages: ChatMessage[]; deep?: boolean };

function readSession(key: string): StoredChat {
  try {
    const raw = localStorage.getItem(key) ?? sessionStorage.getItem(key);
    if (!raw) return { messages: [] };
    const parsed = JSON.parse(raw) as StoredChat;
    const msgs = Array.isArray(parsed.messages)
      ? parsed.messages.map(m => {
          if (m.role !== 'model') return m;
          const clean = extractFollowUps(m.text, m.followUps);
          return { ...m, text: clean.reply, followUps: clean.followUps };
        })
      : [];
    return { messages: msgs, deep: !!parsed.deep };
  } catch {
    return { messages: [] };
  }
}

function writeSession(key: string, data: StoredChat) {
  try {
    // Keep the last 40 messages per cycle so storage stays light and snappy.
    const trimmed: StoredChat = { ...data, messages: data.messages.slice(-40) };
    localStorage.setItem(key, JSON.stringify(trimmed));
  } catch {
    // Ignore storage quota / private mode failures.
  }
}

/** One cheerful, live-computed sentence summarizing your cycle pulse for the empty state. */
function buildOpeningPulse(cycle: Cycle, b: Budget, short: (v: number) => string, isId: boolean): string {
  const left = b.budget - b.spent - b.fixedDue;
  const insight = paceInsight({
    budget: b.budget,
    projTotal: b.projTotal,
    oneOffs: b.proj.oneOffs,
    remainingVar: b.proj.remainingVar,
    daysLeft: cycle.daysLeft,
    dayN: cycle.dayN,
    cycleDays: cycle.cycleDays,
    cats: b.cats,
  });
  const dayTag = isId ? `Hari ke-${cycle.dayN} dari ${cycle.cycleDays}` : `Day ${cycle.dayN} of ${cycle.cycleDays}`;
  if (left < 0) {
    return isId
      ? `${dayTag} — sedang ${short(-left)} di atas rencana, yuk kita atur pelan-pelan.`
      : `${dayTag} — ${short(-left)} above plan, easy to ease back together.`;
  }
  if (insight.oneOffExplains) {
    return isId
      ? `${dayTag} — ritme harianmu tenang; lonjakan hanya dari transaksi besar ${short(b.proj.oneOffs)}.`
      : `${dayTag} — everyday pace is calm; ${short(b.proj.oneOffs)} in one-offs accounts for the bump.`;
  }
  if (insight.tier !== 'calm' && insight.trimPerDay > 0) {
    const drv = insight.topDriver ? (isId ? ` (terutama ${insight.topDriver.name})` : ` (mostly ${insight.topDriver.name})`) : '';
    return isId
      ? `${dayTag} — kurangi ~${short(insight.trimPerDay)}/hari${drv} agar finis tetap pas rencana.`
      : `${dayTag} — trimming ~${short(insight.trimPerDay)}/day${drv} brings you right back on plan.`;
  }
  if (insight.spareBy > 0) {
    return isId
      ? `${dayTag} — proyeksi masih punya ruang lega ${short(insight.spareBy)}, dengan aman ${short(b.safeDay)}/hari.`
      : `${dayTag} — on track for ${short(insight.spareBy)} spare, with a calm ${short(b.safeDay)}/day ahead.`;
  }
  return isId
    ? `${dayTag} — ruang aman masih ${short(b.safeDay)}/hari sampai gajian.`
    : `${dayTag} — looking steady with ${short(b.safeDay)}/day of breathing room to payday.`;
}

type StarterChip = {
  icon: string;
  title: string;
  sub: string;
  prompt: string;
};

/** Up to 4 personal, cycle-aware prompt chips using your actual pace, categories, and top merchant. */
function buildStarters(
  cycle: Cycle,
  b: Budget,
  short: (v: number) => string,
  isId: boolean,
  wealth?: WealthSnapshot,
): StarterChip[] {
  const left = b.budget - b.spent - b.fixedDue;
  const insight = paceInsight({
    budget: b.budget,
    projTotal: b.projTotal,
    oneOffs: b.proj.oneOffs,
    remainingVar: b.proj.remainingVar,
    daysLeft: cycle.daysLeft,
    dayN: cycle.dayN,
    cycleDays: cycle.cycleDays,
    cats: b.cats,
  });
  const wkSplit = weekendSafeSplit(left, cycle.daysLeft + 1, cycle.today.getDay(), b.proj.weekendRatio);
  const bufferCount = b.txs.filter(t => t.cat === 'Buffer' && !t.isIncome && !t.isTransfer).length;

  // Find #1 merchant this cycle for a personal touch.
  const merch = new Map<string, { name: string; total: number }>();
  for (const t of b.txs) {
    if (t.isIncome || t.isTransfer || t.net <= 0) continue;
    const k = merchantKey(t.title) || t.title.toLowerCase();
    const cur = merch.get(k);
    if (cur) cur.total += t.net;
    else merch.set(k, { name: tidyName(t.title), total: t.net });
  }
  const topMerch = [...merch.values()].sort((a, z) => z.total - a.total)[0];

  const out: StarterChip[] = [];

  // 1. Pace / Recovery chip (personal to your actual projection)
  if (left < 0) {
    out.push({
      icon: IC.trend,
      title: isId ? 'Atur ritme kembali' : 'Ease back to plan',
      sub: isId ? `${short(-left)} di atas rencana` : `${short(-left)} above plan`,
      prompt: isId ? 'Kenapa siklus ini lewat rencana dan gimana cara pelan-pelan ngeremnya?' : 'Why am I over plan and how can I gently ease back?',
    });
  } else if (insight.tier !== 'calm' && insight.trimPerDay > 0) {
    const driver = insight.topDriver?.name;
    out.push({
      icon: IC.trend,
      title: driver ? (isId ? `Rem ${driver}?` : `Ease back ${driver}?`) : isId ? 'Cek ritme siklus' : 'Check my pace',
      sub: isId ? `Kurangi ~${short(insight.trimPerDay)}/hari` : `Trim ~${short(insight.trimPerDay)}/day`,
      prompt: driver
        ? isId
          ? `Gimana cara ngerem ${driver} supaya siklus ini finis sesuai rencana?`
          : `How can I gently ease back ${driver} to finish on plan?`
        : isId
          ? 'Gimana cara ngerem pengeluaran pelan-pelan sampai gajian?'
          : 'How can I gently ease back spending until payday?',
    });
  } else {
    out.push({
      icon: IC.sparkle,
      title: isId ? 'Bagaimana ritmeku?' : "How's my pace?",
      sub: insight.spareBy > 0 ? (isId ? `Proyeksi sisa ${short(insight.spareBy)}` : `On track for ${short(insight.spareBy)} spare`) : `${short(b.safeDay)}/day left`,
      prompt: isId ? 'Siklus ini ritmeku gimana, dan apa yang sudah bagus?' : "How's my pace this cycle, and what's going well?",
    });
  }

  // 2. "How can I afford it?" / Runway & Weekend budget chip
  out.push({
    icon: IC.wallet,
    title: isId ? 'Gimana cara membelinya?' : 'How can I afford it?',
    sub: wkSplit
      ? isId
        ? `Akhir pekan ${short(wkSplit.weekendSafe)}/hr`
        : `Weekends ${short(wkSplit.weekendSafe)}/day`
      : isId
        ? `Aman ${short(b.safeDay)}/hari`
        : `Safe at ${short(b.safeDay)}/day`,
    prompt: isId
      ? 'Dengan sisa anggaran, tabungan, dan asetku sekarang, gimana cara beli keinginan tanpa ganggu tabungan atau nambah cicilan?'
      : 'With my remaining budget, savings, and assets right now, how can I afford a treat or bigger purchase without touching savings or adding debt?',
  });

  // 3. Tidy Buffer OR Runway & Freedom check OR Savings goal
  if (bufferCount > 0) {
    out.push({
      icon: IC.tag,
      title: isId ? `Rapikan ${bufferCount} Buffer` : `Tidy ${bufferCount} in Buffer`,
      sub: isId ? 'Bantu pilah otomatis' : 'Suggest categories & rules',
      prompt: isId ? `Bantu rapikan ${bufferCount} transaksi di Buffer dan sarankan kategorinya.` : `Help me sort my ${bufferCount} Buffer ${bufferCount === 1 ? 'transaction' : 'transactions'} and suggest categories.`,
    });
  } else if (wealth) {
    out.push({
      icon: IC.shield,
      title: isId ? 'Cek runway & aset' : 'Check my runway & assets',
      sub:
        wealth.runwayMonths > 0
          ? isId
            ? `${wealth.runwayMonths.toFixed(1)} bln runway · ${wealth.freedomPct.toFixed(0)}% bebas`
            : `${wealth.runwayMonths.toFixed(1)} mo runway · ${wealth.freedomPct.toFixed(0)}% freedom`
          : isId
            ? 'Dana darurat & arus kas'
            : 'Emergency fund & cash flow',
      prompt: isId
        ? 'Kalau aku berhenti kerja hari ini, berapa lama dana daruratku bertahan, dan bagaimana posisi aset vs kewajibanku?'
        : 'If I stopped working today, how long is my survival runway, and how does my asset vs. liability balance look?',
    });
  } else if (b.savingsTarget > 0 && b.saved < b.savingsTarget) {
    out.push({
      icon: IC.piggy,
      title: isId ? 'Target tabungan' : 'Hit my savings goal',
      sub: isId ? `Kurang ${short(b.savingsTarget - b.saved)}` : `${short(b.savingsTarget - b.saved)} to go`,
      prompt: isId ? 'Gimana cara terbaik supaya target tabungan siklus ini tercapai?' : 'What is the easiest way to hit my savings goal this cycle?',
    });
  }

  // 4. Personal top merchant / biggest spend
  out.push({
    icon: IC.bag,
    title: isId ? 'Ke mana perginya?' : 'Where is it going?',
    sub: topMerch ? `${topMerch.name} · ${short(topMerch.total)}` : isId ? 'Merchant terbesar' : 'Top merchants & habits',
    prompt: isId ? 'Merchant dan kebiasaan mana yang paling banyak menyedot pengeluaran siklus ini?' : 'Which merchants and habits are taking the most this cycle?',
  });

  return out.slice(0, 4);
}

type Props = {
  cycle: Cycle;
  budget: Budget;
  /** Every synced transaction, so suggested moves can find theirs. */
  allTxs: TxView[];
  /** Individual fixed bills and their verification status this cycle. */
  fixedBills?: FixedBillStatus[];
  /** Unified Rich Dad + Jakarta behavioral snapshot for holistic coaching. */
  wealth?: WealthSnapshot;
  impulse?: ImpulseSummary;
  fortDip?: FortAssetsAlert | null;
  lifestyleCreep?: LifestyleCreepSignal | null;
  pyfStreak?: number;
  /** Asked as soon as the panel opens (e.g. from Summary's greeting or alerts). */
  ask?: string | null;
  onClose: () => void;
};

/**
 * Chat with Maxie about this cycle. Persists across panel close/reopen within this browser session, supports Quick vs
 * Deep reasoning modes, context-aware starters, one-tap follow-up chips, and safe Apply/Undo action cards.
 */
export function Chat({ cycle, budget, allTxs, fixedBills, wealth, impulse, fortDip, lifestyleCreep, pyfStreak, ask, onClose }: Props) {
  const { settings, update, short } = useSettings();
  const { notes } = useData();
  const sessionKey = 'maxie.chat.' + toISO(cycle.start);
  const initial = useMemo(() => readSession(sessionKey), [sessionKey]);
  const [messages, setMessages] = useState<ChatMessage[]>(() => initial.messages);
  const [deep, setDeep] = useState<boolean>(() => !!initial.deep);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ kind: 'no_key' | 'api' | 'blocked' | 'quota' | 'network' | 'slow'; detail?: string } | null>(null);
  /** Seconds waited for the current answer, shown while thinking. */
  const [waited, setWaited] = useState(0);
  /** Which message index was just copied to the clipboard. */
  const [copied, setCopied] = useState<number | null>(null);
  const [savedToJournal, setSavedToJournal] = useState<number | null>(null);
  const [listening, setListening] = useState(false);
  const recRef = useRef<{ stop: () => void } | null>(null);
  /** The question being answered; an answer for an older one (after Stop, timeout, or New chat) is dropped. */
  const asking = useRef(0);
  const [withNotes, setWithNotes] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const isId = settings.maxieLanguage === 'id';
  const starters = useMemo(() => buildStarters(cycle, budget, short, isId, wealth), [cycle, budget, short, isId, wealth]);
  const openingPulse = useMemo(() => buildOpeningPulse(cycle, budget, short, isId), [cycle, budget, short, isId]);
  const left = budget.budget - budget.spent - budget.fixedDue;
  const bufferCount = useMemo(() => budget.txs.filter(t => t.cat === 'Buffer' && !t.isIncome && !t.isTransfer).length, [budget.txs]);

  const speechCtor =
    typeof window !== 'undefined'
      ? ((window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown }).SpeechRecognition ??
        (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition)
      : undefined;

  const toggleVoice = () => {
    if (listening) {
      recRef.current?.stop();
      setListening(false);
      return;
    }
    if (!speechCtor) return;
    try {
      const rec = new speechCtor() as {
        lang: string;
        interimResults: boolean;
        maxAlternatives: number;
        onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
        onerror: () => void;
        onend: () => void;
        start: () => void;
        stop: () => void;
      };
      rec.lang = isId ? 'id-ID' : 'en-US';
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.onresult = e => {
        const spoken = e.results?.[0]?.[0]?.transcript?.trim();
        if (spoken) setText(prev => (prev.trim() ? `${prev.trim()} ${spoken}` : spoken));
      };
      rec.onerror = () => setListening(false);
      rec.onend = () => setListening(false);
      recRef.current = rec;
      setListening(true);
      rec.start();
    } catch {
      setListening(false);
    }
  };

  useEffect(() => () => recRef.current?.stop(), []);

  const saveReplyToJournal = async (i: number, replyText: string) => {
    const q = [...messages.slice(0, i)].reverse().find(x => x.role === 'user')?.text ?? '';
    const now = new Date().toISOString();
    const title = q ? q.replace(/\?+$/, '').slice(0, 68) : 'Reflection with Maxie';
    try {
      await saveJournalEntry({
        id: newJournalId('je'),
        account: 'all',
        title,
        subtitle: `Saved from Ask Maxie · Day ${cycle.dayN} of ${cycle.cycleDays}`,
        body: replyText,
        coverPath: null,
        tags: ['Maxie', 'Cycle reflection'],
        status: 'draft',
        createdAt: now,
        updatedAt: now,
      });
      setSavedToJournal(i);
      setTimeout(() => setSavedToJournal(c => (c === i ? null : c)), 2600);
    } catch {
      // Ignore if offline/unconfigured
    }
  };

  useEffect(() => {
    writeSession(sessionKey, { messages, deep });
  }, [sessionKey, messages, deep]);

  const request = async (convo: ChatMessage[], useDeep = deep) => {
    setProblem(null);
    setBusy(true);
    setWaited(0);
    const id = ++asking.current;
    const timeout = new Promise<'slow'>(r => setTimeout(() => r('slow'), TIMEOUT_MS));
    try {
      const a = await Promise.race([
        askGemini(convo, chatContext({ cycle, budget, settings, notes, withNotes, fixedBills, wealth, impulse, fortDip, lifestyleCreep, pyfStreak }), useDeep),
        timeout,
      ]);
      if (id !== asking.current) return;
      if (a === 'slow') setProblem({ kind: 'slow' });
      else if ('error' in a) setProblem({ kind: a.error, detail: a.detail });
      else {
        const clean = extractFollowUps(a.reply, a.followUps);
        setMessages([...convo, { role: 'model', text: clean.reply, actions: a.actions, followUps: clean.followUps, mood: a.mood, model: a.model }]);
      }
    } catch (e) {
      if (id === asking.current) setProblem({ kind: 'network', detail: e instanceof Error ? e.message : String(e) });
    } finally {
      if (id === asking.current) setBusy(false);
    }
  };

  const send = async (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    const next: ChatMessage[] = [...messages, { role: 'user', text: question }];
    setMessages(next);
    setText('');
    if (input.current) input.current.style.height = 'auto';
    await request(next);
  };

  const retry = () => {
    if (!messages.length || busy) return;
    void request(messages);
  };

  const stop = () => {
    asking.current++;
    setBusy(false);
  };

  const copyReply = (i: number, replyText: string) => {
    navigator.clipboard?.writeText(replyText).then(() => {
      setCopied(i);
      setTimeout(() => setCopied(c => (c === i ? null : c)), 1800);
    });
  };

  /** Thumbs up or down on answer `i`: kept on the message, and saved so later questions carry it (chatContext). */
  const rate = (i: number, rating: 'up' | 'down') => {
    const m = messages[i];
    const q = [...messages.slice(0, i)].reverse().find(x => x.role === 'user')?.text ?? '';
    const same = m.rating === rating;
    setMessages(messages.map((x, j) => (j === i ? { ...x, rating: same ? undefined : rating } : x)));
    const a = m.text.slice(0, 400);
    const rest = (settings.chatFeedback ?? []).filter(f => !(f.q === q && f.a === a));
    update({ chatFeedback: same ? rest : [...rest, { q: q.slice(0, 200), a, good: rating === 'up', at: new Date().toISOString() }].slice(-30) });
  };

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setWaited(w => w + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  // Auto-grow the textarea cleanly as the user types multi-line prompts.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 168) + 'px';
  }, [text]);

  useEffect(() => {
    if (ask) void send(ask);
    else input.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // Once, on opening.
  }, []);

  const vp = useVisualViewport(true);

  useEffect(() => {
    const scrollY = window.scrollY;
    const prevOverflow = document.body.style.overflow;
    const prevOverscroll = document.documentElement.style.overscrollBehavior;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overscrollBehavior = 'none';
    return () => {
      document.body.style.overflow = prevOverflow;
      document.documentElement.style.overscrollBehavior = prevOverscroll;
      if (window.scrollY !== scrollY) window.scrollTo(0, scrollY);
    };
  }, []);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy, problem, vp.keyboardOpen]);

  const lastModelIdx = [...messages].map((m, i) => (m.role === 'model' ? i : -1)).filter(i => i >= 0).pop() ?? -1;

  return (
    <div
      className={s.chatOverlay}
      data-kb={vp.keyboardOpen ? '1' : undefined}
      onMouseDown={e => e.target === e.currentTarget && onClose()}
    >
      <section
        className={`${s.chatPanel} fade-in`}
        style={vp.keyboardOpen ? { paddingTop: vp.top, paddingBottom: vp.kbHeight } : undefined}
        role="dialog"
        aria-modal="true"
        aria-label="Ask Maxie"
      >
        <header className={s.chatHead}>
          <span className={s.chatMark} style={{ overflow: 'hidden', padding: 0 }}>
            <Logo size={32} mood={busy ? 'curious' : 'happy'} interactive />
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', marginRight: 'auto', minWidth: 0 }}>
            <strong style={{ fontFamily: 'var(--font-serif)', fontSize: 20, fontWeight: 500, lineHeight: '22px' }}>Maxie</strong>
            <span className={s.chatHeadSub}>
              <strong style={{ color: left < 0 ? C.redInk : C.text, fontWeight: 600 }}>
                {short(Math.abs(left))} {left < 0 ? 'over' : 'left'}
              </strong>
              {' · '}
              {cycle.daysLeft + 1}d left
              {bufferCount > 0 ? ` · ${bufferCount} Buffer` : ` · ${Math.round(budget.savedPct)}% saved`}
            </span>
          </span>
          {messages.length > 0 && (
            <button
              type="button"
              className={s.textBtnSm}
              onClick={() => {
                asking.current++;
                setMessages([]);
                setProblem(null);
                setBusy(false);
                writeSession(sessionKey, { messages: [], deep });
              }}
            >
              New
            </button>
          )}
          <button type="button" className={s.iconBtn} onClick={onClose} aria-label="Close" title="Close">
            <Icon d={IC.close} size={18} />
          </button>
        </header>

        <div ref={list} className={s.chatList} aria-live="polite">
          {messages.length === 0 && !busy && (() => {
            const who = settings.name.trim();
            const hr = new Date().getHours();
            const hi = isId
              ? hr < 11
                ? 'Selamat pagi'
                : hr < 15
                  ? 'Selamat siang'
                  : hr < 19
                    ? 'Selamat sore'
                    : 'Selamat malam'
              : hr < 12
                ? 'Good morning'
                : hr < 18
                  ? 'Good afternoon'
                  : 'Good evening';
            const headline = `${hi}${who ? `, ${who}` : ''}.`;
            return (
              <div className={s.chatEmptyStage}>
                <div className={s.chatEmptyGlow} aria-hidden="true" />
                <div className={s.chatEmptyHero}>
                  <span className={s.chatEmptyHalo}>
                    <Logo size={46} mood="happy" interactive cheer={isId ? 'Yuk ngobrol!' : 'Ready when you are!'} />
                  </span>
                  <h2 className={s.chatEmptyTitle}>{headline}</h2>
                  <p className={s.chatEmptySub}>{openingPulse}</p>
                </div>
                <div className={s.chatStarterGrid}>
                  {starters.map(st => (
                    <button key={st.title} type="button" className={s.chatStarterCard} onClick={() => send(st.prompt)}>
                      <span className={s.chatStarterTop}>
                        <Icon d={st.icon} size={14} color={C.clayInk} />
                        <strong>{st.title}</strong>
                      </span>
                      <span className={s.chatStarterSub}>{st.sub}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}

          {messages.map((m, i) => {
            if (m.role === 'user')
              return (
                <div key={i} className={s.chatMine}>
                  {m.text}
                </div>
              );
            const clean = extractFollowUps(m.text, m.followUps);
            const mood = m.mood ?? inferMood(clean.reply);
            const prevUserQ = [...messages.slice(0, i)].reverse().find(x => x.role === 'user')?.text ?? '';
            return (
              <div key={i} className={s.chatTheirsRow}>
                <Logo size={26} mood={mood} interactive cheer="Happy to help!" />
                <div className={s.chatTheirsCol}>
                  <div className={s.chatTheirs}>
                    <Rich text={clean.reply} />
                    <ReplyWidget question={prevUserQ} cycle={cycle} budget={budget} wealth={wealth} short={short} isId={isId} />
                    {m.actions && m.actions.length > 0 && <ActionGroup actions={m.actions} allTxs={allTxs} />}
                    <span className={s.chatRate}>
                      {(['up', 'down'] as const).map(r => (
                        <button
                          key={r}
                          type="button"
                          className={s.chatRateBtn}
                          aria-pressed={m.rating === r}
                          aria-label={r === 'up' ? 'Good answer' : 'Not helpful'}
                          title={r === 'up' ? 'Good answer' : 'Not helpful'}
                          onClick={() => rate(i, r)}
                        >
                          <Icon d={r === 'up' ? IC.thumbUp : IC.thumbDown} size={14} />
                        </button>
                      ))}
                      <button
                        type="button"
                        className={s.chatRateBtn}
                        aria-label={copied === i ? 'Copied' : 'Copy answer'}
                        title={copied === i ? 'Copied' : 'Copy answer'}
                        onClick={() => copyReply(i, clean.reply)}
                      >
                        <Icon d={copied === i ? IC.check : IC.copy} size={14} />
                      </button>
                      <button
                        type="button"
                        className={s.chatRateBtn}
                        aria-label="Save to Journal"
                        title="Save this reflection as a Journal draft"
                        onClick={() => void saveReplyToJournal(i, clean.reply)}
                      >
                        <Icon d={savedToJournal === i ? IC.check : IC.book} size={14} />
                      </button>
                      {savedToJournal === i ? (
                        <span className={s.chatRateNote}>Saved to Journal draft.</span>
                      ) : m.rating ? (
                        <span className={s.chatRateNote}>{m.rating === 'up' ? 'Glad that helped.' : "Got it — I'll tune that next time."}</span>
                      ) : m.model ? (
                        <span className={s.chatModelTag}>{modelLabel(m.model)}</span>
                      ) : null}
                    </span>
                  </div>
                  {i === lastModelIdx && !busy && clean.followUps.length > 0 && (
                    <div className={s.chatFollowUps} aria-label="Suggested follow-ups">
                      {clean.followUps.map(q => (
                        <button key={q} type="button" className={s.chatFollowUp} onClick={() => send(q)}>
                          <span>{q}</span>
                          <Icon d={IC.arrowUpRight} size={12} />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {busy && (
            <div className={s.chatTheirsRow} role="status" aria-live="polite">
              <Logo size={26} mood="curious" />
              <span className={s.thinking}>
                <span className={s.thinkLabel}>{thinkingLabel(waited, deep)}</span>
                <ThinkingArcs />
              </span>
            </div>
          )}
          {problem && <Problem p={problem} onRetry={retry} />}
        </div>

        <form
          className={s.chatForm}
          onSubmit={e => {
            e.preventDefault();
            if (busy) stop();
            else void send(text);
          }}
        >
          <div className={s.chatComposer}>
            <textarea
              ref={input}
              className={s.chatInput}
              rows={1}
              value={text}
              maxLength={1000}
              placeholder={listening ? (isId ? 'Mendengarkan…' : 'Listening…') : isId ? 'Tanya Maxie…' : 'Ask Maxie…'}
              aria-label="Your question"
              onChange={e => setText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send(text);
                }
              }}
            />
            {speechCtor && !busy && (
              <button
                type="button"
                className={s.chatMicBtn}
                data-on={listening || undefined}
                onClick={toggleVoice}
                aria-label={listening ? 'Stop voice input' : 'Voice input'}
                title={listening ? 'Stop listening' : 'Speak your question'}
              >
                <Icon d={IC.mic} size={17} />
              </button>
            )}
            {busy ? (
              <button type="button" className={s.chatStop} onClick={stop} aria-label="Stop waiting" title="Stop waiting">
                <span className={s.chatStopSquare} aria-hidden="true" />
              </button>
            ) : (
              <button type="submit" className={s.chatSend} disabled={!text.trim()} aria-label="Send">
                <Icon d={IC.arrowUp} size={18} strokeWidth={2.25} />
              </button>
            )}
          </div>
          <div className={s.chatFootRow}>
            <div className={s.sxMiniSeg} role="group" aria-label="Answer speed and depth" title="Quick: instant · Deep: deeper reasoning">
              <button type="button" aria-pressed={!deep} onClick={() => setDeep(false)}>
                Quick
              </button>
              <button type="button" aria-pressed={deep} onClick={() => setDeep(true)}>
                Deep
              </button>
            </div>
            <button
              type="button"
              className={s.chatNotesChip}
              aria-pressed={withNotes}
              onClick={() => setWithNotes(v => !v)}
              title="Include your personal transaction notes when asking Maxie"
            >
              <Icon d={withNotes ? IC.check : IC.plus} size={12} />
              Notes
            </button>
            <span className={s.chatDisclosure} style={{ marginLeft: 'auto' }}>Gemini</span>
          </div>
        </form>
      </section>
    </div>
  );
}

/** Inline editorial mini-widget attached automatically to relevant Maxie answers (merchants, affordability, savings, cards). */
function ReplyWidget({
  question,
  cycle,
  budget: b,
  wealth,
  short,
  isId,
}: {
  question: string;
  cycle: Cycle;
  budget: Budget;
  wealth?: WealthSnapshot;
  short: (v: number) => string;
  isId: boolean;
}) {
  if (!question) return null;

  if (wealth && /runway|darurat|emergency|freedom|rat race|aset|asset|liabilit|kewajiban|net worth|pasif|passive|rich dad|bebas|survive|bertahan/i.test(question)) {
    return (
      <div className={s.chatWidget}>
        <span className={s.chatWidgetEyebrow}>{isId ? 'Runway & Kebebasan Aset' : 'Survival Runway & Asset Freedom'}</span>
        <div className={s.chatWidgetStats}>
          <span>
            <span className={s.caption}>{isId ? 'Runway darurat' : 'Emergency runway'}</span>
            <strong style={{ color: wealth.runwayMonths >= wealth.emergencyTargetMonths ? C.good : undefined }}>
              {wealth.runwayMonths > 0 ? `${wealth.runwayMonths.toFixed(1)} mo` : 'Not set'}
            </strong>
          </span>
          <span>
            <span className={s.caption}>{isId ? 'Aset produktif' : 'Assets'}</span>
            <strong>{short(wealth.assetsTotal)}</strong>
          </span>
          <span>
            <span className={s.caption}>{isId ? 'Kewajiban' : 'Liabilities'}</span>
            <strong style={{ color: wealth.liabilitiesTotal > 0 ? C.amberInk : C.good }}>{short(wealth.liabilitiesTotal)}</strong>
          </span>
        </div>
        <div className={s.chatWidgetRow}>
          <div className={s.chatWidgetTop}>
            <span>{isId ? 'Rasio kebebasan (pasif / pengeluaran)' : 'Freedom ratio (passive / expenses)'}</span>
            <strong style={{ color: wealth.freedomPct >= 100 ? C.good : undefined }}>{wealth.freedomPct.toFixed(1)}%</strong>
          </div>
          <span className={s.chatWidgetTrack}>
            <span className={s.chatWidgetFill} style={{ width: `${Math.min(100, Math.max(2, wealth.freedomPct))}%`, background: 'var(--good)' }} />
          </span>
        </div>
      </div>
    );
  }

  if (/merchant|going|biggest|perginya|terbesar|most|banyak/i.test(question)) {
    const m = new Map<string, { name: string; count: number; total: number }>();
    for (const t of b.txs) {
      if (t.isIncome || t.isTransfer || t.net <= 0) continue;
      const k = merchantKey(t.title) || t.title.toLowerCase();
      const cur = m.get(k);
      if (cur) (cur.count++, (cur.total += t.net));
      else m.set(k, { name: tidyName(t.title), count: 1, total: t.net });
    }
    const top = [...m.values()].sort((a, z) => z.total - a.total).slice(0, 4);
    if (!top.length) return null;
    const mx = top[0].total || 1;
    return (
      <div className={s.chatWidget}>
        <span className={s.chatWidgetEyebrow}>{isId ? 'Merchant terbesar siklus ini' : 'Top merchants this cycle'}</span>
        {top.map(item => (
          <div key={item.name} className={s.chatWidgetRow}>
            <div className={s.chatWidgetTop}>
              <span>
                <strong>{item.name}</strong> <span className={s.caption}>({item.count}×)</span>
              </span>
              <strong>{short(item.total)}</strong>
            </div>
            <span className={s.chatWidgetTrack}>
              <span className={s.chatWidgetFill} style={{ width: `${Math.max(6, (item.total / mx) * 100)}%` }} />
            </span>
          </div>
        ))}
      </div>
    );
  }

  if (/afford|treat|buy|jajan|belanja|beli|spend|ruang aman/i.test(question)) {
    const left = b.budget - b.spent - b.fixedDue;
    const wk = weekendSafeSplit(left, cycle.daysLeft + 1, cycle.today.getDay(), b.proj.weekendRatio);
    const spare = Math.max(0, b.budget - b.projTotal);
    return (
      <div className={s.chatWidget}>
        <span className={s.chatWidgetEyebrow}>{isId ? 'Ruang aman belanja' : 'Comfortable spending room'}</span>
        <div className={s.chatWidgetStats}>
          <span>
            <span className={s.caption}>{isId ? 'Aman/hari' : 'Safe / day'}</span>
            <strong>{short(b.safeDay)}</strong>
          </span>
          {wk && (
            <span>
              <span className={s.caption}>{isId ? 'Akhir pekan' : 'Weekends'}</span>
              <strong>{short(wk.weekendSafe)}</strong>
            </span>
          )}
          <span>
            <span className={s.caption}>{spare > 0 ? (isId ? 'Proyeksi sisa' : 'Projected spare') : isId ? 'Sisa rencana' : 'Left in plan'}</span>
            <strong style={{ color: left < 0 ? C.redInk : C.good }}>{short(spare > 0 ? spare : Math.max(0, left))}</strong>
          </span>
        </div>
      </div>
    );
  }

  if (/saving|tabungan|nabung|goal|target/i.test(question) && b.savingsTarget > 0) {
    const pct = Math.min(100, Math.round((b.saved / b.savingsTarget) * 100));
    return (
      <div className={s.chatWidget}>
        <span className={s.chatWidgetEyebrow}>{isId ? 'Progres tabungan' : 'Savings progress'}</span>
        <div className={s.chatWidgetTop}>
          <strong>{short(b.saved)}</strong>
          <span className={s.caption}>
            {pct}% of {short(b.savingsTarget)}
          </span>
        </div>
        <span className={s.chatWidgetTrack}>
          <span className={s.chatWidgetFill} style={{ width: `${pct}%`, background: 'var(--good)' }} />
        </span>
      </div>
    );
  }

  if (/card|kartu|tagihan/i.test(question)) {
    const owed = b.cards.filter(c => c.owed > 0);
    if (!owed.length) return null;
    return (
      <div className={s.chatWidget}>
        <span className={s.chatWidgetEyebrow}>{isId ? 'Tagihan kartu aktif' : 'Active card bills'}</span>
        {owed.map(c => (
          <div key={c.account} className={s.chatWidgetTop}>
            <span>{c.account}</span>
            <strong>{short(c.owed)}</strong>
          </div>
        ))}
      </div>
    );
  }

  return null;
}

/** Gemini's text: headings, "- " bullets, "1. " numbered lists, **bold**, *italic*, and `code`. */
export function Rich({ text }: { text: string }) {
  const inline = (line: string): ReactNode[] => {
    const tokens = line.split(/(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`)/g);
    return tokens.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>;
      if (part.startsWith('*') && part.endsWith('*') && part.length > 2) return <em key={i}>{part.slice(1, -1)}</em>;
      if (part.startsWith('`') && part.endsWith('`') && part.length > 2)
        return (
          <code key={i} className={s.chatCode}>
            {part.slice(1, -1)}
          </code>
        );
      return part;
    });
  };
  const lines = text.split('\n').filter(l => l.trim());
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {lines.map((l, i) => {
        const heading = l.match(/^\s*#{1,3}\s+(.+)/);
        if (heading)
          return (
            <p key={i} className={s.chatRichHeading}>
              {inline(heading[1])}
            </p>
          );
        if (/^\s*[-*•]\s+/.test(l))
          return (
            <div key={i} style={{ display: 'flex', gap: 8 }}>
              <span aria-hidden="true">•</span>
              <span>{inline(l.replace(/^\s*[-*•]\s+/, ''))}</span>
            </div>
          );
        const numbered = l.match(/^\s*(\d+\.)\s+(.+)/);
        if (numbered)
          return (
            <div key={i} style={{ display: 'flex', gap: 8 }}>
              <span style={{ fontWeight: 600, flex: 'none', minWidth: 18 }}>{numbered[1]}</span>
              <span>{inline(numbered[2])}</span>
            </div>
          );
        return (
          <p key={i} style={{ margin: 0 }}>
            {inline(l)}
          </p>
        );
      })}
    </div>
  );
}

export function Problem({ p, onRetry }: { p: { kind: string; detail?: string }; onRetry: () => void }) {
  const where = onVercel ? 'Vercel → Project Settings → Environment Variables' : 'Apps Script editor → Project Settings → Script properties';
  if (p.kind === 'no_key')
    return (
      <div className={s.chatNote}>
        <strong>Maxie isn't set up yet.</strong>
        <span>
          Create an API key in Google AI Studio, then open <strong>{where}</strong> and add <code>GEMINI_API_KEY</code>. Then ask again.
        </span>
      </div>
    );
  if (p.kind === 'quota')
    return (
      <div className={s.chatNote}>
        <strong>I've hit my Gemini limit for now.</strong>
        <span>The free Gemini key allows only so many questions a minute and a day. Try again in a minute, or switch to Quick mode.</span>
        <button type="button" className={s.textBtnSm} onClick={onRetry} style={{ alignSelf: 'flex-start', padding: 0 }}>
          Try again
        </button>
      </div>
    );
  if (p.kind === 'slow')
    return (
      <div className={s.chatNote}>
        <strong>Maxie is taking too long.</strong>
        <span>
          Try again or switch to <strong>Quick</strong> mode. You can also set <code>GEMINI_MODEL</code> = <code>gemini-3.5-flash-lite</code> in{' '}
          <strong>{where}</strong>.
        </span>
        <button type="button" className={s.textBtnSm} onClick={onRetry} style={{ alignSelf: 'flex-start', padding: 0 }}>
          Try again
        </button>
      </div>
    );
  return (
    <div className={s.chatNote} style={{ background: 'var(--red-tint)', color: 'var(--red-ink)' }}>
      <strong>{p.kind === 'blocked' ? "Maxie didn't answer that." : "Couldn't reach Maxie."}</strong>
      {p.detail && <span style={{ wordBreak: 'break-word' }}>{p.detail}</span>}
      <button type="button" className={s.textBtnSm} onClick={onRetry} style={{ alignSelf: 'flex-start', color: 'inherit', padding: 0 }}>
        Try again
      </button>
    </div>
  );
}

/** Category names as the app has them (Gemini may change the case); undefined when there's no such category. */
const known = (name: string | undefined) => [...CATEGORIES.map(c => c.name), ...OTHER_CATEGORIES].find(n => n.toLowerCase() === (name ?? '').trim().toLowerCase());

type PreparedAction = {
  title: ReactNode;
  preview?: string;
  why?: string;
  apply: () => () => void;
};

/** Resolve an AI-proposed action against real data, returning null if it doesn't match cleanly. */
function usePrepareAction(allTxs: TxView[]) {
  const { settings, update, short, ofIncome } = useSettings();
  const { rules, ruleSubs, subs, setRules, setSub, setOverride } = useData();
  const setLimits = useSetLimits();
  const subOf = (cat: string, sub?: string | null) => (sub ? settings.subcategories[cat]?.find(x => x.toLowerCase() === sub.trim().toLowerCase()) : undefined);

  return (a: ChatAction): PreparedAction | null => {
    if (a.type === 'rule') {
      const cat = known(a.category);
      const key = merchantKey(a.merchant ?? '');
      if (!cat || !key) return null;
      const sub = subOf(cat, a.sub);
      return {
        title: (
          <>
            Always put <strong>{a.merchant}</strong> in <strong>{categoryLabel(cat)}{sub ? ' › ' + sub : ''}</strong>
          </>
        ),
        why: a.why,
        apply: () => {
          const prev = Object.entries(rules).find(([m]) => merchantKey(m) === key);
          const prevSub = Object.entries(ruleSubs).find(([m]) => merchantKey(m) === key)?.[1] ?? null;
          setRules({ [key]: cat }, { [key]: sub ?? null });
          return () => (prev ? setRules({ [prev[0]]: prev[1] }, { [prev[0]]: prevSub }) : setRules({ [key]: null }));
        },
      };
    }
    if (a.type === 'recategorize') {
      const cat = known(a.category);
      const txs = (a.txIds ?? []).map(id => allTxs.find(t => t.id === id)).filter((t): t is TxView => !!t && !t.isCcPayment);
      if (!cat || !txs.length) return null;
      const sub = subOf(cat, a.sub);
      return {
        title: (
          <>
            Move {txs.length === 1 ? <strong>{tidyName(txs[0].title)}</strong> : <strong>{txs.length} transactions</strong>} to{' '}
            <strong>
              {categoryLabel(cat)}
              {sub ? ' › ' + sub : ''}
            </strong>
          </>
        ),
        why: a.why,
        apply: () => {
          const before = txs.map(t => ({ t, cat: t.cat, sub: subs[t.plan?.of ?? t.id] ?? null }));
          for (const t of txs) {
            setOverride(t.id, t.category, cat);
            setSub(t.plan?.of ?? t.id, sub ?? null);
          }
          return () =>
            before.forEach(x => {
              setOverride(x.t.id, x.t.category, x.cat);
              setSub(x.t.plan?.of ?? x.t.id, x.sub);
            });
        },
      };
    }
    if (a.type === 'move_limit') {
      const from = categoryByName(known(a.from) ?? '');
      const to = categoryByName(known(a.to) ?? '');
      const onePct = ofIncome(1);
      if (!from || !to || from === to || from.type !== 'variable' || to.type !== 'variable' || !(onePct > 0)) return null;
      const fromLimit = ofIncome(from.limitPct);
      const toLimit = ofIncome(to.limitPct);
      const amount = Math.min(Number(a.amount) || 0, fromLimit);
      if (!(amount > 0)) return null;
      return {
        title: (
          <>
            Move <strong>{short(amount)}</strong> of limit from <strong>{from.name}</strong> to <strong>{to.name}</strong>
          </>
        ),
        preview: `${from.name}: ${short(fromLimit)} → ${short(Math.max(0, fromLimit - amount))} · ${to.name}: ${short(toLimit)} → ${short(toLimit + amount)}`,
        why: a.why,
        apply: () => {
          const pct = Math.ceil((amount / onePct) * 100) / 100;
          setLimits({ [to.name]: to.limitPct + pct, [from.name]: Math.max(0, from.limitPct - pct) });
          return () => setLimits({ [to.name]: to.limitPct, [from.name]: from.limitPct });
        },
      };
    }
    if (a.type === 'challenge') {
      const cat = categoryByName(known(a.category) ?? '');
      if (!cat || cat.type !== 'variable') return null;
      return {
        title: (
          <>
            Start a 7-day no-spend challenge for <strong>{cat.name}</strong>
          </>
        ),
        preview: `7 days starting today — spend nothing on ${cat.name} to earn a trophy.`,
        why: a.why,
        apply: () => {
          const prev = settings.challenges ?? [];
          const next = [...prev.filter(c => c.category !== cat.name), startChallenge(cat.name, new Date())];
          update({ challenges: next });
          return () => update({ challenges: prev });
        },
      };
    }
    if (a.type === 'wishlist') {
      const name = String(a.name ?? '').trim().slice(0, 60);
      const amount = Math.max(0, Math.round(Number(a.amount) || 0));
      const coolDays = Math.max(1, Math.min(90, Math.round(Number(a.coolDays) || 3)));
      if (!name || !(amount > 0)) return null;
      return {
        title: (
          <>
            Pause <strong>{name}</strong> ({short(amount)}) in Cooling-Off Wishlist
          </>
        ),
        preview: `${coolDays}-day pause before buying — fund from assets or surplus, not impulse.`,
        why: a.why,
        apply: () => {
          const prev = settings.wishlist ?? [];
          const id = 'wl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
          const next = [
            { id, name, amount, addedAt: toISO(new Date()), coolDays, fundingMode: 'assets' as const, status: 'cooling' as const },
            ...prev,
          ];
          update({ wishlist: next });
          return () => update({ wishlist: prev });
        },
      };
    }
    if (a.type === 'pay_yourself_first') {
      const nextSave = a.savingsPct != null ? Math.max(0, Math.min(90, Math.round(Number(a.savingsPct)))) : undefined;
      const nextInv = a.investPct != null ? Math.max(0, Math.min(90, Math.round(Number(a.investPct)))) : undefined;
      if (nextSave == null && nextInv == null) return null;
      const parts: string[] = [];
      if (nextSave != null) parts.push(`Savings ${settings.savingsPct}% → ${nextSave}%`);
      if (nextInv != null) parts.push(`Invest ${settings.investPct}% → ${nextInv}%`);
      return {
        title: <>Update Pay-Yourself-First targets</>,
        preview: parts.join(' · '),
        why: a.why,
        apply: () => {
          const prevSave = settings.savingsPct;
          const prevInv = settings.investPct;
          update({
            ...(nextSave != null ? { savingsPct: nextSave } : {}),
            ...(nextInv != null ? { investPct: nextInv } : {}),
          });
          return () => update({ savingsPct: prevSave, investPct: prevInv });
        },
      };
    }
    return null;
  };
}

/** One or more suggested changes on a reply; adds a one-tap "Apply all" when 2+ valid actions are shown. */
function ActionGroup({ actions, allTxs }: { actions: ChatAction[]; allTxs: TxView[] }) {
  const prepare = usePrepareAction(allTxs);
  const items = actions.map((a, idx) => ({ idx, prepared: prepare(a) })).filter((x): x is { idx: number; prepared: PreparedAction } => !!x.prepared);
  const [undos, setUndos] = useState<Record<number, () => void>>({});
  if (!items.length) return null;

  const remaining = items.filter(x => !undos[x.idx]);
  const applyOne = (idx: number, fn: () => () => void) => setUndos(u => ({ ...u, [idx]: fn() }));
  const undoOne = (idx: number) => {
    undos[idx]?.();
    setUndos(u => {
      const next = { ...u };
      delete next[idx];
      return next;
    });
  };
  const applyAll = () => {
    const added: Record<number, () => void> = {};
    for (const x of remaining) added[x.idx] = x.prepared.apply();
    setUndos(u => ({ ...u, ...added }));
  };
  const undoAll = () => {
    for (const x of [...items].reverse()) undos[x.idx]?.();
    setUndos({});
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.length >= 2 && (
        <div className={s.chatActionBatch}>
          <span style={{ fontSize: 12, color: C.textMuted, marginRight: 'auto' }}>{items.length} suggested changes</span>
          {remaining.length > 0 ? (
            <button type="button" className={s.btnPrimarySm} onClick={applyAll}>
              Apply all ({remaining.length})
            </button>
          ) : (
            <button type="button" className={s.textBtnSm} style={{ padding: 0 }} onClick={undoAll}>
              Undo all
            </button>
          )}
        </div>
      )}
      {items.map(({ idx, prepared }) => (
        <ActionCardView
          key={idx}
          prepared={prepared}
          done={!!undos[idx]}
          onApply={() => applyOne(idx, prepared.apply)}
          onUndo={() => undoOne(idx)}
        />
      ))}
    </div>
  );
}

function ActionCardView({ prepared, done, onApply, onUndo }: { prepared: PreparedAction; done: boolean; onApply: () => void; onUndo: () => void }) {
  return (
    <div className={s.chatAction}>
      <span style={{ fontSize: 14 }}>{prepared.title}</span>
      {prepared.preview && <span className={s.chatActionPreview}>{prepared.preview}</span>}
      {prepared.why && <span style={{ fontSize: 13, color: C.textMuted }}>{prepared.why}</span>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {!done ? (
          <button type="button" className={s.btnPrimarySm} onClick={onApply}>
            Apply
          </button>
        ) : (
          <>
            <span className={s.mxTag} data-tone="success">
              Done — all tidy.
            </span>
            <button type="button" className={s.textBtnSm} onClick={onUndo}>
              Undo
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** A single change Gemini suggests (used by ActionPlan): what it does and why, Apply, then Undo. */
export function ActionCard({ action: a, allTxs }: { action: ChatAction; allTxs: TxView[] }) {
  const prepare = usePrepareAction(allTxs);
  const [undo, setUndo] = useState<(() => void) | null>(null);
  const [done, setDone] = useState(false);
  const prepared = prepare(a);
  if (!prepared) return null;
  return (
    <ActionCardView
      prepared={prepared}
      done={done}
      onApply={() => {
        setUndo(() => prepared.apply());
        setDone(true);
      }}
      onUndo={() => {
        undo?.();
        setUndo(null);
        setDone(false);
      }}
    />
  );
}
