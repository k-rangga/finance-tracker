import s from '../../styles/ui.module.css';
import { Card, CardHead, Dot, Stat } from '../../components/ui';
import { payday, type Cycle } from '../../lib/cycle';
import { dayLabel, dayMonth, diffDays, fmtPct, parseISO, pc, addDays, sum } from '../../lib/format';
import { useSettings } from '../../lib/settings';
import { C, plInk } from '../../lib/tokens';
import { levOf, levTag, liqOf, MARKETS, MK_COLOR, MK_NAME, nat, qtyLabel, type Market, type Portfolio as PortfolioModel, type Prices } from './model';
import { useInvestFmt } from './Invest';

type Props = { cycle: Cycle; P: PortfolioModel; prices: Prices; onOpenPrices: () => void; onOpenTrade: (id: string) => void };

// % of income moved to brokers in the five cycles before this one.
const CONTRIB_HISTORY = [20, 20, 13.3, 20, 26.7];

const GRID = 'minmax(190px,1.3fr) 110px 150px 140px 130px minmax(200px,1.3fr)';

export function Portfolio({ cycle, P, prices, onOpenPrices, onOpenTrade }: Props) {
  const { settings, full, short, ofIncome } = useSettings();
  const { dF, dS } = useInvestFmt();
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
  const winRate = P.done.length ? Math.round((P.wins / P.done.length) * 100) + '%' : '—';

  const age = diffDays(parseISO(prices.at), cycle.today);
  const stale = age > 7;
  const pxNote =
    'Prices updated ' +
    (age <= 0 ? 'today' : age === 1 ? 'yesterday' : age + ' days ago') +
    (stale ? ' · weekly update overdue' : ' · next update ' + dayMonth(addDays(parseISO(prices.at), 7)));

  const rows = [...P.pos].sort((a, b) => b.val - a.val);

  const hist = [...CONTRIB_HISTORY, settings.investPct];
  const cmax = Math.max(...hist) * 1.15;
  const labels = hist.map((_, i) => dayMonth(payday(cycle.start.getFullYear(), cycle.start.getMonth() + i - 5)));

  return (
    <div className={s.stack}>
      <Card style={{ gap: 24 }}>
        <CardHead title="Portfolio" caption={`Totals in ${settings.currency} · USD at Rp ${settings.fxRate.toLocaleString('id-ID')}`} />
        <div className={s.stats}>
          <Stat label="Portfolio value" value={dF(P.tot)} sub={`${P.pos.length} open positions`} />
          <Stat
            label="Unrealised P/L"
            value={dS(P.upl, true)}
            sub={`${fmtPct(P.cost ? (P.upl / P.cost) * 100 : 0)} on ${dS(P.cost)} cost`}
            ink={plInk(P.upl)}
            subInk={plInk(P.upl)}
          />
          <Stat label={`Realised ${cycle.today.getFullYear()}`} value={dS(P.realized, true)} sub={`${P.done.length} closed · after fees`} ink={plInk(P.realized)} />
          <Stat label="Win rate" value={winRate} sub={`${P.wins} of ${P.done.length} closed trades`} />
        </div>
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
                <span style={{ color: a.over ? C.amberInk : C.textMuted, fontWeight: a.over ? 700 : 500 }}>· cap {caps[a.m]}%</span>
              </span>
            ))}
          </div>
        </div>
      </Card>

      <section className={s.cardFlush}>
        <div style={{ padding: '24px 28px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <h2 className={s.h2}>Holdings</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: stale ? C.amberInk : C.textMuted }}>{pxNote}</span>
            <button type="button" className={s.btnOutline} onClick={onOpenPrices}>
              Update prices
            </button>
          </div>
          <span style={{ flexBasis: '100%', fontSize: 12, color: C.textMuted }}>Grey tick = entry, dot = last price · tap a row for its journal entry</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 920, display: 'flex', flexDirection: 'column' }} role="table" aria-label="Holdings">
            <div role="row" className={s.eyebrow} style={{ display: 'grid', gridTemplateColumns: GRID, padding: '12px 0', borderTop: `1px solid ${C.border}` }}>
              <span role="columnheader" style={{ padding: '0 16px 0 28px' }}>Asset</span>
              <span role="columnheader" style={{ padding: '0 16px' }}>Qty</span>
              <span role="columnheader" style={{ padding: '0 16px' }}>Last / avg</span>
              <span role="columnheader" style={{ padding: '0 16px', textAlign: 'right' }}>Value</span>
              <span role="columnheader" style={{ padding: '0 16px', textAlign: 'right' }}>P/L</span>
              <span role="columnheader" style={{ padding: '0 28px 0 16px' }}>Stop → target</span>
            </div>
            {rows.map(p => {
              const t = p.t;
              const hasPlan = !!(t.tg && t.sl);
              let tag: [string, string, string] = ['In range', C.divider, C.textMuted];
              let lastL = '0%';
              let entryL = '0%';
              if (hasPlan) {
                const f = (v: number) => pc(((v - t.sl!) / (t.tg! - t.sl!)) * 100);
                lastL = f(p.last);
                entryL = f(t.px);
                const g = (p.last - t.sl!) / (t.tg! - t.sl!);
                if (g < 0) tag = ['Stop breached', C.redTint, C.redInk];
                else if (Math.abs(p.last - t.sl!) / t.sl! <= 0.03) tag = ['Near stop', C.amberTint, C.amberInk];
                else if (g >= 1) tag = ['Target hit', C.accentTint, C.accent800];
                else if (Math.abs(t.tg! - p.last) / t.tg! <= 0.06) tag = ['Near target', C.accentTint, C.accent800];
                if (levOf(t) > 1 && Math.abs(p.last - liqOf(t)) / p.last <= 0.1) tag = ['Near liquidation', C.redTint, C.redInk];
              }
              const ink = plInk(p.pl);
              return (
                <button
                  key={t.id}
                  type="button"
                  role="row"
                  className={`${s.rowBtn} ${s.hoverRow}`}
                  onClick={() => onOpenTrade(t.id)}
                  style={{ display: 'grid', gridTemplateColumns: GRID, alignItems: 'center', padding: '16px 0', borderTop: `1px solid ${C.border}`, fontSize: 15 }}
                >
                  <span role="cell" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px 0 28px', minWidth: 0 }}>
                    <Dot color={MK_COLOR[t.mk]} />
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                      <span style={{ fontWeight: 700 }}>{t.tk}</span>
                      <span style={{ fontSize: 12, color: C.textMuted }}>
                        {t.nm || t.mk}
                        {levTag(t) ? ' · ' + levTag(t) : ''}
                      </span>
                    </span>
                  </span>
                  <span role="cell" style={{ padding: '0 16px' }}>{qtyLabel(t)}</span>
                  <span role="cell" style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 16px' }}>
                    <span>
                      {nat(p.last, t.mk)}
                      {P.hasPrice(t) ? '' : ' · no price'}
                    </span>
                    <span style={{ fontSize: 12, color: C.textMuted }}>avg {nat(t.px, t.mk)}</span>
                  </span>
                  <span role="cell" style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 16px', textAlign: 'right' }}>
                    <span style={{ fontWeight: 700 }}>{dS(p.val)}</span>
                    <span style={{ fontSize: 12, color: C.textMuted }}>{Math.round((p.val / P.tot) * 100)}% of portfolio</span>
                  </span>
                  <span role="cell" style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 16px', textAlign: 'right' }}>
                    <span style={{ fontWeight: 700, color: ink }}>{fmtPct(p.plp)}</span>
                    <span style={{ fontSize: 12, color: ink }}>{dS(p.pl, true)}</span>
                  </span>
                  <span role="cell" style={{ padding: '0 28px 0 16px' }}>
                    {hasPlan ? (
                      <span style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <span className={s.badge} style={{ alignSelf: 'flex-start', padding: '3px 10px', background: tag[1], color: tag[2] }}>
                          {tag[0]}
                        </span>
                        <span style={{ position: 'relative', height: 6, borderRadius: 999, background: C.divider }}>
                          <span style={{ position: 'absolute', top: -4, bottom: -4, width: 2, borderRadius: 2, background: C.greyDark, left: entryL }} />
                          <span
                            style={{
                              position: 'absolute',
                              top: '50%',
                              width: 12,
                              height: 12,
                              borderRadius: '50%',
                              border: '2px solid #fff',
                              transform: 'translate(-50%,-50%)',
                              background: ink,
                              left: lastL,
                            }}
                          />
                        </span>
                        <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, color: C.textMuted }}>
                          <span>Stop {nat(t.sl!, t.mk)}</span>
                          <span>Target {nat(t.tg!, t.mk)}</span>
                        </span>
                      </span>
                    ) : (
                      <span style={{ fontSize: 13, color: C.textMuted }}>Long-term · no exit levels</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <Card style={{ gap: 16 }}>
        <CardHead title="Contributions from savings" caption={`Dashed line = plan (${settings.investPct}% of income)`} />
        <p style={{ fontSize: 14, lineHeight: 1.5, color: C.textSoft }}>
          {full(ofIncome(settings.investPct))} moved to your brokers on {dayLabel(cycle.start)}, out of the {full(ofIncome(60))} savings transfer.{' '}
          {full(ofIncome(sum(hist)))} invested over the last six cycles.
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
                title={`${labels[i]}: ${p}% · ${full(ofIncome(p))}`}
                style={{ width: '100%', maxWidth: 64, borderRadius: 12, height: pc((p / cmax) * 100), background: i === 5 ? C.accent700 : C.mint[5] }}
              />
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0,1fr))', gap: 16 }}>
          {hist.map((p, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', fontSize: 12, fontWeight: i === 5 ? 700 : 500, textAlign: 'center' }}>
              <span>{labels[i]}</span>
              <span style={{ color: C.textMuted, fontWeight: 500 }}>{short(ofIncome(p))}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
