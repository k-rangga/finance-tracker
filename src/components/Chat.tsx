import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import s from '../styles/ui.module.css';
import { IC, Icon } from './Icon';
import { Logo } from './Logo';
import { askGemini, chatContext, modelLabel, type ChatAction, type ChatMessage } from '../lib/chat';
import type { Budget, TxView } from '../lib/budget';
import type { Cycle } from '../lib/cycle';
import type { FixedBillStatus } from '../lib/fixedBills';
import { useData } from '../lib/data';
import { useSettings } from '../lib/settings';
import { useSetLimits } from '../lib/limits';
import { onVercel } from '../lib/supabase';
import { C } from '../lib/tokens';
import { CATEGORIES, categoryByName, categoryLabel, OTHER_CATEGORIES } from '../data/categories';
import { merchantKey } from '../data/transactions';
import { sum, tidyName, toISO } from '../lib/format';

/** Stop waiting after this long; per-model fetches abort at 22s and fall back automatically. */
const TIMEOUT_MS = 45_000;

/** What Maxie is doing, by how long it's been working: the thinking label follows the loading. */
export const thinkingLabel = (secs: number, deep = false) =>
  secs < 2
    ? deep
      ? 'Maxie is digging in…'
      : 'Maxie is thinking…'
    : secs < 5
      ? 'Reading this cycle…'
      : secs < 10
        ? deep
          ? 'Weighing your categories and prices…'
          : 'Checking your categories…'
        : secs < 20
          ? 'Writing an answer…'
          : 'Still working, deeper questions can take up to a minute…';

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
    const raw = sessionStorage.getItem(key);
    if (!raw) return { messages: [] };
    const parsed = JSON.parse(raw) as StoredChat;
    return { messages: Array.isArray(parsed.messages) ? parsed.messages : [], deep: !!parsed.deep };
  } catch {
    return { messages: [] };
  }
}

function writeSession(key: string, data: StoredChat) {
  try {
    sessionStorage.setItem(key, JSON.stringify(data));
  } catch {
    // Ignore storage quota / private mode failures.
  }
}

/** Up to 4 cycle-aware starter prompts tuned to your current numbers (English by default). */
function buildStarters(b: Budget): string[] {
  const left = b.budget - b.spent - b.fixedDue;
  const overCat = b.cats
    .filter(c => c.type === 'variable' && c.status.key === 'over')
    .sort((a, z) => z.used - a.used)[0];
  const bufferCount = b.txs.filter(t => t.cat === 'Buffer' && !t.isIncome && !t.isTransfer).length;
  const owed = sum(b.cards.map(c => Math.max(0, c.owed)));
  const out: string[] = [];

  if (left < 0) {
    out.push('Why am I over plan and how do I recover?');
  } else if (overCat) {
    out.push(`How do I rein in ${overCat.name}?`);
  } else {
    out.push('Am I on track this cycle?');
  }

  if (bufferCount > 0) {
    out.push(`Sort my ${bufferCount} Buffer ${bufferCount === 1 ? 'transaction' : 'transactions'}`);
  }
  if (b.savingsTarget > 0 && b.saved < b.savingsTarget) {
    out.push('How do I hit my savings goal?');
  } else if (owed > 0) {
    out.push('Break down my card bill this cycle');
  }

  out.push('Which merchants take the most?');
  out.push('Where can I trim without feeling it?');
  return out.slice(0, 4);
}

type Props = {
  cycle: Cycle;
  budget: Budget;
  /** Every synced transaction, so suggested moves can find theirs. */
  allTxs: TxView[];
  /** Individual fixed bills and their verification status this cycle. */
  fixedBills?: FixedBillStatus[];
  /** Asked as soon as the panel opens (e.g. from Summary's greeting or alerts). */
  ask?: string | null;
  onClose: () => void;
};

/**
 * Chat with Maxie about this cycle. Persists across panel close/reopen within this browser session, supports Quick vs
 * Deep reasoning modes, context-aware starters, one-tap follow-up chips, and safe Apply/Undo action cards.
 */
