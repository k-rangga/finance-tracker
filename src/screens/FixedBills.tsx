import { useMemo, useState } from 'react';
import s from '../styles/ui.module.css';
import { Checkbox } from '../components/ui';
import { IC, Icon } from '../components/Icon';
import { Select } from '../components/Select';
import type { Budget, TxView } from '../lib/budget';
import type { Cycle } from '../lib/cycle';
import { useData } from '../lib/data';
import { useSettings } from '../lib/settings';
import { dayMonth, ordinal, tidyName, toISO } from '../lib/format';
import { C } from '../lib/tokens';
import { CATEGORIES, categoryByName } from '../data/categories';
import { merchantKey, type Transaction } from '../data/transactions';
import {
  FIXED_BILL_PRESETS,
  newBillId,
  suggestFixedBills,
  type BillEvery,
  type FixedBill,
  type FixedBillCycleState,
  type FixedBillStatus,
  type FixedBillSuggestion,
} from '../lib/fixedBills';

type Props = {
  cycle: Cycle;
  budget: Budget;
  allRaw: Transaction[];
  statuses: FixedBillStatus[];
  catOf: (t: Transaction) => string;
  onShowTransactions: (cat: string) => void;
  onToast: (t: { text: string; undo?: () => void }) => void;
};

const EVERY_LABELS: Record<BillEvery, string> = {
  month: 'Monthly',
  quarter: 'Quarterly',
  year: 'Yearly',
};

const ORDER_RANK: Record<FixedBillStatus['status'], number> = {
  overdue: 0,
  due: 1,
  paid: 2,
  skipped: 3,
  inactive: 4,
};

/**
 * Individual recurring fixed bills with real transaction verification, possible-match confirmation from
 * Buffer/Transfer, overdue tracking, manual linking, cash mark-paid, skip-this-cycle, and 1-step Quick Add.
 */
