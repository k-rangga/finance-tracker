import { useState } from 'react';
import s from '../../styles/ui.module.css';
import { Modal, Options } from '../../components/ui';
import { C, plInk } from '../../lib/tokens';
import { addFee, dirOf, isAdd, nat, numIn, positionHistory, UPDATE_LABEL, type PosState, type Trade, type TradeUpdate, type UpdateKind } from './model';

/** `15 Oct 2026, 09:30` */
export const fmtAt = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const KIND_COLORS: Record<UpdateKind, [string, string]> = {
  avg_up: [C.accentTint, C.accent800],
  avg_down: [C.amberTint, C.amberInk],
  note: [C.divider, C.textSoft],
};

const lotsLabel = (t: Pick<Trade, 'mk' | 'tk'>, q: number) =>
  t.mk === 'IDX' ? q / 100 + (q === 100 ? ' lot' : ' lots') : t.mk === 'US' ? q + (q === 1 ? ' share' : ' shares') : q + ' ' + t.tk;

/** `+5 lots @ Rp 7.900` */
const addLabel = (t: Trade, u: TradeUpdate) => '+' + lotsLabel(t, u.q!) + ' @ ' + nat(u.px!, t.mk);

export function KindBadge({ kind }: { kind: UpdateKind }) {
  const [bg, ink] = KIND_COLORS[kind];
  return (
    <span className={s.badge} style={{ background: bg, color: ink, padding: '3px 10px', fontSize: 13 }}>
      {UPDATE_LABEL[kind]}
    </span>
  );
}

