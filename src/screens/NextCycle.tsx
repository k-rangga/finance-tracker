import { useEffect, useRef, useState } from 'react';
import s from '../styles/ui.module.css';
import { Card } from '../components/ui';
import { IC, Icon } from '../components/Icon';
import { Select } from '../components/Select';
import { builtInCategory, CATEGORIES, categoryByName, type Category } from '../data/categories';
import type { Bill } from '../data/transactions';
import type { Budget } from '../lib/budget';
import type { Cycle } from '../lib/cycle';
import { checkPlan, cycleKey, spendingProfile, type CyclePlan, type PlanCheck, type PlannedCost } from '../lib/cyclePlans';
import { Logo } from '../components/Logo';
import { ThinkingArcs, thinkingLabel } from '../components/Chat';
import { dayLabel, dayMonth, sum, tidyName, toISO } from '../lib/format';
import { useSettings } from '../lib/settings';
import { C } from '../lib/tokens';
import { AmountEditor } from './Categories';

type Props = {
  cycle: Cycle;
  next: Cycle;
  budget: Budget;
  /** Installment payments and subscription charges already due in the next cycle. */
  known: { installments: Bill[]; subscriptions: Bill[] };
};

/**
 * Planning the next pay cycle before it starts: what's already promised (bills, installments, one-off costs,
 * savings), what that leaves for everyday spending, amounts for that cycle only, and a few suggestions from how
 * this cycle is going. It becomes the active plan on payday.
 */
