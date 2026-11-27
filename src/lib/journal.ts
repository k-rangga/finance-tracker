/**
 * Substack-style Journal data layer (Supabase-only, with localStorage fallback when running offline/local dev).
 *
 * - Entries (`journal_entries`), comments/reflections (`journal_comments`), and private images (`journal-images` bucket).
 * - Pure Markdown + inline image (`![caption](journal-img:path)`) + live trade embed (`[[trade:id]]`) parser.
 */
import { supabase } from './supabase';

export type JournalStatus = 'draft' | 'published';
export type CommentKind = 'note' | 'hindsight';

export type JournalEntry = {
  id: string;
  account: string;
  title: string;
  subtitle: string;
  body: string;
  coverPath: string | null;
  tags: string[];
  status: JournalStatus;
  createdAt: string;
  updatedAt: string;
  commentCount?: number;
};

export type JournalComment = {
  id: string;
  entryId: string;
  body: string;
  kind: CommentKind;
  createdAt: string;
  updatedAt: string;
};

export type JournalBlock =
  | { type: 'h1' | 'h2' | 'h3'; text: string }
  | { type: 'quote'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'hr' }
  | { type: 'image'; caption: string; src: string; storagePath?: string }
  | { type: 'trade'; tradeId: string }
  | { type: 'p'; text: string };

export const JOURNAL_IMG_PREFIX = 'journal-img:';
const IMG_BUCKET = 'journal-images';
const MAX_IMG_SIDE = 1600;
const LOCAL_ENTRIES_KEY = 'journal_entries_v1';
const LOCAL_COMMENTS_KEY = 'journal_comments_v1';

export const newJournalId = (prefix = 'je') =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

/** Parse Markdown body into structured editorial blocks (headings, quotes, lists, images, trade embeds, paragraphs). */
export function parseJournalBlocks(body: string): JournalBlock[] {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const blocks: JournalBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed) {
      i++;
      continue;
    }

    // Horizontal divider
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    // Headings
    const hMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (hMatch) {
      const level = hMatch[1].length as 1 | 2 | 3;
      blocks.push({ type: level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3', text: hMatch[2].trim() });
      i++;
      continue;
    }

    // Embedded trade card: [[trade:ID]]
    const tradeMatch = trimmed.match(/^\[\[trade:([^\]]+)\]\]$/);
    if (tradeMatch) {
      blocks.push({ type: 'trade', tradeId: tradeMatch[1].trim() });
      i++;
      continue;
    }

    // Standalone image: ![caption](src)
    const imgMatch = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (imgMatch) {
      const caption = imgMatch[1].trim();
      const src = imgMatch[2].trim();
      const storagePath = src.startsWith(JOURNAL_IMG_PREFIX) ? src.slice(JOURNAL_IMG_PREFIX.length) : undefined;
      blocks.push({ type: 'image', caption, src, storagePath });
      i++;
      continue;
    }

    // Blockquote (consecutive lines starting with ">")
    if (trimmed.startsWith('>')) {
      const qLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        qLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'quote', text: qLines.join('\n').trim() });
      continue;
    }

    // Bullet list (consecutive lines starting with "- " or "* ")
    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ''));
        i++;
      }
      blocks.push({ type: 'list', items });
      continue;
    }

    // Paragraph (absorb consecutive plain lines until blank line or block starter)
    const pLines: string[] = [];
    while (i < lines.length) {
      const t = lines[i].trim();
      if (
        !t ||
        /^(-{3,}|\*{3,}|_{3,})$/.test(t) ||
        /^#{1,3}\s+/.test(t) ||
        /^\[\[trade:[^\]]+\]\]$/.test(t) ||
        /^!\[[^\]]*\]\([^)]+\)$/.test(t) ||
        t.startsWith('>') ||
        /^[-*]\s+/.test(t)
      ) {
        break;
      }
      pLines.push(lines[i]);
      i++;
    }
    if (pLines.length) blocks.push({ type: 'p', text: pLines.join('\n').trim() });
  }

  return blocks;
}

