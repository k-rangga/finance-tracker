import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import s from '../../styles/ui.module.css';
import { Card } from '../../components/ui';
import { IC, Icon } from '../../components/Icon';
import { C } from '../../lib/tokens';
import { getPerps, mergeFills, setPerpNote, skipPerpNotes, syncPerps, usd, type PerpNote, type PerpState, type PerpTrade } from '../../lib/perps';
import { ReviewFields, SavedLabel, useAutosave } from './ReviewFields';
import { perpDraft, perpNoteOf } from './trades';

/** Hyperliquid trades for the whole Investment journal: loaded once, synced on open, reviews saved as you write them. */
export function usePerps() {
  const [state, setState] = useState<PerpState | null>(null);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);

  const sync = useCallback(async (first = false) => {
    setSyncing(true);
    setError('');
    try {
      // What's saved shows at once; the sync then brings it up to date.
      if (first) setState(await getPerps());
      setState(await syncPerps());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }, []);
  useEffect(() => void sync(true), [sync]);

  const trades = useMemo(() => (state ? mergeFills(state.fills, state.funding) : []), [state]);
  const saveNote = (id: string, note: PerpNote | null) => {
    setState(x => {
      if (!x) return x;
      const notes = { ...x.notes };
      if (note) notes[id] = note;
      else delete notes[id];
      return { ...x, notes };
    });
    setPerpNote(id, note).catch(e => setError('Review not saved: ' + (e instanceof Error ? e.message : String(e))));
  };
  /** Mark trades reviewed without writing anything (old ones you won't go through one by one). */
  const skip = (ids: string[]) => {
    setState(x => {
      if (!x) return x;
      const notes = { ...x.notes };
      for (const id of ids) notes[id] ??= { setup: '', mistakes: '', rating: 0, note: '', skipped: true };
      return { ...x, notes };
    });
    skipPerpNotes(ids).catch(e => setError("Couldn't mark them reviewed: " + (e instanceof Error ? e.message : String(e))));
  };
  return { state, trades, notes: state?.notes ?? {}, error, syncing, sync, saveNote, skip };
}

export type Perps = ReturnType<typeof usePerps>;

const pnlInk = (v: number) => (v > 0 ? C.accent800 : v < 0 ? C.redInk : C.textMuted);
export const when = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
export const px = (v: number) => (v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 1 }) : v >= 1 ? v.toFixed(3).replace(/\.?0+$/, '') : v.toPrecision(4));
const shortAddr = (a: string) => a.slice(0, 6) + '…' + a.slice(-4);

/** Where the address goes, until it's there. */
export function ConnectWallet({ hl }: { hl: Perps }) {
  return (
    <Card style={{ gap: 12 }}>
      <h2 className={s.h2}>Connect your Hyperliquid wallet</h2>
      <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14, lineHeight: 1.5 }}>
        <li>
          Open your data Sheet and go to the <strong>config</strong> tab.
        </li>
        <li>
          In the <strong>hyperliquid_address</strong> row, replace <code>0xPASTE_YOUR_WALLET_ADDRESS_HERE</code> with your wallet address (starts with 0x, 42
          characters).
        </li>
        <li>Come back and press Check.</li>
      </ol>
      <span style={{ fontSize: 13, color: C.textMuted }}>It's read-only: with an address, the app can see your trades but can never place or move anything.</span>
      <button type="button" className={s.btnPrimary} style={{ alignSelf: 'flex-start' }} onClick={() => hl.sync()} disabled={hl.syncing}>
        {hl.syncing ? 'Checking…' : 'Check'}
      </button>
    </Card>
  );
}

