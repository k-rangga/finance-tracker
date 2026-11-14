import { useState, type ReactNode } from 'react';
import s from '../../styles/ui.module.css';
import { Dot } from '../../components/ui';
import { usd } from '../../lib/perps';
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
import { manualDraft, needsReview, withReview, type AnyTrade } from './trades';
import { ReviewFields, useAutosave, type ReviewDraft } from './ReviewFields';
import { PerpDetail, px, ReviewBox, when, type Perps } from './Perps';

/** Perps' colour: beside their trades and on the Perps switch, as markets have theirs. */
export const HL_COLOR = '#7c6cf0';


/** A trade's row: name and what kind, dates and size, return and P/L, and its review at a glance. */
function TradeHead({
  open,
  onClick,
  dot,
  name,
  tag,
  line,
  pct,
  money,
  review,
}: {
  open: boolean;
  onClick: () => void;
  dot: string;
  name: string;
  tag: string;
  line: string;
  pct: number | null;
  money: string;
  review: ReactNode;
}) {
  return (
    <button type="button" className={`${s.tradeRow} ${s.hoverRow}`} aria-expanded={open} onClick={onClick}>
      <Dot color={dot} />
      <span className={s.tradeMain}>
        <span className={s.tradeName}>
          {name} <span className={s.tradeTag}>{tag}</span>
        </span>
        <span className={s.tradeLine}>{line}</span>
        {review}
      </span>
      <span className={s.tradeNums}>
        <span style={{ fontSize: 16, fontWeight: 600, color: pct == null ? C.textMuted : plInk(pct) }}>{pct == null ? '—' : fmtPct(pct)}</span>
        <span className={s.tradeLine}>{money}</span>
      </span>
      <Icon d={IC.chevDown} size={16} color={C.textMuted} style={{ transform: open ? 'rotate(180deg)' : 'none', flex: 'none' }} />
    </button>
  );
}

/** Setup, mistakes and followed plan as small tags; "Needs review" when a closed trade has none; open trades: nothing yet. */
function ReviewLine({ item: t }: { item: AnyTrade }) {
  if (!t.closed) return null;
  if (needsReview(t))
    return (
      <span className={s.tradeTags}>
        <span className={s.badgeDot} style={{ background: C.amber }} aria-hidden="true" />
        <span style={{ color: C.amberInk, fontWeight: 600 }}>Needs review</span>
      </span>
    );
  return (
    <span className={s.tradeTags}>
      {t.followed && (
        <span className={s.tradeChip} style={{ background: FP_COLORS[t.followed][0], color: FP_COLORS[t.followed][1] }}>
          Plan: {t.followed}
        </span>
      )}
      {t.setup && <span className={s.tradeChip}>{t.setup}</span>}
      {t.mistakes.map(m => (
        <span key={m} className={s.tradeChip} style={{ background: C.redTint, color: C.redInk }}>
          {m}
        </span>
      ))}
      {t.lesson && (
        <span className={s.ellipsis} style={{ color: C.textSoft, fontStyle: 'italic', minWidth: 0, flex: '1 1 160px' }}>
          “{t.lesson}”
        </span>
      )}
    </span>
  );
}

type Props = {
  today: Date;
  todayISO: string;
  P: Portfolio;
  /** The trades to list (one account, already filtered), newest first. */
  items: AnyTrade[];
  hl: Perps;
  openId: string | null;
  setOpenId: (id: string | null) => void;
  onClose: (id: string, ex: NonNullable<Trade['ex']>) => void;
  /** Entries as stored (first buy only); `journal` holds them with avg ups/downs folded in. */
  stored: Trade[];
  updates: TradeUpdate[];
  onEdit: (t: Trade) => void;
  onSaveUpdate: (u: TradeUpdate) => void;
  onDeleteUpdate: (id: string) => void;
};

/** "Refresh prices" state, shared by Portfolio and Journal. */
export type PriceRefresh = { refresh: () => void; busy: boolean; msg: string };

export const FP_COLORS: Record<FollowedPlan, [string, string]> = {
  Yes: [C.accentTint, C.accent800],
  Partly: [C.amberTint, C.amberInk],
  No: [C.redTint, C.redInk],
};

/** Closing a trade: exit price and date, then the review. */
type CloseDraft = { px: string; d: string; review: ReviewDraft };

/** A closed entry's review, saved as you go, like a Hyperliquid trade's. */
function ManualReview({ ex, onSave }: { ex: NonNullable<Trade['ex']>; onSave: (ex: NonNullable<Trade['ex']>) => void }) {
  const { draft, change, label } = useAutosave(manualDraft(ex), d => onSave(withReview(ex, d)));
  return (
    <ReviewBox label={label}>
      <ReviewFields value={draft} onChange={change} />
    </ReviewBox>
  );
}

