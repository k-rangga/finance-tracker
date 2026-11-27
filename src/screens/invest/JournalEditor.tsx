import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor } from '@tiptap/react';
import { Node, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import s from '../../styles/ui.module.css';
import { IC, Icon } from '../../components/Icon';
import {
  bodyToEditorHtml,
  JOURNAL_IMG_PREFIX,
  saveJournalEntry,
  searchStockPhotos,
  tiptapDocToMarkdown,
  uploadJournalImage,
  type JournalEntry,
  type JournalStatus,
} from '../../lib/journal';
import { draftJournalMonth } from '../../lib/perps';
import { plInk } from '../../lib/tokens';
import { EmbeddedTradeCard, JournalArticleBody, JournalImage } from './JournalArticle';
import type { AnyTrade } from './trades';

type Props = {
  initial: JournalEntry;
  trades: AnyTrade[];
  tradesById: Map<string, AnyTrade>;
  dS: (idr: number, signed?: boolean) => string;
  onSaved: (entry: JournalEntry) => void;
  onClose: (latest: JournalEntry) => void;
};

const STOCK_PRESETS = ['Minimal desk', 'Coffee', 'Architecture', 'Mountains', 'Ocean', 'Books'];

/**
 * Substack-style full-screen WYSIWYG Journal Editor (ProseMirror / TipTap):
 * - Live rich text (bold, italic, headings, clean bullets & numbering, quotes, dividers) — zero markdown/HTML codes
 * - Live embedded Trade Cards with generated SVG charts directly inside the writing canvas
 * - Live inline images (paste, drop, or pick) + Cover image uploader & stock photo search
 * - Seamless borderless canvas; centered top toolbar on web, bottom-docked toolbar on mobile
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

  // Substack-style Cover Image Picker (Upload or Search stock photos)
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  const [stockQuery, setStockQuery] = useState('');
  const [stockResults, setStockResults] = useState<{ url: string; thumb: string; title: string }[]>([]);
  const [stockLoading, setStockLoading] = useState(false);

  const coverFileRef = useRef<HTMLInputElement>(null);
  const inlineFileRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const latestRef = useRef<JournalEntry>(initial);
  const dirtyRef = useRef(false);
  const tradesMapRef = useRef(tradesById);
  const dSRef = useRef(dS);
  tradesMapRef.current = tradesById;
  dSRef.current = dS;

  const markDirty = () => {
    dirtyRef.current = true;
  };

  // Custom TipTap atom node for live Embedded Trade Cards (with generated SVG chart).
  const JournalTradeNode = useMemo(
    () =>
      Node.create({
        name: 'journalTrade',
        group: 'block',
        atom: true,
        selectable: true,
        draggable: true,
        addAttributes() {
          return { tradeId: { default: '' } };
        },
        parseHTML() {
          return [
            {
              tag: 'div[data-journal-trade]',
              getAttrs: el => ({ tradeId: (el as HTMLElement).getAttribute('data-journal-trade') || '' }),
            },
          ];
        },
        renderHTML({ HTMLAttributes }) {
          return ['div', mergeAttributes(HTMLAttributes, { 'data-journal-trade': HTMLAttributes.tradeId })];
        },
        addNodeView() {
          return ReactNodeViewRenderer(({ node, deleteNode }) => {
            const tradeId = String(node.attrs.tradeId || '');
            return (
              <NodeViewWrapper className={s.subNodeBlock}>
                <EmbeddedTradeCard
                  trade={tradesMapRef.current.get(tradeId)}
                  dS={dSRef.current}
                  onRemove={() => deleteNode()}
                />
              </NodeViewWrapper>
            );
          });
        },
      }),
    [],
  );

  // Custom TipTap atom node for live Inline Images with editable caption & remove button.
  const JournalImageNode = useMemo(
    () =>
      Node.create({
        name: 'journalImage',
        group: 'block',
        atom: true,
        selectable: true,
        draggable: true,
        addAttributes() {
          return {
            src: { default: '' },
            caption: { default: '' },
          };
        },
        parseHTML() {
          return [
            {
              tag: 'div[data-journal-image]',
              getAttrs: el => ({
                src: (el as HTMLElement).getAttribute('data-journal-image') || '',
                caption: (el as HTMLElement).getAttribute('data-caption') || '',
              }),
            },
          ];
        },
        renderHTML({ HTMLAttributes }) {
          return [
            'div',
            mergeAttributes(HTMLAttributes, {
              'data-journal-image': HTMLAttributes.src,
              'data-caption': HTMLAttributes.caption,
            }),
          ];
        },
        addNodeView() {
          return ReactNodeViewRenderer(({ node, updateAttributes, deleteNode }) => {
            const src = String(node.attrs.src || '');
            const caption = String(node.attrs.caption || '');
            const storagePath = src.startsWith(JOURNAL_IMG_PREFIX) ? src.slice(JOURNAL_IMG_PREFIX.length) : undefined;
            return (
              <NodeViewWrapper className={s.subNodeBlock}>
                <figure className={s.subEditorFigure} contentEditable={false}>
                  <div className={s.subEditorFigureImgWrap}>
                    <JournalImage src={src} storagePath={storagePath} alt={caption || 'Journal image'} className={s.subFigureImg} />
                    <button
                      type="button"
                      className={s.subNodeRemoveBtn}
                      aria-label="Remove image"
                      title="Remove image"
                      onClick={() => deleteNode()}
                    >
                      <Icon d={IC.close} size={14} />
                    </button>
                  </div>
                  <input
                    className={s.subCaptionInput}
                    value={caption}
                    onChange={e => updateAttributes({ caption: e.target.value })}
                    placeholder="Add a caption (optional)…"
                    aria-label="Image caption"
                  />
                </figure>
              </NodeViewWrapper>
            );
          });
        },
      }),
    [],
  );

  const handleUploadInlineRef = useRef<(file: File) => Promise<void>>(async () => {});

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
      Placeholder.configure({
        placeholder: 'Start writing…',
      }),
      JournalTradeNode,
      JournalImageNode,
    ],
    content: bodyToEditorHtml(initial.body),
    editorProps: {
      attributes: {
        class: s.subProse,
      },
      handlePaste(_view, event) {
        const items = event.clipboardData?.items;
        if (!items) return false;
        for (const item of items) {
          if (item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (file) {
              event.preventDefault();
              void handleUploadInlineRef.current(file);
              return true;
            }
          }
        }
        return false;
      },
      handleDrop(_view, event) {
        const file = event.dataTransfer?.files?.[0];
        if (file && file.type.startsWith('image/')) {
          event.preventDefault();
          void handleUploadInlineRef.current(file);
          return true;
        }
        return false;
      },
    },
    onUpdate({ editor: ed }) {
      markDirty();
      setBody(tiptapDocToMarkdown(ed.getJSON()));
    },
  });

  handleUploadInlineRef.current = async (file: File) => {
    setUploading(true);
    setErr('');
    try {
      const { path } = await uploadJournalImage(file);
      const label = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
      const caption = label && label.toLowerCase() !== 'image' ? label : '';
      editor
        ?.chain()
        .focus()
        .insertContent([
          { type: 'journalImage', attrs: { src: `${JOURNAL_IMG_PREFIX}${path}`, caption } },
          { type: 'paragraph' },
        ])
        .run();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

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

  // Debounced autosave whenever content changes.
  useEffect(() => {
    const hasContent = !!(title.trim() || subtitle.trim() || body.trim() || coverPath);
    if (!hasContent || !dirtyRef.current) return;
    clearTimeout(saveTimer.current);
    setSaveState('saving');
    saveTimer.current = setTimeout(() => {
      void persist(buildEntry());
    }, 900);
    return () => clearTimeout(saveTimer.current);
  }, [title, subtitle, body, coverPath, tags, status]);

  // Lock background page scroll while the full-screen composer is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const handleUploadCover = async (file: File) => {
    setUploading(true);
    setErr('');
    try {
      const { path } = await uploadJournalImage(file);
      markDirty();
      setCoverPath(path);
      setCoverPickerOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  const runStockSearch = async (q: string) => {
    setStockQuery(q);
    if (!q.trim()) {
      setStockResults([]);
      return;
    }
    setStockLoading(true);
    setErr('');
    try {
      const res = await searchStockPhotos(q);
      setStockResults(res);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setStockLoading(false);
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
        const nextMd = body.trim() ? `${body.trim()}\n\n${r.text}` : r.text;
        markDirty();
        setBody(nextMd);
        editor?.commands.setContent(bodyToEditorHtml(nextMd));
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
      {mode === 'write' && editor && (
        <div className={s.subFsDock} role="toolbar" aria-label="Formatting">
          <input
            ref={inlineFileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) void handleUploadInlineRef.current(f);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            className={s.subDockBtn}
            data-on={editor.isActive('heading', { level: 2 }) || undefined}
            title="Heading"
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          >
            H2
          </button>
          <button
            type="button"
            className={s.subDockBtn}
            data-on={editor.isActive('heading', { level: 3 }) || undefined}
            title="Subheading"
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          >
            H3
          </button>
          <span className={s.subToolSep} aria-hidden="true" />
          <button
            type="button"
            className={s.subDockBtn}
            data-on={editor.isActive('bold') || undefined}
            title="Bold (Cmd/Ctrl+B)"
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <strong>B</strong>
          </button>
          <button
            type="button"
            className={s.subDockBtn}
            data-on={editor.isActive('italic') || undefined}
            title="Italic (Cmd/Ctrl+I)"
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <em>I</em>
          </button>
          <button
            type="button"
            className={s.subDockBtn}
            data-on={editor.isActive('code') || undefined}
            title="Inline code"
            onClick={() => editor.chain().focus().toggleCode().run()}
          >
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
          <button
            type="button"
            className={s.subDockBtn}
            data-on={editor.isActive('bulletList') || undefined}
            title="Bullet list"
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <Icon d={IC.list} size={17} />
          </button>
          <button
            type="button"
            className={s.subDockBtn}
            data-on={editor.isActive('orderedList') || undefined}
            title="Numbered list"
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>1.</span>
          </button>
          <button
            type="button"
            className={s.subDockBtn}
            data-on={editor.isActive('blockquote') || undefined}
            title="Quote"
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
          >
            <Icon d={IC.quote} size={16} />
          </button>
          <button
            type="button"
            className={s.subDockBtn}
            title="Divider"
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
          >
            —
          </button>
          {trades.length > 0 && (
            <>
              <span className={s.subToolSep} aria-hidden="true" />
              <button
                type="button"
                className={s.subDockBtn}
                data-on={tradePickerOpen || undefined}
                title="Embed live trade card with chart"
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
              {/* Cover image strip + Stock Photo Search */}
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
                    <button type="button" className={s.btnOutlineSm} onClick={() => setCoverPickerOpen(v => !v)}>
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
                  <button
                    type="button"
                    className={s.textBtnSm}
                    style={{ paddingLeft: 0 }}
                    onClick={() => setCoverPickerOpen(v => !v)}
                    disabled={uploading}
                  >
                    <Icon d={IC.image} size={14} /> Add cover image
                  </button>
                </div>
              )}

              {coverPickerOpen && (
                <div className={s.subCoverPicker}>
                  <div className={s.subCoverPickerHead}>
                    <button type="button" className={s.btnOutlineSm} onClick={() => coverFileRef.current?.click()} disabled={uploading}>
                      <Icon d={IC.image} size={14} /> Upload from device
                    </button>
                    <form
                      className={s.subStockForm}
                      onSubmit={e => {
                        e.preventDefault();
                        void runStockSearch(stockQuery);
                      }}
                    >
                      <Icon d={IC.search} size={14} />
                      <input
                        value={stockQuery}
                        onChange={e => setStockQuery(e.target.value)}
                        placeholder="Search stock photos…"
                        aria-label="Search stock photos"
                      />
                    </form>
                    <button type="button" className={s.iconBtnSm} aria-label="Close cover picker" onClick={() => setCoverPickerOpen(false)}>
                      <Icon d={IC.close} size={15} />
                    </button>
                  </div>
                  <div className={s.subTagFilterRow} style={{ marginTop: 0 }}>
                    {STOCK_PRESETS.map(p => (
                      <button key={p} type="button" className={s.subTagChip} onClick={() => void runStockSearch(p)}>
                        {p}
                      </button>
                    ))}
                  </div>
                  {stockLoading ? (
                    <span className={s.caption}>Searching photos…</span>
                  ) : stockResults.length > 0 ? (
                    <div className={s.subStockGrid}>
                      {stockResults.map(photo => (
                        <button
                          key={photo.url}
                          type="button"
                          className={s.subStockItem}
                          title={photo.title}
                          onClick={() => {
                            markDirty();
                            setCoverPath(photo.url);
                            setCoverPickerOpen(false);
                          }}
                        >
                          <img src={photo.thumb} alt={photo.title} loading="lazy" />
                        </button>
                      ))}
                    </div>
                  ) : null}
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
                            editor
                              ?.chain()
                              .focus()
                              .insertContent([
                                { type: 'journalTrade', attrs: { tradeId: t.key } },
                                { type: 'paragraph' },
                              ])
                              .run();
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

              {/* Seamless borderless WYSIWYG writing canvas */}
              <EditorContent editor={editor} className={s.subProseWrap} />
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
