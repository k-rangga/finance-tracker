import { useEffect, useMemo, useRef, useState } from 'react';
import s from '../../styles/ui.module.css';
import { Card } from '../../components/ui';
import { Select } from '../../components/Select';
import { IC, Icon } from '../../components/Icon';
import { draftJournalMonth, getJournalMonths, setJournalMonth } from '../../lib/perps';
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
};

const monthOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const monthName = (m: string) => new Date(Number(m.slice(0, 4)), Number(m.slice(5)) - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
const dayName = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
/** Monday of the date's week. */
const weekOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
const reviewed = (t: AnyTrade) => !!t.closed && !needsReview(t) && !!(t.followed || t.setup || t.mistakes.length || t.lesson || t.rating);

/**
 * The journal to read: a month of your reviewed trades as a diary, newest first and by week, with the month's
 * numbers, your most repeated mistake and your note on the month on top. Copy takes it all as plain text.
 */
export function JournalFeed({ account, items, dS, onReview }: Props) {
  const months = useMemo(() => {
    const set = new Set(items.filter(t => t.closed).map(t => monthOf(t.closed!)));
    set.add(monthOf(new Date()));
    return [...set].sort().reverse();
  }, [items]);
  const [month, setMonth] = useState(months[0]);
  const [tag, setTag] = useState('');

  const inMonth = items.filter(t => t.closed && monthOf(t.closed) === month);
  const st = reviewStats(inMonth);
  const entries = inMonth.filter(reviewed).sort((a, b) => b.closed!.getTime() - a.closed!.getTime());
  const tags = [...new Set(entries.flatMap(t => [...(t.setup ? [t.setup] : []), ...t.mistakes]))].sort();
  const shown = tag ? entries.filter(t => t.setup === tag || t.mistakes.includes(tag)) : entries;
  const waiting = inMonth.filter(needsReview).length;
  const topMistake = [...st.byMistake].sort((a, b) => b.trades - a.trades || a.pnl - b.pnl)[0];

  // By week, newest first.
  const weeks: { start: Date; list: AnyTrade[] }[] = [];
  for (const t of shown) {
    const w = weekOf(t.closed!);
    const last = weeks[weeks.length - 1];
    if (last && last.start.getTime() === w.getTime()) last.list.push(t);
    else weeks.push({ start: w, list: [t] });
  }

  // The month's note: loaded once, saved a moment after you stop typing.
  const [notes, setNotes] = useState<Record<string, string> | null>(null);
  const [note, setNote] = useState('');
  const [noteState, setNoteState] = useState<'' | 'saving' | 'saved' | 'error'>('');
  const [drafting, setDrafting] = useState(false);
  const [draftErr, setDraftErr] = useState('');
  const key = `${account}|${month}`;
  useEffect(() => {
    getJournalMonths()
      .then(setNotes)
      .catch(() => setNotes({}));
  }, []);
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
  const noteBox = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = noteBox.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.max(72, el.scrollHeight + 2) + 'px';
  }, [note]);

  /** The month as plain text: numbers, note, then every entry. */
  const asText = () =>
    [
      `${SOURCE_NAME[account]} journal, ${monthName(month)}`,
      `${st.count} trades, ${st.winRate == null ? '—' : Math.round(st.winRate) + '% wins'}, ${dS(st.pnl, true)}${st.followedPct != null ? `, plan followed ${Math.round(st.followedPct)}%` : ''}`,
      ...(topMistake ? [`Most repeated mistake: ${topMistake.key} (${topMistake.trades}×, ${dS(topMistake.pnl, true)})`] : []),
      ...(note.trim() ? ['', note.trim()] : []),
      '',
      ...entries.map(
        t =>
          `${dayName(t.closed!)}, ${t.name} ${t.side}, ${dS(t.pnl, true)}` +
          [t.followed && `plan: ${t.followed}`, t.setup, ...t.mistakes].filter(Boolean).map(x => `, ${x}`).join('') +
          (t.lesson ? `\n  "${t.lesson}"` : ''),
      ),
    ].join('\n');
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(asText());
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
      else editNote(note.trim() ? `${note.trim()}\n\n${r.text}` : r.text);
    } catch (e) {
      setDraftErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDrafting(false);
    }
  };

  return (
    <div className={s.stack}>
      <div className={s.invFilters}>
        <Select ariaLabel="Month" value={month} onChange={m => (setMonth(m), setTag(''))} options={months.map(m => ({ value: m, label: monthName(m) }))} />
        <Select ariaLabel="Tag" value={tag} onChange={setTag} options={[{ value: '', label: 'All tags' }, ...tags.map(x => ({ value: x, label: x }))]} />
        <button type="button" className={s.btnOutlineSm} style={{ marginLeft: 'auto', minHeight: 44 }} onClick={copy} disabled={!entries.length && !note.trim()}>
          <Icon d={IC.copy} size={15} />
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <Card style={{ gap: 14 }}>
        <div className={s.cardHead}>
          <h2 className={s.h2}>{monthName(month)}</h2>
          <span className={s.caption}>{SOURCE_NAME[account]}</span>
        </div>
        <span style={{ fontSize: 15 }}>
          {st.count ? (
            <>
              {st.count} trades, {Math.round(st.winRate ?? 0)}% wins,{' '}
              <strong style={{ color: plInk(st.pnl), fontWeight: 600 }}>{dS(st.pnl, true)}</strong>
              {st.followedPct != null && `, plan followed ${Math.round(st.followedPct)}%`}
            </>
          ) : (
            <span style={{ color: C.textMuted }}>No closed trades this month yet.</span>
          )}
        </span>
        {topMistake && (
          <span style={{ fontSize: 14, color: C.textSoft }}>
            Most repeated mistake: <strong style={{ color: C.redInk, fontWeight: 600 }}>{topMistake.key}</strong> ({topMistake.trades}×, {dS(topMistake.pnl, true)})
          </span>
        )}
        <label className={s.field} style={{ gap: 6 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ marginRight: 'auto' }}>Your note on the month</span>
            <span style={{ fontSize: 12, fontWeight: 400, color: noteState === 'error' ? C.redInk : noteState === 'saved' ? C.good : C.textMuted }}>
              {noteState === 'saving' ? 'Saving…' : noteState === 'saved' ? 'Saved' : noteState === 'error' ? 'Not saved' : ''}
            </span>
          </span>
          <textarea
            ref={noteBox}
            className={s.input}
            value={note}
            onChange={e => editNote(e.target.value)}
            placeholder="What worked, what to change, one rule for next month"
            style={{ resize: 'none', minHeight: 72 }}
            disabled={notes == null}
          />
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" className={s.btnOutlineSm} onClick={draft} disabled={drafting || !entries.length}>
            <Icon d={IC.sparkle} size={14} />
            {drafting ? 'Drafting…' : 'Draft with Maxie'}
          </button>
          {draftErr && <span style={{ fontSize: 13, color: C.redInk }}>{draftErr}</span>}
          {waiting > 0 && onReview && (
            <button type="button" className={s.textBtnSm} style={{ marginLeft: 'auto' }} onClick={onReview}>
              {waiting} trade{waiting === 1 ? '' : 's'} this month still to review →
            </button>
          )}
        </div>
      </Card>

      {weeks.length === 0 ? (
        <Card>
          <span style={{ color: C.textMuted, fontSize: 14 }}>
            {tag ? `No reviewed trades tagged ${tag} in ${monthName(month)}.` : `No reviewed trades in ${monthName(month)} yet. Reviews you write appear here.`}
          </span>
        </Card>
      ) : (
        weeks.map(w => (
          <section key={w.start.getTime()} className={s.feedWeek}>
            <h3 className={s.feedWeekHead}>Week of {dayName(w.start)}</h3>
            {w.list.map(t => (
              <article key={t.key} className={s.feedEntry}>
                <div className={s.feedTop}>
                  <span className={s.feedDate}>{dayName(t.closed!)}</span>
                  <span style={{ fontWeight: 600 }}>{t.name}</span>
                  <span style={{ color: C.textMuted }}>{t.side}</span>
                  <span style={{ marginLeft: 'auto', fontWeight: 600, color: plInk(t.pnl), whiteSpace: 'nowrap' }}>{dS(t.pnl, true)}</span>
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
                </div>
                {t.lesson && <p className={s.feedLesson}>“{t.lesson}”</p>}
              </article>
            ))}
          </section>
        ))
      )}
    </div>
  );
}
