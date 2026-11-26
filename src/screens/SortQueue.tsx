import { useState } from 'react';
import s from '../styles/ui.module.css';
import { Modal } from '../components/ui';
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

type Props = {
  /** Ids to go through, fixed when the queue opens (sorting "All Grab" clears the other Grabs on the way). */
  ids: string[];
  allTxs: TxView[];
  g: Guesses;
  onPick: (t: TxView, cat: string, sub: string | null, all: boolean) => void;
  onClose: () => void;
};

/**
 * The transactions still in Buffer, one at a time: the best guess as one big button, a few likely others, and
 * every category under Other. "This one / All <merchant>" works as in the row's menu.
 */
export function SortQueue({ ids, allTxs, g, onPick, onClose }: Props) {
  const { full, settings } = useSettings();
  const [skipped, setSkipped] = useState<string[]>([]);
  const [all, setAll] = useApplyAll();
  const live = ids.map(id => allTxs.find(t => t.id === id)).filter((t): t is TxView => !!t);
  const left = live.filter(t => t.cat === 'Buffer' && !skipped.includes(t.id));
  const t = left[0];
  const done = live.filter(x => x.cat !== 'Buffer').length;

  if (!t)
    return (
      <Modal title="All sorted" onClose={onClose} width={460}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 12, padding: '8px 0' }}>
          <Logo size={52} mood={skipped.length ? 'calm' : 'happy'} interactive cheer="Clean slate!" />
          <p style={{ fontFamily: 'var(--font-serif)', fontSize: 18, lineHeight: '26px', color: C.text }}>
            {skipped.length
              ? `Nice work — ${done} sorted, ${skipped.length} left for later.`
              : done > 0
                ? `Every rupiah has a home. ${done} ${done === 1 ? 'transaction' : 'transactions'} sorted!`
                : 'Nothing left in Buffer — clean slate.'}
          </p>
          <button type="button" className={s.btnPrimary} onClick={onClose}>
            Done
          </button>
        </div>
      </Modal>
    );

  const guess = g.guesses[t.id];
  const options = g.suggest(t);
  const [first, ...rest] = options;
  const name = tidyName(t.title);
  const others = allTxs.filter(x => x.id !== t.id && !x.isCcPayment && merchantKey(x.title) === merchantKey(t.title)).length;
  const pick = (cat: string, sub?: string | null) => onPick(t, cat, sub ?? null, !!merchantKey(t.title) && all);
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
      <div className={s.sortCard}>
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
          <Icon d={IC.check} size={18} />
        </button>
      )}
      {rest.length > 0 && (
        <div className={s.tplGrid}>
          {rest.map(o => (
            <button key={o.category + (o.sub ?? '')} type="button" className={s.tplOpt} onClick={() => pick(o.category, o.sub)}>
              <Icon d={categoryByName(o.category)?.icon ?? IC.coins} size={14} />
              {label(o)}
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

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button type="button" className={s.btnGhost} onClick={() => setSkipped([...skipped, t.id])}>
          Skip
        </button>
        {g.status === 'no_key' && <span style={{ fontSize: 12, color: C.textMuted, marginLeft: 'auto' }}>Maxie guesses need the Gemini API key (GEMINI_API_KEY).</span>}
      </div>
    </Modal>
  );
}

const chipStyle = (cat: string) => {
  const c = categoryByName(cat);
  return c ? { background: c.tint, color: c.ink, borderColor: c.color } : undefined;
};
