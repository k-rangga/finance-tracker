import { useState, type ReactNode } from 'react';
import s from '../styles/ui.module.css';
import { Card, Dot } from '../components/ui';
import { IC, Icon } from '../components/Icon';
import type { Budget, CatView, TxView } from '../lib/budget';
import { dayMonth, sum, tidyName } from '../lib/format';
import { useSettings } from '../lib/settings';
import { useSetLimits } from '../lib/limits';
import { useIsPhone } from '../lib/media';
import { C } from '../lib/tokens';
import { SAVINGS_TARGET_PCT } from '../data/categories';

/** "43.6": limits set as an amount are an exact share of income, so show one decimal at most. */
const pct = (v: number) => String(Math.round(v * 10) / 10);

const SAVE_INK = '#3d9a88';
const FIXED_INK = '#b4ecdf';
const VAR_INK = '#6fd9c2';

/** What a spending transaction counts for this cycle. */
const isSpend = (t: TxView) => !t.isIncome && !t.isTransfer && t.net > 0;

/**
 * Your income, split the way you planned it, next to what really happened: last cycle in full, and this cycle so
 * far. Groups open into their savings buckets, categories, sub-categories and the bills behind them. It always
 * adds up to 100%: money you haven't given a job shows as Not planned, with a place to put it.
 */
