import { useEffect, useMemo, useState } from 'react';
import s from '../../styles/ui.module.css';
import { IC, Icon } from '../../components/Icon';
import { Logo } from '../../components/Logo';
import {
  deleteJournalEntry,
  excerptOf,
  leadImageOf,
  listJournalEntries,
  newJournalId,
  readingTimeMinutes,
  type JournalEntry,
} from '../../lib/journal';
import { C, plInk } from '../../lib/tokens';
import { JournalImage, JournalReader } from './JournalArticle';
import { JournalEditor } from './JournalEditor';
import { needsReview, reviewStats, SOURCE_NAME, type AnyTrade, type Source } from './trades';

type Props = {
  account: 'all' | Source;
  /** All trades across accounts (used for live trade embeds, monthly recap, and Maxie drafting). */
  items: AnyTrade[];
  /** Money from rupiah, in the account's own currency. */
  dS: (idr: number, signed?: boolean) => string;
  /** Opens the quick review, when trades are waiting. */
  onReview?: () => void;
  /** Optional trade to immediately start a new journal entry from. */
  draftFromTrade?: AnyTrade | null;
  onConsumedDraftTrade?: () => void;
};

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

const monthOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/**
 * Substack-style Journal Publication:
 * - Clean editorial feed of your entries (with cover/inline thumbnails, reading time, tags, and comment counts)
 * - Click any entry for the Reader view (with inline images, embedded trade cards, and bottom Reflections/Comments)
 * - Distraction-free Editor with autosave, paste/drop image upload, live trade embeds, and Maxie drafting
 */