/** "Hyperliquid · 0x12…ab · synced 14 Nov 09:03 [Sync now]". */
export function SyncLine({ hl }: { hl: Perps }) {
  if (!hl.state?.address) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 13, color: C.textMuted }}>
      <span style={{ marginRight: 'auto' }}>
        Hyperliquid · {shortAddr(hl.state.address)}
        {hl.state.syncedAt ? ` · synced ${new Date(hl.state.syncedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
      </span>
      {hl.error && <span style={{ color: C.redInk }}>{hl.error}</span>}
      <button type="button" className={s.btnOutlineSm} onClick={() => hl.sync()} disabled={hl.syncing}>
        <Icon d={IC.refresh} size={14} />
        {hl.syncing ? 'Syncing…' : 'Sync now'}
      </button>
    </div>
  );
}

/** Overview: the Hyperliquid account's value and what's open on it right now. */
export function HyperliquidCard({ hl }: { hl: Perps }) {
  if (!hl.state) return null;
  if (!hl.state.address) return <ConnectWallet hl={hl} />;
  const positions = hl.state.positions ?? [];
  const unrealized = positions.reduce((a, p) => a + p.unrealized, 0);
  return (
    <Card style={{ gap: 12 }}>
      <div className={s.cardHead}>
        <h2 className={s.h2}>Hyperliquid</h2>
        <span className={s.caption}>
          {hl.state.equity != null ? `Account ${usd(hl.state.equity)}` : 'Account value unavailable'}
          {positions.length ? ` · open ${usd(unrealized, true)}` : ' · nothing open'}
        </span>
      </div>
      {positions.map(p => (
        <div key={p.coin} style={{ display: 'flex', gap: 10, alignItems: 'baseline', fontSize: 14, flexWrap: 'wrap', padding: '6px 0', borderTop: `1px solid ${C.divider}` }}>
          <span style={{ fontWeight: 600 }}>{p.coin}</span>
          <span className={s.perpSide} data-side={p.size > 0 ? 'Long' : 'Short'}>
            {p.size > 0 ? 'Long' : 'Short'}
          </span>
          <span style={{ color: C.textMuted, marginRight: 'auto' }}>
            {px(Math.abs(p.size))} @ {px(p.entry)}
          </span>
          <span style={{ fontWeight: 600, color: pnlInk(p.unrealized) }}>{usd(p.unrealized, true)}</span>
        </div>
      ))}
      <SyncLine hl={hl} />
    </Card>
  );
}

/** Inside a Hyperliquid trade: its numbers, every fill, and its review. */
export function PerpDetail({ t, note, onSave }: { t: PerpTrade; note?: PerpNote; onSave: (n: PerpNote | null) => void }) {
  const { draft, change, label } = useAutosave(perpDraft(note), d => onSave(perpNoteOf(d)));

  return (
    <div className="fade-in" style={{ padding: '4px 24px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
        {[
          { k: 'Avg entry', v: px(t.entry), sub: `biggest size ${px(t.maxSize)}` },
          { k: 'Avg exit', v: t.exit != null ? px(t.exit) : '—', sub: t.closed ? when(t.closed) : 'Still open' },
          { k: 'Position value', v: usd(t.maxNotional), sub: 'at its biggest' },
          { k: 'Fees', v: usd(t.fees), sub: Math.abs(t.funding) >= 0.005 ? `funding ${usd(t.funding, true)}` : 'no funding' },
        ].map(p => (
          <div key={p.k} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 13, color: C.textMuted }}>{p.k}</span>
            <span style={{ fontSize: 16, fontWeight: 600 }}>{p.v}</span>
            <span style={{ fontSize: 13, color: C.textMuted }}>{p.sub}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className={s.eyebrow}>Fills</span>
        <div style={{ display: 'flex', flexDirection: 'column', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
          {t.fills.map(f => (
            <div key={f.tid} style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px', padding: '5px 0', borderBottom: `1px dashed ${C.divider}` }}>
              <span style={{ color: C.textMuted, whiteSpace: 'nowrap' }}>{when(new Date(f.time))}</span>
              <span style={{ marginRight: 'auto', whiteSpace: 'nowrap' }}>{f.dir.replace('Market Order Liquidation: ', 'Liquidation · ')}</span>
              <span style={{ whiteSpace: 'nowrap' }}>
                {px(f.sz)} @ {px(f.px)}
              </span>
              <span style={{ minWidth: 72, textAlign: 'right', color: pnlInk(f.pnl) }}>{Math.abs(f.pnl) >= 0.005 ? usd(f.pnl, true) : ''}</span>
            </div>
          ))}
        </div>
      </div>

      <ReviewBox label={label}>
        <ReviewFields value={draft} onChange={change} />
      </ReviewBox>
    </div>
  );
}

/** The review's frame: a title and the autosave state. */
export function ReviewBox({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={s.reviewBox}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className={s.eyebrow} style={{ marginRight: 'auto' }}>
          Review
        </span>
        <SavedLabel label={label} />
      </div>
      {children}
    </div>
  );
}
