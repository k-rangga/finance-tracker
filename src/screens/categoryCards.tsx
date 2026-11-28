/**
 * Categories as Maxie's "Monthly spending dashboard" design: each everyday category as its own card (what it's
 * spent against its limit, the last 7 days, the top expenses and one Maxie suggestion), and fixed bills as a list
 * with a status tag on each, an Installments group, and Maxie's fixes inline.
 */
import { useEffect, useState, type ReactNode } from 'react';
import s from '../styles/ui.module.css';
import { IC, Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { usePlans } from '../components/Plans';
import { FlameIcon, MoveBudget, type ChallengeState } from './categoriesExtras';
import type { CatView, TxView } from '../lib/budget';
import type { Cycle } from '../lib/cycle';
import { dayMonth, sum, tidyName, toISO } from '../lib/format';
import { haptic } from '../lib/haptics';
import { leftAfter } from '../lib/installments';
import { useData } from '../lib/data';
import { useSettings } from '../lib/settings';
import { useIsPhone } from '../lib/media';
import { storage } from '../lib/storage';
import { C } from '../lib/tokens';
import { TRANSFER_CATEGORY } from '../data/categories';
import { merchantKey } from '../data/transactions';

/** One category's numbers for this view (see Categories' makeView). */
export type CardRow = { c: CatView; cur: number; last: number; lim: number; mine: TxView[]; st?: { key: 'over' | 'near' | 'ok'; ink: string; bar: string } };

const DAY_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** E-wallet and card top-ups: money moved, not spent. */
const TOPUP = /\b(top ?up|topup|isi saldo|reload|tarik tunai)\b/i;

/** Remembered "no thanks" on a Maxie suggestion (this device, this cycle). */
function useDismissed(key: string): [boolean, () => void] {
  const [gone, setGone] = useState(() => storage.getRaw('moneyTracker.dismiss.' + key) === '1');
  return [
    gone,
    () => {
      storage.setRaw('moneyTracker.dismiss.' + key, '1');
      setGone(true);
    },
  ];
}

/** Maxie's note inside a card: the mark, one or two serif sentences, a primary action and a quiet one. */
export function MaxieNote({ text, actions }: { text: ReactNode; actions: { label: ReactNode; onClick: () => void; primary?: boolean }[] }) {
  return (
    <div className={s.mxNote}>
      <Logo size={24} mood="curious" interactive cheer="Just looking out for you!" />
      <div className={s.mxNoteMain}>
        <p>{text}</p>
        {actions.length > 0 && (
          <div className={s.mxActions}>
            {actions.map((a, i) =>
              a.primary ? (
                <button key={i} type="button" className={s.btnPrimarySm} onClick={a.onClick}>
                  {a.label}
                </button>
              ) : (
                <button key={i} type="button" className={s.mxLinkBtn} onClick={a.onClick}>
                  {a.label}
                </button>
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Paid / Due 28 Nov / Overdue since 20 Nov / Not paid yet, as a small tag. */
export function StatusTag({ status, due }: { status: 'paid' | 'due' | 'overdue' | 'none'; due?: Date }) {
  if (status === 'paid') return <span className={s.mxTag} data-tone="success">Paid</span>;
  if (status === 'overdue') return <span className={s.mxTag} data-tone="danger">{due ? `Overdue since ${dayMonth(due)}` : 'Overdue'}</span>;
  return <span className={s.mxTag}>{status === 'due' && due ? `Due ${dayMonth(due)}` : 'Not paid yet'}</span>;
}

/** The top three places (merchants) in a list of spending, with how many times and how much. */
function topPlaces(mine: TxView[]) {
  const by = new Map<string, { what: string; count: number; amount: number }>();
  for (const t of mine) {
    const k = merchantKey(t.title) || t.title;
    const x = by.get(k) ?? { what: tidyName(t.title.replace(/ \(\d+\/\d+\)( interest)?$/, '')), count: 0, amount: 0 };
    x.count++;
    x.amount += t.net;
    by.set(k, x);
  }
  return [...by.values()].sort((a, b) => b.amount - a.amount).slice(0, 3);
}

function PlaceList({ places, onPick }: { places: { what: string; count: number; amount: number }[]; onPick?: (merchant: string) => void }) {
  const { full } = useSettings();
  return (
    <ul className={s.mxList}>
      {places.map(p => (
        <li key={p.what}>
          {onPick ? (
            <button type="button" className={s.mxPlaceBtn} onClick={() => onPick(p.what)} title={`See ${p.what} transactions`}>
              <span className={s.mxWhat}>{p.what}</span>
              {p.count > 1 && <span className={s.mxCount}>{p.count}×</span>}
              <span className={s.mxAmt}>{full(p.amount)}</span>
            </button>
          ) : (
            <>
              <span className={s.mxWhat}>{p.what}</span>
              {p.count > 1 && <span className={s.mxCount}>{p.count}×</span>}
              <span className={s.mxAmt}>{full(p.amount)}</span>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------------------------- everyday

/**
 * An everyday category as a card: icon, name, streak badge, "spent of limit", remaining or over, and a pace-marked
 * meter. Opened: clickable 7-day bars, clickable top merchants, inline limit nudge / share-room rebalance, and Maxie's note.
 */
/** Playful, warm one-line vibe tailored to the category and its current pace. */
function categoryVibe(name: string, opts: { cur: number; lim: number; over: number; smoothUnder: boolean; pctUsed: number; isId: boolean }): string | null {
  const low = name.toLowerCase();
  if (opts.cur === 0) return opts.isId ? 'Masih utuh — rapi sekali' : 'Untouched so far — golden start';
  if (opts.over > 0) return opts.isId ? 'Agak hangat minggu ini — santai, bisa pinjam ruang' : 'A little warm — easy to borrow spare room';
  if (opts.lim > 0 && opts.pctUsed >= 85) return opts.isId ? 'Sudah dekat garis — pelan-pelan ya' : 'Cozying up to the line';
  if (opts.smoothUnder) {
    if (/cafe|coffee|kopi|dining|food|makan/.test(low)) return opts.isId ? 'Masih lega buat traktir santai' : 'Plenty of treat room left';
    if (/shop|belanja|fashion/.test(low)) return opts.isId ? 'Keranjang tenang, dompet senang' : 'Calm cart, happy wallet';
    if (/take ?out|delivery|grab/.test(low)) return opts.isId ? 'Ritme yang ringan banget' : 'Light & easy pace';
    return opts.isId ? `Melaju mulus (${opts.pctUsed}%)` : `Cruising nicely (${opts.pctUsed}%)`;
  }
  return null;
}

export function BudgetCard({
  r,
  cycle,
  open,
  onToggle,
  streak = 0,
  quietDays,
  challenge,
  justRebalanced,
  todayFrac,
  donors,
  shareTargets = [],
  onMove,
  onShareRoom,
  onNudgeLimit,
  onShowTransactions,
  onEditCategory,
  extra,
}: {
  r: CardRow;
  cycle: Cycle;
  open: boolean;
  onToggle: () => void;
  /** Consecutive past cycles kept within limit (shown at 2+). */
  streak?: number;
  /** Consecutive zero-spend days ending today within the cycle. */
  quietDays?: number | null;
  /** Active mini-quest state for this category (shows compact stamp dots even when collapsed). */
  challenge?: ChallengeState | null;
  /** Brief warm pulse highlight right after pouring budget into or out of this card. */
  justRebalanced?: boolean;
  /** Fraction of the cycle/week elapsed today (0–1), drawn as a subtle tick on the meter. */
  todayFrac?: number;
  donors: { name: string; room: number; spent?: number; limit?: number }[];
  /** Other variable categories that can receive spare budget room from this category. */
  shareTargets?: { name: string; room: number; over: number }[];
  onMove: (from: string, amount: number) => void;
  onShareRoom?: (to: string, amount: number) => void;
  onNudgeLimit?: (delta: number) => void;
  onShowTransactions: (cat: string, extra?: { q?: string; date?: string }) => void;
  onEditCategory: (name: string) => void;
  /** Anything more for the opened card (sub-categories, mini-quests). */
  extra?: ReactNode;
}) {
  const { settings, full, short } = useSettings();
  const isId = settings.maxieLanguage === 'id';
  const phone = useIsPhone();
  const { setOverride } = useData();
  const { c, cur, lim, mine } = r;
  const over = lim > 0 && cur > lim ? cur - lim : 0;
  const room = Math.max(0, lim - cur);
  const pctUsed = lim > 0 ? Math.round((cur / lim) * 100) : 0;
  const [choosing, setChoosing] = useState(false);
  const [pouring, setPouring] = useState(false);
  const [srcIdx, setSrc] = useState(0);
  const [sharing, setSharing] = useState(false);
  const [listView, setListView] = useState<'places' | 'txs'>('places');
  const [showAllTxs, setShowAllTxs] = useState(false);
  const [deltaFloat, setDeltaFloat] = useState<{ id: number; text: string; pos: boolean } | null>(null);
  const step = settings.currency === 'USD' ? 25 : 100_000;

  useEffect(() => {
    if (!deltaFloat) return;
    const t = setTimeout(() => setDeltaFloat(null), 900);
    return () => clearTimeout(t);
  }, [deltaFloat]);

  const fireNudge = (delta: number) => {
    if (!onNudgeLimit || delta === 0) return;
    onNudgeLimit(delta);
    haptic('tap', settings.quietMode);
    if (!settings.quietMode) {
      setDeltaFloat({ id: Date.now(), text: `${delta > 0 ? '+' : '−'}${short(Math.abs(delta))}`, pos: delta > 0 });
    }
  };

  // The last 7 days, today last.
  const days = Array.from({ length: 7 }, (_, i) => new Date(cycle.today.getFullYear(), cycle.today.getMonth(), cycle.today.getDate() - 6 + i));
  const week = days.map(d => ({ d, value: sum(mine.filter(t => t.date.getTime() === d.getTime()).map(t => t.net)) }));
  const wMax = Math.max(1, ...week.map(x => x.value));

  // A top-up that's most of the spending here is probably a transfer, not spending.
  const topup = mine.find(t => TOPUP.test(t.title) && t.net >= cur * 0.4 && t.net > 0);
  const [topupGone, dismissTopup] = useDismissed(`topup.${topup?.id ?? ''}`);
  const src = donors[srcIdx];
  const coverAmt = src ? Math.min(over, src.room) : 0;

  let suggestion: ReactNode = null;
  if (topup && !topupGone)
    suggestion = (
      <MaxieNote
        text={`${tidyName(topup.title)} (${full(topup.net)}) looks like a top-up to your e-wallet, not ${c.name.toLowerCase()}. Move it to Transfers? Transfers don't count against any budget.`}
        actions={[
          {
            label: (
              <>
                <Icon d={IC.transfer} size={15} /> Move to Transfers
              </>
            ),
            primary: true,
            onClick: () => setOverride(topup.id, topup.category, TRANSFER_CATEGORY),
          },
          { label: `Keep it in ${c.name}`, onClick: dismissTopup },
        ]}
      />
    );
  else if (over > 0 && src)
    suggestion = (
      <div className={s.mxNote}>
        <Logo size={24} mood="steady" interactive cheer="Easy tweak — total stays the same!" />
        <div className={s.mxNoteMain}>
          <p>
            {coverAmt < over
              ? `Cover part of it from ${src.name}? It has ${full(src.room)} left, which brings you to ${full(over - coverAmt)} over.`
              : `Cover it from ${src.name}? It has ${full(src.room)} left, so you'd be right back on budget.`}
          </p>
          {choosing && (
            <div className={s.mxSources} role="radiogroup" aria-label="Take budget from">
              {donors.map((x, i) => (
                <button
                  key={x.name}
                  type="button"
                  role="radio"
                  aria-checked={i === srcIdx}
                  className={s.mxSource}
                  data-selected={i === srcIdx || undefined}
                  onClick={() => {
                    setSrc(i);
                    setChoosing(false);
                  }}
                >
                  <span>{x.name}</span>
                  <span className={s.mxSourceLeft}>{short(x.room)} left</span>
                </button>
              ))}
            </div>
          )}
          <div className={s.mxActions}>
            <button
              type="button"
              className={s.btnPrimarySm}
              onClick={() => {
                haptic('success', settings.quietMode);
                onMove(src.name, coverAmt);
              }}
            >
              Pour {full(coverAmt)}
            </button>
            <button type="button" className={s.mxLinkBtn} onClick={() => setPouring(v => !v)}>
              {pouring ? 'Hide slider' : 'Custom pour…'}
            </button>
            {!choosing && !pouring && donors.length > 1 && (
              <button type="button" className={s.mxLinkBtn} onClick={() => setChoosing(true)}>
                Pick another jar
              </button>
            )}
          </div>
          {pouring && (
            <div style={{ marginTop: 8 }}>
              <MoveBudget
                name={c.name}
                need={over}
                targetSpent={cur}
                targetLimit={lim}
                donors={donors}
                onMove={(from, amt) => {
                  onMove(from, amt);
                  setPouring(false);
                }}
                onCancel={() => setPouring(false)}
              />
            </div>
          )}
        </div>
      </div>
    );

  const places = topPlaces(mine);
  const smoothUnder = cur > 0 && lim > 0 && todayFrac != null && todayFrac > 0.15 && cur < lim * todayFrac * 0.85;
  const isNear = !over && (r.st?.key === 'near' || (lim > 0 && pctUsed >= settings.warnAt));
  const statusTone: 'over' | 'near' | 'calm' | 'muted' =
    over > 0 ? 'over' : lim === 0 || cur === 0 ? 'muted' : isNear ? 'near' : smoothUnder ? 'calm' : 'muted';
  const vibe = categoryVibe(c.name, { cur, lim, over, smoothUnder, pctUsed, isId });
  const shareAmt = Math.min(room, step);

  // One consistent prioritized delight chip on the meta footer so adjacent cards keep the exact same height.
  const hasStamp = !!(challenge && challenge.kind === 'nospend' && (challenge.key === 'running' || challenge.key === 'done'));
  const showStreak = !hasStamp && streak >= 2 && !settings.quietMode;
  const showQuiet = !hasStamp && !showStreak && quietDays != null && quietDays >= 2 && !settings.quietMode;

  return (
    <section
      id={'cat-' + c.name}
      className={s.mxCard}
      data-over={over > 0 || undefined}
      data-near={isNear || undefined}
      data-rebalanced={justRebalanced || undefined}
      aria-label={`${c.name} budget`}
    >
      <button type="button" className={s.mxHead} aria-expanded={open} onClick={onToggle}>
        <span className={s.mxIcon} style={{ background: c.tint, color: 'var(--ink)' }}>
          <Icon d={c.icon} size={19} />
        </span>
        <span className={s.mxTitles}>
          <span className={`${s.mxLabel} ${s.ellipsis}`}>{c.name}</span>
        </span>
        <span className={s.mxStatus} data-tone={statusTone} data-over={over > 0 || undefined}>
          {(over > 0 || isNear) && <Icon d={IC.alert} size={14} />}
          {over > 0
            ? `${(phone ? short : full)(over)} over`
            : lim > 0
              ? `${(phone ? short : full)(room)} left`
              : `${(phone ? short : full)(cur)} spent`}
        </span>
        <Icon d={IC.chevDown} size={18} color={C.textMuted} style={{ flex: 'none', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.16s ease-out' }} />
      </button>
      {lim > 0 && (
        <div
          className={s.mxMeter}
          style={{ background: over > 0 ? 'var(--danger-soft)' : isNear ? 'var(--amber-tint)' : c.tint }}
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pctUsed}
          aria-label={`${c.name} budget used`}
        >
          <span
            className={s.mxMeterFill}
            style={{ width: Math.min(100, (cur / (lim || 1)) * 100) + '%', background: over > 0 ? 'var(--danger)' : isNear ? 'var(--amber)' : c.color }}
          />
          {todayFrac != null && todayFrac > 0 && todayFrac < 1 && (
            <span className={s.mxMeterPace} style={{ left: todayFrac * 100 + '%' }} title={`On-plan pace today: ${full(lim * todayFrac)}`} />
          )}
        </div>
      )}
      <div className={s.mxMetaFoot}>
        <span className={s.mxMetaLeft}>
          {lim > 0
            ? `${short(cur)} of ${short(lim)} · ${pctUsed}%`
            : c.name === 'Buffer'
              ? mine.length > 0
                ? `${mine.length} to sort`
                : 'All sorted'
              : 'No monthly limit'}
        </span>
        <span className={s.mxMetaRight}>
          {hasStamp && challenge ? (
            <span className={s.mxMiniStamps} title={challenge.text} aria-label={challenge.text}>
              {Array.from({ length: challenge.totalDays }, (_, i) => {
                const hit = challenge.key === 'done' || i < challenge.day;
                return <span key={i} className={s.mxMiniDot} data-hit={hit || undefined} data-done={challenge.key === 'done' || undefined} />;
              })}
            </span>
          ) : showStreak ? (
            <span className={s.mxStreakBadge} title={`${streak} consecutive cycles within limit`}>
              <FlameIcon size={12} /> {streak} cycles
            </span>
          ) : showQuiet ? (
            <span className={s.mxQuietPill} title={`${quietDays} quiet days without spending in ${c.name}`}>
              {quietDays} quiet days
            </span>
          ) : vibe ? (
            <span className={`${s.ellipsis} ${smoothUnder || cur === 0 ? s.mxSmoothNote : isNear ? s.mxNearNote : s.mxVibeNote}`}>{vibe}</span>
          ) : null}
        </span>
      </div>
      {open && (
        <div className={s.mxBody}>
          {mine.length > 0 && (
            <div className={s.mxWeek} aria-label="Last 7 days">
              {week.map(x => {
                const iso = toISO(x.d);
                return (
                  <button
                    key={x.d.getTime()}
                    type="button"
                    className={s.mxDayBtn}
                    disabled={!x.value}
                    title={x.value ? `${DAY_NAME[x.d.getDay()]}: ${full(x.value)} (tap to view)` : `${DAY_NAME[x.d.getDay()]}: no spend`}
                    onClick={() => x.value && onShowTransactions(c.name, { date: iso })}
                  >
                    <span className={s.mxDayVal} data-zero={!x.value || undefined}>
                      {x.value ? short(x.value) : '–'}
                    </span>
                    <span className={s.mxDayBar} style={{ height: Math.max(2, (x.value / wMax) * 56), background: x.value ? c.color : 'var(--line)' }} />
                    <span className={s.mxDayLabel}>{DAY_LETTER[x.d.getDay()]}</span>
                  </button>
                );
              })}
            </div>
          )}
          {places.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div className={s.sxMiniSeg} role="group" aria-label="View places or transactions">
                  <button type="button" aria-pressed={listView === 'places'} onClick={() => setListView('places')}>
                    Top places
                  </button>
                  <button type="button" aria-pressed={listView === 'txs'} onClick={() => setListView('txs')}>
                    Transactions ({mine.length})
                  </button>
                </div>
              </div>
              {listView === 'places' ? (
                <PlaceList places={places} onPick={merchant => onShowTransactions(c.name, { q: merchant })} />
              ) : (
                (() => {
                  const sorted = [...mine].sort((a, b) => b.date.getTime() - a.date.getTime());
                  const shown = showAllTxs ? sorted : sorted.slice(0, 5);
                  return (
                    <div className={s.fbTxList}>
                      {shown.map(t => (
                        <button
                          key={t.id}
                          type="button"
                          className={s.fbTxRow}
                          onClick={() => onShowTransactions(c.name, { q: tidyName(t.title) })}
                        >
                          <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, marginRight: 'auto' }}>
                            <span className={s.ellipsis} style={{ fontWeight: 500, fontSize: 14 }}>
                              {tidyName(t.title)}
                            </span>
                            <span style={{ fontSize: 12, color: C.textMuted }}>
                              {dayMonth(t.date)} · {t.account}
                            </span>
                          </span>
                          <span style={{ fontWeight: 600, fontSize: 14, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{full(t.net)}</span>
                        </button>
                      ))}
                      {sorted.length > 5 && (
                        <button type="button" className={s.textBtnSm} style={{ alignSelf: 'flex-start', padding: '2px 0' }} onClick={() => setShowAllTxs(v => !v)}>
                          {showAllTxs ? 'Show fewer' : `Show all ${sorted.length} transactions`}
                        </button>
                      )}
                    </div>
                  );
                })()
              )}
            </div>
          ) : (
            <p className={s.mxSummary}>Nothing spent here yet — clean slate.</p>
          )}
          {suggestion}
          {onNudgeLimit && (
            <div className={s.mxNudgeBar}>
              <span className={s.mxNudgeLabel}>
                Limit <strong>{full(lim)}</strong>
                {deltaFloat && (
                  <span key={deltaFloat.id} className={s.mxDeltaFloat} data-pos={deltaFloat.pos || undefined} aria-hidden="true">
                    {deltaFloat.text}
                  </span>
                )}
              </span>
              <span className={s.mxNudgeBtns}>
                <button
                  type="button"
                  className={s.mxNudgeBtn}
                  disabled={lim <= 0}
                  aria-label={`Decrease ${c.name} limit by ${short(step)}`}
                  title={`-${short(step)}`}
                  onClick={() => fireNudge(-Math.min(step, lim))}
                >
                  <Icon d={IC.minus} size={13} /> {short(step)}
                </button>
                <button
                  type="button"
                  className={s.mxNudgeBtn}
                  aria-label={`Increase ${c.name} limit by ${short(step)}`}
                  title={`+${short(step)}`}
                  onClick={() => fireNudge(step)}
                >
                  <Icon d={IC.plus} size={13} /> {short(step)}
                </button>
              </span>
            </div>
          )}
          {sharing && onShareRoom && shareTargets.length > 0 && shareAmt > 0 && (
            <div className={s.mxShareBox}>
              <span style={{ fontSize: 13, color: C.textMuted }}>
                Share <strong>{short(shareAmt)}</strong> of {c.name}&apos;s room with:
              </span>
              <div className={s.mxSources}>
                {shareTargets.slice(0, 5).map(t => (
                  <button
                    key={t.name}
                    type="button"
                    className={s.mxSource}
                    onClick={() => {
                      haptic('success', settings.quietMode);
                      onShareRoom(t.name, shareAmt);
                      setSharing(false);
                    }}
                  >
                    <span>{t.name}</span>
                    <span className={s.mxSourceLeft} style={t.over > 0 ? { color: C.redInk, fontWeight: 600 } : undefined}>
                      {t.over > 0 ? `${short(t.over)} over` : `${short(t.room)} left`}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {extra}
          <div className={s.mxLinks}>
            <button type="button" className={s.mxLink} onClick={() => onShowTransactions(c.name)}>
              See transactions
            </button>
            {onShareRoom && room >= step / 2 && shareTargets.length > 0 && (
              <button type="button" className={s.mxLink} onClick={() => setSharing(v => !v)}>
                {sharing ? 'Close share' : 'Share room'}
              </button>
            )}
            <button type="button" className={s.mxLink} onClick={() => onEditCategory(c.name)}>
              Edit category
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------- fixed bills

/**
 * One fixed bill: icon, name, a status tag (Paid, Due 28 Nov, Not paid yet) with one note, and the amount.
 * Opened: Maxie's fix when something's off (paid with no plan, charged twice), the monthly amount, top places and
 * how it compares with last cycle.
 */
export function BillItem({
  r,
  cycle,
  due,
  open,
  onToggle,
  marked,
  onMark,
  onAmount,
  editor,
  renderEditor,
  onTrackTx,
  onShowTransactions,
}: {
  r: CardRow;
  cycle: Cycle;
  /** Bills still to come this cycle in this category, soonest first. */
  due: { date: Date; amount: number }[];
  open: boolean;
  onToggle: () => void;
  marked: boolean;
  onMark: () => void;
  onAmount: (amount: number) => void;
  /** The "Monthly plan" amount editor (legacy inline prop). */
  editor?: ReactNode;
  /** Optional lazy render callback for clean open/close state. */
  renderEditor?: (close: () => void) => ReactNode;
  /** Optional 1-tap conversion of a cycle transaction into an individual recurring fixed bill. */
  onTrackTx?: (tx: TxView) => void;
  onShowTransactions: (cat: string) => void;
}) {
  const { settings, full, short } = useSettings();
  const phone = useIsPhone();
  const [justPaid, setJustPaid] = useState(false);
  const [editingPlan, setEditingPlan] = useState(false);
  const [showAllTxs, setShowAllTxs] = useState(false);
  useEffect(() => {
    if (!justPaid) return;
    const t = setTimeout(() => setJustPaid(false), 1200);
    return () => clearTimeout(t);
  }, [justPaid]);
  const { c, cur, lim, mine, last } = r;
  const dueTotal = sum(due.map(x => x.amount));
  const status: 'paid' | 'due' | 'none' = cur > 0 || marked ? 'paid' : due.length ? 'due' : 'none';
  const over = lim > 0 && cur > lim ? cur - lim : 0;
  const cycleId = cycle.start.toISOString().slice(0, 10);

  // Charged twice: the same merchant and amount more than once this cycle (a yearly plan, or a mistake).
  const twice = (() => {
    const by = new Map<string, TxView[]>();
    for (const t of mine) {
      const k = merchantKey(t.title) + '|' + Math.round(t.net);
      by.set(k, [...(by.get(k) ?? []), t]);
    }
    return [...by.values()].find(list => list.length >= 2);
  })();
  const [twiceGone, dismissTwice] = useDismissed(`twice.${cycleId}.${c.name}`);
  const [noPlanGone, dismissNoPlan] = useDismissed(`noplan.${cycleId}.${c.name}`);

  const note = over ? (
    <span className={s.mxOver}>{full(over)} over plan</span>
  ) : status === 'paid' && lim === 0 ? (
    <span className={s.mxNoteText}>No monthly plan yet</span>
  ) : status === 'paid' && due.length ? (
    <span className={s.mxNoteText}>{full(dueTotal)} left to pay</span>
  ) : marked && cur === 0 ? (
    <span className={s.mxNoteText}>Ticked off by you</span>
  ) : null;

  let fix: ReactNode = null;
  if (twice && !twiceGone)
    fix = (
      <MaxieNote
        text={`${tidyName(twice[0].title)} charged you ${twice.length === 2 ? 'twice' : twice.length + ' times'} this cycle, ${full(twice[0].net)} each. One of them might be a yearly plan or a mistake.${lim > 0 && cur > lim ? ` Raise your plan to ${full(cur)}?` : ''}`}
        actions={[
          ...(lim > 0 && cur > lim ? [{ label: `Raise my plan to ${full(cur)}`, primary: true, onClick: () => onAmount(cur) }] : []),
          { label: 'See the charges', primary: !(lim > 0 && cur > lim), onClick: () => onShowTransactions(c.name) },
          { label: "It's right", onClick: dismissTwice },
        ]}
      />
    );
  else if (status === 'paid' && lim === 0 && cur > 0 && !noPlanGone)
    fix = (
      <MaxieNote
        text={`You paid ${full(cur)} for ${c.name.toLowerCase()} this cycle. Want me to plan that amount every month so I can remind you before it's due?`}
        actions={[
          { label: `Plan ${full(cur)} a month`, primary: true, onClick: () => onAmount(cur) },
          { label: 'Not now', onClick: dismissNoPlan },
        ]}
      />
    );

  const sortedMine = [...mine].sort((a, b) => b.date.getTime() - a.date.getTime());
  const visibleTxs = showAllTxs ? sortedMine : sortedMine.slice(0, 5);
  return (
    <div className={s.mxBill} data-open={open || undefined}>
      <button type="button" className={s.mxHead} aria-expanded={open} onClick={onToggle}>
        <span className={s.mxIcon} style={{ background: 'var(--surface-200)', color: 'var(--ink)' }}>
          <Icon d={c.icon} size={19} />
        </span>
        <span className={s.mxTitles} style={{ gap: 4 }}>
          <span className={s.mxLabel}>{c.name}</span>
          <span className={s.mxMeta}>
            <span className={justPaid ? s.mxPopIn : undefined}>
              <StatusTag status={status} due={due[0]?.date} />
            </span>
            {note}
          </span>
        </span>
        <span className={s.mxBillAmt} data-unpaid={status !== 'paid' || undefined}>
          {(phone ? short : full)(status === 'paid' ? cur || lim : status === 'due' ? dueTotal : lim)}
        </span>
        <Icon d={IC.chevDown} size={18} color={C.textMuted} style={{ flex: 'none', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.16s ease-out' }} />
      </button>
      {open && (
        <div className={s.mxBillBody}>
          {fix}
          <div className={s.fbPlanStrip}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ fontSize: 12, color: C.textMuted }}>Monthly plan</span>
              <span style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{lim > 0 ? full(lim) : 'Not set'}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ fontSize: 12, color: C.textMuted }}>Paid this cycle</span>
              <span style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: cur > 0 ? C.good : C.textMuted }}>{cur > 0 ? full(cur) : '—'}</span>
            </div>
            <button
              type="button"
              className={s.btnOutlineSm}
              style={{ marginLeft: 'auto' }}
              onClick={() => setEditingPlan(v => !v)}
            >
              {editingPlan ? 'Done' : lim > 0 ? 'Edit plan' : 'Set monthly plan'}
            </button>
          </div>
          {editingPlan && (renderEditor ? renderEditor(() => setEditingPlan(false)) : editor)}
          {cur === 0 && (
            <button
              type="button"
              className={s.btnOutlineSm}
              style={{ alignSelf: 'flex-start' }}
              onClick={() => {
                if (!marked) {
                  haptic('success', settings.quietMode);
                  setJustPaid(true);
                }
                onMark();
              }}
            >
              {marked ? 'Mark as not paid' : 'Mark as paid'}
            </button>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span className={s.mxSubHead}>Transactions this cycle{sortedMine.length > 0 ? ` (${sortedMine.length})` : ''}</span>
            </div>
            {sortedMine.length > 0 ? (
              <div className={s.fbTxList}>
                {visibleTxs.map(t => (
                  <div key={t.id} className={s.fbTxRow} style={{ cursor: 'default' }}>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, marginRight: 'auto' }}>
                      <span className={s.ellipsis} style={{ fontWeight: 500, fontSize: 14 }}>
                        {tidyName(t.title)}
                      </span>
                      <span style={{ fontSize: 12, color: C.textMuted }}>
                        {dayMonth(t.date)} · {t.account}
                      </span>
                    </span>
                    {onTrackTx && (
                      <button type="button" className={s.textBtnSm} style={{ fontSize: 12, padding: '2px 6px' }} onClick={() => onTrackTx(t)}>
                        Track bill
                      </button>
                    )}
                    <span style={{ fontWeight: 600, fontSize: 14, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{full(t.net)}</span>
                  </div>
                ))}
                {sortedMine.length > 5 && (
                  <button type="button" className={s.textBtnSm} style={{ alignSelf: 'flex-start', padding: '2px 0' }} onClick={() => setShowAllTxs(v => !v)}>
                    {showAllTxs ? 'Show fewer' : `Show all ${sortedMine.length} transactions`}
                  </button>
                )}
              </div>
            ) : (
              <span style={{ fontSize: 13, color: C.textMuted }}>No {c.name.toLowerCase()} transactions recorded this cycle yet.</span>
            )}
          </div>
          {last > 0 && (
            <p className={s.mxCompare}>
              Last cycle at this point you'd spent {full(last)} on {c.name.toLowerCase()}.
            </p>
          )}
          <div className={s.mxLinks}>
            <button type="button" className={s.mxLink} onClick={() => onShowTransactions(c.name)}>
              Open in Transactions
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Installments as one group in Fixed bills: every plan with a payment this cycle, from the same schedule as Next
 * cycle and the transactions. The payments count in their own categories; this is where you see them together.
 */
export function InstallmentsGroup({ cycle, open, onToggle }: { cycle: Cycle; open: boolean; onToggle: () => void }) {
  const { full, short } = useSettings();
  const phone = useIsPhone();
  const { views, openSchedule } = usePlans();
  const rows = views
    .map(p => ({ p, pay: p.payments.find(x => x.date >= cycle.start && x.date <= cycle.end) }))
    .filter((x): x is { p: (typeof views)[number]; pay: NonNullable<(typeof x)['pay']> } => !!x.pay)
    .sort((a, b) => a.pay.date.getTime() - b.pay.date.getTime());
  if (!rows.length) return null;
  const paid = rows.filter(x => x.pay.date <= cycle.today);
  const nextDue = rows.find(x => x.pay.date > cycle.today);
  const total = sum(rows.map(x => x.pay.amount));
  return (
    <div className={s.mxBill} data-open={open || undefined}>
      <button type="button" className={s.mxHead} aria-expanded={open} onClick={onToggle}>
        <span className={s.mxIcon} style={{ background: 'var(--surface-200)', color: 'var(--ink)' }}>
          <Icon d={IC.card} size={19} />
        </span>
        <span className={s.mxTitles} style={{ gap: 4 }}>
          <span className={s.mxLabel}>Installments</span>
          <span className={s.mxMeta}>
            <StatusTag status={nextDue ? 'due' : 'paid'} due={nextDue?.pay.date} />
            <span className={s.mxNoteText}>
              {paid.length} of {rows.length} paid this cycle
            </span>
          </span>
        </span>
        <span className={s.mxBillAmt} data-unpaid={!!nextDue || undefined}>
          {(phone ? short : full)(total)}
        </span>
        <Icon d={IC.chevDown} size={18} color={C.textMuted} style={{ flex: 'none', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.16s ease-out' }} />
      </button>
      {open && (
        <div className={s.mxBillBody}>
          <ul className={s.mxItems}>
            {rows.map(({ p, pay }) => {
              const isPaid = pay.date <= cycle.today;
              return (
                <li key={p.key}>
                  <button type="button" className={s.mxItemBtn} onClick={() => openSchedule(p.key)}>
                    <span className={s.mxTitles}>
                      <span className={s.mxItemName}>{p.title}</span>
                      <span className={s.mxNoteText}>
                        {p.category}, {p.account}, {pay.n} of {p.months}, {isPaid ? 'paid' : 'due'} {dayMonth(pay.date)}, {full(leftAfter(p, pay.date))} left
                      </span>
                    </span>
                    <StatusTag status={isPaid ? 'paid' : 'due'} due={pay.date} />
                    <span className={s.mxBillAmt} data-unpaid={!isPaid || undefined}>
                      {full(pay.amount)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <span className={s.mxCompare}>Each payment counts in its own category. Tap one for its full schedule.</span>
        </div>
      )}
    </div>
  );
}

/** Paid and planned for the Installments group this cycle, for the Fixed bills total. */
export function useInstallmentTotals(cycle: Cycle) {
  const { views } = usePlans();
  const pays = views.flatMap(p => p.payments.filter(x => x.date >= cycle.start && x.date <= cycle.end));
  return { paid: sum(pays.filter(x => x.date <= cycle.today).map(x => x.amount)), planned: sum(pays.map(x => x.amount)) };
}
