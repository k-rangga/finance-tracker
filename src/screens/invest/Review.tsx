import s from '../../styles/ui.module.css';
import { Card, CardHead, Dot, Stat } from '../../components/ui';
import { fmtPct, fullDate, sum } from '../../lib/format';
import { C, plInk } from '../../lib/tokens';
import { fmtD, fmtR, MK_COLOR, type Closed, type Portfolio } from './model';
import { FP_COLORS } from './Journal';
import { useInvestFmt } from './Invest';

export function Review({ today, P, onOpenTrade }: { today: Date; P: Portfolio; onOpenTrade: (id: string) => void }) {
  const { dS } = useInvestFmt();
  const done = P.done;
  const avg = (a: number[]) => (a.length ? sum(a) / a.length : 0);
  const rs = (a: Closed[]) => a.filter(d => d.r != null).map(d => d.r!);
  const fy = done.filter(d => d.t.ex!.fp === 'Yes');
  const fn = done.filter(d => d.t.ex!.fp !== 'Yes');
  const avgR = avg(rs(done));
  const nextReview = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const n = (k: number) => k + (k === 1 ? ' trade' : ' trades');

  return (
    <div className={s.stack}>
      <Card style={{ gap: 24 }}>
        <CardHead title="Closed trades" caption={`Monthly review on the 1st · next ${fullDate(nextReview)}`} />
        <div className={s.stats}>
          <Stat label="Win rate" value={done.length ? Math.round((P.wins / done.length) * 100) + '%' : '—'} sub={`${P.wins} of ${done.length} closed trades`} />
          <Stat label="Average R" value={done.length ? fmtR(avgR) : '—'} sub="Return per unit of planned risk" ink={plInk(avgR)} />
          <Stat label="Followed plan" value={done.length ? Math.round((fy.length / done.length) * 100) + '%' : '—'} sub={`${fy.length} of ${done.length} trades`} />
          <Stat label={`Realised P/L ${today.getFullYear()}`} value={dS(P.realized, true)} sub="After fees" ink={plInk(P.realized)} />
        </div>
        <div className={s.note}>
          {!done.length
            ? 'Close a position to start your review history.'
            : `Followed the plan: ${fy.length ? fmtR(avg(rs(fy))) : '—'} average across ${n(fy.length)}. Partly or not followed: ${fn.length ? fmtR(avg(rs(fn))) : '—'} across ${n(fn.length)}.`}
        </div>
      </Card>
      {done.length > 0 && (
        <div className={s.cardFlush}>
          {done.map(d => {
            const t = d.t;
            const fp = FP_COLORS[t.ex!.fp ?? 'Partly'];
            const ink = plInk(d.net);
            return (
              <button
                key={t.id}
                type="button"
                className={`${s.rowBtn} ${s.hoverRow}`}
                onClick={() => onOpenTrade(t.id)}
                style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10, padding: '18px 24px', borderBottom: `1.5px solid ${C.divider}` }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: '12px 16px', flexWrap: 'wrap' }}>
                  <Dot color={MK_COLOR[t.mk]} />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: '1 1 220px', minWidth: 0 }}>
                    <span style={{ fontSize: 16, fontWeight: 700 }}>
                      {t.tk} <span style={{ fontSize: 13, fontWeight: 500, color: C.textMuted }}>{t.nm || t.mk}</span>
                    </span>
                    <span style={{ fontSize: 13, color: C.textMuted }}>
                      {fmtD(t.d)} → {fmtD(t.ex!.d)} · held {d.days} {d.days === 1 ? 'day' : 'days'}
                    </span>
                  </span>
                  <span className={s.badge} style={{ padding: '3px 10px', background: fp[0], color: fp[1] }}>
                    Plan: {t.ex!.fp ?? '—'}
                  </span>
                  <span className={s.badge} style={{ padding: '3px 10px', background: C.divider, color: C.textSoft }}>
                    Rating {t.ex!.rt ?? '—'} / 5
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, minWidth: 120 }}>
                    <span style={{ fontSize: 16, fontWeight: 800, color: ink }}>
                      {d.r == null ? '—' : fmtR(d.r)} · {fmtPct(d.ret)}
                    </span>
                    <span style={{ fontSize: 13, color: ink }}>Net {dS(d.net, true)}</span>
                  </span>
                </span>
                <span style={{ margin: '0 0 0 22px', fontSize: 14, lineHeight: 1.5, color: C.textSoft }}>{t.ex!.ls || 'No lesson written.'}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
