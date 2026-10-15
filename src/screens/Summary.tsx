import { useMemo, useState, type MouseEvent } from 'react';
import s from '../styles/ui.module.css';
import { Badge, Bar, Card, CardHead, Dot, IconChip } from '../components/ui';
import { IC, Icon } from '../components/Icon';
import { changeBadge, iconColors, type Budget, type TxView } from '../lib/budget';
import type { Cycle } from '../lib/cycle';
import { dayLabel, dayMonth, pc, sum } from '../lib/format';
import { useSettings } from '../lib/settings';
import { C } from '../lib/tokens';
import { categoryByName, SAVINGS_TARGET_PCT } from '../data/categories';

type Props = { cycle: Cycle; budget: Budget; onOpenCategory: (name: string) => void };

type Item = { key: string; title: string; sub: string; value: string; ink: string; icon: string; cat?: string };

export function Summary({ cycle, budget, onOpenCategory }: Props) {
  return (
    <div className={s.stack}>
      <ThisCycle cycle={cycle} budget={budget} />
      {budget.cards.length > 0 && <CreditCards budget={budget} />}
      <WhereItWent cycle={cycle} budget={budget} onOpenCategory={onOpenCategory} />
      <WeeklyPace cycle={cycle} budget={budget} />
    </div>
  );
}

