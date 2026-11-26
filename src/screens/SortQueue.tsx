import { useEffect, useState } from 'react';
import s from '../styles/ui.module.css';
import { Modal } from '../components/ui';
import { Celebrate } from '../components/Delight';
import { Logo } from '../components/Logo';
import { IC, Icon } from '../components/Icon';
import { Select } from '../components/Select';
import { CATEGORIES, catFilter, categoryByName, categoryLabel, OTHER_CATEGORIES, parseCatFilter } from '../data/categories';
import type { TxView } from '../lib/budget';
import type { Guesses } from '../lib/guesses';
import { dayLabel, tidyName } from '../lib/format';
import { useSettings } from '../lib/settings';
import { C } from '../lib/tokens';
import { merchantKey } from '../data/transactions';
import { useApplyAll } from './applyScope';
import { FlameIcon } from './categoriesExtras';

type Props = {
  /** Ids to go through, fixed when the queue opens (sorting "All Grab" clears the other Grabs on the way). */
  ids: string[];
  allTxs: TxView[];
  g: Guesses;
  onPick: (t: TxView, cat: string, sub: string | null, all: boolean) => (() => void) | void;
  onClose: () => void;
};

type HistoryItem = { kind: 'sort' | 'skip'; run: () => void };

/**
 * The transactions still in Buffer, one at a time: the best guess as one big button, a few likely others, and
 * every category under Other. "This one / All <merchant>" works as in the row's menu. Supports quick keyboard
 * shortcuts: Enter for top guess, 1–4 for options, S to skip, Z to undo last.
 */