export function FixedBillsList({ cycle, budget, allRaw, statuses, catOf, onShowTransactions, onToast }: Props) {
  const { settings, update, full, short } = useSettings();
  const { subscriptions, setOverride } = useData();
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState<boolean>(false);
  const [presetDraft, setPresetDraft] = useState<Partial<FixedBill> | null>(null);

  const cycleId = toISO(cycle.start);
  const bills = settings.fixedBills ?? [];
  const cycleStates = settings.fixedBillCycles ?? {};
  const curState: FixedBillCycleState = cycleStates[cycleId] ?? {};

  const suggestions = useMemo(
    () => suggestFixedBills(allRaw, bills, subscriptions, settings.notFixedBills ?? [], catOf),
    [allRaw, bills, subscriptions, settings.notFixedBills, catOf],
  );

  const saveBills = (next: FixedBill[]) => update({ fixedBills: next });
  const saveCycleState = (patch: Partial<FixedBillCycleState>) => {
    const nextState: FixedBillCycleState = { ...curState, ...patch };
    // Keep only recent 6 cycle entries to keep settings compact.
    const entries = Object.entries({ ...cycleStates, [cycleId]: nextState }).sort(([a], [b]) => b.localeCompare(a)).slice(0, 6);
    update({ fixedBillCycles: Object.fromEntries(entries) });
  };

  const addBill = (b: Omit<FixedBill, 'id'>) => {
    const created: FixedBill = { ...b, id: newBillId() };
    saveBills([...bills, created]);
    onToast({
      text: `Added ${created.name} (${short(created.amount)}, due ${ordinal(created.dueDay)})`,
      undo: () => saveBills(bills),
    });
  };

  const updateBill = (id: string, patch: Partial<FixedBill>) => {
    const before = bills;
    saveBills(bills.map(x => (x.id === id ? { ...x, ...patch } : x)));
    onToast({ text: `Updated ${patch.name ?? bills.find(x => x.id === id)?.name ?? 'bill'}`, undo: () => saveBills(before) });
  };

  const deleteBill = (bill: FixedBill) => {
    const before = bills;
    saveBills(bills.filter(x => x.id !== bill.id));
    setOpenId(null);
    onToast({ text: `Removed ${bill.name}`, undo: () => saveBills(before) });
  };

  const addSuggestion = (x: FixedBillSuggestion) => {
    addBill({
      name: x.name,
      category: x.category,
      amount: x.amount,
      dueDay: x.dueDay,
      every: 'month',
      merchant: x.merchant,
      varies: x.varies,
    });
  };

  const dismissSuggestion = (key: string) => {
    update({ notFixedBills: [...(settings.notFixedBills ?? []).filter(k => k !== key), key] });
  };

  /** Link an actual transaction to a bill, recategorizing it out of Buffer / Transfer if needed. */
  const linkTx = (bill: FixedBill, tx: TxView) => {
    const prevLinked = curState.linked ?? {};
    const prevPaid = curState.paid ?? [];
    const prevSkipped = curState.skipped ?? [];
    const movedCat = tx.cat === 'Buffer' || (tx.isTransfer && !tx.isCcPayment);
    const prevCat = tx.cat;
    if (movedCat) setOverride(tx.id, tx.category, bill.category);
    saveCycleState({
      linked: { ...prevLinked, [bill.id]: tx.id },
      paid: prevPaid.filter(id => id !== bill.id),
      skipped: prevSkipped.filter(id => id !== bill.id),
    });
    onToast({
      text: `Verified ${bill.name} with ${tidyName(tx.title)} (${short(tx.isTransfer ? tx.amount : tx.net)})`,
      undo: () => {
        if (movedCat) setOverride(tx.id, tx.category, prevCat);
        saveCycleState({ linked: prevLinked, paid: prevPaid, skipped: prevSkipped });
      },
    });
  };

  const unlinkTx = (bill: FixedBill) => {
    const prevLinked = curState.linked ?? {};
    const nextLinked = { ...prevLinked };
    delete nextLinked[bill.id];
    saveCycleState({ linked: nextLinked });
    onToast({ text: `Unlinked transaction from ${bill.name}`, undo: () => saveCycleState({ linked: prevLinked }) });
  };

  const toggleManualPaid = (bill: FixedBill, paid: boolean) => {
    const prevPaid = curState.paid ?? [];
    const prevSkipped = curState.skipped ?? [];
    saveCycleState({
      paid: paid ? [...prevPaid.filter(id => id !== bill.id), bill.id] : prevPaid.filter(id => id !== bill.id),
      skipped: paid ? prevSkipped.filter(id => id !== bill.id) : prevSkipped,
    });
    onToast({
      text: paid ? `Marked ${bill.name} as paid (cash / no receipt)` : `Marked ${bill.name} as unpaid`,
      undo: () => saveCycleState({ paid: prevPaid, skipped: prevSkipped }),
    });
  };

  const toggleSkipped = (bill: FixedBill, skip: boolean) => {
    const prevSkipped = curState.skipped ?? [];
    saveCycleState({
      skipped: skip ? [...prevSkipped.filter(id => id !== bill.id), bill.id] : prevSkipped.filter(id => id !== bill.id),
    });
    onToast({
      text: skip ? `Skipped ${bill.name} for this cycle` : `Restored ${bill.name} for this cycle`,
      undo: () => saveCycleState({ skipped: prevSkipped }),
    });
  };

  const setCycleAmount = (bill: FixedBill, amount: number) => {
    const prevAmounts = curState.amounts ?? {};
    saveCycleState({ amounts: { ...prevAmounts, [bill.id]: amount } });
    onToast({
      text: `${bill.name} set to ${full(amount)} for this cycle only`,
      undo: () => saveCycleState({ amounts: prevAmounts }),
    });
  };

  const rejectPossible = (bill: FixedBill, txId: string) => {
    const prev = curState.notMatch ?? {};
    saveCycleState({ notMatch: { ...prev, [bill.id]: [...(prev[bill.id] ?? []), txId] } });
  };

  // Sort: Overdue first, then Possible match, then Due soonest, then Paid, Skipped, Inactive.
  const ordered = useMemo(() => {
    return [...statuses].sort((a, b) => {
      const ra = a.status === 'due' && a.possibleTx ? 0.5 : ORDER_RANK[a.status];
      const rb = b.status === 'due' && b.possibleTx ? 0.5 : ORDER_RANK[b.status];
      return ra - rb || (a.dueDate?.getTime() ?? 0) - (b.dueDate?.getTime() ?? 0) || a.bill.name.localeCompare(b.bill.name);
    });
  }, [statuses]);

  return (
    <>
      {suggestions.length > 0 && (
        <div className={s.fbSuggest}>
          <div className={s.fbSuggestHead}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>
              Found {suggestions.length} fixed {suggestions.length === 1 ? 'bill' : 'bills'} in your receipts
            </span>
            {suggestions.length > 1 && (
              <button
                type="button"
                className={s.textBtnSm}
                style={{ padding: 0 }}
                onClick={() => {
                  const created = suggestions.map(x => ({
                    id: newBillId(),
                    name: x.name,
                    category: x.category,
                    amount: x.amount,
                    dueDay: x.dueDay,
                    every: 'month' as BillEvery,
                    merchant: x.merchant,
                    varies: x.varies,
                  }));
                  saveBills([...bills, ...created]);
                  onToast({ text: `Added ${created.length} fixed bills`, undo: () => saveBills(bills) });
                }}
              >
                Add all
              </button>
            )}
          </div>
          {suggestions.map(x => (
            <div key={x.key} className={s.fbSuggestRow}>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, marginRight: 'auto' }}>
                <span className={s.ellipsis} style={{ fontSize: 14, fontWeight: 500 }}>
                  {x.name}
                </span>
                <span style={{ fontSize: 12, color: C.textMuted }}>
                  {x.category} · ~{short(x.amount)} · around the {ordinal(x.dueDay)}
                </span>
              </span>
              <button type="button" className={s.btnGhost} style={{ fontSize: 12, padding: '4px 8px', minHeight: 30 }} onClick={() => dismissSuggestion(x.key)}>
                Dismiss
              </button>
              <button type="button" className={s.btnPrimarySm} onClick={() => addSuggestion(x)}>
                Add
              </button>
            </div>
          ))}
        </div>
      )}

      {ordered.map(item => (
        <FixedBillRow
          key={item.bill.id}
          item={item}
          cycle={cycle}
          txs={budget.txs}
          open={openId === item.bill.id}
          onToggle={() => setOpenId(openId === item.bill.id ? null : item.bill.id)}
          onLink={tx => linkTx(item.bill, tx)}
          onUnlink={() => unlinkTx(item.bill)}
          onRejectPossible={txId => rejectPossible(item.bill, txId)}
          onMarkPaid={paid => toggleManualPaid(item.bill, paid)}
          onSkip={skip => toggleSkipped(item.bill, skip)}
          onCycleAmount={amt => setCycleAmount(item.bill, amt)}
          onUpdate={patch => updateBill(item.bill.id, patch)}
          onDelete={() => deleteBill(item.bill)}
          onShowTransactions={onShowTransactions}
        />
      ))}

      <button
        type="button"
        className={s.catFold}
        aria-expanded={adding}
        onClick={() => {
          setAdding(v => !v);
          setPresetDraft(null);
        }}
        style={{ color: C.clayInk, fontWeight: 600, borderTop: ordered.length > 0 ? '1px solid var(--line)' : 'none' }}
      >
        <Icon d={IC.plus} size={14} />
        Add a fixed bill
      </button>

      {adding && (
        <div className={s.billAdd}>
          <div className={s.tplGrid}>
            {FIXED_BILL_PRESETS.map(p => (
              <button
                key={p.label}
                type="button"
                className={s.tplOpt}
                aria-pressed={presetDraft?.name === p.name}
                onClick={() => setPresetDraft({ name: p.name, category: p.category, dueDay: p.dueDay, merchant: p.merchant, varies: p.varies })}
              >
                {p.label}
              </button>
            ))}
            <button
              type="button"
              className={s.tplOpt}
              aria-pressed={presetDraft !== null && !FIXED_BILL_PRESETS.some(p => p.name === presetDraft.name)}
              onClick={() => setPresetDraft({ name: '', category: 'Utilities', dueDay: cycle.today.getDate() })}
            >
              <Icon d={IC.plus} size={14} />
              Custom
            </button>
          </div>
          <FixedBillForm
            key={presetDraft?.name ?? 'blank'}
            initial={presetDraft ?? { name: '', category: 'Housing', dueDay: 1 }}
            submitLabel="Add bill"
            onSave={draft => {
              addBill(draft);
              setAdding(false);
              setPresetDraft(null);
            }}
            onCancel={() => {
              setAdding(false);
              setPresetDraft(null);
            }}
          />
        </div>
      )}
    </>
  );
}