function ThisCycle({ cycle, budget: b }: { cycle: Cycle; budget: Budget }) {
  const { full, short, ofIncome } = useSettings();
  const [open, setOpen] = useState<string | null>('var');
  const budgetPct = Math.round((b.budget / b.income) * 100);

  const txItem = (t: TxView): Item => {
    const c = categoryByName(t.cat);
    return {
      key: t.id,
      title: t.title,
      sub: `${dayMonth(t.date)} · ${t.time} · ${t.cat} · ${t.source}`,
      value: (t.isIncome ? '+ ' : '- ') + full(t.amount),
      ink: t.isIncome ? C.accent800 : C.redInk,
      icon: c ? c.icon : IC.coins,
      cat: t.cat,
    };
  };
  const typeOf = (n: string) => categoryByName(n)?.type;
  const billItems: Item[] = b.bills.map(bill => ({
    key: bill.title,
    title: bill.title,
    sub: `Due ${dayLabel(bill.date)} · in ${cycle.offsetOf(bill.date) - cycle.dayIdx} days · ${bill.category} · ${bill.source}`,
    value: '- ' + full(bill.amount),
    ink: C.redInk,
    icon: IC.calendar,
    cat: bill.category,
  }));
  const savings = ofIncome(SAVINGS_TARGET_PCT);
  const count = (n: number) => (n ? n + (n === 1 ? ' transaction' : ' transactions') : '');

  const rows: { id: string; label: string; value: string; items: Item[]; note?: string; strong?: boolean }[] = [
    { id: 'inc', label: 'Income', value: full(b.income), items: b.txs.filter(t => t.isIncome).map(txItem) },
    {
      id: 'save',
      label: `Savings (${SAVINGS_TARGET_PCT}%)`,
      value: full(savings),
      items: [{ key: 'save', title: 'Transfer to savings', sub: `${dayMonth(cycle.start)} · Payday · Automatic`, value: '- ' + full(savings), ink: C.redInk, icon: IC.piggy }],
    },
    { id: 'fixed', label: 'Fixed bills paid', value: full(b.fixedSpent), items: b.txs.filter(t => typeOf(t.cat) === 'fixed').map(txItem) },
    { id: 'var', label: 'Variable spending', value: full(b.varSpent), items: b.txs.filter(t => typeOf(t.cat) === 'variable').map(txItem) },
    { id: 'due', label: 'Bills still due', value: full(b.fixedDue), items: billItems, note: `${billItems.length} upcoming before ${dayMonth(cycle.end)}` },
    {
      id: 'safe',
      label: 'Safe to spend / day',
      value: full(b.safeDay),
      items: [],
      note: `${cycle.daysLeft} days left · ${full(b.budget - b.spent - b.fixedDue)} after bills`,
    },
    { id: 'left', label: 'Left to spend', value: full(b.budget - b.spent), items: [], strong: true },
  ];

  const ringDeg = Math.max(0, Math.min(100, b.projSavePct)) * 3.6;
  const onTarget = b.projSavePct >= SAVINGS_TARGET_PCT;
  const heroColor = b.spent > b.budget ? C.red : b.spent > b.paceToday ? C.amber : C.mint[5];

  return (
    <Card style={{ gap: 24, overflow: 'hidden' }}>
      <CardHead title="This cycle" caption="Tap a row to see its transactions" />
      <div style={{ display: 'flex', gap: 32, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, flex: 1, minWidth: 240 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 14, color: C.textMuted }}>Spent this cycle</span>
            <span style={{ fontWeight: 800, letterSpacing: '-0.02em', fontSize: 40, lineHeight: 1.05 }}>{full(b.spent)}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 14, color: C.textMuted }}>Spending budget ({budgetPct}%)</span>
            <span style={{ fontSize: 22, fontWeight: 700 }}>{full(b.budget)}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className={s.track} style={{ height: 14 }}>
              <div className={s.fill} style={{ width: pc((b.spent / b.budget) * 100), background: heroColor }} />
              <div className={s.tick} style={{ top: -5, bottom: -5, width: 4, left: pc((b.paceToday / b.budget) * 100) }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, color: C.textMuted }}>
              <span>{Math.round((b.spent / b.budget) * 100)}% used</span>
              <span>Pace target today {short(b.paceToday)}</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: C.textMuted }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Dot color={C.accent700} /> Fixed {full(b.fixedSpent)}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Dot color={C.mint[5]} /> Variable {full(b.varSpent)}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, margin: '0 auto' }}>
          <div
            role="img"
            aria-label={`Projected savings ${b.projSavePct.toFixed(1)}% against a ${SAVINGS_TARGET_PCT}% target`}
            style={{
              width: 172,
              height: 172,
              borderRadius: '50%',
              background: `conic-gradient(${onTarget ? C.mint[5] : C.amber} 0deg ${ringDeg}deg, ${C.divider} ${ringDeg}deg 360deg)`,
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <div style={{ width: 132, height: 132, borderRadius: '50%', background: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontWeight: 800, letterSpacing: '-0.02em', fontSize: 30, color: onTarget ? C.accent800 : C.amberInk }}>{b.projSavePct.toFixed(1)}%</span>
              <span style={{ fontSize: 12, color: C.textMuted }}>projected savings</span>
            </div>
          </div>
          <span style={{ fontSize: 12, fontWeight: 600, color: C.textMuted }}>Target {SAVINGS_TARGET_PCT}%</span>
        </div>
      </div>
      <div className={s.bleed}>
        {rows.map(r => {
          const has = r.items.length > 0;
          const isOpen = open === r.id && has;
          return (
            <div key={r.id} style={{ borderBottom: `1.5px solid ${C.divider}` }}>
              <button
                type="button"
                className={s.rowBtn}
                disabled={!has}
                aria-expanded={has ? isOpen : undefined}
                onClick={() => has && setOpen(isOpen ? null : r.id)}
                style={{ padding: '16px var(--pad)', fontWeight: r.strong ? 800 : 600, background: r.strong ? C.accentSoft : undefined, minHeight: 56 }}
              >
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, marginRight: 'auto', minWidth: 0 }}>
                  <span style={{ fontSize: 15 }}>{r.label}</span>
                  {(r.note ?? count(r.items.length)) && <span style={{ fontSize: 12, fontWeight: 500, color: C.textMuted }}>{r.note ?? count(r.items.length)}</span>}
                </span>
                <span style={{ fontSize: 15, color: r.strong ? C.accent800 : C.text }}>{r.value}</span>
                <Icon d={IC.chevDown} size={16} color={C.textMuted} style={{ opacity: has ? 1 : 0, transform: isOpen ? 'rotate(180deg)' : 'none' }} />
              </button>
              {isOpen && (
                <div className="fade-in" style={{ margin: '0 20px 16px', background: C.bg, borderRadius: 16, padding: '6px 0', maxHeight: 360, overflowY: 'auto' }}>
                  {r.items.map(i => {
                    const ic = iconColors(i.cat);
                    return (
                      <div key={i.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px' }}>
                        <IconChip d={i.icon} bg={ic.bg} ink={ic.ink} size={34} iconSize={16} />
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginRight: 'auto', minWidth: 0 }}>
                          <span style={{ fontSize: 14, fontWeight: 600 }}>{i.title}</span>
                          <span style={{ fontSize: 12, color: C.textMuted }}>{i.sub}</span>
                        </div>
                        <span style={{ fontSize: 14, fontWeight: 700, color: i.ink, whiteSpace: 'nowrap' }}>{i.value}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function CreditCards({ budget: b }: { budget: Budget }) {
  const { full } = useSettings();
  return (
    <Card>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <h2 className={s.h2}>Credit cards</h2>
        <span className={s.caption}>Card purchases count as spending when you buy. Bill payments are transfers.</span>
      </div>
      <div className={s.bleed}>
        {b.cards.map(c => (
          <div key={c.account} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px var(--pad)', borderBottom: `1.5px solid ${C.divider}`, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: '1 1 260px', minWidth: 0 }}>
              <IconChip d={IC.card} bg={C.accentTint} ink={C.accent800} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
                <span style={{ fontSize: 15, fontWeight: 700 }}>{c.account.replace(/^CC /, '')} card</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12, color: C.textMuted }}>
                  <span>Spent this cycle {full(c.spent)}</span>
                  <span aria-hidden="true">·</span>
                  <span>Last bill {full(c.lastBill)}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    Paid {full(c.paid)}
                    {c.paidOn ? ' on ' + dayMonth(c.paidOn) : ''}
                  </span>
                  <Badge bg={c.paidInFull ? C.accentTint : C.amberTint} ink={c.paidInFull ? C.accent800 : C.amberInk} style={{ fontSize: 12, fontWeight: 700, padding: '4px 10px' }}>
                    {c.paidInFull ? 'Paid in full' : full(c.carriedOver) + ' carried over'}
                  </Badge>
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, marginLeft: 'auto', flex: 'none' }}>
              <span style={{ fontSize: 15, fontWeight: 700 }}>{full(c.owed)}</span>
              <span style={{ fontSize: 12, color: C.textMuted }}>owed</span>
            </div>
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px var(--pad)', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginRight: 'auto', minWidth: 0 }}>
            <span style={{ fontSize: 15, fontWeight: 700 }}>Cash out this cycle</span>
            <span style={{ fontSize: 12, color: C.textMuted }}>
              {full(b.nonCardSpent)} bank &amp; e-wallet spending + {full(b.cardBillsPaid)} card bills paid
            </span>
          </div>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{full(b.cashOut)}</span>
        </div>
      </div>
    </Card>
  );
}

function WhereItWent({ cycle, budget: b, onOpenCategory }: Props) {
  const { full, short } = useSettings();
  const [hover, setHover] = useState<number | null>(null);

  const dCats = useMemo(() => b.cats.filter(c => c.spent > 0).sort((x, y) => y.spent - x.spent), [b.cats]);
  const stops = useMemo(() => {
    let acc = 0;
    return dCats.map(c => {
      const from = acc;
      acc += c.spent / b.spent;
      return { from, to: acc };
    });
  }, [dCats, b.spent]);

  const onMove = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left - r.width / 2;
    const y = e.clientY - r.top - r.height / 2;
    const dist = Math.hypot(x, y) / (r.width / 2);
    let idx: number | null = null;
    if (dist >= 0.6 && dist <= 1) {
      let a = Math.atan2(x, -y) / (2 * Math.PI);
      if (a < 0) a += 1;
      const i = stops.findIndex(st => a >= st.from && a < st.to);
      idx = i < 0 ? null : i;
    }
    if (idx !== hover) setHover(idx);
  };

  const bg = !dCats.length
    ? C.divider
    : 'conic-gradient(' +
    dCats.map((c, i) => `${hover === null || hover === i ? c.color : C.borderStrong} ${(stops[i].from * 360).toFixed(2)}deg ${(stops[i].to * 360).toFixed(2)}deg`).join(', ') +
    ')';
  const sel = hover === null ? null : dCats[hover];
  const ranked = [...b.cats].sort((x, y) => x.status.rank - y.status.rank || y.used - x.used);

  return (
    <Card>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <h2 className={s.h2}>Where it went</h2>
        <span className={s.caption}>Click a segment or category to open it in Categories</span>
      </div>
      <div style={{ display: 'flex', gap: 32, alignItems: 'center', flexWrap: 'wrap' }}>
        <div
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          onClick={() => sel && onOpenCategory(sel.name)}
          role="img"
          aria-label={'Spend by category: ' + dCats.map(c => `${c.name} ${Math.round((c.spent / b.spent) * 100)}%`).join(', ')}
          style={{ position: 'relative', width: 200, height: 200, flex: 'none', borderRadius: '50%', background: bg, cursor: sel ? 'pointer' : 'default', margin: '0 auto' }}
        >
          <div
            style={{
              position: 'absolute',
              inset: '20%',
              borderRadius: '50%',
              background: '#fff',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              pointerEvents: 'none',
              padding: 6,
            }}
          >
            <span style={{ fontSize: 12, color: C.textMuted }}>{sel ? sel.name : 'Spent so far'}</span>
            <span style={{ fontWeight: 800, letterSpacing: '-0.02em', fontSize: 22 }}>{short(sel ? sel.spent : b.spent)}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: C.accent600 }}>
              {sel ? Math.round((sel.spent / b.spent) * 100) + '% of spend' : `Day ${cycle.dayN} of ${cycle.cycleDays}`}
            </span>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '2px 12px', flex: 1, minWidth: 200 }}>
          {dCats.map((c, i) => (
            <button
              key={c.name}
              type="button"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              onClick={() => onOpenCategory(c.name)}
              style={{
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 13,
                padding: '6px 12px',
                minHeight: 36,
                borderRadius: 999,
                textAlign: 'left',
                background: hover === i ? C.divider : 'transparent',
              }}
            >
              <Dot color={c.color} />
              <span style={{ marginRight: 'auto' }}>{c.name}</span>
              <span style={{ fontWeight: 700 }}>{Math.round((c.spent / b.spent) * 100)}%</span>
            </button>
          ))}
        </div>
      </div>
      <div className={s.bleed} style={{ marginTop: 4 }}>
        {ranked.map(c => {
          const ic = iconColors(c.name);
          const ch = changeBadge(c.spent, c.lastSameDays);
          return (
            <button
              key={c.name}
              type="button"
              className={s.rowBtn}
              onClick={() => onOpenCategory(c.name)}
              style={{ padding: '14px var(--pad)', borderBottom: `1.5px solid ${C.divider}`, background: c.status.rowBg, flexWrap: 'wrap' }}
            >
              <IconChip d={c.icon} bg={ic.bg} ink={ic.ink} size={36} iconSize={16} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 220px', minWidth: 0 }}>
                <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 14 }}>
                  <span style={{ fontWeight: 700 }}>{c.name}</span>
                  <span style={{ color: C.textMuted }}>
                    <strong style={{ color: C.text }}>{full(c.spent)}</strong> / {full(c.limit)}
                  </span>
                </span>
                <Bar value={c.spent} max={Math.max(c.limit, c.spent)} tick={c.limit} color={c.status.bar} height={8} label={`${c.name} ${Math.round(c.used)}% of limit`} />
              </span>
              <span style={{ display: 'flex', gap: 6, flex: 'none' }}>
                <Badge bg={c.status.bg} ink={c.status.ink}>
                  {c.status.label}
                </Badge>
                <Badge bg={ch.bg} ink={ch.ink} style={{ minWidth: 56, textAlign: 'center' }}>
                  {ch.label}
                </Badge>
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function WeeklyPace({ cycle, budget: b }: { cycle: Cycle; budget: Budget }) {
  const { full, short } = useSettings();
  const [sel, setSel] = useState(cycle.weekIdx);

  const weeks = useMemo(() => {
    const fixedNames = new Set(b.cats.filter(c => c.type === 'fixed').map(c => c.name));
    let fc = 0;
    let vc = 0;
    let pj = 0;
    return [0, 1, 2, 3].map(i => {
      const first = i * 7;
      const last = i === 3 ? cycle.cycleDays - 1 : i * 7 + 6;
      const futureDays = Math.max(0, last - Math.max(first - 1, cycle.dayIdx));
      const billsIn = sum(b.bills.filter(x => Math.min(3, Math.floor(cycle.offsetOf(x.date) / 7)) === i).map(x => x.amount));
      const proj = b.velDay * futureDays + billsIn;
      const fixedW = sum(b.cats.filter(c => fixedNames.has(c.name)).map(c => c.cur[i]));
      const varW = sum(b.cats.filter(c => !fixedNames.has(c.name)).map(c => c.cur[i]));
      fc += fixedW;
      vc += varW;
      pj += proj;
      const cum = fc + vc + pj;
      return {
        i,
        label: 'Week ' + (i + 1),
        range: dayMonth(cycle.dateOf(first)) + ' – ' + dayMonth(cycle.dateOf(last)),
        isFuture: first > cycle.dayIdx,
        hasProj: proj > 0.5,
        weekSpend: fixedW + varW,
        proj,
        fc,
        vc,
        pj,
        cum,
        ideal: fc + b.varBudget * Math.min(1, (last + 1) / cycle.cycleDays),
      };
    });
  }, [b, cycle]);

  const scale = Math.max(b.projTotal, b.budget) * 1.1;
  const w = weeks[sel];
  const diff = w.cum - w.ideal;
  const projOver = b.projTotal > b.budget;
  const thisW = b.weekTotal(cycle.weekIdx);
  const lastW = cycle.weekIdx > 0 ? b.weekTotal(cycle.weekIdx - 1) : 0;
  const wow = lastW ? ((thisW - lastW) / lastW) * 100 : 0;
  const down = wow < 0;

  return (
    <Card style={{ gap: 16 }}>
      <CardHead title="Weekly pace" caption={`Cumulative spend · dashed line = ${Math.round((b.budget / b.income) * 100)}% budget`} />
      {cycle.weekIdx > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            alignSelf: 'flex-start',
            background: down ? C.accentTint : C.redTint,
            color: down ? C.accent800 : C.redInk,
            borderRadius: 999,
            padding: '8px 16px 8px 8px',
            fontSize: 13,
          }}
        >
          <span style={{ flex: 'none', width: 28, height: 28, borderRadius: '50%', background: '#fff', display: 'grid', placeItems: 'center' }}>
            <Icon d={down ? IC.trendDown : IC.trend} size={16} />
          </span>
          <span>
            <strong>
              Week {cycle.weekIdx + 1} is {Math.abs(Math.round(wow))}% {down ? 'lower' : 'higher'} than week {cycle.weekIdx}
            </strong>{' '}
            · {full(thisW)} vs {full(lastW)}
          </span>
        </div>
      )}
      <div style={{ position: 'relative', height: 220, display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 16, alignItems: 'end' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, height: 0, borderTop: `2px dashed ${C.red}`, bottom: pc((b.budget / scale) * 100), zIndex: 2, pointerEvents: 'none' }} />
        <span
          style={{
            position: 'absolute',
            right: 0,
            fontSize: 12,
            fontWeight: 700,
            color: C.redInk,
            background: '#fff',
            padding: '0 6px',
            transform: 'translateY(50%)',
            bottom: pc((b.budget / scale) * 100),
            zIndex: 3,
          }}
        >
          {short(b.budget)}
        </span>
        {weeks.map(wk => (
          <button
            key={wk.i}
            type="button"
            aria-label={`${wk.label}, cumulative ${short(wk.cum)}`}
            aria-pressed={sel === wk.i}
            onMouseEnter={() => setSel(wk.i)}
            onClick={() => setSel(wk.i)}
            style={{
              position: 'relative',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-end',
              border: 'none',
              borderRadius: 16,
              padding: '0 12px',
              background: sel === wk.i ? C.divider : 'transparent',
            }}
          >
            <div style={{ height: pc((wk.cum / scale) * 100), display: 'flex', flexDirection: 'column-reverse', borderRadius: 14, overflow: 'hidden' }}>
              <div style={{ flex: 'none', height: pc((wk.fc / wk.cum) * 100), background: C.accent700 }} />
              <div style={{ flex: 'none', height: pc((wk.vc / wk.cum) * 100), background: C.mint[5] }} />
              <div style={{ flex: 'none', height: pc((wk.pj / wk.cum) * 100), background: `repeating-linear-gradient(135deg, ${C.mint[8]} 0 6px, ${C.accentHover} 6px 12px)` }} />
            </div>
            <div style={{ position: 'absolute', left: 6, right: 6, height: 3, borderRadius: 2, background: C.text, opacity: 0.55, bottom: pc((wk.ideal / scale) * 100) }} />
          </button>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 16 }}>
        {weeks.map(wk => (
          <div key={wk.i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', fontSize: 12, fontWeight: sel === wk.i ? 700 : 500 }}>
            <span>{wk.label}</span>
            <span style={{ color: C.textMuted, fontWeight: 500 }}>{short(wk.cum)}</span>
          </div>
        ))}
      </div>
      <div className={s.note} style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 13 }} aria-live="polite">
        <span style={{ fontWeight: 700 }}>
          {w.label} · {w.range}
          {w.isFuture ? ' · projected' : ''}
        </span>
        <span>
          {w.isFuture ? 'Projected spend ' + short(w.proj) : 'Spent ' + short(w.weekSpend) + (w.hasProj ? ' + ' + short(w.proj) + ' projected' : '')} · cumulative {short(w.cum)} · ideal{' '}
          {short(w.ideal)}
        </span>
        <span style={{ fontWeight: 700, color: (w.isFuture ? projOver : diff > 0) ? C.redInk : C.accent800 }}>
          {w.isFuture
            ? projOver
              ? `Ends ${short(b.projTotal - b.budget)} over budget at current pace`
              : `Ends ${short(b.budget - b.projTotal)} under budget at current pace`
            : diff > 0
              ? `${short(diff)} ahead of ideal pace`
              : `${short(-diff)} behind ideal pace`}
        </span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, fontSize: 12, color: C.textSoft }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Dot color={C.accent700} />
          Fixed bills
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Dot color={C.mint[5]} />
          Variable
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Dot color={C.mint[8]} />
          Projected
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 12, height: 3, borderRadius: 2, background: C.textMuted }} />
          Ideal pace
        </span>
      </div>
    </Card>
  );
}
