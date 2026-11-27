import { useEffect, useState, type ReactNode } from 'react';
import s from '../../styles/ui.module.css';
import { IC, Icon } from '../../components/Icon';
import {
  addJournalComment,
  deleteJournalComment,
  listJournalComments,
  parseJournalBlocks,
  readingTimeMinutes,
  resolveJournalImageUrl,
  updateJournalComment,
  type CommentKind,
  type JournalComment,
  type JournalEntry,
} from '../../lib/journal';
import { C, plInk } from '../../lib/tokens';
import { FP_COLORS } from './Journal';
import { SOURCE_NAME, type AnyTrade } from './trades';

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

const fmtDateTime = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

/** Resolves a Supabase Storage path (or direct URL) and renders a clean editorial image. */
export function JournalImage({
  src,
  storagePath,
  alt,
  className,
  onClick,
}: {
  src: string;
  storagePath?: string;
  alt: string;
  className?: string;
  onClick?: (resolvedUrl: string) => void;
}) {
  const [url, setUrl] = useState<string | null>(storagePath ? null : src);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    if (!storagePath) {
      setUrl(src);
      return;
    }
    resolveJournalImageUrl(storagePath).then(u => {
      if (!alive) return;
      if (u) setUrl(u);
      else setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [src, storagePath]);

  if (failed) return <div className={s.subImgBroken}>Image unavailable</div>;
  if (!url) return <div className={s.subImgSkeleton} aria-label="Loading image" />;
  return (
    <img
      src={url}
      alt={alt}
      className={className}
      loading="lazy"
      onError={() => setFailed(true)}
      onClick={onClick ? () => onClick(url) : undefined}
      style={onClick ? { cursor: 'zoom-in' } : undefined}
    />
  );
}

/** Inline Markdown formatting: **bold**, *italic*, `code`, and [label](https://...). */
function renderInline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)]+\))/g);
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**') && p.length > 4) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (p.startsWith('*') && p.endsWith('*') && p.length > 2) return <em key={i}>{p.slice(1, -1)}</em>;
    if (p.startsWith('`') && p.endsWith('`') && p.length > 2)
      return (
        <code key={i} className={s.subInlineCode}>
          {p.slice(1, -1)}
        </code>
      );
    const link = p.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
    if (link)
      return (
        <a key={i} href={link[2]} target="_blank" rel="noopener noreferrer" className={s.subLink}>
          {link[1]}
        </a>
      );
    return p;
  });
}

const fmtPx = (v: number) =>
  v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : v >= 1 ? v.toFixed(2) : v.toPrecision(4);

