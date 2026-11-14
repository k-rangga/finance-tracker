import { useCallback, useEffect, useMemo, useState } from 'react';
import s from '../../styles/ui.module.css';
import { Card, Pills, Stat } from '../../components/ui';
import { IC, Icon } from '../../components/Icon';
import { C } from '../../lib/tokens';
import { useIsPhone } from '../../lib/media';
import {
  getPerps,
  heldFor,
  holdBucket,
  MISTAKES,
  mergeFills,
  perpStats,
  SETUPS,
  setPerpNote,
  syncPerps,
  usd,
  type PerpNote,
  type PerpState,
  type PerpTrade,
} from '../../lib/perps';

type Period = 'all' | '30' | '7';
const PAGE = 30;

const pnlInk = (v: number) => (v > 0 ? C.accent800 : v < 0 ? C.redInk : C.textMuted);
const when = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const px = (v: number) => (v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 1 }) : v >= 1 ? v.toFixed(3).replace(/\.?0+$/, '') : v.toPrecision(4));
const short = (a: string) => a.slice(0, 6) + '…' + a.slice(-4);

/**
 * Hyperliquid trading journal: your fills, merged into trades (open to flat), with what's working and what isn't,
 * and a journal on each trade. Read-only: the wallet address in the sheet's config tab is all it uses.
 */