export function MonthlyPlan({ budget: b, onOpenInvest }: { budget: Budget; onOpenInvest: () => void }) {
  const { full, ofIncome, settings, update } = useSettings();
  const setLimits = useSetLimits();
  const phone = useIsPhone();
  const [open, setOpen] = useState<Set<string>>(() => new Set(['Savings', 'Fixed bills', 'Everyday spending']));
  const toggle = (k: string) => setOpen(o => (o.has(k) ? new Set([...o].filter(x => x !== k)) : new Set([...o, k])));

  const used = b.cats.filter(c => c.limitPct > 0);
  const unused = b.cats.filter(c => c.limitPct <= 0);
  const fixed = used.filter(c => c.type === 'fixed');
  const vari = used.filter(c => c.type === 'variable');
  const fixedPct = sum(fixed.map(c => c.limitPct));
  const varPct = sum(vari.map(c => c.limitPct));
  const notPlanned = 100 - SAVINGS_TARGET_PCT - fixedPct - varPct;
  const lastOf = (c: CatView) => sum(c.prev);
  const buffer = b.cats.find(c => c.name === 'Buffer');

  // Savings buckets: how the savings share is split each payday.
  const investPct = Math.min(SAVINGS_TARGET_PCT, settings.investPct);
  const bigPct = Math.min(10, SAVINGS_TARGET_PCT - investPct);
  const emergencyPct = Math.max(0, SAVINGS_TARGET_PCT - investPct - bigPct);
  const buckets: { name: string; pct: number; note: ReactNode; now?: number }[] = [
    { name: 'Emergency fund', pct: emergencyPct, note: `Target ${full(b.budget * 6)}, six months of spending` },
    {
      name: 'Investing',
      pct: investPct,
      now: b.invested,
      note: (
        <button type="button" className={s.linkBtn} style={{ fontSize: 13, alignSelf: 'flex-start' }} onClick={onOpenInvest}>
          Open investment journal <Icon d={IC.arrowRight} size={13} />
        </button>
      ),
    },
    { name: 'Planned big costs', pct: bigPct, note: 'Travel, devices, annual fees' },
  ].filter(x => x.pct > 0);

  /** A plan that's off from last cycle by more than a little, and the amount that would match it. */
  const flagOf = (c: CatView): { text: string; ink: string; to: number } | null => {
    const last = lastOf(c);
    if (last <= 0) return null;
    const round = settings.currency === 'IDR' ? 10_000 : 1;
    const to = Math.ceil(last / round) * round;
    if (last > c.limit * 1.15 + round) return { text: `Last cycle ${full(last)}, ${full(last - c.limit)} over plan`, ink: C.amberInk, to };
    if (c.type === 'fixed' && last < c.limit * 0.7) return { text: `Last cycle needed only ${full(last)}`, ink: C.textMuted, to };
    return null;
  };
  const planTo = (c: CatView, amount: number) => setLimits({ [c.name]: (amount / settings.income) * 100 });

  /** Inside a fixed category: what was paid this cycle, by merchant, and the bills still to come. */
  const billsIn = (c: CatView) => {
    const paid = new Map<string, { total: number; last: Date }>();
    for (const t of b.txs)
      if (t.cat === c.name && isSpend(t)) {
        const k = tidyName(t.title);
        const x = paid.get(k);
        paid.set(k, { total: (x?.total ?? 0) + t.net, last: x && x.last > t.date ? x.last : t.date });
      }
    return [
      ...[...paid].map(([name, x]) => ({ name, note: `paid ${dayMonth(x.last)}`, amount: x.total, due: false })),
      ...b.bills.filter(x => x.category === c.name).map(x => ({ name: tidyName(x.title), note: `due ${dayMonth(x.date)}`, amount: x.amount, due: true })),
    ];
  };
  /** Inside an everyday category: this cycle by sub-category, else its biggest merchants. */
  const partsOf = (c: CatView) => {
    const mine = b.txs.filter(t => t.cat === c.name && isSpend(t));
    const subs = settings.subcategories[c.name] ?? [];
    if (subs.length && mine.some(t => t.sub))
      return [...subs, null]
        .map(sub => ({ name: sub ?? 'Other', amount: sum(mine.filter(t => (t.sub ?? null) === sub).map(t => t.net)) }))
        .filter(x => x.amount > 0)
        .sort((x, y) => y.amount - x.amount);
    const by = new Map<string, number>();
    for (const t of mine) by.set(tidyName(t.title), (by.get(tidyName(t.title)) ?? 0) + t.net);
    return [...by]
      .map(([name, amount]) => ({ name, amount }))
      .sort((x, y) => y.amount - x.amount)
      .slice(0, 5);
  };
  const nowInk = (c: CatView) => (c.spent > c.limit + 1 ? C.redInk : c.used >= settings.warnAt ? C.amberInk : undefined);

  const catRows = (c: CatView) => {
    const key = 'cat:' + c.name;
    const flag = flagOf(c);
    const items = c.type === 'fixed' ? billsIn(c) : partsOf(c).map(x => ({ ...x, note: '', due: false }));
    return (
      <div key={c.name}>
        <Row
          level={1}
          name={c.name}
          pctText={pct(c.limitPct)}
          plan={full(c.limit)}
          last={lastOf(c) > 0 ? full(lastOf(c)) : '—'}
          now={c.spent > 0 ? full(c.spent) : '—'}
          nowInk={nowInk(c)}
          open={items.length ? open.has(key) : undefined}
          onToggle={() => toggle(key)}
          phone={phone}
          flag={
            flag && (
              <span className={s.mpFlag} style={{ color: flag.ink }}>
                {flag.ink === C.amberInk && <Icon d={IC.alert} size={13} />}
                {flag.text}
                <button type="button" className={s.textBtnSm} onClick={() => planTo(c, flag.to)}>
                  Plan {full(flag.to)}
                </button>
              </span>
            )
          }
        />
        {open.has(key) &&
          items.map(x => <Row key={x.name + x.note} level={2} name={x.name} note={x.note} now={full(x.amount)} nowInk={x.due ? C.textMuted : undefined} phone={phone} />)}
      </div>
    );
  };

  return (
    <Card style={{ gap: 14 }}>
      <div className={s.cardHead}>
        <h2 className={s.h2}>Monthly plan</h2>
        <span className={s.caption}>{full(b.income)} income · plan, last cycle and this cycle so far</span>
      </div>

      <div style={{ display: 'flex', height: 14, borderRadius: 999, overflow: 'hidden', gap: 3 }} aria-hidden="true">
        <div style={{ flex: SAVINGS_TARGET_PCT, background: SAVE_INK }} />
        <div style={{ flex: fixedPct, background: FIXED_INK }} />
        <div style={{ flex: varPct, background: VAR_INK }} />
        {notPlanned > 0.05 && <div style={{ flex: notPlanned, background: C.divider }} />}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', fontSize: 13 }}>
        {(
          [
            [SAVE_INK, 'Savings', SAVINGS_TARGET_PCT],
            [FIXED_INK, 'Fixed bills', fixedPct],
            [VAR_INK, 'Everyday', varPct],
            ...(notPlanned > 0.05 ? [[C.divider, 'Not planned', notPlanned] as const] : []),
          ] as const
        ).map(([ink, label, p]) => (
          <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Dot color={ink} />
            {label} {pct(p)}%
          </span>
        ))}
      </div>

      <div className={s.mpTable}>
        {!phone && (
          <div className={s.mpHead}>
            <span />
            <span>%</span>
            <span>Plan</span>
            <span>Last cycle</span>
            <span>This cycle</span>
          </div>
        )}

        <Row
          level={0}
          name="Savings"
          note="moved on payday"
          pctText={pct(SAVINGS_TARGET_PCT)}
          plan={full(ofIncome(SAVINGS_TARGET_PCT))}
          last="—"
          now={b.saved > 0 ? full(b.saved) : '—'}
          open={open.has('Savings')}
          onToggle={() => toggle('Savings')}
          phone={phone}
        />
        {open.has('Savings') &&
          buckets.map(k => (
            <Row
              key={k.name}
              level={1}
              name={k.name}
              note={k.note}
              pctText={pct(k.pct)}
              plan={full(ofIncome(k.pct))}
              last="—"
              now={k.now ? full(k.now) : '—'}
              phone={phone}
            />
          ))}

        <Row
          level={0}
          name="Fixed bills"
          pctText={pct(fixedPct)}
          plan={full(ofIncome(fixedPct))}
          last={full(sum(fixed.map(lastOf)))}
          now={full(sum(fixed.map(c => c.spent)))}
          open={open.has('Fixed bills')}
          onToggle={() => toggle('Fixed bills')}
          phone={phone}
        />
        {open.has('Fixed bills') && fixed.map(catRows)}

        <Row
          level={0}
          name="Everyday spending"
          pctText={pct(varPct)}
          plan={full(ofIncome(varPct))}
          last={full(sum(vari.map(lastOf)))}
          now={full(sum(vari.map(c => c.spent)))}
          open={open.has('Everyday spending')}
          onToggle={() => toggle('Everyday spending')}
          phone={phone}
        />
        {open.has('Everyday spending') && vari.map(catRows)}

        {Math.abs(notPlanned) > 0.05 && (
          <div className={s.mpLeftover} style={notPlanned < 0 ? { background: C.redTint, color: C.redInk } : undefined}>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, marginRight: 'auto', minWidth: 0 }}>
              <strong style={{ fontWeight: 600 }}>
                {notPlanned > 0 ? `Not planned · ${full(ofIncome(notPlanned))} (${pct(notPlanned)}%)` : `Planned beyond income · ${full(ofIncome(-notPlanned))} (${pct(-notPlanned)}%)`}
              </strong>
              <span style={{ fontSize: 13, color: notPlanned > 0 ? C.textMuted : 'inherit' }}>
                {notPlanned > 0 ? 'Income with no job yet. Give it one:' : 'Your limits and savings add up to more than you earn. Lower a limit, or savings:'}
              </span>
            </span>
            {notPlanned > 0 ? (
              <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className={s.btnOutlineSm} onClick={() => update({ savingsPct: Math.round((settings.savingsPct + notPlanned) * 10) / 10 })}>
                  Add to Savings
                </button>
                {buffer && (
                  <button type="button" className={s.btnOutlineSm} onClick={() => setLimits({ Buffer: buffer.limitPct + notPlanned })}>
                    Add to Buffer
                  </button>
                )}
              </span>
            ) : (
              <button type="button" className={s.btnOutlineSm} onClick={() => update({ savingsPct: Math.max(0, Math.round((settings.savingsPct + notPlanned) * 10) / 10) })}>
                Save {pct(SAVINGS_TARGET_PCT + notPlanned)}% instead
              </button>
            )}
          </div>
        )}

        <Row level={0} name="Income" pctText="100" plan={full(b.income)} phone={phone} total />
      </div>

      {unused.length > 0 && <span style={{ fontSize: 13, color: C.textMuted }}>Not in the plan: {unused.map(c => c.name).join(', ')} (0%).</span>}
    </Card>
  );
}