export function JournalFeed({ account, items, dS, onReview, draftFromTrade, onConsumedDraftTrade }: Props) {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const [mode, setMode] = useState<'feed' | 'read' | 'edit'>('feed');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draftEntry, setDraftEntry] = useState<JournalEntry | null>(null);

  const [statusFilter, setStatusFilter] = useState<'all' | 'published' | 'draft'>('all');
  const [tagFilter, setTagFilter] = useState('');
  const [query, setQuery] = useState('');

  const tradesById = useMemo(() => new Map(items.map(t => [t.key, t])), [items]);

  // Load entries from Supabase (or local fallback).
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr('');
    listJournalEntries()
      .then(list => {
        if (alive) setEntries(list);
      })
      .catch(e => {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Start a pre-filled entry when jumping from a trade ("Write in Journal").
  useEffect(() => {
    if (!draftFromTrade) return;
    const now = new Date().toISOString();
    const when = draftFromTrade.closed
      ? draftFromTrade.closed.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
      : 'Open';
    const tags = [draftFromTrade.name, ...(draftFromTrade.setup ? [draftFromTrade.setup] : [])];
    const body = [
      `[[trade:${draftFromTrade.key}]]`,
      '',
      '## Thesis & execution',
      '',
      '',
      '## What I learned',
      draftFromTrade.lesson ? `> ${draftFromTrade.lesson}` : '> ',
    ].join('\n');
    setDraftEntry({
      id: newJournalId('je'),
      account,
      title: `${draftFromTrade.name} ${draftFromTrade.side} (${when})`,
      subtitle: `${dS(draftFromTrade.pnl, true)}${draftFromTrade.setup ? ` · ${draftFromTrade.setup}` : ''}`,
      body,
      coverPath: null,
      tags,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      commentCount: 0,
    });
    setActiveId(null);
    setMode('edit');
    onConsumedDraftTrade?.();
  }, [draftFromTrade, account, dS, onConsumedDraftTrade]);

  const startNewEntry = (template?: { title?: string; subtitle?: string; body?: string; tags?: string[] }) => {
    const now = new Date().toISOString();
    setDraftEntry({
      id: newJournalId('je'),
      account,
      title: template?.title ?? '',
      subtitle: template?.subtitle ?? '',
      body: template?.body ?? '',
      coverPath: null,
      tags: template?.tags ?? [],
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      commentCount: 0,
    });
    setActiveId(null);
    setMode('edit');
  };

  const handleSaved = (saved: JournalEntry) => {
    setEntries(prev => {
      const idx = prev.findIndex(x => x.id === saved.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...saved, commentCount: prev[idx].commentCount ?? saved.commentCount ?? 0 };
        return next;
      }
      return [saved, ...prev];
    });
    setActiveId(saved.id);
    setDraftEntry(saved);
  };

  const handleDelete = async (id: string) => {
    await deleteJournalEntry(id);
    setEntries(prev => prev.filter(x => x.id !== id));
    setActiveId(null);
    setDraftEntry(null);
    setMode('feed');
  };

  const handleCommentCountChange = (entryId: string, count: number) => {
    setEntries(prev => prev.map(x => (x.id === entryId ? { ...x, commentCount: count } : x)));
  };

  const activeEntry = useMemo(
    () => (activeId ? entries.find(x => x.id === activeId) ?? draftEntry : draftEntry),
    [activeId, entries, draftEntry],
  );

  // Current month's trade recap for a gentle editorial starter.
  const curMonth = monthOf(new Date());
  const curMonthName = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const monthTrades = useMemo(() => items.filter(t => t.closed && monthOf(t.closed) === curMonth), [items, curMonth]);
  const monthStats = useMemo(() => reviewStats(monthTrades), [monthTrades]);
  const waitingReview = useMemo(() => monthTrades.filter(needsReview).length, [monthTrades]);

  const startMonthlyReview = () => {
    const topTrades = [...monthTrades].sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl)).slice(0, 3);
    const embeds = topTrades.map(t => `[[trade:${t.key}]]`).join('\n\n');
    const summaryLine = monthStats.count
      ? `${monthStats.count} closed trades · ${Math.round(monthStats.winRate ?? 0)}% wins · ${dS(monthStats.pnl, true)}`
      : account === 'all'
        ? 'Trading & investing reflection'
        : `${SOURCE_NAME[account]} reflection`;
    startNewEntry({
      title: `${curMonthName} — Trading Journal`,
      subtitle: summaryLine,
      tags: ['Monthly review'],
      body: [
        '## What worked this month',
        '',
        '- ',
        '',
        '## What to refine next month',
        '',
        '- ',
        ...(embeds ? ['', '## Key trades', '', embeds] : []),
        '',
        '> Main rule to carry forward: ',
      ].join('\n'),
    });
  };

  // All tags across entries (sorted by frequency).
  const allTags = useMemo(() => {
    const freq = new Map<string, number>();
    for (const e of entries) for (const t of e.tags) freq.set(t, (freq.get(t) ?? 0) + 1);
    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([t]) => t)
      .slice(0, 10);
  }, [entries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter(e => {
      if (statusFilter !== 'all' && e.status !== statusFilter) return false;
      if (tagFilter && !e.tags.includes(tagFilter)) return false;
      if (q) {
        const hay = `${e.title} ${e.subtitle} ${e.body} ${e.tags.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [entries, statusFilter, tagFilter, query]);

  const draftCount = useMemo(() => entries.filter(e => e.status === 'draft').length, [entries]);

  // ---- Reader View ----
  if (mode === 'read' && activeEntry) {
    return (
      <JournalReader
        entry={activeEntry}
        tradesById={tradesById}
        dS={dS}
        onBack={() => setMode('feed')}
        onEdit={() => {
          setDraftEntry(activeEntry);
          setMode('edit');
        }}
        onDelete={() => handleDelete(activeEntry.id)}
        onCommentCountChange={handleCommentCountChange}
      />
    );
  }

  // ---- Editor View ----
  if (mode === 'edit' && draftEntry) {
    return (
      <JournalEditor
        initial={draftEntry}
        trades={items}
        tradesById={tradesById}
        dS={dS}
        onSaved={handleSaved}
        onClose={latest => {
          const exists = entries.some(x => x.id === latest.id);
          if (exists) {
            setActiveId(latest.id);
            setMode('read');
          } else {
            setMode('feed');
          }
        }}
      />
    );
  }

  // ---- Publication Feed View ----
  const lowerErr = err.toLowerCase();
  const isMissingTable =
    lowerErr.includes('permission denied') ||
    (lowerErr.includes('journal_entries') && (lowerErr.includes('does not exist') || lowerErr.includes('could not find')));

  return (
    <div className={s.subWrap}>
      {/* Substack Publication Header */}
      <header className={s.subPubHead}>
        <div className={s.subPubInfo}>
          <h2 className={s.subPubTitle}>Journal</h2>
          <p className={s.subPubDesc}>
            Essays, trade reflections, charts, and hindsight notes — private to you.
          </p>
        </div>
        <div className={s.subPubActions}>
          <button type="button" className={s.btnPrimarySm} onClick={() => startNewEntry()}>
            <Icon d={IC.plus} size={14} /> New entry
          </button>
        </div>
      </header>

      {/* Compact Monthly Trade Recap Strip */}
      {monthStats.count > 0 && (
        <div className={s.subRecapBar}>
          <span>
            <strong>{curMonthName}:</strong> {monthStats.count} closed {monthStats.count === 1 ? 'trade' : 'trades'},{' '}
            {Math.round(monthStats.winRate ?? 0)}% wins,{' '}
            <strong style={{ color: plInk(monthStats.pnl) }}>{dS(monthStats.pnl, true)}</strong>
          </span>
          <span className={s.subRecapActions}>
            {waitingReview > 0 && onReview && (
              <button type="button" className={s.textBtnSm} onClick={onReview}>
                Review {waitingReview} waiting
              </button>
            )}
            <button type="button" className={s.btnOutlineSm} onClick={startMonthlyReview}>
              <Icon d={IC.edit} size={13} /> Write monthly review
            </button>
          </span>
        </div>
      )}

      {/* Search & Filter Bar */}
      {entries.length > 0 && (
        <div className={s.subFilterRow}>
          <div className={s.sxMiniSeg} role="group" aria-label="Entry status">
            <button type="button" aria-pressed={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>
              All ({entries.length})
            </button>
            <button type="button" aria-pressed={statusFilter === 'published'} onClick={() => setStatusFilter('published')}>
              Published
            </button>
            {draftCount > 0 && (
              <button type="button" aria-pressed={statusFilter === 'draft'} onClick={() => setStatusFilter('draft')}>
                Drafts ({draftCount})
              </button>
            )}
          </div>
          <label className={s.subSearch}>
            <Icon d={IC.search} size={14} color={C.textMuted} />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search entries…"
              aria-label="Search journal entries"
            />
          </label>
        </div>
      )}

      {allTags.length > 0 && (
        <div className={s.subTagFilterRow}>
          <button
            type="button"
            className={s.subTagChip}
            data-on={!tagFilter || undefined}
            onClick={() => setTagFilter('')}
          >
            All topics
          </button>
          {allTags.map(t => (
            <button
              key={t}
              type="button"
              className={s.subTagChip}
              data-on={tagFilter === t || undefined}
              onClick={() => setTagFilter(tagFilter === t ? '' : t)}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {err && (
        <div className={s.subErrBanner} role="alert">
          {isMissingTable ? (
            <>
              Run <code>supabase/journal.sql</code> once in your Supabase SQL Editor to create the{' '}
              <code>journal_entries</code>, <code>journal_comments</code> tables and <code>journal-images</code> bucket.
            </>
          ) : (
            err
          )}
        </div>
      )}

      {/* Feed List */}
      {loading ? (
        <p className={s.caption} style={{ padding: '24px 0', textAlign: 'center' }}>
          Loading your journal…
        </p>
      ) : filtered.length === 0 ? (
        <div className={s.subEmpty}>
          <Logo size={42} mood="happy" />
          <h3 className={s.subEmptyTitle}>
            {entries.length === 0 ? 'Your quiet space to think clearly' : 'No matching entries'}
          </h3>
          <p className={s.subEmptyDesc}>
            {entries.length === 0
              ? 'Write thesis notes, paste chart screenshots, embed trades, and leave dated reflections for your future self.'
              : 'Try clearing your search or tag filter.'}
          </p>
          {entries.length === 0 && (
            <div className={s.subEmptyActions}>
              <button type="button" className={s.btnPrimarySm} onClick={() => startNewEntry()}>
                <Icon d={IC.plus} size={14} /> Write first entry
              </button>
              <button type="button" className={s.btnOutlineSm} onClick={startMonthlyReview}>
                <Icon d={IC.sparkle} size={14} /> Start {curMonthName} review
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className={s.subFeedList}>
          {filtered.map(entry => {
            const lead = leadImageOf(entry);
            const excerpt = entry.subtitle || excerptOf(entry.body, 155);
            const mins = readingTimeMinutes(entry.body);
            return (
              <article
                key={entry.id}
                className={s.subFeedCard}
                onClick={() => {
                  setActiveId(entry.id);
                  setMode('read');
                }}
              >
                <div className={s.subFeedMain}>
                  <div className={s.subFeedTopMeta}>
                    {entry.status === 'draft' && <span className={s.subDraftBadge}>Draft</span>}
                    <span>{fmtDate(entry.createdAt)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{mins} min read</span>
                    {entry.tags.slice(0, 3).map(t => (
                      <span key={t} className={s.subTag}>
                        {t}
                      </span>
                    ))}
                  </div>
                  <h3 className={s.subFeedTitle}>{entry.title || 'Untitled entry'}</h3>
                  {excerpt && <p className={s.subFeedExcerpt}>{excerpt}</p>}
                  <div className={s.subFeedFoot}>
                    <span className={s.subFeedStat}>
                      <Icon d={IC.message} size={13} color={C.textMuted} />
                      {entry.commentCount ?? 0} {(entry.commentCount ?? 0) === 1 ? 'reflection' : 'reflections'}
                    </span>
                    <button
                      type="button"
                      className={s.textBtnSm}
                      onClick={e => {
                        e.stopPropagation();
                        setActiveId(entry.id);
                        setDraftEntry(entry);
                        setMode('edit');
                      }}
                    >
                      Edit
                    </button>
                  </div>
                </div>
                {lead && (
                  <div className={s.subFeedThumb}>
                    <JournalImage src={lead.src} storagePath={lead.storagePath} alt="" className={s.subFeedThumbImg} />
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
