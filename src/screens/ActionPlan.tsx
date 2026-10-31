import s from '../styles/ui.module.css';
import { Card } from '../components/ui';
import { IC, Icon } from '../components/Icon';
import type { Budget, CatView } from '../lib/budget';
import type { Cycle } from '../lib/cycle';
import { dayLabel } from '../lib/format';
import { useSettings } from '../lib/settings';
import { useSetLimits } from '../lib/limits';
import { C } from '../lib/tokens';
import { SAVINGS_TARGET_PCT, TRANSFER_CATEGORY } from '../data/categories';
import { cycleStatus } from './Summary';

/** At most this many steps: more than three and none of them gets done. */
const MAX_STEPS = 3;

type Step = { key: string; title: string; sub?: string; done?: boolean; action?: { label: string; run: () => void; primary?: boolean } };

/**
 * What to do now, in plain words: the daily target (the same one Summary shows), then up to three steps, most
 * urgent first — categories already over their limit, the one most likely to go over, and the savings transfer.
 * Each has one button, and a step that's done shows ✓ on its own.
 */
export function ActionPlan({ cycle, budget: b, onShowTransactions }: { cycle: Cycle; budget: Budget; onShowTransactions: (cat: string) => void }) {
  const { full, short, ofIncome } = useSettings();
  const setLimits = useSetLimits();
  const status = cycleStatus(cycle, b, full, short);
  const vari = b.cats.filter(c => c.type === 'variable');
  const room = (c: CatView) => c.limit - c.spent;
  const see = (c: CatView) => ({ label: `See ${c.name}`, run: () => onShowTransactions(c.name) });

  const steps: Step[] = [];

  // Already over: say by how much, and cover it from the category with the most room (the total budget stays the same).
  for (const c of vari.filter(x => x.spent > x.limit + 1).sort((x, y) => room(x) - room(y))) {
    const from = vari.filter(x => x !== c && room(x) > 0).sort((x, y) => room(y) - room(x))[0];
    const over = c.spent - c.limit;
    const amount = from ? Math.min(over, room(from)) : 0;
    steps.push({
      key: 'over:' + c.name,
      title: `${c.name} is ${full(over)} over its limit`,
      sub: !from
        ? 'No category has room left to cover it'
        : amount < over
          ? `${from.name} can cover ${full(amount)} of it, all the room it has left`
          : `${from.name} has room to cover it: its limit goes down by the same amount`,
      action: from
        ? {
            label: amount < over ? `Cover ${short(amount)} from ${from.name}` : `Cover from ${from.name}`,
            primary: true,
            run: () => {
              // Rounded up, so the category is covered in full.
              const pct = Math.ceil((amount / ofIncome(1)) * 1e4) / 1e4;
              setLimits({ [c.name]: c.limitPct + pct, [from.name]: Math.max(0, from.limitPct - pct) });
            },
          }
        : see(c),
    });
  }

  // Most likely to go over next. Its pace leaves out big one-off purchases, which won't repeat every few days.
  if (cycle.daysLeft > 0) {
    const big = Math.max(b.safeDay * 3, 1);
    const likely = vari
      .filter(c => c.spent <= c.limit + 1 && c.limit > 0)
      .map(c => {
        const everyday = b.txs.filter(t => t.cat === c.name && !t.isIncome && !t.isTransfer && t.net > 0 && t.net < big);
        const perDay = everyday.reduce((a, t) => a + t.net, 0) / cycle.dayN;
        return { c, perDay, over: c.spent + perDay * cycle.daysLeft - c.limit };
      })
      .filter(x => x.over > x.c.limit * 0.05)
      .sort((x, y) => y.over - x.over)[0];
    if (likely)
      steps.push({
        key: 'likely:' + likely.c.name,
        title: `${likely.c.name}: keep it under ${short(room(likely.c) / cycle.daysLeft)} a day`,
        sub: `You've been spending about ${short(likely.perDay)} a day on it`,
        action: see(likely.c),
      });
  }

  // Savings last, so it's never pushed off the list.
  const save = ofIncome(SAVINGS_TARGET_PCT);
  const saving: Step =
    save <= 0
      ? { key: 'save', title: 'No savings planned this cycle', done: true }
      : b.saved >= save
        ? { key: 'save', title: `Saved ${full(b.saved)} this cycle`, done: true }
        : {
            key: 'save',
            title: `Move ${full(save - b.saved)} to savings`,
            sub: b.saved > 0 ? `${full(b.saved)} moved so far · best done on payday, ${dayLabel(cycle.next)}` : `Best done on payday morning, ${dayLabel(cycle.next)}`,
            action: { label: 'I moved it', run: () => onShowTransactions(TRANSFER_CATEGORY) },
          };
  const shown = [...steps.slice(0, MAX_STEPS - 1), saving];
  const allDone = shown.every(x => x.done);

  return (
    <Card style={{ gap: 18 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 13, color: C.textMuted }}>
          <span style={{ marginRight: 'auto' }}>
            Action plan · day {cycle.dayN} of {cycle.cycleDays}
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: status.ink, fontWeight: 500 }}>
            <span className={s.badgeDot} style={{ background: status.ink }} aria-hidden="true" />
            {status.text}
          </span>
        </div>
        <h2 className={s.h2} style={{ fontSize: 'clamp(19px, 2.2vw, 22px)', lineHeight: 1.3 }}>
          {b.safeDay > 0 ? (
            <>
              Spend at most <span style={{ color: C.accent800 }}>{full(b.safeDay)}</span> a day until payday, {dayLabel(cycle.next)}
            </>
          ) : (
            <span style={{ color: C.redInk }}>Nothing left for spending before payday, {dayLabel(cycle.next)}</span>
          )}
        </h2>
      </div>

      {allDone ? (
        <span className={s.stepRow} style={{ color: C.accent800, fontWeight: 600 }}>
          <span className={s.stepMark} data-done>
            <Icon d={IC.check} size={14} strokeWidth={3} />
          </span>
          On track. Nothing to do.
        </span>
      ) : (
        <ol className={s.stepList}>
          {shown.map((x, i) => (
            <li key={x.key} className={s.stepRow}>
              <span className={s.stepMark} data-done={x.done || undefined}>
                {x.done ? <Icon d={IC.check} size={14} strokeWidth={3} /> : i + 1}
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, marginRight: 'auto' }}>
                <span style={{ fontWeight: 600, fontSize: 15, color: x.done ? C.textMuted : C.text, textDecoration: x.done ? 'line-through' : undefined }}>{x.title}</span>
                {x.sub && <span style={{ fontSize: 13, color: C.textMuted }}>{x.sub}</span>}
              </span>
              {x.action && (
                <button type="button" className={x.action.primary ? s.btnPrimarySm : s.btnOutlineSm} style={{ flex: 'none' }} onClick={x.action.run}>
                  {x.action.label}
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
