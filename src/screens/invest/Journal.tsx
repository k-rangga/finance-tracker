import { useState } from 'react';
import s from '../../styles/ui.module.css';
import { Dot, Options } from '../../components/ui';
import { IC, Icon } from '../../components/Icon';
import { diffDays, fmtPct, parseISO } from '../../lib/format';
import { C, plInk } from '../../lib/tokens';
import {
  dirOf,
  fmtD,
  fmtR,
  levOf,
  levTag,
  liqOf,
  MK_COLOR,
  nat,
  numIn,
  qtyLabel,
  rMultiple,
  isAdd,
  type FollowedPlan,
  type Portfolio,
  type Trade,
  type TradeUpdate,
} from './model';
import { useInvestFmt } from './Invest';
import { UpdateDetail, UpdateForm, UpdateTimeline } from './Updates';

export type JournalFilter = 'all' | 'open' | 'closed' | 'IDX' | 'US' | 'Crypto';

type Props = {
  today: Date;
  todayISO: string;
  P: Portfolio;
  journal: Trade[];
  filter: JournalFilter;
  setFilter: (f: JournalFilter) => void;
  openId: string | null;
  setOpenId: (id: string | null) => void;
  onClose: (id: string, ex: NonNullable<Trade['ex']>) => void;
  /** Entries as stored (first buy only); `journal` holds them with avg ups/downs folded in. */
  stored: Trade[];
  updates: TradeUpdate[];
  onEdit: (t: Trade) => void;
  onSaveUpdate: (u: TradeUpdate) => void;
  onDeleteUpdate: (id: string) => void;
  /** Google Finance refresh, shared with Portfolio. */
  prices: PriceRefresh;
};

/** "Refresh prices" state, shared by Portfolio and Journal. */
export type PriceRefresh = { refresh: () => void; busy: boolean; msg: string };

export const FP_COLORS: Record<FollowedPlan, [string, string]> = {
  Yes: [C.accentTint, C.accent800],
  Partly: [C.amberTint, C.amberInk],
  No: [C.redTint, C.redInk],
};

type CloseDraft = { px: string; d: string; fp: FollowedPlan; rt: number; ls: string };

