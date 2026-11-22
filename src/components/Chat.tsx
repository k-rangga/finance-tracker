import { useEffect, useRef, useState, type ReactNode } from 'react';
import s from '../styles/ui.module.css';
import { IC, Icon } from './Icon';
import { Logo } from './Logo';
import { askGemini, chatContext, type ChatAction, type ChatMessage } from '../lib/chat';
import type { Budget, TxView } from '../lib/budget';
import type { Cycle } from '../lib/cycle';
import { useData } from '../lib/data';
import { useSettings } from '../lib/settings';
import { useSetLimits } from '../lib/limits';
import { C } from '../lib/tokens';
import { CATEGORIES, categoryByName, categoryLabel, OTHER_CATEGORIES } from '../data/categories';
import { merchantKey } from '../data/transactions';
import { tidyName } from '../lib/format';

/** Stop waiting after this long; Apps Script would still finish, but the answer is dropped. */
const TIMEOUT_MS = 75_000;

/** What Maxie is doing, by how long it's been working: the thinking label follows the loading. */
export const thinkingLabel = (secs: number) =>
  secs < 2 ? 'Maxie is thinking…' : secs < 5 ? 'Reading this cycle…' : secs < 10 ? 'Checking your categories…' : secs < 20 ? 'Writing an answer…' : 'Still working, long questions can take up to a minute…';

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

const STARTERS = ['Why am I over budget?', 'How do I finish this cycle on budget?', 'Which merchants should I cut back on?', 'Sort my Buffer transactions'];

type Props = {
  cycle: Cycle;
  budget: Budget;
  /** Every synced transaction, so suggested moves can find theirs. */
  allTxs: TxView[];
  /** Asked as soon as the panel opens (e.g. from "Why?" on Spending pace). */
  ask?: string | null;
  onClose: () => void;
};

/**
 * Chat with Gemini about this cycle. Each question goes with a summary of your spending (chatContext);
 * suggested changes come back as cards that do nothing until you tap Apply, and can be undone.
 */
