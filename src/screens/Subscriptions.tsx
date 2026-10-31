import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import s from '../styles/ui.module.css';
import { Card, DueChip, IconChip, Modal, Options } from '../components/ui';
import { IC, Icon } from '../components/Icon';
import { useData } from '../lib/data';
import { useSettings } from '../lib/settings';
import { useSetLimits } from '../lib/limits';
import { dayMonth, fullDate, startOfToday, sum, toISO } from '../lib/format';
import { C } from '../lib/tokens';
import { iconChip, type Budget } from '../lib/budget';
import { addEvery, EVERY, everyLabel, perMonth, suggestSubscriptions, type Every, type SubState, type Subscription, type Suggestion } from '../lib/subscriptions';
import type { Transaction } from '../data/transactions';

type Props = {
  budget: Budget;
  states: Record<string, SubState>;
  /** Every transaction loaded, to suggest subscriptions from. */
  txs: Transaction[];
  catOf: (t: Transaction) => string;
};

const newId = () => 'sub_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const per = (e: Every) => ({ month: '/ month', year: '/ year', week: '/ week' })[e];

/**
 * Everything you pay for on repeat, by next billing date: what it costs a month and a year, which ones need a look
 * (a charge that didn't come, a new price), and likely ones found in your charges to add with a tap.
 */
export function Subscriptions({ budget: b, states, txs, catOf }: Props) {
  const { full, settings, update } = useSettings();
  const { subscriptions: subs, setSubscription } = useData();
  const setLimits = useSetLimits();
  const [editing, setEditing] = useState<{ id: string; sub?: Subscription } | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);
  const today = useMemo(startOfToday, []);

  const suggestions = useMemo(() => suggestSubscriptions(txs, subs, settings.notSubscriptions, catOf, today), [txs, subs, settings.notSubscriptions, catOf, today]);
  const entries = Object.entries(subs);
  const live = entries.filter(([, x]) => x.status !== 'cancelled');
  const cancelled = entries.filter(([, x]) => x.status === 'cancelled');
  // Ones that need a look first, then by the next billing date.
  const order = (id: string) => (states[id]?.state === 'late' ? -1e12 : (states[id]?.next?.getTime() ?? 0));
  live.sort(([a], [z]) => order(a) - order(z));
  const monthly = sum(live.map(([, x]) => perMonth(x)));
  const saving = sum(cancelled.map(([, x]) => perMonth(x)));

  // The Subscriptions limit, matched to what they actually cost, when it's off by more than a little.
  const cat = b.cats.find(c => c.name === 'Subscriptions');
  const limitOff = cat && monthly > 0 && Math.abs(cat.limit - monthly) > Math.max(monthly * 0.05, 1);

  const add = (x: Suggestion) => {
    const { key: _key, count: _count, ...sub } = x;
    setSubscription(newId(), sub);
  };
  const notOne = (keys: string[]) => update({ notSubscriptions: [...settings.notSubscriptions.filter(k => !keys.includes(k)), ...keys] });

  return (
    <Card style={{ gap: 16 }}>
      <div className={s.cardHead} style={{ alignItems: 'center', flexWrap: 'nowrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <h2 className={s.h2}>Subscriptions</h2>
          <span className={s.caption}>
            {live.length ? `${full(monthly)} a month · ${full(monthly * 12)} a year · ${live.length} active` : 'What you pay for on repeat, and when each bills'}
          </span>
        </div>
        <button type="button" className={s.btnOutlineSm} style={{ flex: 'none' }} onClick={() => setEditing({ id: newId() })}>
          <Icon d={IC.plus} size={15} /> Add
        </button>
      </div>

      {suggestions.length > 0 && (
        <div className={s.subSuggest}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, fontSize: 14, marginRight: 'auto' }}>
              Found {suggestions.length} likely subscription{suggestions.length === 1 ? '' : 's'} in your charges
            </span>
            {suggestions.length > 1 && (
              <button type="button" className={s.textBtnSm} onClick={() => suggestions.forEach(add)}>
                Add all
              </button>
            )}
          </div>
          {suggestions.map(x => (
            <div key={x.key} className={s.subSuggestRow}>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, marginRight: 'auto' }}>
                <span className={s.ellipsis} style={{ fontSize: 14, fontWeight: 500 }}>
                  {x.name}
                </span>
                <span style={{ fontSize: 13, color: C.textMuted }}>
                  {full(x.amount)} {per(x.every)} · {x.count} charge{x.count === 1 ? '' : 's'} · next {dayMonth(new Date(x.next + 'T00:00'))}
                </span>
              </span>
              <button type="button" className={s.btnGhost} style={{ fontSize: 13, padding: '6px 10px', minHeight: 32, whiteSpace: 'nowrap', flex: 'none' }} onClick={() => notOne([x.key])}>
                Not one
              </button>
              <button type="button" className={s.btnPrimarySm} onClick={() => add(x)}>
                Add
              </button>
            </div>
          ))}
        </div>
      )}

      {live.length === 0 && suggestions.length === 0 && (
        <span style={{ fontSize: 14, color: C.textMuted }}>No subscriptions yet. Add one, or they'll be suggested here once their charges come in.</span>
      )}

      {live.length > 0 && (
        <div className={s.subList}>
          {live.map(([id, x]) => (
            <SubRow key={id} sub={x} st={states[id]} catOf={catOf} onOpen={() => setEditing({ id, sub: x })} onSave={patch => setSubscription(id, { ...x, ...patch })} />
          ))}
        </div>
      )}

      {(limitOff || cancelled.length > 0) && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', fontSize: 13 }}>
          {limitOff && cat && (
            <button type="button" className={s.textBtnSm} onClick={() => setLimits({ Subscriptions: (monthly / settings.income) * 100 })}>
              Set the Subscriptions limit to {full(monthly)} (now {full(cat.limit)}) →
            </button>
          )}
          {cancelled.length > 0 && (
            <button type="button" className={s.textBtnSm} style={{ color: C.textMuted }} aria-expanded={showCancelled} onClick={() => setShowCancelled(!showCancelled)}>
              {showCancelled ? 'Hide' : 'Show'} cancelled ({cancelled.length}) · saving {full(saving)} a month
            </button>
          )}
        </div>
      )}
      {showCancelled && cancelled.length > 0 && (
        <div className={s.subList} style={{ opacity: 0.75 }}>
          {cancelled.map(([id, x]) => (
            <SubRow key={id} sub={x} st={states[id]} catOf={catOf} onOpen={() => setEditing({ id, sub: x })} onSave={patch => setSubscription(id, { ...x, ...patch })} />
          ))}
        </div>
      )}

      {editing &&
        createPortal(
          <SubscriptionDialog
            sub={editing.sub}
            accounts={[...new Set(txs.map(t => t.account).filter(Boolean))].sort()}
            onSave={x => {
              setSubscription(editing.id, x);
              setEditing(null);
            }}
            onDelete={
              editing.sub
                ? () => {
                    setSubscription(editing.id, null);
                    setEditing(null);
                  }
                : undefined
            }
            onClose={() => setEditing(null)}
          />,
          document.body,
        )}
    </Card>
  );
}