/** Generated SVG execution/level chart for an embedded trade card (works for both Perps and Manual trades). */
function TradeMiniChart({ trade }: { trade: AnyTrade }) {
  const W = 420;
  const H = 88;
  const padX = 14;
  const padY = 14;
  const win = trade.pnl >= 0;
  const tone = win ? 'var(--good)' : 'var(--red-ink)';
  const gradId = `tr_${trade.key.replace(/[^a-zA-Z0-9]/g, '_')}`;

  if (trade.perp) {
    const p = trade.perp;
    const sorted = [...(p.fills ?? [])].sort((a, b) => a.time - b.time);
    const pts = sorted.length >= 2 ? sorted.map(f => f.px) : [p.entry, p.exit ?? p.entry];
    const min = Math.min(...pts, p.entry);
    const max = Math.max(...pts, p.entry);
    const span = Math.max(max - min, p.entry * 0.005 || 1);
    const xOf = (i: number) => padX + (pts.length > 1 ? (i / (pts.length - 1)) * (W - padX * 2) : (W - padX * 2) / 2);
    const yOf = (v: number) => H - padY - ((v - min) / span) * (H - padY * 2);
    const line = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)} ${yOf(v).toFixed(1)}`).join(' ');
    const area = `${line} L${xOf(pts.length - 1).toFixed(1)} ${H - 4} L${xOf(0).toFixed(1)} ${H - 4} Z`;
    const entryY = yOf(p.entry);

    return (
      <div className={s.subTradeChartWrap}>
        <svg viewBox={`0 0 ${W} ${H}`} className={s.subTradeChartSvg} role="img" aria-label={`${trade.name} execution chart`}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={tone} stopOpacity="0.22" />
              <stop offset="100%" stopColor={tone} stopOpacity="0" />
            </linearGradient>
          </defs>
          <line x1={padX} x2={W - padX} y1={entryY} y2={entryY} stroke="var(--line-strong)" strokeWidth={1} strokeDasharray="3 4" opacity={0.7} />
          <path d={area} fill={`url(#${gradId})`} />
          <path d={line} fill="none" stroke={tone} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={xOf(0)} cy={yOf(pts[0])} r={3.5} fill="var(--surface)" stroke="var(--ink-muted)" strokeWidth={2} />
          <circle cx={xOf(pts.length - 1)} cy={yOf(pts[pts.length - 1])} r={4} fill={tone} />
        </svg>
        <div className={s.subTradeChartMeta}>
          <span>Entry ${fmtPx(p.entry)}</span>
          {p.exit != null && <span>Exit ${fmtPx(p.exit)}</span>}
          {trade.ret != null && (
            <strong style={{ color: plInk(trade.ret), marginLeft: 'auto' }}>
              {trade.ret >= 0 ? '+' : ''}
              {trade.ret.toFixed(1)}%
            </strong>
          )}
        </div>
      </div>
    );
  }

  if (trade.manual) {
    const m = trade.manual;
    const endPx = m.ex?.px ?? m.px;
    const levels = [m.px, endPx, ...(m.tg ? [m.tg] : []), ...(m.sl ? [m.sl] : [])];
    const min = Math.min(...levels);
    const max = Math.max(...levels);
    const span = Math.max(max - min, m.px * 0.02 || 1);
    const yOf = (v: number) => H - padY - ((v - min) / span) * (H - padY * 2);
    const x1 = padX + 18;
    const x2 = W - padX - 18;
    const line = `M${x1} ${yOf(m.px).toFixed(1)} L${x2} ${yOf(endPx).toFixed(1)}`;
    const area = `${line} L${x2} ${H - 4} L${x1} ${H - 4} Z`;

    return (
      <div className={s.subTradeChartWrap}>
        <svg viewBox={`0 0 ${W} ${H}`} className={s.subTradeChartSvg} role="img" aria-label={`${trade.name} trade levels chart`}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={tone} stopOpacity="0.2" />
              <stop offset="100%" stopColor={tone} stopOpacity="0" />
            </linearGradient>
          </defs>
          {m.tg && (
            <line x1={padX} x2={W - padX} y1={yOf(m.tg)} y2={yOf(m.tg)} stroke="var(--good)" strokeWidth={1} strokeDasharray="3 4" opacity={0.7} />
          )}
          {m.sl && (
            <line x1={padX} x2={W - padX} y1={yOf(m.sl)} y2={yOf(m.sl)} stroke="var(--red-ink)" strokeWidth={1} strokeDasharray="3 4" opacity={0.65} />
          )}
          <path d={area} fill={`url(#${gradId})`} />
          <path d={line} fill="none" stroke={tone} strokeWidth={2.2} strokeLinecap="round" />
          <circle cx={x1} cy={yOf(m.px)} r={3.5} fill="var(--surface)" stroke="var(--ink-muted)" strokeWidth={2} />
          <circle cx={x2} cy={yOf(endPx)} r={4} fill={tone} />
        </svg>
        <div className={s.subTradeChartMeta}>
          <span>Entry {fmtPx(m.px)}</span>
          {m.ex?.px != null && <span>Exit {fmtPx(m.ex.px)}</span>}
          {m.tg && <span style={{ color: C.good }}>TP {fmtPx(m.tg)}</span>}
          {m.sl && <span style={{ color: C.redInk }}>SL {fmtPx(m.sl)}</span>}
          {trade.ret != null && (
            <strong style={{ color: plInk(trade.ret), marginLeft: 'auto' }}>
              {trade.ret >= 0 ? '+' : ''}
              {trade.ret.toFixed(1)}%
            </strong>
          )}
        </div>
      </div>
    );
  }

  return null;
}