export function Chat({ cycle, budget, allTxs, ask, onClose }: Props) {
  const { settings, update } = useSettings();
  const { notes } = useData();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ kind: 'no_key' | 'api' | 'blocked' | 'network' | 'slow'; detail?: string } | null>(null);
  /** Seconds waited for the current answer, shown while thinking. */
  const [waited, setWaited] = useState(0);
  /** The question being answered; an answer for an older one (after a timeout or New chat) is dropped. */
  const asking = useRef(0);
  const [withNotes, setWithNotes] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const send = async (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    const next: ChatMessage[] = [...messages, { role: 'user', text: question }];
    setMessages(next);
    setText('');
    setProblem(null);
    setBusy(true);
    setWaited(0);
    const id = ++asking.current;
    const timeout = new Promise<'slow'>(r => setTimeout(() => r('slow'), TIMEOUT_MS));
    try {
      const a = await Promise.race([askGemini(next, chatContext({ cycle, budget, settings, notes, withNotes })), timeout]);
      if (id !== asking.current) return;
      if (a === 'slow') setProblem({ kind: 'slow' });
      else if ('error' in a) setProblem({ kind: a.error, detail: a.detail });
      else setMessages([...next, { role: 'model', text: a.reply, actions: a.actions, model: a.model }]);
    } catch (e) {
      if (id === asking.current) setProblem({ kind: 'network', detail: e instanceof Error ? e.message : String(e) });
    } finally {
      if (id === asking.current) setBusy(false);
    }
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

  return (
    <div className={s.chatOverlay} onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <section className={`${s.chatPanel} fade-in`} role="dialog" aria-modal="true" aria-label="Ask Maxie">
        <header className={s.chatHead}>
          <span className={s.chatMark} style={{ overflow: 'hidden', padding: 0 }}>
            <Logo size={32} />
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', marginRight: 'auto', minWidth: 0 }}>
            <strong style={{ fontFamily: 'var(--font-serif)', fontSize: 20, fontWeight: 500 }}>Maxie</strong>
            <span style={{ fontSize: 12, color: C.textMuted }}>About this cycle's spending</span>
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
              }}
            >
              New chat
            </button>
          )}
          <button type="button" className={s.iconBtn} onClick={onClose} aria-label="Close" title="Close">
            <Icon d={IC.close} size={18} strokeWidth={2.5} />
          </button>
        </header>

        <div ref={list} className={s.chatList} aria-live="polite">
          {messages.length === 0 && !busy && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '8px 0' }}>
              <span style={{ fontSize: 14, color: C.textSoft }}>Ask about your spending, or start with one of these:</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {STARTERS.map(q => (
                  <button key={q} type="button" className={s.chatStarter} onClick={() => send(q)}>
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className={s.chatMine}>
                {m.text}
              </div>
            ) : (
              <div key={i} className={s.chatTheirsRow}>
                <Logo size={28} />
                <div className={s.chatTheirs}>
                  <Rich text={m.text} />
                  {(m.actions ?? []).map((a, j) => (
                    <ActionCard key={j} action={a} allTxs={allTxs} />
                  ))}
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
                        <Icon d={r === 'up' ? IC.thumbUp : IC.thumbDown} size={16} />
                      </button>
                    ))}
                    {m.rating && <span className={s.chatRateNote}>{m.rating === 'up' ? 'Thanks, noted.' : "Thanks, I'll do better."}</span>}
                  </span>
                </div>
              </div>
            ),
          )}
          {busy && (
            <div className={s.chatTheirsRow} role="status" aria-live="polite">
              <Logo size={28} />
              <span className={s.thinking}>
                <span className={s.thinkLabel}>{thinkingLabel(waited)}</span>
                <ThinkingArcs />
              </span>
            </div>
          )}
          {problem && <Problem p={problem} onRetry={() => messages.length && send(messages[messages.length - 1].text)} />}
        </div>

        <form
          className={s.chatForm}
          onSubmit={e => {
            e.preventDefault();
            void send(text);
          }}
        >
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <textarea
              ref={input}
              className={s.chatInput}
              rows={1}
              value={text}
              maxLength={1000}
              placeholder="Ask Maxie anything"
              aria-label="Your question"
              onChange={e => setText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send(text);
                }
              }}
            />
            <button type="submit" className={s.chatSend} disabled={!text.trim() || busy} aria-label="Send">
              <Icon d={IC.send} size={17} />
            </button>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.textMuted }}>
            <input type="checkbox" checked={withNotes} onChange={e => setWithNotes(e.target.checked)} />
            Include my notes. Maxie runs on Google Gemini: this cycle's spending summary is sent there
          </label>
          <span className={s.chatDisclosure}>Maxie is AI and can get things wrong, so double-check anything important.</span>
        </form>
      </section>
    </div>
  );
}

/** Gemini's text: paragraphs, "- " bullets and **bold**. */
export function Rich({ text }: { text: string }) {
  const inline = (line: string): ReactNode[] => line.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part));
  const lines = text.split('\n').filter(l => l.trim());
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {lines.map((l, i) =>
        /^\s*[-*•]\s+/.test(l) ? (
          <div key={i} style={{ display: 'flex', gap: 8 }}>
            <span aria-hidden="true">•</span>
            <span>{inline(l.replace(/^\s*[-*•]\s+/, ''))}</span>
          </div>
        ) : (
          <p key={i} style={{ margin: 0 }}>
            {inline(l)}
          </p>
        ),
      )}
    </div>
  );
}