/** Estimated reading time in minutes (minimum 1 min when non-empty). */
export function readingTimeMinutes(body: string): number {
  const plain = body
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[\[trade:[^\]]+\]\]/g, '')
    .replace(/[#>*_`~-]/g, ' ')
    .trim();
  if (!plain) return 1;
  const words = plain.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

/** Clean plain-text excerpt for feed cards (strips markdown, images, and trade embeds). */
export function excerptOf(body: string, maxLen = 150): string {
  const blocks = parseJournalBlocks(body);
  const textParts: string[] = [];
  for (const b of blocks) {
    if (b.type === 'p' || b.type === 'quote') textParts.push(b.text);
    else if (b.type === 'list') textParts.push(b.items.join(' · '));
  }
  const clean = textParts
    .join(' ')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen - 1).replace(/\s+\S*$/, '') + '…';
}

/** First image reference in an entry (coverPath first, else first inline image). */
export function leadImageOf(entry: Pick<JournalEntry, 'coverPath' | 'body'>): { src: string; storagePath?: string } | null {
  if (entry.coverPath) {
    return entry.coverPath.startsWith('data:') || entry.coverPath.startsWith('http')
      ? { src: entry.coverPath }
      : { src: JOURNAL_IMG_PREFIX + entry.coverPath, storagePath: entry.coverPath };
  }
  const blocks = parseJournalBlocks(entry.body);
  const img = blocks.find((b): b is Extract<JournalBlock, { type: 'image' }> => b.type === 'image');
  return img ? { src: img.src, storagePath: img.storagePath } : null;
}

// ---- Local fallback storage (for offline / local dev without Supabase env vars) ----

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal(key: string, val: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {
    // ignore quota errors in local fallback
  }
}

// ---- Supabase CRUD ----

type EntryRow = {
  id: string;
  account: string;
  title: string;
  subtitle: string;
  body: string;
  cover_path: string | null;
  tags: string[] | null;
  status: string;
  created_at: string;
  updated_at: string;
};

type CommentRow = {
  id: string;
  entry_id: string;
  body: string;
  kind: string;
  created_at: string;
  updated_at: string;
};

const toEntry = (r: EntryRow, commentCount = 0): JournalEntry => ({
  id: r.id,
  account: r.account || 'all',
  title: r.title || '',
  subtitle: r.subtitle || '',
  body: r.body || '',
  coverPath: r.cover_path ?? null,
  tags: Array.isArray(r.tags) ? r.tags.filter((x): x is string => typeof x === 'string') : [],
  status: r.status === 'draft' ? 'draft' : 'published',
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  commentCount,
});

const toComment = (r: CommentRow): JournalComment => ({
  id: r.id,
  entryId: r.entry_id,
  body: r.body,
  kind: r.kind === 'hindsight' ? 'hindsight' : 'note',
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

async function currentUserId(): Promise<string> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error('Please sign in to save your journal.');
  return data.user.id;
}

/** Fetch all journal entries (newest first) with comment counts. */
export async function listJournalEntries(): Promise<JournalEntry[]> {
  if (!supabase) {
    const entries = readLocal<JournalEntry[]>(LOCAL_ENTRIES_KEY, []);
    const comments = readLocal<JournalComment[]>(LOCAL_COMMENTS_KEY, []);
    const counts = new Map<string, number>();
    for (const c of comments) counts.set(c.entryId, (counts.get(c.entryId) ?? 0) + 1);
    return entries
      .map(e => ({ ...e, commentCount: counts.get(e.id) ?? 0 }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  const [{ data: rows, error }, { data: cRows }] = await Promise.all([
    supabase.from('journal_entries').select('*').order('created_at', { ascending: false }),
    supabase.from('journal_comments').select('entry_id'),
  ]);
  if (error) throw new Error(error.message);
  const counts = new Map<string, number>();
  for (const c of (cRows ?? []) as { entry_id: string }[]) {
    counts.set(c.entry_id, (counts.get(c.entry_id) ?? 0) + 1);
  }
  return ((rows ?? []) as EntryRow[]).map(r => toEntry(r, counts.get(r.id) ?? 0));
}

/** Create or update a journal entry. */
export async function saveJournalEntry(entry: JournalEntry): Promise<JournalEntry> {
  const now = new Date().toISOString();
  const next: JournalEntry = {
    ...entry,
    createdAt: entry.createdAt || now,
    updatedAt: now,
  };

  if (!supabase) {
    const list = readLocal<JournalEntry[]>(LOCAL_ENTRIES_KEY, []);
    const idx = list.findIndex(x => x.id === next.id);
    if (idx >= 0) list[idx] = next;
    else list.unshift(next);
    writeLocal(LOCAL_ENTRIES_KEY, list);
    return next;
  }

  const userId = await currentUserId();
  const { data, error } = await supabase
    .from('journal_entries')
    .upsert(
      {
        user_id: userId,
        id: next.id,
        account: next.account,
        title: next.title,
        subtitle: next.subtitle,
        body: next.body,
        cover_path: next.coverPath,
        tags: next.tags,
        status: next.status,
        created_at: next.createdAt,
        updated_at: next.updatedAt,
      },
      { onConflict: 'user_id,id' },
    )
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return toEntry(data as EntryRow, entry.commentCount ?? 0);
}

/** Delete a journal entry (its comments cascade-delete in Supabase). */
export async function deleteJournalEntry(id: string): Promise<void> {
  if (!supabase) {
    writeLocal(
      LOCAL_ENTRIES_KEY,
      readLocal<JournalEntry[]>(LOCAL_ENTRIES_KEY, []).filter(x => x.id !== id),
    );
    writeLocal(
      LOCAL_COMMENTS_KEY,
      readLocal<JournalComment[]>(LOCAL_COMMENTS_KEY, []).filter(x => x.entryId !== id),
    );
    return;
  }
  const { error } = await supabase.from('journal_entries').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** Fetch comments/reflections for one entry (oldest first, like a Substack thread). */
export async function listJournalComments(entryId: string): Promise<JournalComment[]> {
  if (!supabase) {
    return readLocal<JournalComment[]>(LOCAL_COMMENTS_KEY, [])
      .filter(c => c.entryId === entryId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  const { data, error } = await supabase
    .from('journal_comments')
    .select('*')
    .eq('entry_id', entryId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as CommentRow[]).map(toComment);
}

/** Add a comment or hindsight reflection to a journal entry. */
export async function addJournalComment(entryId: string, body: string, kind: CommentKind = 'note'): Promise<JournalComment> {
  const now = new Date().toISOString();
  const comment: JournalComment = {
    id: newJournalId('jc'),
    entryId,
    body: body.trim(),
    kind,
    createdAt: now,
    updatedAt: now,
  };
  if (!supabase) {
    const list = readLocal<JournalComment[]>(LOCAL_COMMENTS_KEY, []);
    list.push(comment);
    writeLocal(LOCAL_COMMENTS_KEY, list);
    return comment;
  }
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from('journal_comments')
    .insert({
      user_id: userId,
      id: comment.id,
      entry_id: entryId,
      body: comment.body,
      kind: comment.kind,
      created_at: now,
      updated_at: now,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return toComment(data as CommentRow);
}

/** Update an existing comment's body or kind. */
export async function updateJournalComment(id: string, body: string, kind: CommentKind): Promise<JournalComment> {
  const now = new Date().toISOString();
  if (!supabase) {
    const list = readLocal<JournalComment[]>(LOCAL_COMMENTS_KEY, []);
    const idx = list.findIndex(x => x.id === id);
    if (idx < 0) throw new Error('Comment not found.');
    list[idx] = { ...list[idx], body: body.trim(), kind, updatedAt: now };
    writeLocal(LOCAL_COMMENTS_KEY, list);
    return list[idx];
  }
  const { data, error } = await supabase
    .from('journal_comments')
    .update({ body: body.trim(), kind, updated_at: now })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return toComment(data as CommentRow);
}

/** Delete a comment. */
export async function deleteJournalComment(id: string): Promise<void> {
  if (!supabase) {
    writeLocal(
      LOCAL_COMMENTS_KEY,
      readLocal<JournalComment[]>(LOCAL_COMMENTS_KEY, []).filter(x => x.id !== id),
    );
    return;
  }
  const { error } = await supabase.from('journal_comments').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ---- Images (compress to JPEG <= 1600px, upload to private Supabase Storage bucket, cache signed URLs) ----

const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

function shrinkImage(file: File): Promise<{ blob: Blob; ext: string; mime: string }> {
  if (file.type === 'image/gif') return Promise.resolve({ blob: file, ext: 'gif', mime: 'image/gif' });
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_IMG_SIDE / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * scale));
      c.height = Math.max(1, Math.round(img.height * scale));
      const ctx = c.getContext('2d');
      if (!ctx) return reject(new Error('Could not read image.'));
      ctx.drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(
        blob => (blob ? resolve({ blob, ext: 'jpg', mime: 'image/jpeg' }) : reject(new Error('Could not encode image.'))),
        'image/jpeg',
        0.84,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image.'));
    };
    img.src = url;
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read image.'));
    r.readAsDataURL(blob);
  });
}

/** Compress and upload a journal image. Returns the storage path and an immediately usable preview URL. */
export async function uploadJournalImage(file: File): Promise<{ path: string; url: string }> {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file.');
  const { blob, ext, mime } = await shrinkImage(file);

  if (!supabase) {
    const dataUrl = await blobToDataUrl(blob);
    return { path: dataUrl, url: dataUrl };
  }

  const userId = await currentUserId();
  const path = `${userId}/${newJournalId('img')}.${ext}`;
  const { error } = await supabase.storage.from(IMG_BUCKET).upload(path, blob, { contentType: mime, upsert: false });
  if (error) throw new Error(error.message);

  const { data: signed, error: signErr } = await supabase.storage.from(IMG_BUCKET).createSignedUrl(path, 3600);
  if (signErr || !signed?.signedUrl) throw new Error(signErr?.message || 'Uploaded, but could not load image URL.');
  signedUrlCache.set(path, { url: signed.signedUrl, expiresAt: Date.now() + 50 * 60_000 });
  return { path, url: signed.signedUrl };
}

/** Resolve a Supabase Storage path (or direct URL/data URL) into a displayable URL, with 50-min in-memory cache. */
export async function resolveJournalImageUrl(path: string): Promise<string | null> {
  if (!path) return null;
  if (path.startsWith('data:') || path.startsWith('http://') || path.startsWith('https://')) return path;
  const cached = signedUrlCache.get(path);
  if (cached && cached.expiresAt > Date.now()) return cached.url;
  if (!supabase) return null;

  const { data, error } = await supabase.storage.from(IMG_BUCKET).createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) return null;
  signedUrlCache.set(path, { url: data.signedUrl, expiresAt: Date.now() + 50 * 60_000 });
  return data.signedUrl;
}