export function Journal({ today, todayISO, P, items, hl, openId, setOpenId, onClose, stored, updates, onEdit, onSaveUpdate, onDeleteUpdate }: Props) {
  const { dS } = useInvestFmt();
  /** Add/edit update form, and the detail view of one update. */
  const [form, setForm] = useState<{ t: Trade; editing?: TradeUpdate } | null>(null);
  const [detail, setDetail] = useState<{ t: Trade; u: TradeUpdate } | null>(null);
  const storedOf = (t: Trade) => stored.find(x => x.id === t.id) ?? t;
  const [closing, setClosing] = useState<string | null>(null);
  const [cd, setCd] = useState<CloseDraft>({ px: '', d: todayISO, review: manualDraft() });
  const [err, setErr] = useState('');

  const startClose = (t: Trade) => {
    setClosing(t.id);
    setErr('');
    setCd({ px: String(P.lastOf(t)), d: todayISO, review: manualDraft() });
  };
  const saveClose = (t: Trade) => {
    const px = numIn(cd.px, t.mk);
    if (!(px > 0)) return setErr('Enter the exit price.');
    onClose(t.id, withReview({ px, d: cd.d || todayISO }, cd.review));
    setClosing(null);
  };

  /** A Hyperliquid trade, laid out like an entry's row: name, dates and size, side, return and P/L, result. */
  const perpRow = (item: AnyTrade) => {
    const t = item.perp!;
    const isOpen = openId === item.key;
    return (
      <div key={item.key} style={{ borderBottom: `1px solid ${C.divider}`, background: isOpen ? C.bg : 'transparent' }}>
        <TradeHead
          open={isOpen}
          onClick={() => setOpenId(isOpen ? null : item.key)}
          dot={HL_COLOR}
          name={t.coin}
          tag={t.side + (t.liquidated ? ' · liquidated' : '')}
          line={(t.closed ? `${when(t.opened)} → ${when(t.closed)}` : 'Open since ' + when(t.opened)) + ` · ${px(t.maxSize)} @ ${px(t.entry)}`}
          pct={item.ret}
          money={t.closed ? usd(t.pnl, true) : 'Open'}
          review={<ReviewLine item={item} />}
        />
        {isOpen && <PerpDetail key={t.id} t={t} note={hl.notes[t.id]} onSave={n => hl.saveNote(t.id, n)} />}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className={s.cardFlush}>
        {items.length === 0 && <div style={{ padding: '48px 24px', textAlign: 'center', fontSize: 15, color: C.textMuted }}>No trades match.</div>}
        {items.map(item => {
          if (item.perp) return perpRow(item);
          const t = item.manual!;
          const isOpen = openId === item.key;
          const cl = !!t.ex;
          const last = cl ? t.ex!.px : P.lastOf(t);
          const ret = ((last - t.px) / t.px) * 100 * dirOf(t) * levOf(t);
          const r = rMultiple(t, last);
          const pl = cl ? P.done.find(d => d.t.id === t.id)?.net ?? 0 : P.pos.find(p => p.t.id === t.id)?.pl ?? 0;
          const rr = t.tg && t.sl && (t.px - t.sl) * dirOf(t) > 0 ? (t.tg - t.px) / (t.px - t.sl) : null;
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
          const catWhen = t.cd
            ? fmtD(t.cd) + (cl ? '' : cdays! > 0 ? ` · in ${cdays} days` : cdays === 0 ? ' · today' : ' · passed')
            : t.cat
              ? 'No date set'
              : 'Add one so the position has a reason to move';

          return (
            <div key={t.id} style={{ borderBottom: `1px solid ${C.divider}`, background: isOpen ? C.bg : 'transparent' }}>
              <TradeHead
                open={isOpen}
                onClick={() => {
                  setOpenId(isOpen ? null : item.key);
                  setClosing(null);
                }}
                dot={MK_COLOR[t.mk]}
                name={t.tk}
                tag={[t.nm || t.mk, t.st, levTag(t)].filter(Boolean).join(' · ')}
                line={
                  (cl ? `${fmtD(t.d)} → ${fmtD(t.ex!.d)}` : 'Since ' + fmtD(t.d)) +
                  ` · ${qtyLabel(t)} @ ${nat(t.px, t.mk)}` +
                  (cl ? '' : P.hasPrice(t) ? ` · now ${nat(last, t.mk)}` : ' · no price yet')
                }
                pct={ret}
                money={(cl ? '' : 'Open ') + dS(pl, true)}
                review={<ReviewLine item={item} />}
              />
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
                  {cl && <ManualReview key={t.id} ex={t.ex!} onSave={ex => onClose(t.id, ex)} />}
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
                      <span style={{ fontSize: 16, fontWeight: 600 }}>Close {t.tk}</span>
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
                          Close trade
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