export function Perps() {
  const phone = useIsPhone();
  const [state, setState] = useState<PerpState | null>(null);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [period, setPeriod] = useState<Period>('all');
  const [coin, setCoin] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);

  const sync = useCallback(async (first = false) => {
    setSyncing(true);
    setError('');
    try {
      // Opening the tab shows what's saved at once, then brings it up to date.
      if (first) setState(await getPerps());
      setState(await syncPerps());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }, []);
  useEffect(() => void sync(true), [sync]);

  const trades = useMemo(() => (state ? mergeFills(state.fills) : []), [state]);
  const coins = useMemo(() => [...new Set(trades.map(t => t.coin))].sort(), [trades]);
  const inView = useMemo(() => {
    const from = period === 'all' ? 0 : Date.now() - Number(period) * 864e5;
    return trades.filter(t => (!coin || t.coin === coin) && (t.closed ?? t.opened).getTime() >= from);
  }, [trades, period, coin]);
  const st = useMemo(() => perpStats(inView), [inView]);
  const list = useMemo(() => [...inView].reverse(), [inView]);

  const saveNote = (id: string, note: PerpNote | null) => {
    setState(x => {
      if (!x) return x;
      const notes = { ...x.notes };
      if (note) notes[id] = note;
      else delete notes[id];
      return { ...x, notes };
    });
    setPerpNote(id, note).catch(e => setError("Note not saved: " + (e instanceof Error ? e.message : String(e))));
  };

  if (!state)
    return <Card>{error ? <span style={{ color: C.redInk }}>Couldn't load Hyperliquid trades: {error}</span> : <span style={{ color: C.textMuted }}>Loading your trades…</span>}</Card>;

  if (!state.address)
    return (
      <Card style={{ gap: 12 }}>
        <h2 className={s.h2}>Connect your Hyperliquid wallet</h2>
        <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14, lineHeight: 1.5 }}>
          <li>Open your data Sheet and go to the <strong>config</strong> tab.</li>
          <li>
            In the <strong>hyperliquid_address</strong> row, replace <code>0xPASTE_YOUR_WALLET_ADDRESS_HERE</code> with your wallet address (starts with 0x,
            42 characters).
          </li>
          <li>Come back and press Check.</li>
        </ol>
        <span style={{ fontSize: 13, color: C.textMuted }}>It's read-only: with an address, the app can see your trades but can never place or move anything.</span>
        <button type="button" className={s.btnPrimary} style={{ alignSelf: 'flex-start' }} onClick={() => sync()} disabled={syncing}>
          {syncing ? 'Checking…' : 'Check'}
        </button>
      </Card>
    );

  const byCoin = st.by(t => t.coin);
  const bySide = st.by(t => t.side);
  const byHold = st.by(holdBucket);
  const worst = byCoin[0];
  const best = byCoin[byCoin.length - 1];
  // The coins that moved your result most, either way, best first.
  const topCoins = [...byCoin].sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl)).slice(0, 6).sort((a, b) => b.pnl - a.pnl);

  // Three plain findings, the most useful first.
  const findings: { ink: string; text: string }[] = [];
  if (worst && worst.pnl < 0)
    findings.push({ ink: C.redInk, text: `${worst.key} lost ${usd(-worst.pnl)} over ${worst.trades} trades (${Math.round((worst.wins / worst.trades) * 100)}% wins).` });
  if (best && best.pnl > 0 && best !== worst)
    findings.push({ ink: C.accent800, text: `${best.key} made ${usd(best.pnl)} over ${best.trades} trades (${Math.round((best.wins / best.trades) * 100)}% wins).` });
  if (st.fees > 0)
    findings.push({
      ink: C.amberInk,
      text: `Fees cost ${usd(st.fees)}. Before fees you'd be at ${usd(st.pnl + st.fees, true)}${st.pnl < 0 && st.pnl + st.fees > 0 ? ': they turned a profit into a loss' : ''}.`,
    });
  const holdBest = byHold[byHold.length - 1];
  if (byHold.length > 1 && holdBest.pnl > 0) findings.push({ ink: C.textSoft, text: `Your best holding time: ${holdBest.key.toLowerCase()} (${usd(holdBest.pnl, true)} over ${holdBest.trades} trades).` });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 13, color: C.textMuted }}>
        <span style={{ marginRight: 'auto' }}>
          Hyperliquid · {short(state.address)}
          {state.syncedAt ? ` · synced ${new Date(state.syncedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
        </span>
        {error && <span style={{ color: C.redInk }}>{error}</span>}
        <button type="button" className={s.btnOutlineSm} onClick={() => sync()} disabled={syncing}>
          <Icon d={IC.refresh} size={14} /> {syncing ? 'Syncing…' : 'Sync now'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <Pills<Period>
          label="Period"
          items={[
            ['all', 'All time'],
            ['30', '30 days'],
            ['7', '7 days'],
          ]}
          value={period}
          onChange={p => {
            setPeriod(p);
            setShown(PAGE);
          }}
        />
        <select className={s.select} value={coin} onChange={e => (setCoin(e.target.value), setShown(PAGE))} aria-label="Coin" style={{ width: 'auto' }}>
          <option value="">All coins</option>
          {coins.map(c => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {st.trades === 0 ? (
        <Card>
          <span style={{ color: C.textMuted }}>{trades.length ? 'No closed trades in this period.' : 'No trades yet. They appear here after your first fill on Hyperliquid.'}</span>
        </Card>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))', gap: 12 }}>
            <Card>
              <Stat label="Net PnL" value={usd(st.pnl, true)} ink={pnlInk(st.pnl)} sub={`${st.trades} trades · after fees`} />
            </Card>
            <Card>
              <Stat label="Win rate" value={`${Math.round(st.winRate)}%`} sub={`avg win ${usd(st.avgWin)} · avg loss ${usd(st.avgLoss)}`} />
            </Card>
            <Card>
              <Stat
                label="Won per $1 lost"
                value={Number.isFinite(st.profitFactor) ? usd(st.profitFactor) : '—'}
                ink={st.profitFactor >= 1 ? C.accent800 : C.redInk}
                sub={st.profitFactor >= 1 ? 'Above $1: making money' : 'Below $1: losing money'}
              />
            </Card>
            <Card>
              <Stat label="Fees paid" value={usd(st.fees)} sub={st.liquidated ? `${st.liquidated} liquidated` : 'No liquidations'} subInk={st.liquidated ? C.redInk : undefined} />
            </Card>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 16, alignItems: 'start' }}>
            <Card style={{ gap: 10 }}>
              <h3 className={s.sideTitle}>What the numbers say</h3>
              {findings.map(f => (
                <span key={f.text} style={{ display: 'flex', gap: 8, fontSize: 14, lineHeight: 1.45 }}>
                  <span className={s.badgeDot} style={{ background: f.ink, marginTop: 7, flex: 'none' }} aria-hidden="true" />
                  {f.text}
                </span>
              ))}
            </Card>
            <Card style={{ gap: 10 }}>
              <h3 className={s.sideTitle}>By coin</h3>
              <Breakdown rows={topCoins} />
              <h3 className={s.sideTitle} style={{ marginTop: 6 }}>
                Long vs short
              </h3>
              <Breakdown rows={[...bySide].reverse()} />
            </Card>
          </div>
        </>
      )}

      {list.length > 0 && (
        <Card flush>
          <div style={{ padding: '16px 20px 8px' }}>
            <h3 className={s.sideTitle}>Trades</h3>
            <span style={{ fontSize: 13, color: C.textMuted }}>Every fill from opening to flat is one trade. Tap one to see its fills and write your journal.</span>
          </div>
          {list.slice(0, shown).map(t => (
            <TradeRow key={t.id} t={t} note={state.notes[t.id]} open={open === t.id} onToggle={() => setOpen(open === t.id ? null : t.id)} onSave={n => saveNote(t.id, n)} phone={phone} />
          ))}
          {list.length > shown && (
            <button type="button" className={s.textBtnSm} style={{ margin: '12px 20px 16px' }} onClick={() => setShown(shown + PAGE)}>
              Show {Math.min(PAGE, list.length - shown)} more of {list.length - shown}
            </button>
          )}
        </Card>
      )}
    </div>
  );
}

function Breakdown({ rows }: { rows: { key: string; trades: number; wins: number; pnl: number }[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {rows.map(r => (
        <div key={r.key} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '6px 0', borderBottom: `1px solid ${C.divider}`, fontSize: 14 }}>
          <span className={s.ellipsis} style={{ marginRight: 'auto', minWidth: 0 }}>
            {r.key}
          </span>
          <span style={{ fontSize: 12, color: C.textMuted, whiteSpace: 'nowrap' }}>
            {r.trades} · {Math.round((r.wins / r.trades) * 100)}% wins
          </span>
          <span style={{ fontWeight: 600, color: pnlInk(r.pnl), minWidth: 84, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{usd(r.pnl, true)}</span>
        </div>
      ))}
    </div>
  );
}

function TradeRow({ t, note, open, onToggle, onSave, phone }: { t: PerpTrade; note?: PerpNote; open: boolean; onToggle: () => void; onSave: (n: PerpNote | null) => void; phone: boolean }) {
  return (
    <div style={{ borderTop: `1px solid ${C.divider}` }}>
      <button type="button" className={s.rowBtn} style={{ padding: '12px 20px', cursor: 'pointer', font: 'inherit' }} aria-expanded={open} onClick={onToggle}>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, marginRight: 'auto' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 15 }}>
            {t.coin}
            <span className={s.perpSide} data-side={t.side}>
              {t.side}
            </span>
            {t.liquidated && <span style={{ fontSize: 12, color: C.redInk, fontWeight: 600 }}>Liquidated</span>}
            {!t.closed && <span style={{ fontSize: 12, color: C.amberInk, fontWeight: 600 }}>Open</span>}
            {note && <Icon d={IC.book} size={13} color={C.textMuted} />}
          </span>
          <span style={{ fontSize: 13, color: C.textMuted }}>
            {when(t.opened)} · held {heldFor(t)}
            {!phone && ` · ${px(t.entry)} → ${t.exit != null ? px(t.exit) : '…'} · ${t.fills.length} fill${t.fills.length === 1 ? '' : 's'}`}
          </span>
        </span>
        <span style={{ fontWeight: 600, fontSize: 15, color: t.closed ? pnlInk(t.pnl) : C.textMuted, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
          {t.closed ? usd(t.pnl, true) : '—'}
        </span>
      </button>
      {open && <TradeDetail t={t} note={note} onSave={onSave} />}
    </div>
  );
}

function TradeDetail({ t, note, onSave }: { t: PerpTrade; note?: PerpNote; onSave: (n: PerpNote | null) => void }) {
  const [setup, setSetup] = useState(note?.setup ?? '');
  const [mistakes, setMistakes] = useState<string[]>(note?.mistakes ? note.mistakes.split(',').filter(Boolean) : []);
  const [rating, setRating] = useState(note?.rating ?? 0);
  const [text, setText] = useState(note?.note ?? '');
  const [saved, setSaved] = useState(false);
  const dirty = setup !== (note?.setup ?? '') || mistakes.join(',') !== (note?.mistakes ?? '') || rating !== (note?.rating ?? 0) || text !== (note?.note ?? '');
  const toggleMistake = (m: string) => setMistakes(x => (x.includes(m) ? x.filter(y => y !== m) : [...x, m]));

  return (
    <div className="fade-in" style={{ padding: '4px 20px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, color: C.textSoft }}>
        <span>
          Entry <strong>{px(t.entry)}</strong>
        </span>
        <span>
          Exit <strong>{t.exit != null ? px(t.exit) : '—'}</strong>
        </span>
        <span>
          Biggest size <strong>{px(t.maxSize)}</strong> (≈{usd(t.maxNotional)})
        </span>
        <span>
          Fees <strong>{usd(t.fees)}</strong>
        </span>
        {t.closed && <span>Closed {when(t.closed)}</span>}
      </div>

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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className={s.label}>Setup</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {SETUPS.map(x => (
            <button key={x} type="button" className={setup === x ? s.optOn : s.opt} aria-pressed={setup === x} onClick={() => setSetup(setup === x ? '' : x)}>
              {x}
            </button>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className={s.label}>Mistakes</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {MISTAKES.map(x => (
            <button key={x} type="button" className={mistakes.includes(x) ? s.optOn : s.opt} aria-pressed={mistakes.includes(x)} onClick={() => toggleMistake(x)}>
              {x}
            </button>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className={s.label}>How well did you follow your plan?</span>
        <div style={{ display: 'flex', gap: 6 }}>
          {[1, 2, 3, 4, 5].map(n => (
            <button key={n} type="button" className={rating === n ? s.optOn : s.opt} aria-pressed={rating === n} onClick={() => setRating(rating === n ? 0 : n)} style={{ minWidth: 40 }}>
              {n}
            </button>
          ))}
        </div>
      </div>
      <label className={s.field}>
        Notes
        <textarea className={s.input} rows={3} value={text} onChange={e => setText(e.target.value)} placeholder="Why you took it, what you saw, what you'd do differently" />
      </label>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button
          type="button"
          className={s.btnPrimarySm}
          disabled={!dirty}
          onClick={() => {
            const n = { setup, mistakes: mistakes.join(','), rating, note: text.trim() };
            onSave(n.setup || n.mistakes || n.rating || n.note ? n : null);
            setSaved(true);
          }}
        >
          Save journal
        </button>
        {saved && !dirty && <span style={{ fontSize: 13, color: C.accent800 }}>Saved</span>}
      </div>
    </div>
  );
}
