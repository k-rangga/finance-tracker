import { useState } from 'react';
import { createPortal } from 'react-dom';
import s from '../../styles/ui.module.css';
import { Modal } from '../../components/ui';
import { Celebrate } from '../../components/Delight';
import { Logo } from '../../components/Logo';
import { usd } from '../../lib/perps';
import { fmtPct } from '../../lib/format';
import { C, plInk } from '../../lib/tokens';
import { ReviewFields, SavedLabel, useAutosave } from './ReviewFields';
import { manualDraft, perpDraft, perpNoteOf, withReview, type AnyTrade } from './trades';
import { fmtD, nat, qtyLabel, type Trade } from './model';
import { px, when, type Perps } from './Perps';
import { useInvestFmt } from './Invest';

type Props = {
  /** The trades waiting for a review, as they were when this opened (newest first). */
  queue: AnyTrade[];
  hl: Perps;
  onSaveManual: (id: string, ex: NonNullable<Trade['ex']>) => void;
  onClose: () => void;
};

/**
 * Reviewing a backlog, one trade at a time: what happened, then followed plan, tags and a lesson (each saved as you
 * go). Next moves on; Skip leaves it waiting; old Hyperliquid trades can all be marked reviewed at once.
 */
export function QuickReview({ queue, hl, onSaveManual, onClose }: Props) {
  const [i, setI] = useState(0);
  const t = queue[i];
  const rest = queue.slice(i).filter(x => x.perp);

  return createPortal(
    <>
      <Celebrate id={`quickreview-${queue.length}-${queue[0]?.key ?? 'done'}`} when={!t && queue.length > 0} />
      <Modal title={t ? `Review ${i + 1} of ${queue.length}` : 'All caught up!'} onClose={onClose} width={620}>
        {!t ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 12, padding: '8px 0' }}>
            <Logo size={52} mood="happy" interactive cheer="Sharp discipline!" />
            <p style={{ fontFamily: 'var(--font-serif)', fontSize: 18, lineHeight: '26px', color: C.text }}>
              Nice work — every trade in this list is reviewed! Your Journal has them all, month by month.
            </p>
            <button type="button" className={s.btnPrimary} onClick={onClose}>
              Done
            </button>
          </div>
        ) : (
        <>
          <div className={s.track} style={{ height: 4 }} aria-hidden="true">
            <span className={s.fill} style={{ width: `${(i / queue.length) * 100}%`, background: C.accent600 }} />
          </div>
          <Item key={t.key} t={t} hl={hl} onSaveManual={onSaveManual} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {rest.length > 1 && (
              <button
                type="button"
                className={s.btnGhost}
                style={{ marginRight: 'auto', fontSize: 13 }}
                onClick={() => {
                  if (!window.confirm(`Mark the remaining ${rest.length} Hyperliquid trades as reviewed, without notes? They'll stop showing as "to review".`)) return;
                  hl.skip(rest.map(x => x.perp!.id));
                  setI(queue.length);
                }}
              >
                Mark the rest reviewed
              </button>
            )}
            <button type="button" className={s.btnOutline} style={{ marginLeft: rest.length > 1 ? 0 : 'auto' }} onClick={() => setI(i + 1)}>
              Skip
            </button>
            <button type="button" className={s.btnPrimary} onClick={() => setI(i + 1)}>
              Next →
            </button>
          </div>
        </>
      )}
    </Modal>
    </>,
    document.body,
  );
}

/** One trade: a short summary, then its review form. */
function Item({ t, hl, onSaveManual }: { t: AnyTrade; hl: Perps; onSaveManual: Props['onSaveManual'] }) {
  const { dS } = useInvestFmt();
  const p = t.perp;
  const m = t.manual;
  const { draft, change, label } = useAutosave(p ? perpDraft(hl.notes[p.id]) : manualDraft(m!.ex), d =>
    p ? hl.saveNote(p.id, perpNoteOf(d)) : onSaveManual(m!.id, withReview(m!.ex!, d)),
  );
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 3, marginRight: 'auto', minWidth: 0 }}>
          <span style={{ fontSize: 18, fontWeight: 600 }}>
            {t.name} <span style={{ fontSize: 14, fontWeight: 400, color: C.textMuted }}>{t.side}</span>
          </span>
          <span style={{ fontSize: 13, color: C.textMuted }}>
            {p
              ? `${when(p.opened)} → ${p.closed ? when(p.closed) : '…'}, ${px(p.maxSize)} @ ${px(p.entry)} → ${p.exit != null ? px(p.exit) : '…'}, ${p.fills.length} fills`
              : `${fmtD(m!.d)} → ${fmtD(m!.ex!.d)}, ${qtyLabel(m!)} @ ${nat(m!.px, m!.mk)} → ${nat(m!.ex!.px, m!.mk)}`}
          </span>
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
          <span style={{ fontSize: 18, fontWeight: 600, color: plInk(t.pnl) }}>{p ? usd(p.pnl, true) : dS(t.pnl, true)}</span>
          {t.ret != null && <span style={{ fontSize: 13, color: C.textMuted }}>{fmtPct(t.ret)}</span>}
        </span>
      </div>
      {m?.th && <p style={{ fontSize: 14, color: C.textSoft, lineHeight: 1.5 }}>Thesis: {m.th}</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: -8 }}>
        <SavedLabel label={label} />
      </div>
      <ReviewFields value={draft} onChange={change} />
    </>
  );
}
