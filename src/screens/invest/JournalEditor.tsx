import { useEffect, useRef, useState } from 'react';
import s from '../../styles/ui.module.css';
import { IC, Icon } from '../../components/Icon';
import {
  JOURNAL_IMG_PREFIX,
  saveJournalEntry,
  uploadJournalImage,
  type JournalEntry,
  type JournalStatus,
} from '../../lib/journal';
import { draftJournalMonth } from '../../lib/perps';
import { plInk } from '../../lib/tokens';
import { JournalArticleBody, JournalImage } from './JournalArticle';
import type { AnyTrade } from './trades';

type Props = {
  initial: JournalEntry;
  trades: AnyTrade[];
  tradesById: Map<string, AnyTrade>;
  dS: (idr: number, signed?: boolean) => string;
  onSaved: (entry: JournalEntry) => void;
  onClose: (latest: JournalEntry) => void;
};

/**
 * Substack-style distraction-free Journal Editor:
 * - Borderless serif title + subtitle, tag chips, optional cover image
 * - Minimal formatting toolbar + paste/drop image upload to Supabase Storage + live trade embed picker
 * - Autosave with Write / Preview toggle and Maxie AI drafting helper
 */
export function JournalEditor({ initial, trades, tradesById, dS, onSaved, onClose }: Props) {
  const [title, setTitle] = useState(initial.title);
  const [subtitle, setSubtitle] = useState(initial.subtitle);
  const [body, setBody] = useState(initial.body);
  const [coverPath, setCoverPath] = useState<string | null>(initial.coverPath);
  const [tags, setTags] = useState<string[]>(initial.tags);
  const [tagInput, setTagInput] = useState('');
  const [status, setStatus] = useState<JournalStatus>(initial.status);

  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const [saveState, setSaveState] = useState<'' | 'saving' | 'saved' | 'error'>('');
  const [err, setErr] = useState('');
  const [uploading, setUploading] = useState(false);
  const [tradePickerOpen, setTradePickerOpen] = useState(false);
  const [tradeQuery, setTradeQuery] = useState('');
  const [drafting, setDrafting] = useState(false);

  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const coverFileRef = useRef<HTMLInputElement>(null);
  const inlineFileRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const latestRef = useRef<JournalEntry>(initial);
  const dirtyRef = useRef(false);

  const buildEntry = (overrideStatus?: JournalStatus): JournalEntry => ({
    ...latestRef.current,
    title: title.trim(),
    subtitle: subtitle.trim(),
    body,
    coverPath,
    tags,
    status: overrideStatus ?? status,
  });

  const persist = async (next: JournalEntry) => {
    setSaveState('saving');
    setErr('');
    try {
      const saved = await saveJournalEntry(next);
      latestRef.current = saved;
      dirtyRef.current = false;
      onSaved(saved);
      setSaveState('saved');
      return saved;
    } catch (e) {
      setSaveState('error');
      setErr(e instanceof Error ? e.message : String(e));
      return next;
    }
  };

  // Debounced autosave whenever content changes (only if the user has typed something).
  useEffect(() => {
    const hasContent = !!(title.trim() || subtitle.trim() || body.trim() || coverPath);
    if (!hasContent) return;
    if (!dirtyRef.current) return;
    clearTimeout(saveTimer.current);
    setSaveState('saving');
    saveTimer.current = setTimeout(() => {
      void persist(buildEntry());
    }, 900);
    return () => clearTimeout(saveTimer.current);
  }, [title, subtitle, body, coverPath, tags, status]);

  // Auto-grow textarea height smoothly while writing.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || mode !== 'write') return;
    el.style.height = 'auto';
    el.style.height = Math.max(320, el.scrollHeight + 16) + 'px';
  }, [body, mode]);

  const markDirty = () => {
    dirtyRef.current = true;
  };

  const insertAtCursor = (snippet: string, wrapBefore?: string, wrapAfter?: string) => {
    const el = bodyRef.current;
    markDirty();
    if (!el) {
      setBody(prev => (prev ? `${prev}\n\n${snippet}` : snippet));
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const selected = body.slice(start, end);
    const inserted = wrapBefore != null ? `${wrapBefore}${selected || snippet}${wrapAfter ?? wrapBefore}` : snippet;
    const next = body.slice(0, start) + inserted + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + inserted.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const insertBlockLine = (prefix: string) => {
    const el = bodyRef.current;
    markDirty();
    if (!el) {
      setBody(prev => (prev ? `${prev}\n${prefix}` : prefix));
      return;
    }
    const start = el.selectionStart ?? body.length;
    const before = body.slice(0, start);
    const needsNl = before.length > 0 && !before.endsWith('\n') ? '\n\n' : '';
    const inserted = `${needsNl}${prefix}`;
    const next = before + inserted + body.slice(start);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + inserted.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const handleUploadInline = async (file: File) => {
    setUploading(true);
    setErr('');
    try {
      const { path } = await uploadJournalImage(file);
      const label = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
      const caption = label && label.toLowerCase() !== 'image' ? label : '';
      insertBlockLine(`![${caption}](${JOURNAL_IMG_PREFIX}${path})\n`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  const handleUploadCover = async (file: File) => {
    setUploading(true);
    setErr('');
    try {
      const { path } = await uploadJournalImage(file);
      markDirty();
      setCoverPath(path);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          void handleUploadInline(file);
          return;
        }
      }
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLTextAreaElement>) => {
    const file = e.dataTransfer?.files?.[0];
    if (file && file.type.startsWith('image/')) {
      e.preventDefault();
      void handleUploadInline(file);
    }
  };

  const addTag = (raw: string) => {
    const clean = raw.trim().replace(/^#/, '').slice(0, 28);
    if (!clean || tags.includes(clean)) return;
    markDirty();
    setTags(prev => [...prev, clean]);
  };

  const handlePublishToggle = async (nextStatus: JournalStatus) => {
    clearTimeout(saveTimer.current);
    setStatus(nextStatus);
    const saved = await persist(buildEntry(nextStatus));
    if (nextStatus === 'published') onClose(saved);
  };

  const handleBack = async () => {
    clearTimeout(saveTimer.current);
    const hasContent = !!(title.trim() || subtitle.trim() || body.trim() || coverPath);
    if (dirtyRef.current && hasContent) {
      const saved = await persist(buildEntry());
      onClose(saved);
    } else {
      onClose(latestRef.current);
    }
  };

  const askMaxieDraft = async () => {
    setDrafting(true);
    setErr('');
    try {
      const recent = trades.slice(0, 8).map(t => {
        const when = t.closed ? t.closed.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : 'Open';
        return `- ${when}: ${t.name} ${t.side}, ${dS(t.pnl, true)}${t.setup ? `, setup: ${t.setup}` : ''}${t.mistakes.length ? `, mistakes: ${t.mistakes.join('/')}` : ''}${t.lesson ? ` — "${t.lesson}"` : ''}`;
      });
      const prompt = [
        title ? `Entry title: ${title}` : 'Write a thoughtful, calm Substack-style trading reflection in Markdown (use ## headings and a short > takeaway quote).',
        subtitle ? `Subtitle: ${subtitle}` : '',
        body.trim() ? `Current draft notes:\n${body.trim()}` : '',
        recent.length ? `Recent trades context:\n${recent.join('\n')}` : '',
      ]
        .filter(Boolean)
        .join('\n\n');
      const r = await draftJournalMonth(prompt);
      if (!r.text) {
        setErr(r.error === 'no_key' ? 'Maxie needs GEMINI_API_KEY configured first.' : "Maxie couldn't draft right now. Try again.");
      } else {
        markDirty();
        setBody(prev => (prev.trim() ? `${prev.trim()}\n\n${r.text}` : r.text!));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDrafting(false);
    }
  };

  const filteredTrades = trades
    .filter(t => !tradeQuery.trim() || `${t.name} ${t.side} ${t.setup ?? ''}`.toLowerCase().includes(tradeQuery.toLowerCase()))
    .slice(0, 8);

  // Lock background page scroll while the full-screen composer is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const coverStorage =
    coverPath && !coverPath.startsWith('data:') && !coverPath.startsWith('http') ? coverPath : undefined;

  const statusLabel = uploading
    ? 'Uploading…'
    : saveState === 'saving'
      ? 'Saving…'
      : saveState === 'saved'
        ? 'Saved'
        : saveState === 'error'
          ? 'Save failed'
          : status === 'draft'
            ? 'Draft'
            : 'Published';

  const words = body
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[\[trade:[^\]]+\]\]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

  return (
    <div className={s.subFullScreen} role="dialog" aria-modal="true" aria-label="Journal editor">
      {/* Substack-style minimal top bar */}
      <header className={s.subFsBar}>
        <div className={s.subFsBarLeft}>
          <button type="button" className={s.subFsBackBtn} onClick={handleBack} aria-label="Back to Journal" title="Back to Journal">
            <Icon d={IC.chevLeft} size={18} />
            <span className={s.subFsBackText}>{saveState === 'saved' || !dirtyRef.current ? 'Done' : 'Cancel'}</span>
          </button>
          <span className={s.subFsStatus} data-state={saveState || status}>
            <span className={s.subFsStatusDot} aria-hidden="true" />
            {statusLabel}
          </span>
        </div>

        <div className={s.subFsBarRight}>
          <button
            type="button"
            className={s.subFsPillBtn}
            onClick={() => setMode(m => (m === 'write' ? 'preview' : 'write'))}
          >
            {mode === 'write' ? 'Preview' : 'Write'}
          </button>
          {status === 'published' ? (
            <button type="button" className={s.subFsPillBtn} onClick={() => handlePublishToggle('draft')}>
              Unpublish
            </button>
          ) : (
            <button type="button" className={s.btnPrimarySm} onClick={() => handlePublishToggle('published')}>
              Publish
            </button>
          )}
        </div>
      </header>

      {/* Substack formatting toolbar: centered top bar on web, docked bottom bar on mobile */}
      {mode === 'write' && (
        <div className={s.subFsDock} role="toolbar" aria-label="Formatting">
          <input
            ref={inlineFileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) void handleUploadInline(f);
              e.target.value = '';
            }}
          />
          <button type="button" className={s.subDockBtn} title="Heading" onClick={() => insertBlockLine('## ')}>
            H2
          </button>
          <button type="button" className={s.subDockBtn} title="Subheading" onClick={() => insertBlockLine('### ')}>
            H3
          </button>
          <span className={s.subToolSep} aria-hidden="true" />
          <button type="button" className={s.subDockBtn} title="Bold" onClick={() => insertAtCursor('bold', '**')}>
            <strong>B</strong>
          </button>
          <button type="button" className={s.subDockBtn} title="Italic" onClick={() => insertAtCursor('italic', '*')}>
            <em>I</em>
          </button>
          <button type="button" className={s.subDockBtn} title="Inline code" onClick={() => insertAtCursor('code', '`')}>
            <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12.5 }}>{'<>'}</span>
          </button>
          <span className={s.subToolSep} aria-hidden="true" />
          <button
            type="button"
            className={s.subDockBtn}
            title="Insert image (or paste / drop)"
            onClick={() => inlineFileRef.current?.click()}
            disabled={uploading}
          >
            <Icon d={IC.image} size={17} />
          </button>
          <button type="button" className={s.subDockBtn} title="Bullet list" onClick={() => insertBlockLine('- ')}>
            <Icon d={IC.list} size={17} />
          </button>
          <button type="button" className={s.subDockBtn} title="Quote" onClick={() => insertBlockLine('> ')}>
            <Icon d={IC.quote} size={16} />
          </button>
          <button type="button" className={s.subDockBtn} title="Divider" onClick={() => insertBlockLine('---\n\n')}>
            —
          </button>
          {trades.length > 0 && (
            <>
              <span className={s.subToolSep} aria-hidden="true" />
              <button
                type="button"
                className={s.subDockBtn}
                data-on={tradePickerOpen || undefined}
                title="Embed live trade card"
                onClick={() => setTradePickerOpen(v => !v)}
              >
                <Icon d={IC.trend} size={16} />
                <span className={s.subDockLabel}>Trade</span>
              </button>
            </>
          )}
          <span className={s.subToolSep} aria-hidden="true" />
          <button
            type="button"
            className={s.subDockBtn}
            title="Ask Maxie to help draft"
            onClick={askMaxieDraft}
            disabled={drafting}
          >
            <Icon d={IC.sparkle} size={16} />
            <span className={s.subDockLabel}>{drafting ? 'Drafting…' : 'Maxie'}</span>
          </button>
        </div>
      )}

      {/* Scrollable full-screen writing / preview body */}
      <div className={s.subFsScroll}>
        <div className={s.subFsInner}>
          {err && (
            <div className={s.subErrBanner} role="alert">
              {err}
            </div>
          )}

          {mode === 'preview' ? (
            <article className={s.subFsPreview}>
              <header className={s.subArticleHead}>
                {status === 'draft' && <span className={s.subDraftBadge}>Draft preview</span>}
                <h1 className={s.subTitle}>{title.trim() || 'Untitled entry'}</h1>
                {subtitle.trim() && <p className={s.subSubtitle}>{subtitle.trim()}</p>}
                {tags.length > 0 && (
                  <div className={s.subTagRow}>
                    {tags.map(t => (
                      <span key={t} className={s.subTag}>
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </header>
              {coverPath && (
                <div className={s.subCoverWrap}>
                  <JournalImage src={coverPath} storagePath={coverStorage} alt={title || 'Cover'} className={s.subCoverImg} />
                </div>
              )}
              <JournalArticleBody body={body} tradesById={tradesById} dS={dS} />
            </article>
          ) : (
            <div className={s.subFsCanvas}>
              {/* Cover image strip */}
              <input
                ref={coverFileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) void handleUploadCover(f);
                  e.target.value = '';
                }}
              />
              {coverPath ? (
                <div className={s.subCoverWrap}>
                  <JournalImage src={coverPath} storagePath={coverStorage} alt="Cover" className={s.subCoverImg} />
                  <div className={s.subCoverControls}>
                    <button type="button" className={s.btnOutlineSm} onClick={() => coverFileRef.current?.click()}>
                      Change
                    </button>
                    <button
                      type="button"
                      className={s.btnOutlineSm}
                      onClick={() => {
                        markDirty();
                        setCoverPath(null);
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ) : (
                <div className={s.subCoverAddRow}>
                  <button type="button" className={s.textBtnSm} style={{ paddingLeft: 0 }} onClick={() => coverFileRef.current?.click()} disabled={uploading}>
                    <Icon d={IC.image} size={14} /> Add cover image
                  </button>
                </div>
              )}

              {/* Borderless Substack Title & Subtitle */}
              <input
                className={s.subTitleInput}
                value={title}
                onChange={e => {
                  markDirty();
                  setTitle(e.target.value);
                }}
                placeholder="Title"
                aria-label="Entry title"
              />
              <input
                className={s.subSubtitleInput}
                value={subtitle}
                onChange={e => {
                  markDirty();
                  setSubtitle(e.target.value);
                }}
                placeholder="Add a subtitle…"
                aria-label="Entry subtitle"
              />

              {/* Tags */}
              <div className={s.subTagEditor}>
                {tags.map(t => (
                  <span key={t} className={s.subTagRemovable}>
                    {t}
                    <button
                      type="button"
                      aria-label={`Remove ${t}`}
                      onClick={() => {
                        markDirty();
                        setTags(prev => prev.filter(x => x !== t));
                      }}
                    >
                      ×
                    </button>
                  </span>
                ))}
                <input
                  className={s.subTagInput}
                  value={tagInput}
                  onChange={e => setTagInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault();
                      addTag(tagInput);
                      setTagInput('');
                    } else if (e.key === 'Backspace' && !tagInput && tags.length) {
                      markDirty();
                      setTags(prev => prev.slice(0, -1));
                    }
                  }}
                  onBlur={() => {
                    if (tagInput.trim()) {
                      addTag(tagInput);
                      setTagInput('');
                    }
                  }}
                  placeholder={tags.length ? 'Add tag…' : 'Add tags (e.g. BTC, Perps, Psychology)…'}
                  aria-label="Add tag"
                />
              </div>

              {tradePickerOpen && (
                <div className={s.subTradePicker}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      className={s.input}
                      style={{ minHeight: 36, fontSize: 13, flex: 1 }}
                      value={tradeQuery}
                      onChange={e => setTradeQuery(e.target.value)}
                      placeholder="Search any trade (BTC, BBCA, NVDA…)"
                    />
                    <button type="button" className={s.iconBtnSm} aria-label="Close picker" onClick={() => setTradePickerOpen(false)}>
                      <Icon d={IC.close} size={15} />
                    </button>
                  </div>
                  <div className={s.subTradePickList}>
                    {filteredTrades.length === 0 ? (
                      <span className={s.caption}>No matching trades.</span>
                    ) : (
                      filteredTrades.map(t => (
                        <button
                          key={t.key}
                          type="button"
                          className={s.subTradePickRow}
                          onClick={() => {
                            insertBlockLine(`[[trade:${t.key}]]\n`);
                            setTradePickerOpen(false);
                            setTradeQuery('');
                          }}
                        >
                          <span>
                            <strong>{t.name}</strong> <span className={s.tradeTag}>{t.side}</span>
                            {t.closed && (
                              <span className={s.caption} style={{ marginLeft: 8 }}>
                                {t.closed.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                              </span>
                            )}
                          </span>
                          <strong style={{ color: plInk(t.pnl), fontVariantNumeric: 'tabular-nums' }}>{dS(t.pnl, true)}</strong>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* Main full-height writing area */}
              <textarea
                ref={bodyRef}
                className={s.subBodyInput}
                value={body}
                onChange={e => {
                  markDirty();
                  setBody(e.target.value);
                }}
                onPaste={handlePaste}
                onDrop={handleDrop}
                placeholder="Start writing…"
                aria-label="Journal entry body"
              />
            </div>
          )}
        </div>
      </div>

      {/* Subtle desktop word-count footer */}
      <footer className={s.subFsFoot}>
        <span>{words} {words === 1 ? 'word' : 'words'}</span>
        <span aria-hidden="true">·</span>
        <span>Paste or drop images directly into the canvas</span>
      </footer>
    </div>
  );
}
