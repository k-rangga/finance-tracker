import { useEffect, useState } from 'react';
import s from '../styles/ui.module.css';
import { Card } from '../components/ui';
import { IC, Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { ActionCard, Problem, Rich, ThinkingArcs, thinkingLabel } from '../components/Chat';
import { askGemini, chatContext, type ChatAction } from '../lib/chat';
import { spendingProfile } from '../lib/cyclePlans';
import { useData } from '../lib/data';
import type { Budget, CatView } from '../lib/budget';
import type { Cycle } from '../lib/cycle';
import { dayLabel, toISO } from '../lib/format';
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
      title: `${c.name} is ${full(over)} over`,
      sub: !from
        ? "Nothing else has room left, so let's keep the rest of it tight."
        : amount < over
          ? `${from.name} can cover ${full(amount)} of it. That's all the room it has left.`
          : `Let's cover it from ${from.name}, it has the most room. Your total budget stays the same.`,
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
        title: `Keep ${likely.c.name} under ${short(room(likely.c) / cycle.daysLeft)} a day`,
        sub: `You've been averaging about ${short(likely.perDay)} a day, so it's the next one I'd watch.`,
        action: see(likely.c),
      });
  }

  // Savings last, so it's never pushed off the list.
  const save = ofIncome(SAVINGS_TARGET_PCT);
  const saving: Step =
    save <= 0
      ? { key: 'save', title: 'No savings planned this cycle', done: true }
      : b.saved >= save
        ? { key: 'save', title: `You saved ${full(b.saved)} this cycle`, done: true }
        : {
            key: 'save',
            title: `Move ${full(save - b.saved)} to savings`,
            sub: b.saved > 0 ? `${full(b.saved)} is in already. Do the rest on payday, ${dayLabel(cycle.next)}.` : `Do it on payday morning, ${dayLabel(cycle.next)}, before anything else goes out.`,
            action: { label: 'I moved it', run: () => onShowTransactions(TRANSFER_CATEGORY) },
          };
  const shown = [...steps.slice(0, MAX_STEPS - 1), saving];
  const allDone = shown.every(x => x.done);

  return (
    <Card style={{ gap: 18 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Logo size={28} />
          <span style={{ fontSize: 13, fontWeight: 600, color: C.textMuted, marginRight: 'auto' }}>
            Maxie's plan, day {cycle.dayN} of {cycle.cycleDays}
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: status.ink, fontWeight: 500 }}>
            <span className={s.badgeDot} style={{ background: status.ink }} aria-hidden="true" />
            {status.text}
          </span>
        </div>
        <p className={s.insightBody}>
          {b.safeDay > 0 ? (
            <>
              You've got <strong style={{ fontWeight: 600 }}>{full(b.safeDay)}</strong> a day until payday on {dayLabel(cycle.next)}.{' '}
              {allDone ? "You're on track, nothing needs doing today." : "Here's what I'd do:"}
            </>
          ) : (
            <>
              <span style={{ color: C.redInk }}>There's nothing left for spending before payday on {dayLabel(cycle.next)}.</span> Here's how I'd get through it:
            </>
          )}
        </p>
      </div>

      {!allDone && (
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

      <MaxiePlan cycle={cycle} budget={b} />
    </Card>
  );
}

/** What Maxie is asked for on the Plan tab. */
const PLAN_REQUEST =
  'Make me a plan for the rest of this pay cycle from my data, looking at every category, my daily averages and where the money goes (spendingByCategory). Start with one sentence on where I stand. ' +
  'Then up to 3 numbered steps, most important first, each with a real amount and a day or date where it helps. ' +
  'Cover staying on budget until payday and my savings target. Suggest moving limits between categories as actions when it clearly helps.';

type PlanAnswer = { text: string; actions: ChatAction[] };
/** Maxie's plan per cycle, kept while the app is open so switching tabs doesn't ask again. */
const planCache = new Map<string, PlanAnswer>();

/** Maxie writes a plan from this cycle's numbers (Gemini, in Maxie's voice); budget moves come as Apply cards. */
function MaxiePlan({ cycle, budget: b }: { cycle: Cycle; budget: Budget }) {
  const { settings } = useSettings();
  const { notes } = useData();
  const key = toISO(cycle.start);
  const [plan, setPlan] = useState<PlanAnswer | null>(() => planCache.get(key) ?? null);
  const [busy, setBusy] = useState(false);
  const [waited, setWaited] = useState(0);
  const [problem, setProblem] = useState<{ kind: string; detail?: string } | null>(null);

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setWaited(w => w + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  const ask = async () => {
    setBusy(true);
    setWaited(0);
    setProblem(null);
    try {
      const a = await askGemini([{ role: 'user', text: PLAN_REQUEST }], {
          ...chatContext({ cycle, budget: b, settings, notes, withNotes: false }),
          spendingByCategory: Object.fromEntries(b.cats.filter(c => c.spent > 0).map(c => [c.name, spendingProfile(cycle, b, c.name)])),
        },
        true,
      );
      if ('error' in a) setProblem({ kind: a.error, detail: a.detail });
      else {
        const p = { text: a.reply, actions: a.actions.filter(x => x.type === 'move_limit') };
        planCache.set(key, p);
        setPlan(p);
      }
    } catch (e) {
      setProblem({ kind: 'network', detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  if (busy)
    return (
      <div className={s.maxiePlan} role="status" aria-live="polite">
        <span className={s.thinking}>
          <span className={s.thinkLabel}>{thinkingLabel(waited)}</span>
          <ThinkingArcs />
        </span>
      </div>
    );
  if (problem) return <Problem p={problem} onRetry={ask} />;
  if (!plan)
    return (
      <div className={s.maxiePlan}>
        <button type="button" className={s.btnOutlineSm} onClick={ask} style={{ alignSelf: 'flex-start' }}>
          <Icon d={IC.sparkle} size={15} /> Make my plan with Maxie
        </button>
        <span style={{ fontSize: 12, color: C.textMuted }}>Maxie reads this cycle's numbers and writes you a plan. It's AI, so double-check anything important.</span>
      </div>
    );
  return (
    <div className={s.maxiePlan}>
      <div className={s.maxiePlanText}>
        <Rich text={plan.text} />
      </div>
      {plan.actions.map((x, i) => (
        <ActionCard key={i} action={x} allTxs={b.txs} />
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button type="button" className={s.textBtnSm} onClick={ask} style={{ padding: 0 }}>
          Ask Maxie again
        </button>
        <span style={{ fontSize: 12, color: C.textMuted }}>Maxie is AI and can get things wrong, so double-check anything important.</span>
      </div>
    </div>
  );
}