export function Chat({ cycle, budget, allTxs, fixedBills, ask, onClose }: Props) {
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
  /** The question being answered; an answer for an older one (after Stop, timeout, or New chat) is dropped. */
  const asking = useRef(0);
  const [withNotes, setWithNotes] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const starters = useMemo(() => buildStarters(budget), [budget]);
  const left = budget.budget - budget.spent - budget.fixedDue;
  const bufferCount = useMemo(() => budget.txs.filter(t => t.cat === 'Buffer' && !t.isIncome && !t.isTransfer).length, [budget.txs]);

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
      const a = await Promise.race([askGemini(convo, chatContext({ cycle, budget, settings, notes, withNotes, fixedBills }), useDeep), timeout]);
      if (id !== asking.current) return;
      if (a === 'slow') setProblem({ kind: 'slow' });
      else if ('error' in a) setProblem({ kind: a.error, detail: a.detail });
      else setMessages([...convo, { role: 'model', text: a.reply, actions: a.actions, followUps: a.followUps, model: a.model }]);
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

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy, problem]);

  const lastModelIdx = [...messages].map((m, i) => (m.role === 'model' ? i : -1)).filter(i => i >= 0).pop() ?? -1;

  return (
    <div className={s.chatOverlay} onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <section className={`${s.chatPanel} fade-in`} role="dialog" aria-modal="true" aria-label="Ask Maxie">
        <header className={s.chatHead}>
          <span className={s.chatMark} style={{ overflow: 'hidden', padding: 0 }}>
            <Logo size={32} mood={busy ? 'curious' : 'happy'} interactive />
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', marginRight: 'auto', minWidth: 0 }}>
            <strong style={{ fontFamily: 'var(--font-serif)', fontSize: 20, fontWeight: 500, lineHeight: '22px' }}>Maxie</strong>
            <span style={{ fontSize: 12, color: C.textMuted }}>{deep ? 'Deeper reasoning · free tier' : 'Fast cycle assistant'}</span>
          </span>
          <div className={s.sxMiniSeg} role="group" aria-label="Answer speed and depth" title="Quick: instant 3.5 Flash-Lite · Deep: smarter 3.6 Flash (free tier)">
            <button type="button" aria-pressed={!deep} onClick={() => setDeep(false)}>
              Quick
            </button>
            <button type="button" aria-pressed={deep} onClick={() => setDeep(true)}>
              Deep
            </button>
          </div>
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

        <div className={s.chatContextBar} aria-label="Cycle snapshot sent to Maxie">
          <span style={{ color: left < 0 ? C.redInk : C.text, fontWeight: 600 }}>
            {short(Math.abs(left))} {left < 0 ? 'over plan' : 'left'}
          </span>
          <span aria-hidden="true">·</span>
          <span>{cycle.daysLeft + 1}d to payday</span>
          {bufferCount > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span>{bufferCount} in Buffer</span>
            </>
          )}
          <span aria-hidden="true">·</span>
          <span>{Math.round(budget.savedPct)}% saved</span>
        </div>

        <div ref={list} className={s.chatList} aria-live="polite">
          {messages.length === 0 && !busy && (() => {
            const who = settings.name.trim();
            const hr = new Date().getHours();
            const hi = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
            const headline = `${hi}${who ? `, ${who}` : ''}!`;
            const sub = "I'm Maxie — ready to check this cycle's spending, tidy up categories, or find room to save. What's on your mind?";
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '8px 0' }}>
                <div className={s.chatTheirsRow}>
                  <Logo size={36} mood="happy" interactive />
                  <div className={s.chatTheirs}>
                    <span className={s.chatName}>Maxie</span>
                    <p style={{ margin: 0 }}>
                      <strong>{headline}</strong> {sub}
                    </p>
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {starters.map(q => (
                    <button key={q} type="button" className={s.chatStarter} onClick={() => send(q)}>
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}

          {messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className={s.chatMine}>
                {m.text}
              </div>
            ) : (
              <div key={i} className={s.chatTheirsRow}>
                <Logo size={28} mood="happy" />
                <div className={s.chatTheirs}>
                  <span className={s.chatName}>Maxie</span>
                  <Rich text={m.text} />
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
                        <Icon d={r === 'up' ? IC.thumbUp : IC.thumbDown} size={15} />
                      </button>
                    ))}
                    <button
                      type="button"
                      className={s.chatRateBtn}
                      aria-label={copied === i ? 'Copied' : 'Copy answer'}
                      title={copied === i ? 'Copied' : 'Copy answer'}
                      onClick={() => copyReply(i, m.text)}
                    >
                      <Icon d={copied === i ? IC.check : IC.copy} size={15} />
                    </button>
                    {m.rating && <span className={s.chatRateNote}>{m.rating === 'up' ? 'Thanks, noted!' : "Got it, I'll do better."}</span>}
                    {!m.rating && m.model && <span className={s.chatModelTag}>{modelLabel(m.model)}</span>}
                  </span>
                  {i === lastModelIdx && !busy && m.followUps && m.followUps.length > 0 && (
                    <div className={s.chatFollowUps} aria-label="Suggested follow-ups">
                      {m.followUps.map(q => (
                        <button key={q} type="button" className={s.chatFollowUp} onClick={() => send(q)}>
                          {q}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ),
          )}

          {busy && (
            <div className={s.chatTheirsRow} role="status" aria-live="polite">
              <Logo size={28} mood="curious" />
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
              placeholder="Ask Maxie anything…"
              aria-label="Your question"
              onChange={e => setText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send(text);
                }
              }}
            />
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
            <button
              type="button"
              className={s.chatNotesChip}
              aria-pressed={withNotes}
              onClick={() => setWithNotes(v => !v)}
              title="Include your personal transaction notes when asking Maxie"
            >
              <Icon d={withNotes ? IC.check : IC.plus} size={12} />
              Include notes
            </button>
            <span className={s.chatDisclosure}>Runs on Gemini · double-check big numbers</span>
          </div>
        </form>
      </section>
    </div>
  );
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
  const { settings, short, ofIncome } = useSettings();
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
              Applied
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