/** Embedded live trade snapshot card with generated chart (shared by WYSIWYG Editor and Reader). */
export function EmbeddedTradeCard({
  trade,
  dS,
  onRemove,
}: {
  trade: AnyTrade | undefined;
  dS: (idr: number, signed?: boolean) => string;
  onRemove?: () => void;
}) {
  if (!trade) {
    return (
      <div className={s.subTradeMissing}>
        <span>Linked trade no longer found.</span>
        {onRemove && (
          <button type="button" className={s.textBtnSm} onClick={onRemove}>
            Remove
          </button>
        )}
      </div>
    );
  }
  const dateStr = trade.closed
    ? trade.closed.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : 'Open';
  return (
    <div className={s.subTradeEmbed} contentEditable={false}>
      <div className={s.subTradeEmbedTop}>
        <span className={s.subTradeEmbedTitle}>
          <strong>{trade.name}</strong>
          <span className={s.tradeTag}>{trade.side}</span>
          <span className={s.caption}>{dateStr}</span>
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <strong style={{ color: plInk(trade.pnl), fontSize: 15.5, fontVariantNumeric: 'tabular-nums' }}>
            {dS(trade.pnl, true)}
          </strong>
          {onRemove && (
            <button type="button" className={s.iconBtnSm} aria-label="Remove trade card" title="Remove trade card" onClick={onRemove}>
              <Icon d={IC.close} size={13} />
            </button>
          )}
        </span>
      </div>
      <TradeMiniChart trade={trade} />
      {(trade.followed || trade.setup || trade.mistakes.length > 0) && (
        <div className={s.tradeTags} style={{ marginTop: 4 }}>
          {trade.followed && (
            <span className={s.tradeChip} style={{ background: FP_COLORS[trade.followed][0], color: FP_COLORS[trade.followed][1] }}>
              Plan: {trade.followed}
            </span>
          )}
          {trade.setup && <span className={s.tradeChip}>{trade.setup}</span>}
          {trade.mistakes.map(m => (
            <span key={m} className={s.tradeChip} style={{ background: C.redTint, color: C.redInk }}>
              {m}
            </span>
          ))}
        </div>
      )}
      {trade.lesson && <p className={s.subTradeEmbedLesson}>“{trade.lesson}”</p>}
    </div>
  );
}