/** Updates on a trade, newest first. `t` is the stored entry (its first buy), not the averaged position. */
export function UpdateTimeline({ t, updates, onOpen }: { t: Trade; updates: TradeUpdate[]; onOpen: (u: TradeUpdate) => void }) {
  const hist = positionHistory(t, updates).reverse();
  if (!hist.length) return <span style={{ fontSize: 13, color: C.textMuted }}>No updates yet. Log an avg up, avg down or a note as the trade develops.</span>;
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
      {hist.map(({ u, after }) => (
        <li key={u.id}>
          <button type="button" className={`${s.rowBtn} ${s.hoverRow}`} onClick={() => onOpen(u)} style={{ gap: 12, padding: '10px 12px', borderRadius: 12, alignItems: 'flex-start' }}>
            <span style={{ width: 10, height: 10, marginTop: 6, flex: 'none', borderRadius: '50%', background: KIND_COLORS[u.kind][1] }} />
            <span style={{ display: 'flex', flexDirection: 'column', gap: 4, marginRight: 'auto', minWidth: 0, textAlign: 'left' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, color: C.textMuted }}>{fmtAt(u.at)}</span>
                <KindBadge kind={u.kind} />
              </span>
              {isAdd(u) && (
                <span style={{ fontSize: 14, fontWeight: 700 }}>
                  {addLabel(t, u)} <span style={{ fontWeight: 500, color: C.textMuted }}>· new avg {nat(after.avg, t.mk)}</span>
                </span>
              )}
              {u.note && (
                <span style={{ fontSize: 13, color: C.textSoft, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.note.split('\n')[0]}</span>
              )}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/** Full detail of one update: what was bought, the position before and after, and P/L at the current price. */
export function UpdateDetail({ t, updates, update, last, onEdit, onDelete, onClose }: {
  t: Trade;
  updates: TradeUpdate[];
  update: TradeUpdate;
  /** Current price (native). */
  last: number;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const h = positionHistory(t, updates).find(x => x.u.id === update.id);
  if (!h) return null;
  const { u, before, after } = h;
  // Unrealised P/L of the position as it stood after this update, at today's price (fees included).
  const fees = after.cost - after.avg * after.q;
  const pl = (last - after.avg) * after.q * dirOf(t) - fees;
  const row = (k: string, v: string, ink?: string) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderTop: `1px solid ${C.divider}`, fontSize: 14 }}>
      <span style={{ color: C.textMuted }}>{k}</span>
      <span style={{ fontWeight: 700, color: ink, textAlign: 'right' }}>{v}</span>
    </div>
  );
  const pos = (p: PosState) => `${lotsLabel(t, p.q)} · avg ${nat(p.avg, t.mk)} · cost ${nat(p.cost, t.mk)}`;
  return (
    <Modal title={`${t.tk} · ${UPDATE_LABEL[u.kind]}`} onClose={onClose} width={520}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <KindBadge kind={u.kind} />
        <span style={{ fontSize: 14, fontWeight: 700 }}>{fmtAt(u.at)}</span>
      </div>
      <div>
        {isAdd(u) && (
          <>
            {row('Price', nat(u.px!, t.mk))}
            {row('Quantity', lotsLabel(t, u.q!))}
            {row('Fee', nat(addFee(t, u), t.mk) + (u.fee == null ? ' (auto)' : ''))}
            {row('Before', pos(before))}
            {row('After', pos(after))}
          </>
        )}
        {row(isAdd(u) ? 'Unrealised P/L now' : 'Position now', isAdd(u) ? (pl >= 0 ? '+' : '−') + nat(Math.abs(pl), t.mk) + ` at ${nat(last, t.mk)}` : pos(after), isAdd(u) ? plInk(pl) : undefined)}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className={s.label}>Note</span>
        <p style={{ fontSize: 14, lineHeight: 1.55, whiteSpace: 'pre-wrap', color: u.note ? C.text : C.textMuted }}>{u.note || 'No note.'}</p>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className={s.btnPrimary} onClick={onEdit}>
          Edit
        </button>
        <button
          type="button"
          className={s.btnGhost}
          style={{ color: C.redInk }}
          onClick={() => window.confirm('Delete this update? The position goes back to how it was without it.') && onDelete()}
        >
          Delete
        </button>
      </div>
    </Modal>
  );
}

/** `2026-10-15T09:30` in local time, for a datetime-local input. */
const localInput = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** Add or edit an update. The type is suggested from the price against the current average, but can be changed. */
export function UpdateForm({ t, avg, last, editing, onClose, onSave }: {
  /** Stored entry (for market and ticker). */
  t: Trade;
  /** Current average buy price, to suggest avg up or down. */
  avg: number;
  last: number;
  editing?: TradeUpdate;
  onClose: () => void;
  onSave: (u: TradeUpdate) => void;
}) {
  const cur = t.mk === 'IDX' ? 'Rp' : '$';
  const suggest = (px: number): UpdateKind => (px > 0 && px < avg ? 'avg_down' : 'avg_up');
  const [kind, setKind] = useState<UpdateKind>(editing?.kind ?? suggest(last));
  const [touched, setTouched] = useState(!!editing);
  const [at, setAt] = useState(localInput(editing?.at ?? new Date().toISOString()));
  const [px, setPx] = useState(String(editing?.px ?? last));
  const [q, setQ] = useState(editing?.q != null ? String(t.mk === 'IDX' ? editing.q / 100 : editing.q) : '');
  const [fee, setFee] = useState(editing?.fee != null ? String(editing.fee) : '');
  const [note, setNote] = useState(editing?.note ?? '');
  const [err, setErr] = useState('');
  const add = kind !== 'note';

  const save = () => {
    const when = new Date(at);
    if (isNaN(when.getTime())) return setErr('Choose a date and time.');
    const p = numIn(px, t.mk);
    const n = parseFloat(q.replace(/[^\d.]/g, '')) * (t.mk === 'IDX' ? 100 : 1);
    const f = numIn(fee, t.mk);
    if (add && !(p > 0 && n > 0)) return setErr(`Enter the price and ${t.mk === 'IDX' ? 'lots' : 'quantity'} you bought.`);
    if (!add && !note.trim()) return setErr('Write the note.');
    onSave({
      id: editing?.id ?? 'tu' + Date.now(),
      tradeId: t.id,
      at: when.toISOString(),
      kind,
      ...(add ? { px: p, q: n, ...(f >= 0 ? { fee: f } : {}) } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
  };

  return (
    <Modal title={`${editing ? 'Edit update' : 'Add update'} · ${t.tk}`} onClose={onClose} width={520}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className={s.label}>Type</span>
        <Options
          label="Type"
          items={['avg_up', 'avg_down', 'note'] as const}
          value={kind}
          onChange={k => {
            setKind(k);
            setTouched(true);
            setErr('');
          }}
          render={k => UPDATE_LABEL[k]}
        />
        {add && <span style={{ fontSize: 13, color: C.textMuted }}>Current average {nat(avg, t.mk)}</span>}
      </div>
      <label className={s.field}>
        Date and time
        <input className={s.input} type="datetime-local" value={at} onChange={e => setAt(e.target.value)} />
      </label>
      {add && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }}>
          <label className={s.field}>
            Price ({cur})
            <input
              className={s.input}
              inputMode="decimal"
              value={px}
              onChange={e => {
                setPx(e.target.value);
                setErr('');
                if (!touched) setKind(suggest(numIn(e.target.value, t.mk)));
              }}
            />
          </label>
          <label className={s.field}>
            {t.mk === 'IDX' ? 'Lots' : t.mk === 'US' ? 'Shares' : 'Units'}
            <input className={s.input} inputMode="decimal" autoFocus value={q} onChange={e => {
                setQ(e.target.value);
                setErr('');
              }}
            />
          </label>
          <label className={s.field}>
            Fee ({cur}, optional)
            <input className={s.input} inputMode="decimal" value={fee} placeholder={t.mk === 'IDX' ? 'Auto 0.15%' : 'Auto 0.1%'} onChange={e => setFee(e.target.value)} />
          </label>
        </div>
      )}
      <label className={s.field}>
        {add ? 'Note (optional)' : 'Note'}
        <textarea className={s.input} rows={4} value={note} onChange={e => {
            setNote(e.target.value);
            setErr('');
          }}
          placeholder="Why now? What changed in the thesis?" />
      </label>
      {err && (
        <span className={s.error} role="alert">
          {err}
        </span>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className={s.btnPrimary} onClick={save}>
          {editing ? 'Save changes' : 'Add update'}
        </button>
        <button type="button" className={s.btnGhost} onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
