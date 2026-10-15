import { useMemo, useState } from 'react';
import s from '../../styles/ui.module.css';
import { Card, Stat } from '../../components/ui';
import { fmtPct, fullDate, parseISO, pc, toISO } from '../../lib/format';
import { C, plInk } from '../../lib/tokens';
import type { Snap } from './model';
import { useInvestFmt } from './Invest';

type Range = '3M' | '6M' | 'YTD' | '1Y' | 'All';
type Pt = { dt: Date; v: number; c: number };


export function Progress({ today, snaps }: { today: Date; snaps: Snap[] }) {
  const { dF, dS } = useInvestFmt();
  const [rg, setRg] = useState<Range>('6M');
  const [hov, setHov] = useState<number | null>(null);

  const pts = useMemo<Pt[]>(() => snaps.filter(x => x.v > 0 && x.c > 0).map(x => ({ dt: parseISO(x.d), v: x.v, c: x.c })), [snaps]);

  if (pts.length < 2)
    return (
      <Card>
        <h2 className={s.h2}>Value vs contributions</h2>
        <p style={{ fontSize: 14, lineHeight: 1.5, color: C.textMuted }}>
          {pts.length
            ? 'One point so far. The chart fills in as you update prices each week.'
            : 'Add a journal entry and update prices weekly to start tracking value against what you put in.'}
        </p>
      </Card>
    );

  const from =
    rg === 'All'
      ? null
      : rg === 'YTD'
        ? new Date(today.getFullYear(), 0, 1)
        : new Date(today.getFullYear(), today.getMonth() - { '3M': 3, '6M': 6, '1Y': 12 }[rg], today.getDate());
  let ser = from ? pts.filter(p => p.dt >= from) : pts;
  if (ser.length < 2) ser = pts.slice(-2);

  const raw = (Math.max(...ser.map(p => Math.max(p.v, p.c))) * 1.05) / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(k => k * mag).find(x => x >= raw)!;
  const ymax = step * 4;
  const t0 = ser[0].dt.getTime();
  const t1 = ser[ser.length - 1].dt.getTime();
  const X = (d: Date) => ((d.getTime() - t0) / (t1 - t0)) * 1000;
  const Y = (v: number) => 300 - (v / ymax) * 300;
  const f1 = (n: number) => n.toFixed(1);

  const vPath = ser.map((p, i) => (i ? 'L' : 'M') + f1(X(p.dt)) + ' ' + f1(Y(p.v))).join(' ');
  const cPts: [number, number][] = [[X(ser[0].dt), Y(ser[0].c)]];
  ser.slice(1).forEach((p, i) => cPts.push([X(p.dt), Y(ser[i].c)], [X(p.dt), Y(p.c)]));
  const cPath = cPts.map((q, i) => (i ? 'L' : 'M') + f1(q[0]) + ' ' + f1(q[1])).join(' ');
  const gainArea = vPath + ' ' + [...cPts].reverse().map(q => 'L' + f1(q[0]) + ' ' + f1(q[1])).join(' ') + ' Z';

  const mos: Date[] = [];
  for (let m = new Date(ser[0].dt.getFullYear(), ser[0].dt.getMonth() + 1, 1); m.getTime() <= t1; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) mos.push(m);
  const ev = Math.max(1, Math.ceil(mos.length / 7));
  const xTicks = mos
    .filter((_, i) => i % ev === 0)
    .map(m => ({ label: m.toLocaleDateString('en-GB', { month: 'short' }) + (m.getMonth() === 0 ? ' ' + String(m.getFullYear()).slice(2) : ''), left: pc(X(m) / 10) }));

  const hi = hov != null && hov < ser.length ? hov : ser.length - 1;
  const hp = ser[hi];
  const hg = hp.v - hp.c;
  const fs0 = ser[0];
  const fl = ser[ser.length - 1];
  const gNow = fl.v - fl.c;
  const gRange = gNow - (fs0.v - fs0.c);
  const firstReal = parseISO(snaps.find(x => x.v > 0)?.d ?? toISO(today));

  return (
    <Card style={{ gap: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h2 className={s.h2}>Value vs contributions</h2>
        <div style={{ display: 'flex', gap: 4, background: C.bg, borderRadius: 999, padding: 4 }} role="group" aria-label="Range">
          {(['3M', '6M', 'YTD', '1Y', 'All'] as Range[]).map(k => (
            <button
              key={k}
              type="button"
              aria-pressed={rg === k}
              onClick={() => {
                setRg(k);
                setHov(null);
              }}
              style={{
                fontSize: 14,
                fontWeight: 700,
                padding: '8px 14px',
                minHeight: 40,
                borderRadius: 999,
                border: 'none',
                background: rg === k ? '#fff' : 'transparent',
                color: rg === k ? C.accent800 : C.textMuted,
                boxShadow: rg === k ? '0 1px 3px rgba(23,32,27,.12)' : 'none',
              }}
            >
              {k}
            </button>
          ))}
        </div>
      </div>
      <div className={s.stats}>
        <Stat label="Portfolio value" value={dF(fl.v)} sub="As of last price update" />
        <Stat label="Total contributed" value={dF(fl.c)} sub={dS(fl.c - fs0.c, true) + ' added in this range'} />
        <Stat label="Total gain" value={dS(gNow, true)} sub={fmtPct((gNow / fl.c) * 100) + ' of contributions'} ink={plInk(gNow)} subInk={plInk(gNow)} />
        <Stat label="Gain in range" value={dS(gRange, true)} sub={'Since ' + fullDate(fs0.dt) + ', excluding deposits'} ink={plInk(gRange)} />
      </div>
      <div aria-live="polite" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 24px', fontSize: 14, padding: '12px 16px', background: C.bg, borderRadius: 12 }}>
        <strong style={{ marginRight: 'auto' }}>{fullDate(hp.dt)}</strong>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 16, height: 3, borderRadius: 2, background: C.accent700 }} />
          Value <strong>{dF(hp.v)}</strong>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 16, height: 0, borderTop: `2px dashed ${C.textMuted}` }} />
          Contributed <strong>{dF(hp.c)}</strong>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: '#cdeee6' }} />
          Gain{' '}
          <strong style={{ color: plInk(hg) }}>
            {dS(hg, true)} ({fmtPct((hg / hp.c) * 100)})
          </strong>
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr)', gap: '8px 12px' }}>
        <div style={{ position: 'relative', height: 300, minWidth: 56 }} aria-hidden="true">
          {[4, 3, 2, 1, 0].map(k => (
            <span key={k} style={{ position: 'absolute', right: 0, top: pc(100 - k * 25), transform: 'translateY(-50%)', fontSize: 12, color: C.textMuted, whiteSpace: 'nowrap' }}>
              {k ? dS(step * k) : '0'}
            </span>
          ))}
        </div>
        <div style={{ position: 'relative', height: 300 }} role="img" aria-label={`Portfolio value ${dF(fl.v)} against ${dF(fl.c)} contributed`}>
          {[4, 3, 2, 1, 0].map(k => (
            <div key={k} style={{ position: 'absolute', left: 0, right: 0, top: pc(100 - k * 25), borderTop: `1px solid ${C.divider}` }} />
          ))}
          <svg viewBox="0 0 1000 300" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}>
            <path d={gainArea} fill="#cdeee6" opacity={0.7} />
            <path d={cPath} fill="none" stroke={C.textMuted} strokeWidth={2} strokeDasharray="6 5" vectorEffect="non-scaling-stroke" />
            <path d={vPath} fill="none" stroke={C.accent700} strokeWidth={3} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </svg>
          <div style={{ position: 'absolute', top: 0, bottom: 0, width: 1, background: C.text, opacity: 0.2, left: pc(X(hp.dt) / 10) }} />
          <div
            style={{
              position: 'absolute',
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: '#fff',
              border: `2px solid ${C.textMuted}`,
              transform: 'translate(-50%,-50%)',
              left: pc(X(hp.dt) / 10),
              top: pc(Y(hp.c) / 3),
            }}
          />
          <div
            style={{
              position: 'absolute',
              width: 12,
              height: 12,
              borderRadius: '50%',
              background: C.accent700,
              border: '2px solid #fff',
              transform: 'translate(-50%,-50%)',
              left: pc(X(hp.dt) / 10),
              top: pc(Y(hp.v) / 3),
            }}
          />
          <div onMouseLeave={() => setHov(null)} style={{ position: 'absolute', inset: 0 }}>
            {ser.map((p, i) => {
              const l = i ? (X(ser[i - 1].dt) + X(p.dt)) / 2 : 0;
              const r = i < ser.length - 1 ? (X(p.dt) + X(ser[i + 1].dt)) / 2 : 1000;
              return <div key={i} onMouseEnter={() => setHov(i)} onClick={() => setHov(i)} style={{ position: 'absolute', top: 0, bottom: 0, left: pc(l / 10), width: pc((r - l) / 10) }} />;
            })}
          </div>
        </div>
        <div />
        <div style={{ position: 'relative', height: 18 }} aria-hidden="true">
          {xTicks.map(t => (
            <span key={t.label + t.left} style={{ position: 'absolute', left: t.left, transform: 'translateX(-50%)', fontSize: 12, color: C.textMuted, whiteSpace: 'nowrap' }}>
              {t.label}
            </span>
          ))}
        </div>
      </div>
      <span className={s.caption}>Tracking since {fullDate(firstReal)}. Each price update adds a point.</span>
    </Card>
  );
}