export function NextCycle({ cycle, next, budget, known }: Props) {
  const { settings, update, full } = useSettings();
  const key = cycleKey(next);
  const plan: CyclePlan = settings.cyclePlans?.[key] ?? {};
  // The newest plan, so several changes in a row (Apply, Apply) each build on the last one.
  const latest = useRef(plan);
  latest.current = plan;
  const income = settings.income;
  const pctOf = (amount: number) => (income > 0 ? (amount / income) * 100 : 0);
  const amountOf = (pct: number) => (pct / 100) * income;

  /** A category's regular amount (your plan without any one-cycle changes). */
  const regularPct = (c: Category) =>
    settings.customCategories.find(x => x.name === c.name)?.limitPct ?? settings.limitOverrides[c.name] ?? c.defaultLimitPct ?? builtInCategory(c.name)?.limitPct ?? 0;
  const nextPct = (c: Category) => plan.limits?.[c.name] ?? regularPct(c);

  const save = (p: CyclePlan) => {
    latest.current = p;
    // Only this cycle's and later plans are kept.
    const now = cycleKey(cycle);
    const kept = Object.fromEntries(Object.entries(settings.cyclePlans ?? {}).filter(([k]) => k >= now && k !== key));
    update({ cyclePlans: { ...kept, [key]: p } });
  };
  const setAmount = (c: Category, amount: number) => {
    const plan = latest.current;
    const limits = { ...(plan.limits ?? {}) };
    // Enough decimals that the amount you typed comes back exactly (Rp 1.100.000, not 1.100.010).
    const pct = Math.round(pctOf(amount) * 1e8) / 1e8;
    if (Math.abs(pct - regularPct(c)) < 1e-6) delete limits[c.name];
    else limits[c.name] = pct;
    save({ ...plan, limits });
  };
  const costs = plan.costs ?? [];
  const setCosts = (list: PlannedCost[]) => save({ ...latest.current, costs: list });

  const fixed = CATEGORIES.filter(c => c.type === 'fixed' && !c.auto);
  const everyday = CATEGORIES.filter(c => c.type === 'variable');
  const fixedTotal = sum(fixed.map(c => amountOf(nextPct(c))));
  const installments = sum(known.installments.map(b => b.amount));
  const oneOffs = sum(costs.map(c => c.amount));
  const savings = amountOf(settings.savingsPct);
  const free = income - fixedTotal - installments - oneOffs - savings;
  const everydayTotal = sum(everyday.map(c => amountOf(nextPct(c))));
  const left = free - everydayTotal;
  const changed = Object.keys(plan.limits ?? {}).length;
  const bufferPct = settings.bufferPct ?? 10;

  return (
    <div className={s.stack}>
      <Card style={{ gap: 4 }}>
        <h2 className={s.h2}>
          {dayMonth(next.start)} – {dayMonth(next.end)}
        </h2>
        <span style={{ fontSize: 14, color: C.textMuted }}>
          Payday {dayLabel(next.start)}, {next.cycleDays} days. This plan starts on its own that day.
        </span>
      </Card>

      <Card style={{ gap: 10 }}>
        <h2 className={s.h2}>What's already promised</h2>
        <div className={s.planLines}>
          <Line label="Income" value={full(income)} strong />
          <Line
            label="Fixed bills"
            value={'− ' + full(fixedTotal)}
            note={known.subscriptions.length ? 'Subscriptions due: ' + known.subscriptions.map(b => `${tidyName(b.title)} ${dayMonth(b.date)}`).join(', ') : undefined}
          />
          {installments > 0 && (
            <Line
              label="Installments"
              value={'− ' + full(installments)}
              note={known.installments.map(b => tidyName(b.title.replace(/ \(\d+\/\d+\)$/, ''))).join(', ')}
            />
          )}
          {oneOffs > 0 && <Line label="One-off costs" value={'− ' + full(oneOffs)} note={costs.map(c => c.name).join(', ')} />}
          <Line label={`Savings and investing (${settings.savingsPct}%)`} value={'− ' + full(savings)} />
          <div className={s.planDivider} />
          <Line label="Free for everyday spending" value={full(free)} strong ink={free < 0 ? C.redInk : undefined} />
          <Line label="Everyday plan" value={'− ' + full(everydayTotal)} />
        </div>
        <BufferBar left={left} income={income} pct={bufferPct} onPct={v => update({ bufferPct: v })} />
      </Card>

      <PurrCheck
        payload={() => ({
          // The whole plan, so Maxie checks all of it, not just everyday categories.
          city: settings.city || undefined,
          currency: settings.currency,
          nextCycle: { start: toISO(next.start), end: toISO(next.end), days: next.cycleDays },
          today: { cycleDay: cycle.dayN, cycleDays: cycle.cycleDays },
          income,
          savingsTargetPct: settings.savingsPct,
          bufferGoal: amountOf(bufferPct),
          bufferPct,
          left,
          promised: { fixedBills: fixedTotal, installments, oneOffs, savings },
          installments: known.installments.map(b => ({ title: tidyName(b.title), amount: Math.round(b.amount), date: toISO(b.date) })),
          subscriptions: known.subscriptions.map(b => ({ title: tidyName(b.title), amount: Math.round(b.amount), date: toISO(b.date) })),
          oneOffs: costs.map(c => ({ name: c.name, amount: c.amount, date: c.date, category: c.category })),
          categories: [...everyday, ...fixed].map(c => {
            const now = budget.cats.find(x => x.name === c.name);
            return {
              name: c.name,
              type: c.type,
              next: Math.round(amountOf(nextPct(c))),
              usual: Math.round(amountOf(regularPct(c))),
              thisCycle: now ? Math.round((now.spent / Math.max(1, cycle.dayN)) * cycle.cycleDays) : 0,
              lastCycle: now ? Math.round(sum(now.prev)) : 0,
              spending: spendingProfile(cycle, budget, c.name),
            };
          }),
        })}
        amountOfCategory={name => {
          const c = CATEGORIES.find(x => x.name === name);
          return c ? amountOf(nextPct(c)) : 0;
        }}
        onApply={(name, amount) => {
          const c = CATEGORIES.find(x => x.name === name);
          if (c) setAmount(c, amount);
        }}
      />

      <Suggestions cycle={cycle} budget={budget} nextPct={nextPct} onApply={(c, amount) => setAmount(c, amount)} />

      <Card style={{ gap: 6 }}>
        <div className={s.cardHead}>
          <h2 className={s.h2}>Amounts next cycle</h2>
          <span className={s.caption}>{changed ? `${changed} changed for this cycle` : 'Same as your regular plan'}</span>
        </div>
        <span style={{ fontSize: 13, color: C.textMuted }}>Changes here are for this cycle only. Your regular plan stays as it is.</span>
        <span className={s.planGroup}>Everyday spending</span>
        {everyday.map(c => (
          <AmountRow key={c.name} c={c} amount={amountOf(nextPct(c))} regular={amountOf(regularPct(c))} onSave={v => setAmount(c, v)} />
        ))}
        <span className={s.planGroup}>Fixed bills</span>
        {fixed.map(c => (
          <AmountRow key={c.name} c={c} amount={amountOf(nextPct(c))} regular={amountOf(regularPct(c))} onSave={v => setAmount(c, v)} />
        ))}
      </Card>

      <OneOffs next={next} costs={costs} onChange={setCosts} />
    </div>
  );
}