/** One subscription: what it costs, when it bills next, and anything that needs a look. */
function SubRow({ sub: x, st, catOf, onOpen, onSave }: { sub: Subscription; st?: SubState; catOf: (t: Transaction) => string; onOpen: () => void; onSave: (patch: Partial<Subscription>) => void }) {
  const { full } = useSettings();
  const chip = iconChip(st?.last ? catOf(st.last) : 'Subscriptions');
  return (
    <div className={s.subRow}>
      <button type="button" className={s.subRowMain} onClick={onOpen} aria-label={`Edit ${x.name}`}>
        <IconChip d={IC.repeat} bg={chip.bg} ink={chip.ink} size={34} iconSize={15} />
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, marginRight: 'auto' }}>
          <span className={s.ellipsis} style={{ fontSize: 15, fontWeight: 600 }}>
            {x.name}
          </span>
          <span className={s.ellipsis} style={{ fontSize: 13, color: C.textMuted }}>
            {full(x.amount)} {per(x.every)}
            {x.every !== 'month' ? ` · ${full(perMonth(x))} a month` : ''}
            {x.account ? ` · ${x.account}` : ''}
          </span>
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flex: 'none' }}>
          {st?.trial && <span style={{ fontSize: 12, color: C.amberInk, fontWeight: 600 }}>Trial ends</span>}
          {st?.state === 'cancelled' ? (
            <span style={{ fontSize: 12, color: C.textMuted }}>Cancelled</span>
          ) : st?.next && st.state !== 'late' ? (
            st.inDays > 45 ? <span className={s.dueChip}>{fullDate(st.next)}</span> : <DueChip date={st.next} inDays={st.inDays} />
          ) : null}
        </span>
      </button>
      {st?.state === 'late' && st.next && (
        <div className={s.subFlag} style={{ background: C.redTint, color: C.redInk }}>
          <span style={{ marginRight: 'auto' }}>No charge since its billing date, {dayMonth(st.next)}. Cancelled?</span>
          <button type="button" className={s.textBtnSm} style={{ color: 'inherit' }} onClick={() => onSave({ status: 'cancelled' })}>
            Yes, cancelled
          </button>
          <button type="button" className={s.textBtnSm} style={{ color: 'inherit' }} onClick={() => onSave({ next: toISO(addEvery(st.next!, x.every)) })}>
            Skip to {dayMonth(addEvery(st.next, x.every))}
          </button>
        </div>
      )}
      {st?.charged != null && st.state !== 'cancelled' && (
        <div className={s.subFlag} style={{ background: C.amberTint, color: C.amberInk }}>
          <span style={{ marginRight: 'auto' }}>
            Last charged {full(st.charged)} on {dayMonth(st.last!.date)}, not {full(x.amount)}.
          </span>
          <button type="button" className={s.textBtnSm} style={{ color: 'inherit' }} onClick={() => onSave({ amount: st.charged })}>
            Use {full(st.charged)}
          </button>
        </div>
      )}
    </div>
  );
}