export function Journal({ today, todayISO, P, journal, filter, setFilter, openId, setOpenId, onClose, stored, updates, onEdit, onSaveUpdate, onDeleteUpdate, prices }: Props) {
  const { dS } = useInvestFmt();
  /** Add/edit update form, and the detail view of one update. */
  const [form, setForm] = useState<{ t: Trade; editing?: TradeUpdate } | null>(null);
  const [detail, setDetail] = useState<{ t: Trade; u: TradeUpdate } | null>(null);
  const storedOf = (t: Trade) => stored.find(x => x.id === t.id) ?? t;
  const [closing, setClosing] = useState<string | null>(null);
  const [cd, setCd] = useState<CloseDraft>({ px: '', d: todayISO, fp: 'Yes', rt: 3, ls: '' });
  const [err, setErr] = useState('');

  const count = (f: JournalFilter) => journal.filter(t => match(t, f)).length;
  const list = journal.filter(t => match(t, filter)).sort((a, b) => b.d.localeCompare(a.d));
  const filters: [JournalFilter, string][] = [
    ['all', 'All'],
    ['open', 'Open'],
    ['closed', 'Closed'],
    ['IDX', 'IDX'],
    ['US', 'US'],
    ['Crypto', 'Crypto'],
  ];

  const startClose = (t: Trade) => {
    setClosing(t.id);
    setErr('');
    setCd({ px: String(P.lastOf(t)), d: todayISO, fp: 'Yes', rt: 3, ls: '' });
  };
  const saveClose = (t: Trade) => {
    const px = numIn(cd.px, t.mk);
    if (!(px > 0)) return setErr('Enter the exit price.');
    onClose(t.id, { px, d: cd.d || todayISO, fp: cd.fp, rt: cd.rt, ls: cd.ls.trim() });
    setClosing(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Filters on the left, prices on the right, on one line when there's room. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div className={s.pills} role="group" aria-label="Filter entries" style={{ marginRight: 'auto' }}>
          {filters.map(([k, l]) => (
            <button
              key={k}
              type="button"
              aria-pressed={filter === k}
              className={filter === k ? s.optOn : s.opt}
              onClick={() => {
                setFilter(k);
                setClosing(null);
              }}
            >
              {l} · {count(k)}
            </button>
          ))}
        </div>
        <button type="button" className={s.btnOutline} onClick={prices.refresh} disabled={prices.busy}>
          {prices.busy ? 'Refreshing prices…' : 'Refresh prices'}
        </button>
        {prices.msg && (
          <span role="status" style={{ flexBasis: '100%', textAlign: 'right', fontSize: 13, color: C.textMuted }}>
            {prices.msg}
          </span>
        )}
      </div>
      <div className={s.cardFlush}>
        {list.length === 0 && <div style={{ padding: '48px 24px', textAlign: 'center', fontSize: 15, color: C.textMuted }}>No entries here yet.</div>}
        {list.map(t => {
          const isOpen = openId === t.id;
          const cl = !!t.ex;
          const last = cl ? t.ex!.px : P.lastOf(t);
          const ret = ((last - t.px) / t.px) * 100 * dirOf(t) * levOf(t);
          const r = rMultiple(t, last);
          const pl = cl ? P.done.find(d => d.t.id === t.id)?.net ?? 0 : P.pos.find(p => p.t.id === t.id)?.pl ?? 0;
          const rr = t.tg && t.sl && (t.px - t.sl) * dirOf(t) > 0 ? (t.tg - t.px) / (t.px - t.sl) : null;
          const st: [string, string, string] = !cl ? ['Open', C.divider, C.textMuted] : pl > 0 ? ['Win', C.accentTint, C.accent800] : ['Loss', C.redTint, C.redInk];
          const cdays = t.cd ? diffDays(today, parseISO(t.cd)) : null;
          const plan: { k: string; v: string; sub: string; ink?: string }[] = [
            { k: t.q !== storedOf(t).q ? 'Avg entry' : 'Entry', v: nat(t.px, t.mk), sub: qtyLabel(t) + (t.q !== storedOf(t).q ? ` · ${1 + updates.filter(u => u.tradeId === t.id && isAdd(u)).length} buys` : '') },
            { k: 'Target', v: t.tg ? nat(t.tg, t.mk) : '—', sub: t.tg ? fmtPct(((t.tg - t.px) / t.px) * 100) : 'Not set' },
            { k: 'Stop', v: t.sl ? nat(t.sl, t.mk) : '—', sub: t.sl ? fmtPct(((t.sl - t.px) / t.px) * 100) : 'Not set' },
            { k: 'Reward : risk', v: rr ? rr.toFixed(1) + ' : 1' : '—', sub: rr ? (rr >= 2 ? 'Meets 2 : 1' : 'Below 2 : 1') : 'Needs target and stop', ink: rr && rr < 2 ? C.amberInk : undefined },
            { k: 'Conviction', v: t.cv + ' / 5', sub: t.st },
          ];
          if (levOf(t) > 1) plan.splice(1, 0, { k: 'Leverage', v: levTag(t), sub: 'Liquidation ~' + nat(liqOf(t), t.mk), ink: C.amberInk });
          if (cl) plan.push({ k: 'Exit', v: nat(t.ex!.px, t.mk), sub: fmtD(t.ex!.d) }, { k: 'R multiple', v: r == null ? '—' : fmtR(r), sub: fmtPct(ret), ink: plInk(ret) });
          const fp = FP_COLORS[t.ex?.fp ?? 'Partly'];
          const catWhen = t.cd
            ? fmtD(t.cd) + (cl ? '' : cdays! > 0 ? ` · in ${cdays} days` : cdays === 0 ? ' · today' : ' · passed')
            : t.cat
              ? 'No date set'
              : 'Add one so the position has a reason to move';

          return (
            <div key={t.id} style={{ borderBottom: `1px solid ${C.divider}`, background: isOpen ? C.bg : 'transparent' }}>
              <button
                type="button"
                className={`${s.rowBtn} ${s.hoverRow}`}
                aria-expanded={isOpen}
                onClick={() => {
                  setOpenId(isOpen ? null : t.id);
                  setClosing(null);
                }}
                style={{ gap: '12px 16px', flexWrap: 'wrap', padding: '18px 24px' }}
              >
                <Dot color={MK_COLOR[t.mk]} />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 220px', minWidth: 0 }}>
                  <span style={{ fontSize: 16, fontWeight: 600 }}>
                    {t.tk} <span style={{ fontSize: 13, fontWeight: 500, color: C.textMuted }}>{t.nm || t.mk}</span>
                  </span>
                  <span style={{ fontSize: 13, color: C.textMuted }}>
                    {(cl ? `${fmtD(t.d)} → ${fmtD(t.ex!.d)}` : 'Bought ' + fmtD(t.d)) + ' · ' + qtyLabel(t) + ' @ ' + nat(t.px, t.mk)}
                  </span>
                  <span style={{ display: 'flex', gap: 3 }} aria-label={`Conviction ${t.cv} of 5`} role="img">
                    {[1, 2, 3, 4, 5].map(i => (
                      <span key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: i <= t.cv ? C.accent600 : C.borderStrong }} />
                    ))}
                  </span>
                </span>
                <span className={s.badge} style={{ background: C.divider, color: C.textSoft }}>
                  {t.st}
                  {levTag(t) ? ' · ' + levTag(t) : ''}
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, minWidth: 120 }}>
                  <span style={{ fontSize: 16, fontWeight: 600, color: plInk(ret) }}>{fmtPct(ret)}</span>
                  <span style={{ fontSize: 13, color: C.textMuted, whiteSpace: 'nowrap' }}>
                    {cl ? 'Realised ' : 'Unrealised '}
                    {dS(pl, true)}
                  </span>
                </span>
                <span className={s.badge} style={{ minWidth: 44, textAlign: 'center', background: st[1], color: st[2] }}>
                  {st[0]}
                </span>
                <Icon d={IC.chevDown} size={16} color={C.textMuted} style={{ transform: isOpen ? 'rotate(180deg)' : 'none' }} />
              </button>
              {isOpen && (
                <div className="fade-in" style={{ padding: '4px 24px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: '20px 32px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span className={s.eyebrow}>Thesis</span>
                      <p style={{ fontSize: 14, lineHeight: 1.55 }}>{t.th || 'No thesis written.'}</p>
                      {t.tags && <span style={{ fontSize: 13, color: C.textMuted }}>Tags: {t.tags}</span>}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span className={s.eyebrow}>Catalyst</span>
                      <span style={{ fontSize: 14, fontWeight: 600 }}>{t.cat || 'No catalyst set'}</span>
                      <span style={{ fontSize: 13, color: C.textMuted }}>{catWhen}</span>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
                    {plan.map(p => (
                      <div key={p.k} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ fontSize: 13, color: C.textMuted }}>{p.k}</span>
                        <span style={{ fontSize: 16, fontWeight: 600, color: p.ink }}>{p.v}</span>
                        <span style={{ fontSize: 13, color: C.textMuted }}>{p.sub}</span>
                      </div>
                    ))}
                  </div>
                  {cl && (
                    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span className={s.eyebrow} style={{ marginRight: 'auto' }}>
                          Review
                        </span>
                        <span className={s.badge} style={{ padding: '3px 10px', background: fp[0], color: fp[1] }}>
                          Followed plan: {t.ex!.fp ?? '—'}
                        </span>
                        <span className={s.badge} style={{ padding: '3px 10px', background: C.divider, color: C.textSoft }}>
                          Rating {t.ex!.rt ?? '—'} / 5
                        </span>
                      </div>
                      <p style={{ fontSize: 14, lineHeight: 1.55 }}>{t.ex!.ls || 'No lesson written.'}</p>
                    </div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <span className={s.eyebrow}>Updates</span>
                    <UpdateTimeline t={storedOf(t)} updates={updates} onOpen={u => setDetail({ t, u })} />
                  </div>
                  {closing !== t.id && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {!cl && (
                        <button type="button" className={s.btnOutline} onClick={() => setForm({ t })}>
                          <Icon d={IC.plus} size={16} /> Add update
                        </button>
                      )}
                      <button type="button" className={s.btnOutline} onClick={() => onEdit(storedOf(t))}>
                        Edit entry
                      </button>
                      {/* Closing is final, so it sits apart from the everyday actions. */}
                      {!cl && (
                        <button type="button" className={s.btnGhost} onClick={() => startClose(t)} style={{ marginLeft: 'auto' }}>
                          Close trade
                        </button>
                      )}
                    </div>
                  )}
                  {!cl && closing === t.id && (
                    <div style={{ background: C.surface, border: `1.5px solid ${C.accent600}`, borderRadius: 10, padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
                      <span style={{ fontSize: 16, fontWeight: 600 }}>Close {t.tk} and review</span>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                        <label className={s.field}>
                          Exit price ({t.mk === 'IDX' ? 'Rp' : '$'})
                          <input
                            className={s.input}
                            inputMode="decimal"
                            value={cd.px}
                            onChange={e => {
                              setCd({ ...cd, px: e.target.value });
                              setErr('');
                            }}
                          />
                        </label>
                        <label className={s.field}>
                          Exit date
                          <input className={s.input} type="date" value={cd.d} onChange={e => setCd({ ...cd, d: e.target.value })} />
                        </label>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <span className={s.label}>Followed plan?</span>
                        <Options label="Followed plan" items={['Yes', 'Partly', 'No'] as const} value={cd.fp} onChange={fp => setCd({ ...cd, fp })} />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <span className={s.label}>Rating (process, not outcome)</span>
                        <Options label="Rating" round items={[1, 2, 3, 4, 5] as const} value={cd.rt as 1 | 2 | 3 | 4 | 5} onChange={rt => setCd({ ...cd, rt })} />
                      </div>
                      <label className={s.field}>
                        Lesson
                        <textarea
                          className={s.input}
                          rows={3}
                          value={cd.ls}
                          onChange={e => setCd({ ...cd, ls: e.target.value })}
                          placeholder="What would you repeat or change next time?"
                        />
                      </label>
                      {err && (
                        <span className={s.error} role="alert">
                          {err}
                        </span>
                      )}
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button type="button" className={s.btnPrimary} onClick={() => saveClose(t)}>
                          Save review
                        </button>
                        <button type="button" className={s.btnGhost} onClick={() => setClosing(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {form && (
        <UpdateForm
          t={storedOf(form.t)}
          avg={form.t.px}
          last={P.lastOf(form.t)}
          editing={form.editing}
          onClose={() => setForm(null)}
          onSave={u => {
            onSaveUpdate(u);
            setForm(null);
          }}
        />
      )}
      {detail && (
        <UpdateDetail
          t={storedOf(detail.t)}
          updates={updates}
          update={detail.u}
          last={P.lastOf(detail.t)}
          onClose={() => setDetail(null)}
          onEdit={() => {
            setForm({ t: detail.t, editing: detail.u });
            setDetail(null);
          }}
          onDelete={() => {
            onDeleteUpdate(detail.u.id);
            setDetail(null);
          }}
        />
      )}
    </div>
  );
}

function match(t: Trade, f: JournalFilter) {
  if (f === 'all') return true;
  if (f === 'open') return !t.ex;
  if (f === 'closed') return !!t.ex;
  return t.mk === f;
}