/** What's left unplanned against the buffer goal (a share of income you keep free), with the goal adjustable. */
function BufferBar({ left, income, pct, onPct }: { left: number; income: number; pct: number; onPct: (v: number) => void }) {
  const { short } = useSettings();
  const goal = (pct / 100) * income;
  const state = left < 0 ? 'over' : left < goal ? 'short' : 'met';
  const ink = state === 'over' ? C.redInk : state === 'short' ? C.amberInk : C.good;
  const bar = state === 'over' ? C.red : state === 'short' ? C.amber : C.good;
  const fill = goal > 0 ? Math.max(0, Math.min(1, left / goal)) : left >= 0 ? 1 : 0;
  return (
    <div className={s.bufferBox}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{ fontWeight: 600, marginRight: 'auto' }}>Buffer</span>
        <span style={{ fontWeight: 650, color: ink, whiteSpace: 'nowrap' }}>
          {state === 'over' ? `${short(-left)} over income` : `${short(left)} of ${short(goal)}`}
        </span>
      </div>
      <span className={s.sumTrack} role="img" aria-label={`Buffer ${Math.round(fill * 100)}% of the goal`}>
        <span className={s.sumFill} style={{ width: fill * 100 + '%', background: bar }} />
      </span>
      <label className={s.bufferGoal}>
        <span>Goal</span>
        <input type="range" min={0} max={25} step={1} value={pct} onChange={e => onPct(Number(e.target.value))} aria-label="Buffer goal, % of income" />
        <span style={{ minWidth: 36, textAlign: 'right', fontWeight: 600 }}>{pct}%</span>
      </label>
    </div>
  );
}

/**
 * Maxie on the next cycle: "Plan it for me" sets an amount for each everyday category from your real spending,
 * "Check my plan" reviews the plan you made. Either way, each amount is applied with a tap (or all at once) and
 * can be undone.
 */
