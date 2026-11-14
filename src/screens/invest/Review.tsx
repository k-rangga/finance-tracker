import { useState } from 'react';
import s from '../../styles/ui.module.css';
import { Card, CardHead, Pills, Stat } from '../../components/ui';
import { fullDate } from '../../lib/format';
import { C, plInk } from '../../lib/tokens';
import { fmtR } from './model';
import { useInvestFmt } from './Invest';
import { reviewStats, SOURCE_NAME, type AnyTrade, type Group, type Source } from './trades';

type Period = 'all' | 'year' | '30' | '7';

/**
 * How well you trade, from every closed trade (typed-in and Hyperliquid alike): the numbers, what they say, and
 * where the results come from — by name, side, setup and the mistakes you tagged.
 */
export function Review({ today, items }: { today: Date; items: AnyTrade[] }) {
  const { dS } = useInvestFmt();
  const [source, setSource] = useState<'all' | Source>('all');
  const [period, setPeriod] = useState<Period>('all');

  const from = period === 'all' ? 0 : period === 'year' ? new Date(today.getFullYear(), 0, 1).getTime() : today.getTime() - Number(period) * 864e5;
  const closed = items.filter(t => t.closed && t.closed.getTime() >= from && (source === 'all' || t.source === source));
  const st = reviewStats(closed);
  const nextReview = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const n = (k: number) => k + (k === 1 ? ' trade' : ' trades');
  const wins = (g: Group) => Math.round((g.wins / g.trades) * 100) + '% wins';

  // Plain findings, most useful first.
  const findings: { ink: string; text: string }[] = [];
  const worst = st.byName[0];
  const best = st.byName[st.byName.length - 1];
  if (worst && worst.pnl < 0) findings.push({ ink: C.redInk, text: `${worst.key} lost ${dS(-worst.pnl)} over ${n(worst.trades)} (${wins(worst)}).` });
  if (best && best.pnl > 0 && best !== worst) findings.push({ ink: C.accent800, text: `${best.key} made ${dS(best.pnl)} over ${n(best.trades)} (${wins(best)}).` });
  const costly = st.byMistake[0];
  if (costly && costly.pnl < 0) findings.push({ ink: C.redInk, text: `Trades tagged ${costly.key} cost ${dS(-costly.pnl)} over ${n(costly.trades)}: your most expensive mistake.` });
  if (st.avgFollowed != null && st.avgNotFollowed != null)
    findings.push({
      ink: st.avgFollowed >= st.avgNotFollowed ? C.accent800 : C.amberInk,
      text: `Following your plan averaged ${dS(st.avgFollowed, true)} a trade; not following it, ${dS(st.avgNotFollowed, true)}.`,
    });
  const costs = st.fees - st.funding;
  if (costs > 0 && st.count)
    findings.push({
      ink: C.amberInk,
      text: `Fees${st.funding < 0 ? ' and funding' : ''} cost ${dS(costs)}. Before them you'd be at ${dS(st.pnl + costs, true)}${st.pnl < 0 && st.pnl + costs > 0 ? ': they turned a profit into a loss' : ''}.`,
    });
  if (!st.answered && st.count) findings.push({ ink: C.textMuted, text: 'Review a few trades (followed plan, mistakes) to see what your habits cost.' });

  // The names that moved the result most, either way, best first.
  const topNames = [...st.byName].sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl)).slice(0, 6).sort((a, b) => b.pnl - a.pnl);

  return (
    <div className={s.stack}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <Pills<'all' | Source>
          label="Source"
          items={[
            ['all', 'All'],
            ['manual', SOURCE_NAME.manual],
            ['perp', SOURCE_NAME.perp],
          ]}
          value={source}
          onChange={setSource}
        />
        <Pills<Period>
          label="Period"
          items={[
            ['all', 'All time'],
            ['year', 'This year'],
            ['30', '30 days'],
            ['7', '7 days'],
          ]}
          value={period}
          onChange={setPeriod}
        />
      </div>

      <Card style={{ gap: 24 }}>
        <CardHead title="Closed trades" caption={`Monthly review on the 1st · next ${fullDate(nextReview)}`} />
        <div className={s.stats}>
          <Stat label="Net P/L" value={st.count ? dS(st.pnl, true) : '—'} ink={plInk(st.pnl)} sub={`${n(st.count)} · after fees${st.funding ? ' and funding' : ''}`} />
          <Stat label="Win rate" value={st.winRate == null ? '—' : Math.round(st.winRate) + '%'} sub={st.count ? `avg win ${dS(st.avgWin)} · avg loss ${dS(st.avgLoss)}` : 'No closed trades'} />
          <Stat
            label="Won per 1 lost"
            value={st.perLost == null ? '—' : st.perLost.toFixed(2)}
            ink={st.perLost == null ? undefined : st.perLost >= 1 ? C.accent800 : C.redInk}
            sub={st.perLost == null ? 'No losses yet' : st.perLost >= 1 ? 'Above 1: making money' : 'Below 1: losing money'}
          />
          <Stat
            label="Followed plan"
            value={st.followedPct == null ? '—' : Math.round(st.followedPct) + '%'}
            sub={st.answered ? `of ${n(st.answered)} reviewed${st.avgR != null ? ` · avg ${fmtR(st.avgR)}` : ''}` : 'No reviews yet'}
          />
        </div>
        {findings.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {findings.map(f => (
              <span key={f.text} style={{ display: 'flex', gap: 8, fontSize: 14, lineHeight: 1.45 }}>
                <span className={s.badgeDot} style={{ background: f.ink, marginTop: 7, flex: 'none' }} aria-hidden="true" />
                {f.text}
              </span>
            ))}
          </div>
        )}
        {!st.count && <div className={s.note}>Close a position, or sync Hyperliquid, to start your review history.</div>}
      </Card>

      {st.count > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 16, alignItems: 'start' }}>
          <Card style={{ gap: 10 }}>
            <h3 className={s.sideTitle}>By ticker or coin</h3>
            <Breakdown rows={topNames} fmt={v => dS(v, true)} />
            <h3 className={s.sideTitle} style={{ marginTop: 6 }}>
              Long vs short
            </h3>
            <Breakdown rows={[...st.bySide].reverse()} fmt={v => dS(v, true)} />
          </Card>
          <Card style={{ gap: 10 }}>
            <h3 className={s.sideTitle}>Mistakes, by what they cost</h3>
            {st.byMistake.length ? (
              <Breakdown rows={st.byMistake} fmt={v => dS(v, true)} />
            ) : (
              <span style={{ fontSize: 14, color: C.textMuted }}>Tag mistakes when you review a trade, and their cost shows here.</span>
            )}
            {st.bySetup.length > 0 && (
              <>
                <h3 className={s.sideTitle} style={{ marginTop: 6 }}>
                  By setup
                </h3>
                <Breakdown rows={[...st.bySetup].reverse()} fmt={v => dS(v, true)} />
              </>
            )}
            {st.liquidated > 0 && <span style={{ fontSize: 13, color: C.redInk }}>{n(st.liquidated)} liquidated.</span>}
          </Card>
        </div>
      )}
    </div>
  );
}

function Breakdown({ rows, fmt }: { rows: Group[]; fmt: (v: number) => string }) {
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
          <span style={{ fontWeight: 600, color: plInk(r.pnl), minWidth: 96, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{fmt(r.pnl)}</span>
        </div>
      ))}
    </div>
  );
}
