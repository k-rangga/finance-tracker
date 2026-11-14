import { useState } from 'react';
import s from '../../styles/ui.module.css';
import { Dot } from '../../components/ui';
import { Select } from '../../components/Select';
import { usd } from '../../lib/perps';
import { useIsPhone } from '../../lib/media';
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
import { SOURCE_NAME, splitTags, type AnyTrade, type Source } from './trades';
import { ReviewFields, type ReviewDraft } from './ReviewFields';
import { PerpDetail, px, SyncLine, ConnectWallet, when, type Perps } from './Perps';

/** Which trades show: by source, open or closed, and one ticker or coin (or all). */
export type JournalFilter = { source: 'all' | Source; status: 'all' | 'open' | 'closed'; name: string };
export const ALL_TRADES: JournalFilter = { source: 'all', status: 'all', name: '' };

/** Hyperliquid's colour beside a trade, as markets have theirs. */
const HL_COLOR = '#7c6cf0';

type Props = {
  today: Date;
  todayISO: string;
  P: Portfolio;
  /** Typed-in entries and Hyperliquid trades together, newest first. */
  items: AnyTrade[];
  hl: Perps;
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

/** Closing a trade, or changing a closed one's review: exit price and date, then the review. */
type CloseDraft = { px: string; d: string; review: ReviewDraft };

const reviewOf = (ex?: Trade['ex']): ReviewDraft => ({ followed: ex?.fp ?? '', rating: ex?.rt ?? 0, setup: ex?.su ?? '', mistakes: splitTags(ex?.mi), note: ex?.ls ?? '' });

export function Journal({ today, todayISO, P, items, hl, filter, setFilter, openId, setOpenId, onClose, stored, updates, onEdit, onSaveUpdate, onDeleteUpdate, prices }: Props) {
  const { dS } = useInvestFmt();
  /** Add/edit update form, and the detail view of one update. */
  const [form, setForm] = useState<{ t: Trade; editing?: TradeUpdate } | null>(null);
  const [detail, setDetail] = useState<{ t: Trade; u: TradeUpdate } | null>(null);
  const storedOf = (t: Trade) => stored.find(x => x.id === t.id) ?? t;
  const [closing, setClosing] = useState<string | null>(null);
  const [cd, setCd] = useState<CloseDraft>({ px: '', d: todayISO, review: reviewOf() });
  const [err, setErr] = useState('');
  const phone = useIsPhone();

  const match = (t: AnyTrade, f: JournalFilter) =>
    (f.source === 'all' || t.source === f.source) && (f.status === 'all' || (f.status === 'open') === !t.closed) && (!f.name || t.name === f.name);
  const count = (patch: Partial<JournalFilter>) => items.filter(t => match(t, { ...filter, ...patch })).length;
  const list = items.filter(t => match(t, filter));
  const names = [...new Set(items.filter(t => match(t, { ...filter, name: '' })).map(t => t.name))].sort();
  const set = (patch: Partial<JournalFilter>) => {
    setFilter({ ...filter, ...patch });
    setClosing(null);
  };

  const startClose = (t: Trade) => {
    setClosing(t.id);
    setErr('');
    setCd({ px: String(t.ex?.px ?? P.lastOf(t)), d: t.ex?.d ?? todayISO, review: reviewOf(t.ex) });
  };
  const saveClose = (t: Trade) => {
    const px = numIn(cd.px, t.mk);
    if (!(px > 0)) return setErr('Enter the exit price.');
    const r = cd.review;
    onClose(t.id, { px, d: cd.d || todayISO, fp: r.followed || undefined, rt: r.rating || undefined, ls: r.note.trim(), su: r.setup || undefined, mi: r.mistakes.join(',') || undefined });
    setClosing(null);
  };

  /** A Hyperliquid trade, laid out like an entry's row: name, dates and size, side, return and P/L, result. */
  const perpRow = (item: AnyTrade) => {
    const t = item.perp!;
    const isOpen = openId === item.key;
    const st: [string, string, string] = !t.closed ? ['Open', C.divider, C.textMuted] : t.pnl > 0 ? ['Win', C.accentTint, C.accent800] : ['Loss', C.redTint, C.redInk];
    return (
      <div key={item.key} style={{ borderBottom: `1px solid ${C.divider}`, background: isOpen ? C.bg : 'transparent' }}>
        <button
          type="button"
          className={`${s.rowBtn} ${s.hoverRow}`}
          aria-expanded={isOpen}
          onClick={() => setOpenId(isOpen ? null : item.key)}
          style={{ gap: '12px 16px', flexWrap: 'wrap', padding: '18px 24px' }}
        >
          <Dot color={HL_COLOR} />
          <span style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 220px', minWidth: 0 }}>
            <span style={{ fontSize: 16, fontWeight: 600 }}>
              {t.coin} <span style={{ fontSize: 13, fontWeight: 500, color: C.textMuted }}>Hyperliquid</span>
            </span>
            <span style={{ fontSize: 13, color: C.textMuted }}>
              {(t.closed ? `${when(t.opened)} → ${when(t.closed)}` : 'Opened ' + when(t.opened)) + ` · ${px(t.maxSize)} @ ${px(t.entry)} · ${t.fills.length} fill${t.fills.length === 1 ? '' : 's'}`}
            </span>
          </span>
          <span className={s.badge} style={{ background: C.divider, color: C.textSoft }}>
            Perp · {t.side}
            {t.liquidated ? ' · liquidated' : ''}
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, minWidth: 120 }}>
            <span style={{ fontSize: 16, fontWeight: 600, color: item.ret == null ? C.textMuted : plInk(item.ret) }}>{item.ret == null ? '—' : fmtPct(item.ret)}</span>
            <span style={{ fontSize: 13, color: C.textMuted, whiteSpace: 'nowrap' }}>{t.closed ? 'Realised ' + usd(t.pnl, true) : 'Open on Overview'}</span>
          </span>
          <span className={s.badge} style={{ minWidth: 44, textAlign: 'center', background: st[1], color: st[2] }}>
            {st[0]}
          </span>
          <Icon d={IC.chevDown} size={16} color={C.textMuted} style={{ transform: isOpen ? 'rotate(180deg)' : 'none' }} />
        </button>
        {isOpen && <PerpDetail key={t.id} t={t} note={hl.notes[t.id]} onSave={n => hl.saveNote(t.id, n)} />}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Where trades come from, open or closed, and one name: the same filters for every source. Phones get dropdowns. */}
      {phone ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Select
              ariaLabel="Source"
              value={filter.source}
              onChange={v => set({ source: v, name: '' })}
              options={(['all', 'manual', 'perp'] as const).map(k => ({ value: k, label: `${k === 'all' ? 'All' : SOURCE_NAME[k]} · ${count({ source: k, name: '' })}` }))}
            />
            <Select
              ariaLabel="Status"
              value={filter.status}
              onChange={v => set({ status: v })}
              options={[
                { value: 'all' as const, label: 'Open & closed' },
                { value: 'open' as const, label: 'Open' },
                { value: 'closed' as const, label: 'Closed' },
              ]}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Select ariaLabel="Ticker or coin" value={filter.name} onChange={name => set({ name })} options={[{ value: '', label: 'All names' }, ...names.map(n => ({ value: n, label: n }))]} style={{ flex: 1 }} />
            {filter.source !== 'perp' && (
              <button type="button" className={s.iconBtn} onClick={prices.refresh} disabled={prices.busy} aria-label="Refresh stock and crypto prices" title="Refresh prices">
                <Icon d={IC.refresh} size={16} />
              </button>
            )}
            {filter.source !== 'manual' && hl.state?.address && (
              <button type="button" className={s.btnOutlineSm} onClick={() => hl.sync()} disabled={hl.syncing}>
                {hl.syncing ? 'Syncing…' : 'Sync Hyperliquid'}
              </button>
            )}
          </div>
          {filter.source === 'perp' && hl.state && !hl.state.address && <ConnectWallet hl={hl} />}
        </>
      ) : (
        <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div className={s.pills} role="group" aria-label="Source">
          {(['all', 'manual', 'perp'] as const).map(k => (
            <button key={k} type="button" aria-pressed={filter.source === k} className={filter.source === k ? s.optOn : s.opt} onClick={() => set({ source: k, name: '' })}>
              {k === 'all' ? 'All' : SOURCE_NAME[k]} · {count({ source: k, name: '' })}
            </button>
          ))}
        </div>
        <div className={s.pills} role="group" aria-label="Status">
          {(['all', 'open', 'closed'] as const).map(k => (
            <button key={k} type="button" aria-pressed={filter.status === k} className={filter.status === k ? s.optOn : s.opt} onClick={() => set({ status: k })}>
              {k === 'all' ? 'Open & closed' : k === 'open' ? 'Open' : 'Closed'}
            </button>
          ))}
        </div>
        <Select ariaLabel="Ticker or coin" value={filter.name} onChange={name => set({ name })} options={[{ value: '', label: 'All names' }, ...names.map(n => ({ value: n, label: n }))]} style={{ minWidth: 150 }} />
      </div>
      {filter.source !== 'perp' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 13, color: C.textMuted }}>
          <span style={{ marginRight: 'auto' }}>{prices.msg || 'Stocks & crypto prices from Google Finance'}</span>
          <button type="button" className={s.btnOutlineSm} onClick={prices.refresh} disabled={prices.busy}>
            <Icon d={IC.refresh} size={14} />
            {prices.busy ? 'Refreshing…' : 'Refresh prices'}
          </button>
        </div>
      )}
      {filter.source !== 'manual' && (hl.state && !hl.state.address ? filter.source === 'perp' && <ConnectWallet hl={hl} /> : <SyncLine hl={hl} />)}
        </>
      )}
      <div className={s.cardFlush}>
        {list.length === 0 && <div style={{ padding: '48px 24px', textAlign: 'center', fontSize: 15, color: C.textMuted }}>No trades here yet.</div>}
        {list.map(item => {
          if (item.perp) return perpRow(item);
          const t = item.manual!;
          const isOpen = openId === item.key;
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
                  setOpenId(isOpen ? null : item.key);
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
                        {t.ex!.su && (
                          <span className={s.badge} style={{ padding: '3px 10px', background: C.divider, color: C.textSoft }}>
                            {t.ex!.su}
                          </span>
                        )}
                        {splitTags(t.ex!.mi).map(m => (
                          <span key={m} className={s.badge} style={{ padding: '3px 10px', background: C.redTint, color: C.redInk }}>
                            {m}
                          </span>
                        ))}
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
                      {cl && (
                        <button type="button" className={s.btnOutline} onClick={() => startClose(t)}>
                          Edit review
                        </button>
                      )}
                      {/* Closing is final, so it sits apart from the everyday actions. */}
                      {!cl && (
                        <button type="button" className={s.btnGhost} onClick={() => startClose(t)} style={{ marginLeft: 'auto' }}>
                          Close trade
                        </button>
                      )}
                    </div>
                  )}
                  {closing === t.id && (
                    <div style={{ background: C.surface, border: `1.5px solid ${C.accent600}`, borderRadius: 10, padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
                      <span style={{ fontSize: 16, fontWeight: 600 }}>{cl ? `Review ${t.tk}` : `Close ${t.tk} and review`}</span>
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
                      <ReviewFields value={cd.review} onChange={review => setCd({ ...cd, review })} />
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