function PurrCheck({
  payload,
  amountOfCategory,
  onApply,
}: {
  payload: () => unknown;
  amountOfCategory: (name: string) => number;
  onApply: (name: string, amount: number) => void;
}) {
  const { short, settings } = useSettings();
  const city = settings.city?.trim();
  const [state, setState] = useState<'' | 'working' | 'done'>('');
  const [mode, setMode] = useState<'build' | 'check'>('build');
  const [waited, setWaited] = useState(0);
  const [result, setResult] = useState<PlanCheck | null>(null);
  const [applied, setApplied] = useState<Record<string, number>>({});
  useEffect(() => {
    if (state !== 'working') return;
    const t = setInterval(() => setWaited(w => w + 1), 1000);
    return () => clearInterval(t);
  }, [state]);
  const run = async (m: 'build' | 'check') => {
    setMode(m);
    setState('working');
    setWaited(0);
    setApplied({});
    try {
      setResult(await checkPlan({ ...(payload() as object), mode: m }));
    } catch (e) {
      setResult({ error: 'api', detail: e instanceof Error ? e.message : String(e) });
    }
    setState('done');
  };
  // Changes that would actually change something.
  const changes = (result?.changes ?? []).filter(c => applied[c.category] != null || Math.abs(amountOfCategory(c.category) - c.amount) >= 1);
  const open = changes.filter(c => applied[c.category] == null);
  const apply = (c: { category: string; amount: number }) => {
    setApplied(a => ({ ...a, [c.category]: amountOfCategory(c.category) }));
    onApply(c.category, c.amount);
  };
  return (
    <Card style={{ gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Logo size={28} />
        <span style={{ fontFamily: 'var(--font-serif)', fontSize: 19, fontWeight: 500, marginRight: 'auto' }}>Maxie</span>
      </div>
      {state === 'working' ? (
        <span className={s.thinking} role="status" aria-live="polite">
          <span className={s.thinkLabel}>
            {waited < 3
              ? 'Reading your whole plan…'
              : waited < 8
                ? 'Looking at where your money goes…'
                : city && waited < 20
                  ? `Checking prices in ${city}…`
                  : mode === 'build'
                    ? 'Setting your amounts…'
                    : thinkingLabel(waited)}
          </span>
          <ThinkingArcs />
        </span>
      ) : state === 'done' && result?.error ? (
        <span style={{ fontSize: 14, color: C.redInk }}>{result.error === 'no_key' ? "I can't plan yet: I need my Gemini API key." : "Sorry, I couldn't do that just now. Try again in a minute?"}</span>
      ) : state === 'done' && result?.verdict ? (
        <>
          <p className={s.insightBody} style={{ fontSize: 17, lineHeight: '26px' }}>
            {result.verdict}
          </p>
          {(result.notes ?? []).length > 0 && (
            <ul className={s.maxieNotes}>
              {result.notes!.map(n => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          {result.searched && city && <span style={{ fontSize: 12, color: C.textMuted }}>I compared with typical prices in {city}.</span>}
        </>
      ) : (
        <p className={s.insightBody} style={{ fontSize: 17, lineHeight: '26px' }}>
          Want me to plan next cycle from what you actually spend? I'll look over the whole plan and keep your buffer covered.
        </p>
      )}
      {changes.map(c => {
        const done = applied[c.category] != null;
        const from = done ? applied[c.category] : amountOfCategory(c.category);
        return (
          <div key={c.category} className={s.changeRow}>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, marginRight: 'auto', minWidth: 0 }}>
              <span style={{ fontWeight: 600 }}>
                {c.category}{' '}
                <span style={{ fontWeight: 500, color: C.textMuted }}>
                  {short(from)} → {short(c.amount)}
                </span>
              </span>
              {c.why && <span style={{ fontSize: 13, color: C.textMuted }}>{c.why}</span>}
            </span>
            {done ? (
              <button
                type="button"
                className={s.textBtnSm}
                onClick={() => {
                  onApply(c.category, applied[c.category]);
                  setApplied(a => Object.fromEntries(Object.entries(a).filter(([k]) => k !== c.category)));
                }}
              >
                Undo
              </button>
            ) : (
              <button type="button" className={s.btnOutlineSm} onClick={() => apply(c)}>
                Apply
              </button>
            )}
          </div>
        );
      })}
      {state !== 'working' && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {open.length > 1 && (
            <button type="button" className={s.btnPrimarySm} onClick={() => open.forEach(apply)}>
              Apply all {open.length}
            </button>
          )}
          {state !== 'done' && (
            <button type="button" className={s.btnPrimarySm} onClick={() => run('build')}>
              Plan it for me
            </button>
          )}
          <button type="button" className={s.btnOutlineSm} onClick={() => run('check')}>
            {state === 'done' && mode === 'check' ? 'Check again' : 'Check my plan'}
          </button>
          {state === 'done' && (
            <button type="button" className={s.textBtnSm} onClick={() => run('build')}>
              Plan it again
            </button>
          )}
        </div>
      )}
    </Card>
  );
}

function Line({ label, value, note, strong, ink }: { label: string; value: string; note?: string; strong?: boolean; ink?: string }) {
  return (
    <div className={s.planLine}>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, marginRight: 'auto' }}>
        <span style={{ fontWeight: strong ? 600 : 400 }}>{label}</span>
        {note && <span style={{ fontSize: 13, color: C.textMuted }}>{note}</span>}
      </span>
      <span style={{ fontWeight: strong ? 650 : 500, whiteSpace: 'nowrap', color: ink ?? C.text }}>{value}</span>
    </div>
  );
}

/** A category's amount for the next cycle: tap to change it; shows the regular amount when it differs. */
function AmountRow({ c, amount, regular, onSave }: { c: Category; amount: number; regular: number; onSave: (v: number) => void }) {
  const { short } = useSettings();
  const [open, setOpen] = useState(false);
  const differs = Math.abs(amount - regular) >= 1;
  return (
    <div>
      <button type="button" className={s.planAmountRow} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 1, marginRight: 'auto', minWidth: 0 }}>
          <span>{c.name}</span>
          {differs && <span style={{ fontSize: 12, color: C.textMuted }}>Usually {short(regular)}</span>}
        </span>
        <span style={{ fontWeight: 600, whiteSpace: 'nowrap', color: amount > 0 ? C.text : C.textMuted }}>{amount > 0 ? short(amount) : 'None'}</span>
        <Icon d={IC.chevDown} size={15} color={C.textMuted} style={{ transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && (
        <div style={{ padding: '4px 0 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <AmountEditor
            label={`${c.name} next cycle`}
            initial={amount}
            onSave={v => {
              onSave(v);
              setOpen(false);
            }}
            onCancel={() => setOpen(false)}
          />
          {differs && (
            <button
              type="button"
              className={s.textBtnSm}
              style={{ alignSelf: 'flex-start', padding: 0 }}
              onClick={() => {
                onSave(regular);
                setOpen(false);
              }}
            >
              Back to the usual {short(regular)}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * From how this cycle is going (spending so far, carried to the end of the cycle): raise a category that's on
 * track to go over, or trim one that will use much less. One tap sets it for the next cycle.
 */
function Suggestions({ cycle, budget, nextPct, onApply }: { cycle: Cycle; budget: Budget; nextPct: (c: Category) => number; onApply: (c: Category, amount: number) => void }) {
  const { settings, short } = useSettings();
  if (cycle.dayN < 7) return null;
  const step = settings.currency === 'IDR' ? 50_000 : 5;
  const up = (v: number) => Math.ceil(v / step) * step;
  const list = budget.cats
    .filter(c => c.type === 'variable' && c.limit > 0)
    .map(c => {
      const projected = (c.spent / cycle.dayN) * cycle.cycleDays;
      const cat = categoryByName(c.name)!;
      const planned = (nextPct(cat) / 100) * settings.income;
      if (projected > c.limit * 1.1) {
        const to = up(projected);
        return to > planned + step / 2 ? { cat, to, text: `${c.name} is heading for ${short(projected)} this cycle, against a plan of ${short(c.limit)}.`, verb: 'Plan' } : null;
      }
      // Only categories you've actually used: nothing spent yet says nothing about next cycle.
      if (c.spent > 0 && projected < c.limit * 0.6 && c.limit - projected >= step * 4) {
        const to = up(projected * 1.15);
        return to < planned - step / 2 ? { cat, to, text: `${c.name} will likely use only ${short(projected)} of ${short(c.limit)}.`, verb: 'Plan' } : null;
      }
      return null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .slice(0, 4);
  if (!list.length) return null;
  return (
    <Card style={{ gap: 10 }}>
      <h2 className={s.h2}>From this cycle</h2>
      {list.map(x => (
        <div key={x.cat.name} className={s.suggestRow}>
          <span style={{ fontSize: 14, lineHeight: 1.45, marginRight: 'auto', minWidth: 0 }}>{x.text}</span>
          <button type="button" className={s.btnOutlineSm} style={{ flex: 'none' }} onClick={() => onApply(x.cat, x.to)}>
            {x.verb} {short(x.to)}
          </button>
        </div>
      ))}
    </Card>
  );
}

/** One-off costs in the next cycle: set aside in the plan, shown as bills on their date, ticked off when paid. */
function OneOffs({ next, costs, onChange }: { next: Cycle; costs: PlannedCost[]; onChange: (list: PlannedCost[]) => void }) {
  const { settings, full } = useSettings();
  const idr = settings.currency === 'IDR';
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(toISO(new Date(next.start.getTime() + 7 * 864e5)));
  const [category, setCategory] = useState('Buffer');
  const value = idr ? Number(amount.replace(/\D/g, '')) : Number(amount.replace(/[^\d.]/g, ''));
  const valid = name.trim() && value > 0 && date >= toISO(next.start) && date <= toISO(next.end);
  const add = () => {
    if (!valid) return;
    onChange([...costs, { id: Math.random().toString(36).slice(2, 10), name: name.trim().slice(0, 60), amount: value, date, category }]);
    setName('');
    setAmount('');
    setAdding(false);
  };
  return (
    <Card style={{ gap: 8 }}>
      <div className={s.cardHead}>
        <h2 className={s.h2}>One-off costs</h2>
        {costs.length > 0 && <span className={s.caption}>{full(sum(costs.map(c => c.amount)))} set aside</span>}
      </div>
      {costs.length === 0 && !adding && <span style={{ fontSize: 14, color: C.textMuted }}>Anything extra next cycle: a wedding gift, a trip, a car service.</span>}
      {[...costs]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map(c => (
          <div key={c.id} className={s.planLine}>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, marginRight: 'auto' }}>
              <span>{c.name}</span>
              <span style={{ fontSize: 13, color: C.textMuted }}>
                {dayMonth(new Date(c.date + 'T00:00:00'))}, {c.category}
              </span>
            </span>
            <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{full(c.amount)}</span>
            <button type="button" className={s.iconBtnSm} aria-label={`Remove ${c.name}`} onClick={() => onChange(costs.filter(x => x.id !== c.id))}>
              <Icon d={IC.close} size={14} />
            </button>
          </div>
        ))}
      {adding ? (
        <form
          className={s.costForm}
          onSubmit={e => {
            e.preventDefault();
            add();
          }}
        >
          <label className={s.field}>
            <span>What</span>
            <input className={s.input} autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Wedding gift" maxLength={60} />
          </label>
          <label className={s.field}>
            <span>Amount</span>
            <input
              className={s.input}
              inputMode="decimal"
              value={amount}
              onChange={e => setAmount(idr ? (Number(e.target.value.replace(/\D/g, '')) || '').toLocaleString('id-ID') : e.target.value)}
              placeholder={idr ? 'e.g. 500.000' : 'e.g. 50'}
            />
          </label>
          <label className={s.field}>
            <span>When</span>
            <input className={s.input} type="date" value={date} min={toISO(next.start)} max={toISO(next.end)} onChange={e => setDate(e.target.value)} />
          </label>
          <label className={s.field}>
            <span>Category</span>
            <Select value={category} onChange={setCategory} ariaLabel="Category" options={CATEGORIES.filter(c => !c.auto).map(c => ({ value: c.name, label: c.name, dot: c.color }))} />
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className={s.btnPrimary} disabled={!valid}>
              Add
            </button>
            <button type="button" className={s.btnGhost} onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className={s.catFold} style={{ color: C.clayInk, fontWeight: 600, borderTop: costs.length ? undefined : 'none', paddingLeft: 0 }} onClick={() => setAdding(true)}>
          <Icon d={IC.plus} size={14} />
          Add a one-off cost
        </button>
      )}
    </Card>
  );
}
