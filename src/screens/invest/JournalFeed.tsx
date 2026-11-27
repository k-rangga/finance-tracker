import { useEffect, useMemo, useRef, useState } from 'react';
import s from '../../styles/ui.module.css';
import { Card } from '../../components/ui';
import { Logo } from '../../components/Logo';
import { Select } from '../../components/Select';
import { IC, Icon } from '../../components/Icon';
import { toISO } from '../../lib/format';
import { haptic } from '../../lib/haptics';
import { draftJournalMonth, getJournalMonths, setJournalMonth } from '../../lib/perps';
import { useSettings } from '../../lib/settings';
import { C, plInk } from '../../lib/tokens';
import { FP_COLORS } from './Journal';
import { needsReview, reviewStats, SOURCE_NAME, type AnyTrade, type Source } from './trades';

type Props = {
  account: Source;
  /** This account's trades (all of them; the Journal picks the month). */
  items: AnyTrade[];
  /** Money from rupiah, in the account's own currency. */
  dS: (idr: number, signed?: boolean) => string;
  /** Opens the quick review, when trades are waiting. */
  onReview?: () => void;
  /** Jump to a specific trade in the Trades tab. */
  onOpenTrade?: (key: string) => void;
  /** Open the New Entry modal (Stocks & crypto). */
  onNewEntry?: () => void;
};

type FreeEntry = { id: string; key: string; d: string; mood?: string; text: string };
type TimelineItem =
  | { kind: 'trade'; date: Date; trade: AnyTrade; isOpen: boolean; isReviewed: boolean }
  | { kind: 'free'; date: Date; entry: FreeEntry };

const MOODS = ['Calm', 'Patient', 'Focused', 'Cautious', 'FOMO'] as const;
const MONTH_STARTERS = ['What worked well:\n', 'Biggest lesson:\n', 'One rule for next month:\n'];
const FREE_STARTERS = ['Market read: ', 'Mindset check: ', 'Sitting on hands today: '];
const MAXIE_PROMPTS = [
  'What made you feel most calm or rushed this month?',
  'Which decision would you gladly repeat tomorrow?',
  'Did you stick to your stops and sizing when it mattered?',
  'What is one habit worth carrying into next month?',
];

const monthOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const monthName = (m: string) => new Date(Number(m.slice(0, 4)), Number(m.slice(5)) - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
const dayName = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
/** Monday of the date's week. */
const weekOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
const reviewed = (t: AnyTrade) => !!t.closed && !needsReview(t) && !!(t.followed || t.setup || t.mistakes.length || t.lesson || t.rating);

function parseFreeEntries(notes: Record<string, string> | null, account: Source, month: string): FreeEntry[] {
  if (!notes) return [];
  const prefix = `free|${account}|${month}|`;
  const out: FreeEntry[] = [];
  for (const [k, raw] of Object.entries(notes)) {
    if (!k.startsWith(prefix) || !raw) continue;
    try {
      const parsed = JSON.parse(raw) as { d?: string; mood?: string; text?: string };
      if (!parsed.text?.trim()) continue;
      out.push({ id: k.slice(prefix.length), key: k, d: parsed.d || `${month}-01`, mood: parsed.mood, text: parsed.text });
    } catch {
      /* ignore malformed entry */
    }
  }
  return out.sort((a, b) => b.d.localeCompare(a.d) || b.id.localeCompare(a.id));
}

/**
 * The journal to read & write: a month of your trades (open theses + closed trades + reviews) and
 * free-form reflections, sorted by week, plus your warm monthly note on top.
 */
export function JournalFeed({ account, items, dS, onReview, onOpenTrade, onNewEntry }: Props) {
  const { settings } = useSettings();
  const [notes, setNotes] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    getJournalMonths()
      .then(setNotes)
      .catch(() => setNotes({}));
  }, []);

  const months = useMemo(() => {
    const set = new Set<string>();
    for (const t of items) {
      set.add(monthOf(t.closed ?? t.opened));
      set.add(monthOf(t.opened));
    }
    if (notes) {
      const freePrefix = `free|${account}|`;
      for (const k of Object.keys(notes)) {
        if (k.startsWith(freePrefix)) {
          const m = k.slice(freePrefix.length).split('|')[0];
          if (/^\d{4}-\d{2}$/.test(m)) set.add(m);
        }
      }
    }
    set.add(monthOf(new Date()));
    return [...set].sort().reverse();
  }, [items, notes, account]);

  const [month, setMonth] = useState(months[0]);
  const [tag, setTag] = useState('');
  const [scope, setScope] = useState<'all' | 'reviewed'>('all');

  const closedInMonth = items.filter(t => t.closed && monthOf(t.closed) === month);
  const openInMonth = items.filter(t => !t.closed && monthOf(t.opened) === month);
  const st = reviewStats(closedInMonth);
  const reviewedCount = closedInMonth.filter(reviewed).length;
  const waiting = closedInMonth.filter(needsReview).length;
  const topMistake = [...st.byMistake].sort((a, b) => b.trades - a.trades || a.pnl - b.pnl)[0];

  const freeEntries = useMemo(() => parseFreeEntries(notes, account, month), [notes, account, month]);
  const allMonthTrades = useMemo(() => {
    if (scope === 'reviewed') return closedInMonth.filter(reviewed);
    return [...closedInMonth, ...openInMonth];
  }, [scope, closedInMonth, openInMonth]);

  const tags = useMemo(
    () =>
      [
        ...new Set([
          ...allMonthTrades.flatMap(t => [...(t.setup ? [t.setup] : []), ...t.mistakes]),
          ...freeEntries.map(f => f.mood).filter((x): x is string => !!x),
        ]),
      ].sort(),
    [allMonthTrades, freeEntries],
  );

  // Unified chronological timeline: trades + free entries.
  const timeline = useMemo(() => {
    const rows: TimelineItem[] = [];
    for (const t of allMonthTrades) {
      if (tag && t.setup !== tag && !t.mistakes.includes(tag)) continue;
      rows.push({
        kind: 'trade',
        date: t.closed ?? t.opened,
        trade: t,
        isOpen: !t.closed,
        isReviewed: reviewed(t),
      });
    }
    for (const entry of freeEntries) {
      if (tag && entry.mood !== tag) continue;
      rows.push({
        kind: 'free',
        date: new Date(entry.d + 'T12:00:00'),
        entry,
      });
    }
    return rows.sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [allMonthTrades, freeEntries, tag]);

  // By week, newest first.
  const weeks: { start: Date; list: TimelineItem[] }[] = [];
  for (const item of timeline) {
    const w = weekOf(item.date);
    const last = weeks[weeks.length - 1];
    if (last && last.start.getTime() === w.getTime()) last.list.push(item);
    else weeks.push({ start: w, list: [item] });
  }

  // Monthly note: loaded once, saved a moment after you stop typing.
  const [note, setNote] = useState('');
  const [noteState, setNoteState] = useState<'' | 'saving' | 'saved' | 'error'>('');
  const [drafting, setDrafting] = useState(false);
  const [draftErr, setDraftErr] = useState('');
  const key = `${account}|${month}`;
  useEffect(() => {
    setNote(notes?.[key] ?? '');
    setNoteState('');
  }, [notes, key]);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const editNote = (v: string) => {
    setNote(v);
    setNoteState('saving');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setNotes(n => ({ ...(n ?? {}), [key]: v }));
      setJournalMonth(key, v)
        .then(() => setNoteState('saved'))
        .catch(() => setNoteState('error'));
    }, 800);
  };
  const appendMonthStarter = (s0: string) => {
    haptic('tick', settings.quietMode);
    const cur = note.trimEnd();
    editNote(cur ? `${cur}\n\n${s0}` : s0);
    noteBox.current?.focus();
  };
  const noteBox = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = noteBox.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.max(84, el.scrollHeight + 2) + 'px';
  }, [note]);

  // Free-form quick reflection composer.
  const todayStr = toISO(new Date());
  const defaultFreeDate = todayStr.startsWith(month) ? todayStr : `${month}-01`;
  const [writingFree, setWritingFree] = useState(false);
  const [freeDate, setFreeDate] = useState(defaultFreeDate);
  const [freeMood, setFreeMood] = useState('');
  const [freeText, setFreeText] = useState('');
  const [savingFree, setSavingFree] = useState(false);
  useEffect(() => {
    setFreeDate(todayStr.startsWith(month) ? todayStr : `${month}-01`);
  }, [month, todayStr]);

  const saveFree = async () => {
    const trimmed = freeText.trim();
    if (!trimmed) return;
    setSavingFree(true);
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const entryMonth = freeDate.slice(0, 7) || month;
    const entryKey = `free|${account}|${entryMonth}|${id}`;
    const payload = JSON.stringify({ d: freeDate, ...(freeMood ? { mood: freeMood } : {}), text: trimmed });
    try {
      await setJournalMonth(entryKey, payload);
      setNotes(n => ({ ...(n ?? {}), [entryKey]: payload }));
      haptic('success', settings.quietMode);
      setFreeText('');
      setFreeMood('');
      setWritingFree(false);
    } finally {
      setSavingFree(false);
    }
  };

  const deleteFree = async (entryKey: string) => {
    haptic('tick', settings.quietMode);
    setNotes(n => {
      const next = { ...(n ?? {}) };
      delete next[entryKey];
      return next;
    });
    await setJournalMonth(entryKey, '');
  };

  /** The month as plain text: numbers, note, then every trade & reflection. */
  const asText = () =>
    [
      `${SOURCE_NAME[account]} journal, ${monthName(month)}`,
      `${st.count} closed trades, ${st.winRate == null ? '—' : Math.round(st.winRate) + '% wins'}, ${dS(st.pnl, true)}${st.followedPct != null ? `, plan followed ${Math.round(st.followedPct)}%` : ''}`,
      ...(topMistake ? [`Most repeated mistake: ${topMistake.key} (${topMistake.trades}×, ${dS(topMistake.pnl, true)})`] : []),
      ...(note.trim() ? ['', note.trim()] : []),
      '',
      ...timeline.map(item => {
        if (item.kind === 'free') {
          const e = item.entry;
          return `${dayName(item.date)} [Note${e.mood ? ` · ${e.mood}` : ''}]: ${e.text}`;
        }
        const t = item.trade;
        if (item.isOpen) {
          return `${dayName(item.date)}, ${t.name} ${t.side} (Open)${t.manual?.th ? `\n  Thesis: "${t.manual.th}"` : ''}`;
        }
        return (
          `${dayName(item.date)}, ${t.name} ${t.side}, ${dS(t.pnl, true)}` +
          [t.followed && `plan: ${t.followed}`, t.setup, ...t.mistakes].filter(Boolean).map(x => `, ${x}`).join('') +
          (t.lesson ? `\n  "${t.lesson}"` : '')
        );
      }),
    ].join('\n');

  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(asText());
      haptic('tap', settings.quietMode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt('Copy your journal:', asText());
    }
  };
  const draft = async () => {
    setDrafting(true);
    setDraftErr('');
    try {
      const r = await draftJournalMonth(asText());
      if (!r.text) setDraftErr(r.error === 'no_key' ? 'Maxie needs its Gemini API key first (GEMINI_API_KEY).' : "Maxie couldn't write a draft. Try again.");
      else {
        haptic('success', settings.quietMode);
        editNote(note.trim() ? `${note.trim()}\n\n${r.text}` : r.text);
      }
    } catch (e) {
      setDraftErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDrafting(false);
    }
  };

  const promptIdx = (Number(month.slice(5)) + new Date().getDate()) % MAXIE_PROMPTS.length;
  const maxiePrompt = MAXIE_PROMPTS[promptIdx];

  return (
    <div className={s.stack}>
      <div className={s.invJournalBar}>
        <div className={s.invFilters} style={{ flex: 1, minWidth: 0 }}>
          <Select ariaLabel="Month" value={month} onChange={m => (setMonth(m), setTag(''))} options={months.map(m => ({ value: m, label: monthName(m) }))} />
          <Select ariaLabel="Tag" value={tag} onChange={setTag} options={[{ value: '', label: 'All tags' }, ...tags.map(x => ({ value: x, label: x }))]} />
          <div className={s.segment} role="group" aria-label="Entries shown">
            <button type="button" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>
              All activity
            </button>
            <button type="button" aria-pressed={scope === 'reviewed'} onClick={() => setScope('reviewed')}>
              Reviewed
            </button>
          </div>
        </div>
        <button type="button" className={s.btnOutlineSm} style={{ minHeight: 40 }} onClick={copy} disabled={!timeline.length && !note.trim()}>
          <Icon d={IC.copy} size={15} />
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      {/* Warm monthly reflection card */}
      <Card className={s.journalPaper} style={{ gap: 14 }}>
        <div className={s.cardHead}>
          <h2 className={s.h2}>{monthName(month)}</h2>
          <span className={s.caption}>{SOURCE_NAME[account]}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 15 }}>
            {st.count ? (
              <>
                {st.count} closed, {Math.round(st.winRate ?? 0)}% wins,{' '}
                <strong style={{ color: plInk(st.pnl), fontWeight: 600 }}>{dS(st.pnl, true)}</strong>
                {st.followedPct != null && `, plan followed ${Math.round(st.followedPct)}%`}
              </>
            ) : openInMonth.length > 0 ? (
              <span style={{ color: C.textSoft }}>{openInMonth.length} open {openInMonth.length === 1 ? 'position' : 'positions'} this month</span>
            ) : (
              <span style={{ color: C.textMuted }}>A fresh page for {monthName(month)}.</span>
            )}
          </span>
          {(closedInMonth.length > 0 || freeEntries.length > 0) && (
            <span className={s.journalProgressPill}>
              {closedInMonth.length > 0 ? `${reviewedCount}/${closedInMonth.length} reviewed` : null}
              {closedInMonth.length > 0 && freeEntries.length > 0 ? ' · ' : null}
              {freeEntries.length > 0 ? `${freeEntries.length} ${freeEntries.length === 1 ? 'note' : 'notes'}` : null}
            </span>
          )}
        </div>
        {topMistake && (
          <span style={{ fontSize: 14, color: C.textSoft }}>
            Most repeated mistake: <strong style={{ color: C.redInk, fontWeight: 600 }}>{topMistake.key}</strong> ({topMistake.trades}×, {dS(topMistake.pnl, true)})
          </span>
        )}
        <div className={s.journalPromptBar}>
          <Logo size={22} mood="curious" />
          <span>{maxiePrompt}</span>
        </div>
        <label className={s.field} style={{ gap: 6 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ marginRight: 'auto' }}>Monthly reflection</span>
            <span style={{ fontSize: 12, fontWeight: 400, color: noteState === 'error' ? C.redInk : noteState === 'saved' ? C.good : C.textMuted }}>
              {noteState === 'saving' ? 'Saving…' : noteState === 'saved' ? 'Saved' : noteState === 'error' ? 'Not saved' : ''}
            </span>
          </span>
          <textarea
            ref={noteBox}
            className={`${s.input} ${s.journalTextarea}`}
            value={note}
            onChange={e => editNote(e.target.value)}
            placeholder="Jot down what worked, what felt off, or one rule to keep next month…"
            style={{ resize: 'none', minHeight: 84 }}
            disabled={notes == null}
          />
        </label>
        <div className={s.invStarterRow} aria-label="Reflection starters">
          {MONTH_STARTERS.map(st0 => (
            <button key={st0} type="button" className={s.invStarterChip} onClick={() => appendMonthStarter(st0)}>
              + {st0.replace(':\n', '')}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            className={s.btnOutlineSm}
            onClick={() => {
              haptic('tap', settings.quietMode);
              setWritingFree(v => !v);
            }}
          >
            <Icon d={writingFree ? IC.close : IC.plus} size={14} />
            {writingFree ? 'Close note' : 'Write a free note'}
          </button>
          <button
            type="button"
            className={s.btnOutlineSm}
            onClick={draft}
            disabled={drafting || (!timeline.length && !note.trim())}
            title={!timeline.length ? 'Add a trade or note first so Maxie has context' : undefined}
          >
            <Icon d={IC.sparkle} size={14} />
            {drafting ? 'Drafting…' : 'Draft with Maxie'}
          </button>
          {draftErr && <span style={{ fontSize: 13, color: C.redInk }}>{draftErr}</span>}
          {waiting > 0 && onReview && (
            <button type="button" className={s.textBtnSm} style={{ marginLeft: 'auto' }} onClick={onReview}>
              {waiting} trade{waiting === 1 ? '' : 's'} still to review →
            </button>
          )}
        </div>
      </Card>

      {/* Free-form journal entry composer */}
      {writingFree && (
        <Card className={s.journalFreeCard} style={{ gap: 12 }}>
          <div className={s.cardHead}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>New reflection</span>
            <input type="date" className={s.input} value={freeDate} onChange={e => setFreeDate(e.target.value)} aria-label="Reflection date" style={{ width: 'auto', minHeight: 36, padding: '4px 10px', fontSize: 13 }} />
          </div>
          <div className={s.invStarterRow} role="group" aria-label="Mindset">
            {MOODS.map(m => (
              <button
                key={m}
                type="button"
                className={s.journalMoodChip}
                aria-pressed={freeMood === m}
                onClick={() => setFreeMood(freeMood === m ? '' : m)}
              >
                {m}
              </button>
            ))}
          </div>
          <textarea
            className={`${s.input} ${s.journalTextarea}`}
            rows={3}
            value={freeText}
            onChange={e => setFreeText(e.target.value)}
            placeholder="A market observation, a trade you skipped, or how you're feeling today…"
            autoFocus
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {FREE_STARTERS.map(st0 => (
              <button
                key={st0}
                type="button"
                className={s.invStarterChip}
                onClick={() => setFreeText(prev => (prev.trim() ? `${prev.trimEnd()}\n${st0}` : st0))}
              >
                + {st0.replace(': ', '')}
              </button>
            ))}
            <button
              type="button"
              className={s.btnPrimarySm}
              style={{ marginLeft: 'auto' }}
              disabled={savingFree || !freeText.trim()}
              onClick={() => void saveFree()}
            >
              {savingFree ? 'Saving…' : 'Save note'}
            </button>
          </div>
        </Card>
      )}

      {weeks.length === 0 ? (
        <Card>
          <div className={s.mxEmptyInline} style={{ padding: 0, flexWrap: 'wrap', gap: 12 }}>
            <Logo size={30} mood="curious" interactive cheer="Every great investor keeps notes." />
            <span style={{ flex: '1 1 200px' }}>
              {tag
                ? `No entries tagged ${tag} in ${monthName(month)}.`
                : scope === 'reviewed' && (closedInMonth.length > 0 || openInMonth.length > 0)
                  ? `No reviewed trades yet — switch to "All activity" to see your ${closedInMonth.length + openInMonth.length} trades.`
                  : `Nothing logged in ${monthName(month)} yet. Write a quick note or log a position to start your story.`}
            </span>
            <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
              {!writingFree && (
                <button type="button" className={s.btnOutlineSm} onClick={() => setWritingFree(true)}>
                  Write a note
                </button>
              )}
              {onNewEntry && (
                <button type="button" className={s.btnPrimarySm} onClick={onNewEntry}>
                  + New entry
                </button>
              )}
            </span>
          </div>
        </Card>
      ) : (
        weeks.map(w => (
          <section key={w.start.getTime()} className={s.feedWeek}>
            <h3 className={s.feedWeekHead}>Week of {dayName(w.start)}</h3>
            {w.list.map(item => {
              if (item.kind === 'free') {
                const e = item.entry;
                return (
                  <article key={e.key} className={`${s.feedEntry} ${s.feedEntryFree}`}>
                    <div className={s.feedTop}>
                      <span className={s.feedDate}>{dayName(item.date)}</span>
                      <span className={s.tradeChip} style={{ background: 'var(--accent-tint)', color: 'var(--accent-800)' }}>
                        Note
                      </span>
                      {e.mood && <span className={s.tradeChip}>{e.mood}</span>}
                      <button
                        type="button"
                        className={s.iconBtnSm}
                        style={{ marginLeft: 'auto' }}
                        aria-label="Delete note"
                        title="Delete note"
                        onClick={() => void deleteFree(e.key)}
                      >
                        <Icon d={IC.close} size={14} />
                      </button>
                    </div>
                    <p className={s.feedLesson}>{e.text}</p>
                  </article>
                );
              }
              const t = item.trade;
              return (
                <article
                  key={t.key}
                  className={s.feedEntry}
                  style={onOpenTrade ? { cursor: 'pointer' } : undefined}
                  onClick={() => onOpenTrade?.(t.key)}
                >
                  <div className={s.feedTop}>
                    <span className={s.feedDate}>{dayName(item.date)}</span>
                    <span style={{ fontWeight: 600 }}>{t.name}</span>
                    <span style={{ color: C.textMuted }}>{t.side}</span>
                    {item.isOpen ? (
                      <span className={s.tradeChip} style={{ marginLeft: 'auto', background: 'var(--good-soft)', color: 'var(--good)' }}>
                        Open
                      </span>
                    ) : (
                      <span style={{ marginLeft: 'auto', fontWeight: 600, color: plInk(t.pnl), whiteSpace: 'nowrap' }}>{dS(t.pnl, true)}</span>
                    )}
                  </div>
                  <div className={s.tradeTags} style={{ marginTop: 0 }}>
                    {t.followed && (
                      <span className={s.tradeChip} style={{ background: FP_COLORS[t.followed][0], color: FP_COLORS[t.followed][1] }}>
                        Plan: {t.followed}
                      </span>
                    )}
                    {t.setup && <span className={s.tradeChip}>{t.setup}</span>}
                    {t.mistakes.map(m => (
                      <span key={m} className={s.tradeChip} style={{ background: C.redTint, color: C.redInk }}>
                        {m}
                      </span>
                    ))}
                    {!item.isOpen && !item.isReviewed && (
                      <span className={s.tradeChip} style={{ background: 'var(--amber-tint)', color: 'var(--amber-ink)' }}>
                        Needs review →
                      </span>
                    )}
                  </div>
                  {item.isOpen && t.manual?.th && <p className={s.feedLesson}>Thesis: “{t.manual.th}”</p>}
                  {!item.isOpen && t.lesson && <p className={s.feedLesson}>“{t.lesson}”</p>}
                </article>
              );
            })}
          </section>
        ))
      )}
    </div>
  );
}