/**
 * One line of the plan. Desktop: name, %, plan, last cycle, this cycle in columns. Phone: name and plan, with last
 * and this cycle on a line below. `open` (when set) makes the name a toggle for the rows inside it.
 */
function Row({
  level,
  name,
  note,
  pctText,
  plan,
  last,
  now,
  nowInk,
  open,
  onToggle,
  flag,
  phone,
  total,
}: {
  level: 0 | 1 | 2;
  name: string;
  note?: ReactNode;
  pctText?: string;
  plan?: string;
  last?: string;
  now?: string;
  nowInk?: string;
  open?: boolean;
  onToggle?: () => void;
  flag?: ReactNode;
  phone: boolean;
  total?: boolean;
}) {
  const label = (
    <span className={s.mpName} style={{ paddingLeft: level * 18 }}>
      {open !== undefined ? (
        <button type="button" className={s.mpToggle} aria-expanded={open} onClick={onToggle}>
          <Icon d={IC.chevDown} size={14} style={{ transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform .15s' }} />
          {name}
        </button>
      ) : (
        <span style={{ paddingLeft: level < 2 ? 20 : 0 }}>{name}</span>
      )}
      {note && <span className={s.mpNote}>{note}</span>}
    </span>
  );
  /** Phones leave out an empty column rather than show "—". */
  const has = (v?: string) => !!v && v !== '—';
  const cls = `${s.mpRow} ${level === 0 ? s.mpGroup : level === 2 ? s.mpItem : ''} ${total ? s.mpTotal : ''}`;

  if (phone)
    return (
      <div className={cls}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          {label}
          <span className={s.mpNum} style={level === 2 ? { color: nowInk } : undefined}>
            {level === 2 ? now : plan}
            {pctText && level < 2 && <span className={s.mpPct} style={{ marginLeft: 6 }}>{pctText}%</span>}
          </span>
        </div>
        {level < 2 && !total && (has(last) || has(now)) && (
          <span className={s.mpSub} style={{ paddingLeft: level * 18 + 20 }}>
            {has(last) && `Last cycle ${last}`}
            {has(last) && has(now) && ' · '}
            {has(now) && (
              <>
                this cycle <span style={{ color: nowInk }}>{now}</span>
              </>
            )}
          </span>
        )}
        {flag && <span style={{ paddingLeft: level * 18 + 20 }}>{flag}</span>}
      </div>
    );

  return (
    <div className={cls}>
      <div className={s.mpCols}>
        {label}
        <span className={s.mpPct}>{pctText ? `${pctText}%` : ''}</span>
        <span className={s.mpNum}>{plan ?? ''}</span>
        <span className={s.mpNum} style={{ color: C.textSoft, fontWeight: 500 }}>
          {last ?? ''}
        </span>
        <span className={s.mpNum} style={{ color: nowInk, fontWeight: level === 0 ? 600 : 500 }}>
          {now ?? ''}
        </span>
      </div>
      {flag && <span style={{ paddingLeft: level * 18 + 20 }}>{flag}</span>}
    </div>
  );
}