/** Renders a journal entry's Markdown body in Substack editorial style (shared by Reader and Editor preview). */
export function JournalArticleBody({
  body,
  tradesById,
  dS,
  onZoom,
}: {
  body: string;
  tradesById: Map<string, AnyTrade>;
  dS: (idr: number, signed?: boolean) => string;
  onZoom?: (url: string, caption: string) => void;
}) {
  const blocks = parseJournalBlocks(body);
  if (!blocks.length) return <p className={s.subEmptyBody}>Nothing written yet.</p>;
  return (
    <div className={s.subBody}>
      {blocks.map((b, idx) => {
        if (b.type === 'h1') return <h2 key={idx} className={s.subH2}>{renderInline(b.text)}</h2>;
        if (b.type === 'h2') return <h2 key={idx} className={s.subH2}>{renderInline(b.text)}</h2>;
        if (b.type === 'h3') return <h3 key={idx} className={s.subH3}>{renderInline(b.text)}</h3>;
        if (b.type === 'hr') return <hr key={idx} className={s.subHr} />;
        if (b.type === 'quote')
          return (
            <blockquote key={idx} className={s.subQuote}>
              {b.text.split('\n').map((line, li) => (
                <p key={li} style={{ margin: li ? '6px 0 0' : 0 }}>
                  {renderInline(line)}
                </p>
              ))}
            </blockquote>
          );
        if (b.type === 'list')
          return (
            <ul key={idx} className={s.subList}>
              {b.items.map((it, ii) => (
                <li key={ii}>{renderInline(it)}</li>
              ))}
            </ul>
          );
        if (b.type === 'ol')
          return (
            <ol key={idx} className={s.subList}>
              {b.items.map((it, ii) => (
                <li key={ii}>{renderInline(it)}</li>
              ))}
            </ol>
          );
        if (b.type === 'trade') return <EmbeddedTradeCard key={idx} trade={tradesById.get(b.tradeId)} dS={dS} />;
        if (b.type === 'image')
          return (
            <figure key={idx} className={s.subFigure}>
              <JournalImage
                src={b.src}
                storagePath={b.storagePath}
                alt={b.caption || 'Journal image'}
                className={s.subFigureImg}
                onClick={onZoom ? url => onZoom(url, b.caption) : undefined}
              />
              {b.caption && <figcaption className={s.subCaption}>{b.caption}</figcaption>}
            </figure>
          );
        return (
          <p key={idx} className={s.subP}>
            {b.text.split('\n').map((line, li) => (
              <span key={li}>
                {li > 0 && <br />}
                {renderInline(line)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

/** Full Substack-style Article Reader with cover image, lightbox zoom, and bottom Comments/Reflections thread. */
export function JournalReader({
  entry,
  tradesById,
  dS,
  onBack,
  onEdit,
  onDelete,
  onCommentCountChange,
}: {
  entry: JournalEntry;
  tradesById: Map<string, AnyTrade>;
  dS: (idr: number, signed?: boolean) => string;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => Promise<void>;
  onCommentCountChange: (entryId: string, count: number) => void;
}) {
  const [comments, setComments] = useState<JournalComment[]>([]);
  const [loadingComments, setLoadingComments] = useState(true);
  const [newBody, setNewBody] = useState('');
  const [newKind, setNewKind] = useState<CommentKind>('note');
  const [submitting, setSubmitting] = useState(false);
  const [commentErr, setCommentErr] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');
  const [editKind, setEditKind] = useState<CommentKind>('note');
  const [confirmDel, setConfirmDel] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [zoom, setZoom] = useState<{ url: string; caption: string } | null>(null);

  useEffect(() => {
    let alive = true;
    setLoadingComments(true);
    listJournalComments(entry.id)
      .then(list => {
        if (!alive) return;
        setComments(list);
        onCommentCountChange(entry.id, list.length);
      })
      .catch(e => {
        if (alive) setCommentErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive) setLoadingComments(false);
      });
    return () => {
      alive = false;
    };
  }, [entry.id]);

  const copyMarkdown = async () => {
    const md = [
      `# ${entry.title || 'Untitled'}`,
      ...(entry.subtitle ? [`*${entry.subtitle}*`] : []),
      '',
      entry.body,
      ...(comments.length
        ? ['', '---', '## Reflections', ...comments.map(c => `- (${fmtDate(c.createdAt)}${c.kind === 'hindsight' ? ' · Hindsight' : ''}) ${c.body}`)]
        : []),
    ].join('\n');
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt('Copy entry:', md);
    }
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBody.trim() || submitting) return;
    setSubmitting(true);
    setCommentErr('');
    try {
      const added = await addJournalComment(entry.id, newBody, newKind);
      const next = [...comments, added];
      setComments(next);
      onCommentCountChange(entry.id, next.length);
      setNewBody('');
      setNewKind('note');
    } catch (err) {
      setCommentErr(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveEdit = async (id: string) => {
    if (!editBody.trim()) return;
    setCommentErr('');
    try {
      const updated = await updateJournalComment(id, editBody, editKind);
      setComments(prev => prev.map(c => (c.id === id ? updated : c)));
      setEditingId(null);
    } catch (err) {
      setCommentErr(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeleteComment = async (id: string) => {
    setCommentErr('');
    try {
      await deleteJournalComment(id);
      const next = comments.filter(c => c.id !== id);
      setComments(next);
      onCommentCountChange(entry.id, next.length);
    } catch (err) {
      setCommentErr(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const mins = readingTimeMinutes(entry.body);
  const coverStorage =
    entry.coverPath && !entry.coverPath.startsWith('data:') && !entry.coverPath.startsWith('http')
      ? entry.coverPath
      : undefined;

  return (
    <div className={s.subFullScreen} role="dialog" aria-modal="true" aria-label={entry.title || 'Journal entry'}>
      <header className={s.subFsBar}>
        <button type="button" className={s.subFsPillBtn} onClick={onBack}>
          <Icon d={IC.chevLeft} size={15} /> Back
        </button>
        <div className={s.subFsBarRight}>
          <button type="button" className={s.subFsPillBtn} onClick={copyMarkdown}>
            <Icon d={IC.copy} size={14} /> {copied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" className={s.btnPrimarySm} onClick={onEdit}>
            <Icon d={IC.edit} size={14} /> Edit
          </button>
          {!confirmDel ? (
            <button type="button" className={s.iconBtnSm} aria-label="Delete entry" title="Delete entry" onClick={() => setConfirmDel(true)}>
              <Icon d={IC.trash} size={15} />
            </button>
          ) : (
            <span className={s.subConfirmDel}>
              <button
                type="button"
                className={s.btnDangerSm}
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  await onDelete();
                }}
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
              <button type="button" className={s.subFsPillBtn} onClick={() => setConfirmDel(false)}>
                Cancel
              </button>
            </span>
          )}
        </div>
      </header>

      <div className={s.subFsScroll}>
        <div className={s.subFsInner}>
          <article className={s.subFsArticle}>
        <header className={s.subArticleHead}>
          {entry.status === 'draft' && <span className={s.subDraftBadge}>Draft</span>}
          <h1 className={s.subTitle}>{entry.title || 'Untitled entry'}</h1>
          {entry.subtitle && <p className={s.subSubtitle}>{entry.subtitle}</p>}
          <div className={s.subMetaRow}>
            <span>{fmtDate(entry.createdAt)}</span>
            <span aria-hidden="true">·</span>
            <span>{mins} min read</span>
            {entry.account && entry.account !== 'all' && SOURCE_NAME[entry.account as keyof typeof SOURCE_NAME] && (
              <>
                <span aria-hidden="true">·</span>
                <span>{SOURCE_NAME[entry.account as keyof typeof SOURCE_NAME]}</span>
              </>
            )}
          </div>
          {entry.tags.length > 0 && (
            <div className={s.subTagRow}>
              {entry.tags.map(t => (
                <span key={t} className={s.subTag}>
                  {t}
                </span>
              ))}
            </div>
          )}
        </header>

        {entry.coverPath && (
          <div className={s.subCoverWrap}>
            <JournalImage
              src={entry.coverPath}
              storagePath={coverStorage}
              alt={entry.title || 'Cover image'}
              className={s.subCoverImg}
              onClick={url => setZoom({ url, caption: entry.title })}
            />
          </div>
        )}

        <JournalArticleBody
          body={entry.body}
          tradesById={tradesById}
          dS={dS}
          onZoom={(url, caption) => setZoom({ url, caption })}
        />
      </article>

      {/* Substack-style Comments & Hindsight Reflections */}
      <section className={s.subComments} aria-label="Comments and reflections">
        <div className={s.subCommentsHead}>
          <Icon d={IC.message} size={17} color={C.textMuted} />
          <h2 className={s.h2} style={{ margin: 0 }}>
            Reflections {comments.length > 0 && <span className={s.caption}>({comments.length})</span>}
          </h2>
        </div>
        <p className={s.caption} style={{ margin: '2px 0 14px' }}>
          Add follow-up thoughts or hindsight takeaways days later without rewriting your original post.
        </p>

        {commentErr && (
          <p className={s.caption} style={{ color: C.redInk, marginBottom: 10 }}>
            {commentErr}
          </p>
        )}

        {loadingComments ? (
          <p className={s.caption}>Loading reflections…</p>
        ) : comments.length > 0 ? (
          <div className={s.subCommentList}>
            {comments.map(c => (
              <div key={c.id} className={s.subCommentItem} data-kind={c.kind}>
                {editingId === c.id ? (
                  <div className={s.subCommentEdit}>
                    <textarea
                      className={s.subCommentInput}
                      rows={3}
                      value={editBody}
                      onChange={e => setEditBody(e.target.value)}
                    />
                    <div className={s.subCommentFormBar}>
                      <div className={s.sxMiniSeg} role="group" aria-label="Reflection type">
                        <button type="button" aria-pressed={editKind === 'note'} onClick={() => setEditKind('note')}>
                          Note
                        </button>
                        <button type="button" aria-pressed={editKind === 'hindsight'} onClick={() => setEditKind('hindsight')}>
                          Hindsight
                        </button>
                      </div>
                      <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8 }}>
                        <button type="button" className={s.textBtnSm} onClick={() => setEditingId(null)}>
                          Cancel
                        </button>
                        <button type="button" className={s.btnPrimarySm} onClick={() => handleSaveEdit(c.id)}>
                          Save
                        </button>
                      </span>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className={s.subCommentMeta}>
                      {c.kind === 'hindsight' && <span className={s.subHindsightBadge}>Hindsight takeaway</span>}
                      <span className={s.caption}>{fmtDateTime(c.createdAt)}</span>
                      <span className={s.subCommentActions}>
                        <button
                          type="button"
                          className={s.textBtnSm}
                          onClick={() => {
                            setEditingId(c.id);
                            setEditBody(c.body);
                            setEditKind(c.kind);
                          }}
                        >
                          Edit
                        </button>
                        <button type="button" className={s.textBtnSm} onClick={() => handleDeleteComment(c.id)}>
                          Delete
                        </button>
                      </span>
                    </div>
                    <p className={s.subCommentBody}>{c.body}</p>
                  </>
                )}
              </div>
            ))}
          </div>
        ) : null}

        <form className={s.subCommentForm} onSubmit={handleAddComment}>
          <textarea
            className={s.subCommentInput}
            rows={3}
            value={newBody}
            onChange={e => setNewBody(e.target.value)}
            placeholder="Write a follow-up comment or hindsight note…"
          />
          <div className={s.subCommentFormBar}>
            <div className={s.sxMiniSeg} role="group" aria-label="Reflection type">
              <button type="button" aria-pressed={newKind === 'note'} onClick={() => setNewKind('note')}>
                Note
              </button>
              <button type="button" aria-pressed={newKind === 'hindsight'} onClick={() => setNewKind('hindsight')}>
                Hindsight
              </button>
            </div>
            <button type="submit" className={s.btnPrimarySm} style={{ marginLeft: 'auto' }} disabled={!newBody.trim() || submitting}>
              {submitting ? 'Posting…' : 'Add reflection'}
            </button>
          </div>
        </form>
      </section>
        </div>
      </div>

      {zoom && (
        <div className={s.subLightbox} role="dialog" aria-modal="true" onClick={() => setZoom(null)}>
          <button type="button" className={s.subLightboxClose} aria-label="Close image" onClick={() => setZoom(null)}>
            <Icon d={IC.close} size={20} />
          </button>
          <img src={zoom.url} alt={zoom.caption || 'Zoomed image'} onClick={e => e.stopPropagation()} />
          {zoom.caption && <span className={s.subLightboxCap}>{zoom.caption}</span>}
        </div>
      )}
    </div>
  );
}