function FixedBillRow({
  item,
  cycle,
  txs,
  open,
  onToggle,
  onLink,
  onUnlink,
  onRejectPossible,
  onMarkPaid,
  onSkip,
  onCycleAmount,
  onUpdate,
  onDelete,
  onShowTransactions,
}: {
  item: FixedBillStatus;
  cycle: Cycle;
  txs: TxView[];
  open: boolean;
  onToggle: () => void;
  onLink: (tx: TxView) => void;
  onUnlink: () => void;
  onRejectPossible: (txId: string) => void;
  onMarkPaid: (paid: boolean) => void;
  onSkip: (skip: boolean) => void;
  onCycleAmount: (amount: number) => void;
  onUpdate: (patch: Partial<FixedBill>) => void;
  onDelete: () => void;
  onShowTransactions: (cat: string) => void;
}) {
  const { full, short } = useSettings();
  const [pickingTx, setPickingTx] = useState(false);
  const [txQuery, setTxQuery] = useState('');
  const [editing, setEditing] = useState(false);
  const { bill, dueDate, expected, status, matchKind, matchedTx, actual, variance, possibleTx } = item;
  const cat = categoryByName(bill.category);

  const badge = (() => {
    if (status === 'paid') {
      if (matchedTx) {
        return (
          <span className={s.mxTag} data-tone="success">
            <Icon d={IC.check} size={11} strokeWidth={2.6} /> Verified · {dayMonth(matchedTx.date)}
          </span>
        );
      }
      return (
        <span className={s.mxTag} data-tone="success">
          Paid (manual)
        </span>
      );
    }
    if (status === 'overdue') {
      return (
        <span className={s.mxTag} data-tone="danger">
          Overdue since {dueDate ? dayMonth(dueDate) : ordinal(bill.dueDay)}
        </span>
      );
    }
    if (status === 'skipped') return <span className={s.mxTag}>Skipped this cycle</span>;
    if (status === 'inactive') return <span className={s.mxTag}>{bill.paused ? 'Paused' : 'Not due this cycle'}</span>;
    return <span className={s.mxTag}>Due {dueDate ? dayMonth(dueDate) : ordinal(bill.dueDay)}</span>;
  })();

  const varianceNote =
    status === 'paid' && matchedTx && Math.abs(variance) >= (expected >= 50_000 ? 5_000 : 1) ? (
      <span className={variance > 0 ? s.mxOver : s.fbUnderNote}>
        {variance > 0 ? `+${short(variance)} vs plan` : `${short(-variance)} under`}
      </span>
    ) : null;

  // Candidate transactions for the manual "Link transaction" picker, sorted by closest amount & keyword match.
  const linkCandidates = useMemo(() => {
    if (!pickingTx) return [];
    const q = txQuery.trim().toLowerCase();
    const bk = merchantKey(bill.merchant || bill.name);
    return txs
      .filter(t => !t.isIncome && !t.isCcPayment && (!q || `${t.title} ${t.cat} ${t.account}`.toLowerCase().includes(q)))
      .sort((a, b) => {
        const aa = a.isTransfer ? a.amount : a.net;
        const ba = b.isTransfer ? b.amount : b.net;
        const ak = bk && merchantKey(a.title).includes(bk) ? -1 : 0;
        const bkM = bk && merchantKey(b.title).includes(bk) ? -1 : 0;
        if (ak !== bkM) return ak - bkM;
        return Math.abs(aa - expected) - Math.abs(ba - expected);
      })
      .slice(0, 12);
  }, [pickingTx, txQuery, txs, bill.merchant, bill.name, expected]);

  return (
    <div className={s.mxBill} data-open={open || undefined}>
      <button type="button" className={s.mxHead} aria-expanded={open} onClick={onToggle}>
        <span className={s.mxIcon} style={{ background: cat?.tint ?? 'var(--surface-200)', color: 'var(--ink)' }}>
          <Icon d={cat?.icon ?? IC.calendar} size={19} />
        </span>
        <span className={s.mxTitles} style={{ gap: 4 }}>
          <span className={s.fbNameRow}>
            <span className={s.mxLabel}>{bill.name}</span>
            <span className={s.fbCatTag}>{bill.category}</span>
          </span>
          <span className={s.mxMeta}>
            {badge}
            {varianceNote}
            {status !== 'paid' && bill.varies && <span className={s.mxNoteText}>Est.</span>}
          </span>
        </span>
        <span className={s.mxBillAmt} data-unpaid={status === 'due' || status === 'overdue' || undefined}>
          {full(status === 'paid' ? actual : expected)}
        </span>
        <Icon d={IC.chevDown} size={18} color={C.textMuted} style={{ flex: 'none', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.16s ease-out' }} />
      </button>

      {possibleTx && (status === 'due' || status === 'overdue') && (
        <div className={s.fbMatchBar}>
          <Icon d={IC.sparkle} size={14} color={C.clayInk} />
          <span className={s.fbMatchText}>
            Paid via <strong>{tidyName(possibleTx.title)}</strong> ({short(possibleTx.isTransfer ? possibleTx.amount : possibleTx.net)}, {dayMonth(possibleTx.date)}
            {possibleTx.cat !== bill.category ? ` in ${possibleTx.cat}` : ''})?
          </span>
          <div className={s.fbMatchBtns}>
            <button type="button" className={s.btnPrimarySm} onClick={() => onLink(possibleTx)}>
              Confirm &amp; link
            </button>
            <button type="button" className={s.textBtnSm} style={{ padding: '0 4px' }} onClick={() => onRejectPossible(possibleTx.id)}>
              Not this
            </button>
          </div>
        </div>
      )}

      {open && (
        <div className={s.mxBillBody}>
          {matchedTx && (
            <div className={s.fbProof}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, marginRight: 'auto' }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                  {matchKind === 'linked' ? 'Linked receipt' : 'Auto-matched receipt'}: {tidyName(matchedTx.title)}
                </span>
                <span style={{ fontSize: 12, color: C.textMuted }}>
                  {dayMonth(matchedTx.date)} · {matchedTx.account} · Paid {full(actual)} (plan {full(expected)})
                </span>
              </div>
              {matchKind === 'linked' && (
                <button type="button" className={s.textBtnSm} style={{ padding: 0 }} onClick={onUnlink}>
                  Unlink
                </button>
              )}
              <button type="button" className={s.textBtnSm} style={{ padding: 0 }} onClick={() => onShowTransactions(matchedTx.cat)}>
                View
              </button>
            </div>
          )}

          <div className={s.fbActionRow}>
            {status !== 'paid' && status !== 'inactive' && (
              <>
                <button type="button" className={s.btnOutlineSm} onClick={() => setPickingTx(v => !v)}>
                  <Icon d={IC.clip} size={13} /> {pickingTx ? 'Close picker' : 'Link transaction'}
                </button>
                <button type="button" className={s.btnOutlineSm} onClick={() => onMarkPaid(true)}>
                  <Icon d={IC.check} size={13} /> Mark paid (cash)
                </button>
                {status !== 'skipped' ? (
                  <button type="button" className={s.btnGhost} style={{ fontSize: 13, padding: '6px 10px' }} onClick={() => onSkip(true)}>
                    Skip this cycle
                  </button>
                ) : (
                  <button type="button" className={s.btnOutlineSm} onClick={() => onSkip(false)}>
                    Unskip
                  </button>
                )}
              </>
            )}
            {status === 'paid' && matchKind === 'manual' && (
              <>
                <button type="button" className={s.btnOutlineSm} onClick={() => setPickingTx(v => !v)}>
                  <Icon d={IC.clip} size={13} /> Link actual receipt
                </button>
                <button type="button" className={s.btnGhost} style={{ fontSize: 13, padding: '6px 10px' }} onClick={() => onMarkPaid(false)}>
                  Mark unpaid
                </button>
              </>
            )}
            <button type="button" className={s.textBtnSm} style={{ marginLeft: 'auto', padding: 0 }} onClick={() => setEditing(v => !v)}>
              {editing ? 'Close edit' : 'Edit bill'}
            </button>
          </div>

          {pickingTx && (
            <div className={s.fbPicker}>
              <input
                className={s.input}
                value={txQuery}
                onChange={e => setTxQuery(e.target.value)}
                placeholder="Search this cycle's transactions…"
                aria-label="Search transactions to link"
              />
              {linkCandidates.length === 0 ? (
                <span style={{ fontSize: 13, color: C.textMuted }}>No transactions in this cycle match your search.</span>
              ) : (
                <div className={s.fbPickerList}>
                  {linkCandidates.map(t => {
                    const amt = t.isTransfer ? t.amount : t.net;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        className={s.fbPickerRow}
                        onClick={() => {
                          onLink(t);
                          setPickingTx(false);
                          setTxQuery('');
                        }}
                      >
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, marginRight: 'auto' }}>
                          <span className={s.ellipsis} style={{ fontWeight: 500 }}>
                            {tidyName(t.title)}
                          </span>
                          <span style={{ fontSize: 12, color: C.textMuted }}>
                            {dayMonth(t.date)} · {t.cat} · {t.account}
                          </span>
                        </span>
                        <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{short(amt)}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {editing && (
            <FixedBillForm
              initial={{ ...bill, amount: expected }}
              defaultAmount={bill.amount}
              showCycleScope
              submitLabel="Save"
              onSave={(draft, scope) => {
                if (scope === 'cycle') {
                  onCycleAmount(draft.amount);
                } else {
                  onUpdate(draft);
                }
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
              onTogglePause={() => {
                onUpdate({ paused: !bill.paused });
                setEditing(false);
              }}
              onDelete={onDelete}
              cycleAnchorMonth={cycle.start.getMonth() + 1}
            />
          )}
        </div>
      )}
    </div>
  );
}

function FixedBillForm({
  initial,
  defaultAmount,
  showCycleScope,
  submitLabel,
  onSave,
  onCancel,
  onTogglePause,
  onDelete,
  cycleAnchorMonth,
}: {
  initial: Partial<FixedBill>;
  defaultAmount?: number;
  showCycleScope?: boolean;
  submitLabel: string;
  onSave: (bill: Omit<FixedBill, 'id'>, scope: 'all' | 'cycle') => void;
  onCancel: () => void;
  onTogglePause?: () => void;
  onDelete?: () => void;
  cycleAnchorMonth?: number;
}) {
  const { settings } = useSettings();
  const idr = settings.currency === 'IDR';
  const fmt = (v?: number) => (v && v > 0 ? (idr ? Math.round(v).toLocaleString('id-ID') : String(Math.round(v * 100) / 100)) : '');

  const [name, setName] = useState(initial.name ?? '');
  const [amtText, setAmtText] = useState(fmt(initial.amount));
  const [dueDay, setDueDay] = useState(String(initial.dueDay ?? 1));
  const [category, setCategory] = useState(initial.category ?? 'Housing');
  const [every, setEvery] = useState<BillEvery>(initial.every ?? 'month');
  const [merchant, setMerchant] = useState(initial.merchant ?? '');
  const [varies, setVaries] = useState(!!initial.varies);
  const [scope, setScope] = useState<'all' | 'cycle'>('all');

  const amount = idr ? Number(amtText.replace(/\D/g, '')) : Number(amtText.replace(/[^\d.]/g, ''));
  const valid = name.trim().length > 0 && amount > 0;

  const catOptions = useMemo(() => {
    const fixed = CATEGORIES.filter(c => c.type === 'fixed' && !c.auto).map(c => ({ value: c.name, label: c.name }));
    const variable = CATEGORIES.filter(c => c.type === 'variable').map(c => ({ value: c.name, label: `${c.name} (everyday)` }));
    return [...fixed, ...variable];
  }, []);

  return (
    <form
      className={s.fbForm}
      onSubmit={e => {
        e.preventDefault();
        if (!valid) return;
        onSave(
          {
            name: name.trim(),
            category,
            amount,
            dueDay: Math.max(1, Math.min(31, Number(dueDay) || 1)),
            every,
            anchorMonth: initial.anchorMonth ?? cycleAnchorMonth ?? new Date().getMonth() + 1,
            merchant: merchant.trim() || undefined,
            varies: varies || undefined,
            paused: initial.paused,
          },
          scope,
        );
      }}
    >
      {showCycleScope && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: C.textMuted }}>Apply amount to:</span>
          <div className={s.sxMiniSeg} role="group" aria-label="Apply scope">
            <button type="button" aria-pressed={scope === 'all'} onClick={() => { setScope('all'); if (defaultAmount) setAmtText(fmt(defaultAmount)); }}>
              Every month
            </button>
            <button type="button" aria-pressed={scope === 'cycle'} onClick={() => setScope('cycle')}>
              This cycle only
            </button>
          </div>
        </div>
      )}

      <div className={s.fbFormGrid}>
        {scope === 'all' && (
          <label className={s.field}>
            <span>Bill name</span>
            <input className={s.input} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Electricity (PLN)" maxLength={50} />
          </label>
        )}
        <label className={s.field}>
          <span>{scope === 'cycle' ? 'Amount for this cycle' : 'Amount'} ({settings.currency})</span>
          <input
            className={s.input}
            inputMode="decimal"
            value={amtText}
            placeholder={idr ? 'e.g. 500.000' : 'e.g. 120'}
            onChange={e => setAmtText(idr ? (Number(e.target.value.replace(/\D/g, '')) || '').toLocaleString('id-ID') : e.target.value)}
          />
        </label>
        {scope === 'all' && (
          <>
            <label className={s.field}>
              <span>Due day (1–31)</span>
              <input
                className={s.input}
                inputMode="numeric"
                value={dueDay}
                onChange={e => setDueDay(e.target.value.replace(/\D/g, '').slice(0, 2))}
                placeholder="1–31"
              />
            </label>
            <div className={s.field}>
              <span>Category</span>
              <Select ariaLabel="Category" value={category} onChange={setCategory} options={catOptions} />
            </div>
            <div className={s.field}>
              <span>Repeats</span>
              <Select
                ariaLabel="Repeats"
                value={every}
                onChange={v => setEvery(v as BillEvery)}
                options={(['month', 'quarter', 'year'] as BillEvery[]).map(k => ({ value: k, label: EVERY_LABELS[k] }))}
              />
            </div>
            <label className={s.field}>
              <span>Match receipt keyword (optional)</span>
              <input className={s.input} value={merchant} onChange={e => setMerchant(e.target.value)} placeholder="e.g. pln, indihome, ibu kos" maxLength={50} />
            </label>
          </>
        )}
      </div>

      {scope === 'all' && (
        <Checkbox checked={varies} onChange={setVaries}>
          Amount varies each month (e.g. electricity, water — wider auto-match range)
        </Checkbox>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button type="submit" className={s.btnPrimarySm} disabled={!valid}>
          {submitLabel}
        </button>
        <button type="button" className={s.btnGhost} style={{ fontSize: 13 }} onClick={onCancel}>
          Cancel
        </button>
        {onTogglePause && (
          <button type="button" className={s.btnGhost} style={{ fontSize: 13, marginLeft: 'auto' }} onClick={onTogglePause}>
            {initial.paused ? 'Resume' : 'Pause'}
          </button>
        )}
        {onDelete && (
          <button type="button" className={s.btnGhost} style={{ fontSize: 13, color: C.redInk }} onClick={onDelete}>
            Delete
          </button>
        )}
      </div>
    </form>
  );
}
