import s from '../../styles/ui.module.css';
import { Card, CardHead, Dot } from '../../components/ui';
import { payday, type Cycle } from '../../lib/cycle';
import { dayLabel, dayMonth, diffDays, parseISO, pc, addDays, sum, toISO } from '../../lib/format';
import { useSettings } from '../../lib/settings';
import { C } from '../../lib/tokens';
import { monthlyAssetCashflow } from '../../lib/wealth';
import { buyFee, levOf, MARKETS, MK_COLOR, MK_NAME, type Market, type Portfolio as PortfolioModel, type Prices } from './model';
import { useInvestFmt } from './Invest';

/** "Prices updated 4 days ago, Google Finance checked 09:28", and whether the weekly update is overdue. */
export function priceNote(prices: Prices, today: Date) {
  const age = diffDays(parseISO(prices.at), today);
  const stale = age > 7;
  const text =
    'Prices updated ' +
    (age <= 0 ? 'today' : age === 1 ? 'yesterday' : age + ' days ago') +
    (prices.quotedAt
      ? ', Google Finance checked ' + new Date(prices.quotedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
      : stale
        ? ', weekly update overdue'
        : ', next update ' + dayMonth(addDays(parseISO(prices.at), 7)));
  return { text, stale };
}

/** Stocks & crypto insights: how the money is spread across markets against your caps, and what goes in each payday. */
export function Portfolio({ cycle, P }: { cycle: Cycle; P: PortfolioModel }) {
  const { settings, full, short, ofIncome } = useSettings();
  const { dS } = useInvestFmt();
  const caps: Record<Market, number> = { IDX: settings.idxCap, US: settings.usCap, Crypto: settings.cryptoCap };

  const alloc = MARKETS.map(m => {
    const v = sum(P.pos.filter(p => p.t.mk === m).map(p => p.val));
    const share = P.tot ? (v / P.tot) * 100 : 0;
    return { m, v, share, over: share > caps[m] };
  }).filter(a => a.v > 0);
  const overs = alloc.filter(a => a.over);
  const capWarn = overs.length
    ? overs.map(a => `${MK_NAME[a.m]} is ${Math.round(a.share)}% of the portfolio, above your ${caps[a.m]}% cap`).join('. ') + '. Pause new buys there or trim to rebalance.'
    : '';

  // Money put into new positions in each of the last six pay cycles, as % of income.
  const trades = [...P.pos.map(p => p.t), ...P.done.map(d => d.t)];
  const starts = Array.from({ length: 7 }, (_, i) => payday(cycle.start.getFullYear(), cycle.start.getMonth() + i - 5));
  const hist = starts.slice(0, 6).map((from, i) => {
    const idr = sum(trades.filter(t => parseISO(t.d) >= from && parseISO(t.d) < starts[i + 1]).map(t => P.toIdr((t.px * t.q) / levOf(t) + buyFee(t), t.mk)));
    const money = settings.currency === 'USD' ? idr / settings.fxRate : idr;
    return (money / settings.income) * 100;
  });
  const cmax = Math.max(...hist, settings.investPct) * 1.15;
  const labels = starts.slice(0, 6).map(dayMonth);
  const cf = monthlyAssetCashflow(settings.assetCashflows ?? [], toISO(cycle.today));
  const portDisp = settings.currency === 'USD' ? P.tot / settings.fxRate : P.tot;
  const impliedYieldPct = portDisp > 0 && cf.annual > 0 ? (cf.annual / portDisp) * 100 : 0;

  return (
    <div className={s.stack}>
      <Card style={{ gap: 24 }}>
        <CardHead title="Allocation" caption={`${dS(P.tot)} in ${P.pos.length} open ${P.pos.length === 1 ? 'position' : 'positions'}, USD at Rp${settings.fxRate.toLocaleString('id-ID')}`} />
        {capWarn && (
          <div role="status" style={{ background: C.amberTint, color: C.amberInk, borderRadius: 12, padding: '12px 16px', fontSize: 14, lineHeight: 1.5 }}>
            <strong>Over cap.</strong> {capWarn}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', height: 14, borderRadius: 999, overflow: 'hidden', gap: 3 }} aria-hidden="true">
            {alloc.map(a => (
              <div key={a.m} style={{ flex: a.v, background: MK_COLOR[a.m] }} />
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 20px', fontSize: 13 }}>
            {alloc.map(a => (
              <span key={a.m} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Dot color={MK_COLOR[a.m]} />
                {MK_NAME[a.m]} <strong>{Math.round(a.share)}%</strong>
                <span style={{ color: C.textMuted }}>{dS(a.v)}</span>
                <span style={{ color: a.over ? C.amberInk : C.textMuted, fontWeight: a.over ? 700 : 500 }}>(cap {caps[a.m]}%)</span>
              </span>
            ))}
          </div>
        </div>
      </Card>

      <Card style={{ gap: 14 }}>
        <CardHead
          title="Passive Cash Flow & Yield"
          caption={cf.monthly > 0 ? `${short(cf.monthly)}/mo · ${short(cf.annual)}/yr${impliedYieldPct > 0 ? ` · ${impliedYieldPct.toFixed(1)}% implied yield` : ''}` : 'Dividends, bond coupons, staking & interest'}
        />
        {cf.monthly > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {cf.bySource.map(row => (
              <div key={row.source} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '6px 0', borderBottom: `1px solid ${C.divider}`, fontSize: 14 }}>
                <span>{row.label}</span>
                <strong style={{ color: C.good, fontVariantNumeric: 'tabular-nums' }}>+{full(row.monthly)}/mo</strong>
              </div>
            ))}
            <span style={{ fontSize: 12.5, color: C.textMuted }}>
              Add or edit asset cash flows anytime in Savings plan → Personal Cash-Flow Statement. Linking a ticker credits Return of Capital on that position.
            </span>
          </div>
        ) : (
          <p style={{ fontSize: 14, lineHeight: 1.5, color: C.textSoft }}>
            No passive cash flows logged yet. Record dividends, SBN coupons, deposit interest, or staking yields under <strong>Savings plan → Personal Cash-Flow Statement</strong> to track how fast your asset column covers monthly expenses.
          </p>
        )}
      </Card>


      <Card style={{ gap: 16 }}>
        <CardHead title="Contributions from savings" caption={`Dashed line = plan (${settings.investPct}% of income)`} />
        <p style={{ fontSize: 14, lineHeight: 1.5, color: C.textSoft }}>
          Plan: {full(ofIncome(settings.investPct))} of each payday's {full(ofIncome(60))} savings goes to your brokers. This cycle you've put{' '}
          {full(ofIncome(hist[5]))} into new positions since {dayLabel(cycle.start)}; {full(ofIncome(sum(hist)))} over the last six cycles, from your journal entries.
        </p>
        <div style={{ position: 'relative', height: 160, display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0,1fr))', gap: 16 }}>
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              height: 0,
              borderTop: `2px dashed ${C.textSoft}`,
              opacity: 0.5,
              bottom: pc((settings.investPct / cmax) * 100),
              pointerEvents: 'none',
            }}
          />
          {hist.map((p, i) => (
            <div key={i} style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center' }}>
              <div
                title={`${labels[i]}: ${p.toFixed(1)}%, ${full(ofIncome(p))}`}
                style={{ width: '100%', maxWidth: 64, borderRadius: 12, height: pc((p / cmax) * 100), background: i === 5 ? C.accent700 : C.series[1] }}
              />
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0,1fr))', gap: 16 }}>
          {hist.map((p, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', fontSize: 13, fontWeight: i === 5 ? 700 : 500, textAlign: 'center' }}>
              <span>{labels[i]}</span>
              <span style={{ color: C.textMuted, fontWeight: 500 }}>{short(ofIncome(p))}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
