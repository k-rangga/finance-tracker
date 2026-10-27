import { useEffect, useState } from 'react';
import s from '../styles/ui.module.css';
import { Badge, IconChip, Pills } from '../components/ui';
import { IC, Icon } from '../components/Icon';
import { categoryStatus, changeBadge, iconColors, type Budget, type CatView } from '../lib/budget';
import type { Cycle } from '../lib/cycle';
import { pc } from '../lib/format';
import { useSettings } from '../lib/settings';
import { C } from '../lib/tokens';

type Mode = 'cycle' | 'week';
type Group = 'all' | 'fixed' | 'variable';

type Props = {
  cycle: Cycle;
  budget: Budget;
  open: string | null;
  setOpen: (n: string | null) => void;
  onShowTransactions: (cat: string) => void;
  /** Open the edit dialog for a category (built-in: limit and colour only). */
  onEditCategory: (name: string) => void;
  onNewCategory: () => void;
};

export function Categories({ cycle, budget, open, setOpen, onShowTransactions, onEditCategory, onNewCategory }: Props) {
  const { settings, full, short } = useSettings();
  const [mode, setMode] = useState<Mode>('cycle');
  const [group, setGroup] = useState<Group>('all');
  const wi = cycle.weekIdx;

  useEffect(() => {
    if (open) document.getElementById('cat-' + open)?.scrollIntoView({ block: 'center' });
    // Only on arrival, so a category opened from Summary scrolls into view.
  }, []);

  const view = (c: CatView) => {
    const isCycle = mode === 'cycle';
    const cur = isCycle ? c.spent : c.cur[wi];
    const last = isCycle ? c.lastSameDays : wi > 0 ? c.cur[wi - 1] : c.prev[3];
    const lim = isCycle ? c.limit : c.limit / 4;
    const used = lim ? (cur / lim) * 100 : 0;
    const st = isCycle ? c.status : categoryStatus(used, c, settings.warnAt);
    return { c, cur, last, lim, used, st, scale: Math.max(lim, cur, last) * 1.08 };
  };

  const rank = (a: ReturnType<typeof view>, b: ReturnType<typeof view>) => a.st.rank - b.st.rank || b.used - a.used;
  const showFixed = mode === 'cycle' && group !== 'variable';
  const showVar = group !== 'fixed';
  const sections: [string, ReturnType<typeof view>[]][] = [];
  if (showFixed) sections.push(['Fixed bills', budget.cats.filter(c => c.type === 'fixed').map(view).sort(rank)]);
  if (showVar) sections.push(['Variable', budget.cats.filter(c => c.type === 'variable').map(view).sort(rank)]);

  const caption =
    mode === 'cycle'
      ? `Day ${cycle.dayN} of this cycle vs the same ${cycle.dayN} days last cycle. Black tick = cycle limit. Click a row for weekly history.`
      : `Week ${wi + 1} vs ${wi > 0 ? 'week ' + wi : 'the last week of the previous cycle'}, variable categories only. Black tick = weekly share of limit.`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Pills
          label="Comparison"
          items={[
            ['cycle', 'This cycle vs last'],
            ['week', 'This week vs last'],
          ]}
          value={mode}
          onChange={m => {
            setMode(m);
            setOpen(null);
          }}
        />
        <button type="button" className={s.btnOutline} onClick={onNewCategory} style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Icon d={IC.plus} size={16} /> New category
        </button>
        <select className={s.select} style={{ width: 'auto', borderRadius: 999, fontSize: 14, padding: '10px 44px 10px 18px' }} value={group} onChange={e => setGroup(e.target.value as Group)} aria-label="Filter categories">
          <option value="all">All categories</option>
          <option value="fixed">Fixed bills</option>
          <option value="variable">Variable</option>
        </select>
      </div>
      <span style={{ fontSize: 13, color: C.textMuted }}>{caption}</span>
      {sections.length === 0 && (
        <div className={s.cardFlush} style={{ padding: '40px 24px', textAlign: 'center', fontSize: 14, color: C.textMuted }}>
          Fixed bills are monthly, so they only appear in the cycle comparison.
        </div>
      )}
      {sections.map(([title, rows]) => (
        <section key={title} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, color: C.textMuted, letterSpacing: 0, padding: '0 4px' }}>
            {title} · {full(rows.reduce((a, r) => a + r.cur, 0))} of {full(rows.reduce((a, r) => a + r.lim, 0))}
          </h2>
          <div className={s.cardFlush}>
            {rows.map(({ c, cur, last, lim, st, scale }) => {
              const isOpen = open === c.name;
              const ic = iconColors(c.name);
              const ch = changeBadge(cur, last);
              const wmax = Math.max(...c.cur, ...c.prev, 0.01);
              return (
                <div key={c.name} id={'cat-' + c.name} style={{ borderBottom: `1.5px solid ${C.divider}`, background: st.rowBg }}>
                  <button
                    type="button"
                    className={s.rowBtn}
                    aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : c.name)}
                    style={{ flexDirection: 'column', alignItems: 'stretch', padding: '20px 24px', gap: 12 }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                      <IconChip d={c.icon} bg={ic.bg} ink={ic.ink} size={40} iconSize={18} />
                      <span style={{ fontWeight: 700, fontSize: 16, marginRight: 'auto' }}>{c.name}</span>
                      <Badge bg={st.bg} ink={st.ink}>
                        {st.label}
                      </Badge>
                      <Badge bg={ch.bg} ink={ch.ink} style={{ fontSize: 13, fontWeight: 800 }}>
                        {ch.label}
                      </Badge>
                      <Icon d={IC.chevDown} size={16} color={C.textMuted} style={{ transform: isOpen ? 'rotate(180deg)' : 'none' }} />
                    </span>
                    <span style={{ display: 'grid', gridTemplateColumns: '44px minmax(0, 1fr) auto', alignItems: 'center', gap: '8px 12px', fontSize: 13 }}>
                      <span style={{ fontWeight: 700 }}>This</span>
                      <span className={s.track}>
                        <span className={s.fill} style={{ width: pc((cur / scale) * 100), background: st.bar }} />
                        <span className={s.tick} style={{ left: pc((lim / scale) * 100) }} />
                      </span>
                      <span style={{ fontWeight: 700, minWidth: 96, textAlign: 'right' }}>{full(cur)}</span>
                      <span style={{ color: C.textMuted }}>Last</span>
                      <span className={s.track}>
                        <span className={s.fill} style={{ width: pc((last / scale) * 100), background: C.grey }} />
                        <span className={s.tick} style={{ left: pc((lim / scale) * 100) }} />
                      </span>
                      <span style={{ color: C.textMuted, minWidth: 96, textAlign: 'right' }}>{full(last)}</span>
                    </span>
                    <span style={{ display: 'flex', gap: '4px 16px', flexWrap: 'wrap', fontSize: 13, color: C.textMuted }}>
                      <span>
                        Limit <strong style={{ color: C.text }}>{full(lim)}</strong>
                      </span>
                      <span>
                        Spent <strong style={{ color: C.text }}>{full(cur)}</strong>
                      </span>
                      <span>
                        {lim - cur >= 0 ? 'Remaining ' : 'Over by '}
                        <strong style={{ color: lim - cur >= 0 ? C.accent800 : C.redInk }}>{full(Math.abs(lim - cur))}</strong>
                      </span>
                    </span>
                    {st.key !== 'ok' && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: st.key === 'over' ? C.redInk : C.amberInk }}>
                        <Icon d={IC.alert} size={16} />
                        {st.key === 'over' ? `Limit reached · ${short(cur - lim)} over` : `${settings.warnAt}% of limit used · ${short(lim - cur)} left`}
                      </span>
                    )}
                  </button>
                  {isOpen && (
                    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 24px 20px' }}>
                      <span style={{ fontSize: 13, color: C.textMuted }}>Weekly · this cycle (colour) vs last cycle (grey) · limit {short(c.limit)}</span>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12, height: 90, alignItems: 'end', maxWidth: 420 }}>
                        {[0, 1, 2, 3].map(i => (
                          <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'end', justifyContent: 'center', height: '100%' }} title={`W${i + 1}: ${full(c.cur[i])} vs ${full(c.prev[i])}`}>
                            <div style={{ width: 14, borderRadius: 999, height: pc((c.cur[i] / wmax) * 100), background: st.bar }} />
                            <div style={{ width: 14, borderRadius: 999, height: pc((c.prev[i] / wmax) * 100), background: C.grey }} />
                          </div>
                        ))}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12, fontSize: 13, textAlign: 'center', color: C.textMuted, maxWidth: 420 }}>
                        {[1, 2, 3, 4].map(i => (
                          <span key={i}>W{i}</span>
                        ))}
                      </div>
                      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                        <button type="button" className={s.linkBtn} onClick={() => onShowTransactions(c.name)}>
                          See {c.name.toLowerCase()} transactions <Icon d={IC.arrowRight} size={14} />
                        </button>
                        <button type="button" className={s.linkBtn} onClick={() => onEditCategory(c.name)}>
                          {c.custom ? 'Edit category' : 'Edit limit or colour'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