export function Problem({ p, onRetry }: { p: { kind: string; detail?: string }; onRetry: () => void }) {
  if (p.kind === 'no_key')
    return (
      <div className={s.chatNote}>
        <strong>Maxie isn't set up yet.</strong>
        <span>
          Create an API key in Google AI Studio, then in the Apps Script editor open <strong>Project Settings → Script properties</strong> and add{' '}
          <code>GEMINI_API_KEY</code> with your key. Then ask again.
        </span>
      </div>
    );
  if (p.kind === 'slow')
    return (
      <div className={s.chatNote}>
        <strong>Maxie is taking too long.</strong>
        <span>
          Try again. If it keeps happening, switch to the faster model: in <strong>Script properties</strong> add <code>GEMINI_MODEL</code> ={' '}
          <code>gemini-3.5-flash-lite</code>.
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

/** A change Gemini suggests: what it does and why, Apply, then Undo. Suggestions that don't fit your data aren't shown. */
export function ActionCard({ action: a, allTxs }: { action: ChatAction; allTxs: TxView[] }) {
  const { settings, short, ofIncome } = useSettings();
  const { rules, ruleSubs, subs, setRules, setSub, setOverride } = useData();
  const setLimits = useSetLimits();
  const [undo, setUndo] = useState<(() => void) | null>(null);
  const [done, setDone] = useState(false);
  const subOf = (cat: string, sub?: string | null) => (sub ? settings.subcategories[cat]?.find(x => x.toLowerCase() === sub.trim().toLowerCase()) : undefined);

  let title: ReactNode = null;
  let apply: (() => () => void) | null = null;
  if (a.type === 'rule') {
    const cat = known(a.category);
    const key = merchantKey(a.merchant ?? '');
    if (cat && key) {
      const sub = subOf(cat, a.sub);
      title = (
        <>
          Always put <strong>{a.merchant}</strong> in <strong>{categoryLabel(cat)}{sub ? ' › ' + sub : ''}</strong>
        </>
      );
      apply = () => {
        const prev = Object.entries(rules).find(([m]) => merchantKey(m) === key);
        const prevSub = Object.entries(ruleSubs).find(([m]) => merchantKey(m) === key)?.[1] ?? null;
        setRules({ [key]: cat }, { [key]: sub ?? null });
        return () => (prev ? setRules({ [prev[0]]: prev[1] }, { [prev[0]]: prevSub }) : setRules({ [key]: null }));
      };
    }
  } else if (a.type === 'recategorize') {
    const cat = known(a.category);
    const txs = (a.txIds ?? []).map(id => allTxs.find(t => t.id === id)).filter((t): t is TxView => !!t && !t.isCcPayment);
    if (cat && txs.length) {
      const sub = subOf(cat, a.sub);
      title = (
        <>
          Move {txs.length === 1 ? <strong>{tidyName(txs[0].title)}</strong> : <strong>{txs.length} transactions</strong>} to <strong>{categoryLabel(cat)}{sub ? ' › ' + sub : ''}</strong>
        </>
      );
      apply = () => {
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
      };
    }
  } else if (a.type === 'move_limit') {
    const from = categoryByName(known(a.from) ?? '');
    const to = categoryByName(known(a.to) ?? '');
    const amount = Math.min(Number(a.amount) || 0, from ? ofIncome(from.limitPct) : 0);
    if (from && to && from !== to && amount > 0) {
      title = (
        <>
          Move <strong>{short(amount)}</strong> of limit from <strong>{from.name}</strong> to <strong>{to.name}</strong>
        </>
      );
      apply = () => {
        // In % of income, rounded up so the whole amount moves.
        const pct = Math.ceil((amount / ofIncome(1)) * 100) / 100;
        setLimits({ [to.name]: to.limitPct + pct, [from.name]: Math.max(0, from.limitPct - pct) });
        return () => setLimits({ [to.name]: to.limitPct, [from.name]: from.limitPct });
      };
    }
  }
  if (!apply) return null;

  return (
    <div className={s.chatAction}>
      <span style={{ fontSize: 14 }}>{title}</span>
      {a.why && <span style={{ fontSize: 13, color: C.textMuted }}>{a.why}</span>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {!done ? (
          <button
            type="button"
            className={s.btnPrimarySm}
            onClick={() => {
              setUndo(() => apply!());
              setDone(true);
            }}
          >
            Apply
          </button>
        ) : (
          <>
            <span style={{ fontSize: 13, fontWeight: 600, color: C.good }}>✓ Applied</span>
            {undo && (
              <button
                type="button"
                className={s.textBtnSm}
                onClick={() => {
                  undo();
                  setUndo(null);
                  setDone(false);
                }}
              >
                Undo
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