export function SortQueue({ ids, allTxs, g, onPick, onClose }: Props) {
  const { full, settings } = useSettings();
  const [skipped, setSkipped] = useState<string[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [streak, setStreak] = useState(0);
  const [all, setAll] = useApplyAll();
  const live = ids.map(id => allTxs.find(t => t.id === id)).filter((t): t is TxView => !!t);
  const left = live.filter(t => t.cat === 'Buffer' && !skipped.includes(t.id));
  const t = left[0];
  const done = live.filter(x => x.cat !== 'Buffer').length;
  const total = Math.max(1, live.length);
  const options = t ? g.suggest(t) : [];
  const [first, ...rest] = options;

  const pick = (cat: string, sub?: string | null) => {
    if (!t) return;
    const undo = onPick(t, cat, sub ?? null, !!merchantKey(t.title) && all);
    if (undo) setHistory(prev => [...prev, { kind: 'sort', run: undo }]);
    setStreak(n => n + 1);
  };

  const skipCurrent = () => {
    if (!t) return;
    const id = t.id;
    setSkipped(prev => [...prev, id]);
    setHistory(prev => [...prev, { kind: 'skip', run: () => setSkipped(sList => sList.filter(x => x !== id)) }]);
    setStreak(0);
  };

  const undoLast = () => {
    const last = history[history.length - 1];
    if (!last) return;
    setHistory(prev => prev.slice(0, -1));
    last.run();
    if (last.kind === 'sort') setStreak(n => Math.max(0, n - 1));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.toLowerCase() === 'z' && history.length > 0) {
        e.preventDefault();
        undoLast();
        return;
      }
      if (!t) return;
      if (e.key === 'Enter' && first) {
        e.preventDefault();
        pick(first.category, first.sub);
      } else if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        skipCurrent();
      } else if (/^[1-4]$/.test(e.key)) {
        const opt = options[Number(e.key) - 1];
        if (opt) {
          e.preventDefault();
          pick(opt.category, opt.sub);
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [t, first, options, all, history]);

  if (!t)
    return (
      <>
        <Celebrate id={`sort-${done}-${ids[0] ?? 'all'}`} when={done > 0 && skipped.length === 0} />
        <Modal title="All sorted" onClose={onClose} width={460}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 12, padding: '8px 0' }}>
            <Logo size={52} mood={skipped.length ? 'calm' : 'happy'} interactive cheer="Clean slate." />
            <p style={{ fontFamily: 'var(--font-serif)', fontSize: 18, lineHeight: '26px', color: C.text }}>
              {skipped.length
                ? `Nice and steady — ${done} sorted, ${skipped.length} left for later.`
                : done > 0
                  ? `Every rupiah has a calm home. ${done} ${done === 1 ? 'transaction' : 'transactions'} sorted.`
                  : 'Nothing left in Buffer — clean slate.'}
            </p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {history.length > 0 && (
                <button type="button" className={s.btnGhost} onClick={undoLast}>
                  Undo last
                </button>
              )}
              <button type="button" className={s.btnPrimary} onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        </Modal>
      </>
    );

  const guess = g.guesses[t.id];
  const name = tidyName(t.title);
  const others = allTxs.filter(x => x.id !== t.id && !x.isCcPayment && merchantKey(x.title) === merchantKey(t.title)).length;
  const label = (o: { category: string; sub?: string }) => categoryLabel(o.category) + (o.sub ? ' › ' + o.sub : '');
  const every = [
    ...CATEGORIES.filter(c => c.name !== 'Buffer' && !c.auto)
      .sort((a, b) => a.name.localeCompare(b.name))
      .flatMap(c => [
      { value: c.name, label: c.name },
      ...[...(settings.subcategories[c.name] ?? [])].sort((a, b) => a.localeCompare(b)).map(x => ({ value: catFilter(c.name, x), label: `${c.name} › ${x}` })),
    ]),
    ...OTHER_CATEGORIES.map(o => ({ value: o, label: categoryLabel(o), group: 'Not spending' })),
  ];

  return (
    <Modal title={`To sort: ${left.length} left`} onClose={onClose} width={480}>
      <div className={s.sortProgressWrap}>
        <div className={s.track} style={{ height: 5 }} aria-hidden="true">
          <span className={s.fill} style={{ width: `${Math.round(((done + skipped.length) / total) * 100)}%`, background: 'var(--clay)' }} />
        </div>
        {!settings.quietMode && streak >= 2 && (
          <span className={s.sortStreak}>
            <FlameIcon size={13} />
            {streak} sorted
          </span>
        )}
        <span className={s.sortProgressLabel}>
          {done} of {live.length} sorted
        </span>
      </div>

      <div key={t.id} className={`${s.sortCard} ${s.sortCardEnter}`}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: 19, fontWeight: 650, marginRight: 'auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
          <span style={{ fontSize: 19, fontWeight: 650, whiteSpace: 'nowrap' }}>{full(t.amount)}</span>
        </div>
        <span style={{ fontSize: 13, color: C.textMuted }}>
          {dayLabel(t.date)}, {t.time}, {t.account}
          {t.title !== name ? ` (${t.title})` : ''}
        </span>
      </div>

      {guess ? (
        <span className={s.sortWhy}>
          <Icon d={IC.sparkle} size={14} color={C.accent600} />
          <span>
            {guess.why}
            {guess.confidence === 'low' && <span style={{ color: C.textMuted }}> (not sure)</span>}
          </span>
        </span>
      ) : g.status === 'asking' ? (
        <span className={s.sortWhy} style={{ color: C.textMuted }}>
          <Icon d={IC.sparkle} size={14} /> Maxie is looking at your patterns…
        </span>
      ) : null}

      {first && (
        <button type="button" className={s.sortMain} onClick={() => pick(first.category, first.sub)} style={chipStyle(first.category)}>
          <Icon d={categoryByName(first.category)?.icon ?? IC.coins} size={18} />
          <span style={{ marginRight: 'auto' }}>{label(first)}</span>
          <kbd className={`${s.sortKeyHint} ${s.desktopOnly}`}>1</kbd>
          <Icon d={IC.check} size={18} />
        </button>
      )}
      {rest.length > 0 && (
        <div className={s.tplGrid}>
          {rest.map((o, idx) => (
            <button key={o.category + (o.sub ?? '')} type="button" className={s.tplOpt} onClick={() => pick(o.category, o.sub)}>
              <Icon d={categoryByName(o.category)?.icon ?? IC.coins} size={14} />
              {label(o)}
              {idx < 3 && <kbd className={`${s.sortKeyHint} ${s.desktopOnly}`}>{idx + 2}</kbd>}
            </button>
          ))}
        </div>
      )}
      <Select
        ariaLabel="Other category"
        placeholder="Other category…"
        value=""
        onChange={v => {
          const p = parseCatFilter(v);
          pick(p.cat, p.sub ?? null);
        }}
        options={every}
      />

      {merchantKey(t.title) && (
        <div className={s.recatScope} style={{ padding: 0, border: 'none' }}>
          <span>Apply to</span>
          <div className={s.segment} role="group" aria-label="Apply to">
            <button type="button" aria-pressed={!all} onClick={() => setAll(false)}>
              This one
            </button>
            <button type="button" aria-pressed={all} onClick={() => setAll(true)}>
              All {name}
              {others > 0 ? ` (${others + 1})` : ''}
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className={s.btnGhost} onClick={skipCurrent}>
          Skip <kbd className={`${s.sortKeyHint} ${s.desktopOnly}`} style={{ marginLeft: 4 }}>S</kbd>
        </button>
        {history.length > 0 && (
          <button type="button" className={s.btnGhost} onClick={undoLast}>
            Undo <kbd className={`${s.sortKeyHint} ${s.desktopOnly}`} style={{ marginLeft: 4 }}>Z</kbd>
          </button>
        )}
        {g.status === 'no_key' ? (
          <span style={{ fontSize: 12, color: C.textMuted, marginLeft: 'auto' }}>Maxie guesses need the Gemini API key (GEMINI_API_KEY).</span>
        ) : (
          <span className={s.desktopOnly} style={{ fontSize: 12, color: C.textMuted, marginLeft: 'auto' }}>
            Enter / 1–4 sort · S skip · Z undo
          </span>
        )}
      </div>
    </Modal>
  );
}

const chipStyle = (cat: string) => {
  const c = categoryByName(cat);
  return c ? { background: c.tint, color: c.ink, borderColor: c.color } : undefined;
};