/** Add or change one subscription. */
function SubscriptionDialog({
  sub,
  accounts,
  onSave,
  onDelete,
  onClose,
}: {
  sub?: Subscription;
  accounts: string[];
  onSave: (x: Subscription) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const { settings } = useSettings();
  const idr = settings.currency === 'IDR';
  const fmt = (v: number) => (idr ? Math.round(v).toLocaleString('id-ID') : String(Math.round(v * 100) / 100));
  const parse = (text: string) => (idr ? Number(text.replace(/\D/g, '')) : Number(text.replace(/[^\d.]/g, '')));
  const [name, setName] = useState(sub?.name ?? '');
  const [merchant, setMerchant] = useState(sub?.merchant ?? '');
  const [amount, setAmount] = useState(sub ? fmt(sub.amount) : '');
  const [every, setEvery] = useState<Every>(sub?.every ?? 'month');
  const [next, setNext] = useState(sub?.next ?? toISO(addEvery(startOfToday(), 'month')));
  const [account, setAccount] = useState(sub?.account ?? '');
  const [status, setStatus] = useState<Subscription['status']>(sub?.status ?? 'active');
  const value = parse(amount);
  const valid = name.trim() && value > 0 && Number.isFinite(value) && /^\d{4}-\d{2}-\d{2}$/.test(next);
  const listId = 'sub-accounts';

  return (
    <Modal title={sub ? `Edit ${sub.name}` : 'Add a subscription'} onClose={onClose} width={520}>
      <label className={s.field}>
        Name
        <input className={s.input} value={name} onChange={e => setName(e.target.value)} placeholder="Spotify" />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: 12 }}>
        <label className={s.field}>
          Amount
          <input className={s.input} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder={idr ? '59.990' : '9.99'} />
        </label>
        <label className={s.field}>
          {status === 'trial' ? 'Trial ends (first charge)' : 'Next billing date'}
          <input className={s.input} type="date" value={next} onChange={e => setNext(e.target.value)} />
        </label>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className={s.label}>Bills</span>
        <Options<Every> label="How often it bills" items={EVERY} value={every} onChange={setEvery} render={everyLabel} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className={s.label}>Status</span>
        <Options<Subscription['status']>
          label="Status"
          items={['active', 'trial', 'cancelled'] as const}
          value={status}
          onChange={setStatus}
          render={v => ({ active: 'Active', trial: 'Free trial', cancelled: 'Cancelled' })[v]}
        />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: 12 }}>
        <label className={s.field}>
          Card or account
          <input className={s.input} list={listId} value={account} onChange={e => setAccount(e.target.value)} placeholder="CC BCA" />
          <datalist id={listId}>
            {accounts.map(a => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </label>
        <label className={s.field}>
          Name on the receipt
          <input className={s.input} value={merchant} onChange={e => setMerchant(e.target.value)} placeholder={name || 'Same as the name'} />
        </label>
      </div>
      <span style={{ fontSize: 13, color: C.textMuted }}>
        Charges whose receipt name contains this are matched to it, and each one moves the billing date on by a {every}.
      </span>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        {onDelete && (
          <button type="button" className={s.btnGhost} onClick={onDelete} style={{ marginRight: 'auto', color: C.redInk }}>
            Delete
          </button>
        )}
        <button type="button" className={s.btnOutline} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={s.btnPrimary}
          disabled={!valid}
          onClick={() => onSave({ name: name.trim(), merchant: merchant.trim() || name.trim(), amount: value, every, next, account: account.trim(), status })}
        >
          {sub ? 'Save' : 'Add subscription'}
        </button>
      </div>
    </Modal>
  );
}
