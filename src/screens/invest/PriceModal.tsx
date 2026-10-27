import { useState } from 'react';
import s from '../../styles/ui.module.css';
import { Dot, Modal } from '../../components/ui';
import { C } from '../../lib/tokens';
import { MK_COLOR, nat, numIn, type Portfolio } from './model';

export function PriceModal({ P, onClose, onSave }: { P: Portfolio; onClose: () => void; onSave: (map: Record<string, number>) => void }) {
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(P.openTks.map(t => [t.tk, String(P.lastOf(t))])));
  const save = () => {
    const map: Record<string, number> = {};
    P.openTks.forEach(t => {
      const x = numIn(draft[t.tk], t.mk);
      if (x > 0) map[t.tk] = x;
    });
    onSave(map);
  };
  return (
    <Modal title="Weekly price update" onClose={onClose}>
      <p style={{ fontSize: 14, lineHeight: 1.5, color: C.textMuted }}>Enter the latest closing price from your broker or exchange.</p>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {P.openTks.map(t => (
          <div key={t.tk} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,180px)', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: `1px solid ${C.divider}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <Dot color={MK_COLOR[t.mk]} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 15, fontWeight: 700 }}>{t.tk}</span>
                <span style={{ fontSize: 13, color: C.textMuted }}>Was {nat(P.lastOf(t), t.mk)}</span>
              </div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: C.textSoft }}>
              <span>{t.mk === 'IDX' ? 'Rp' : '$'}</span>
              <input className={s.input} inputMode="decimal" aria-label={`${t.tk} price`} value={draft[t.tk] ?? ''} onChange={e => setDraft(d => ({ ...d, [t.tk]: e.target.value }))} />
            </label>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className={s.btnPrimary} onClick={save}>Save prices</button>
        <button type="button" className={s.btnGhost} onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}
