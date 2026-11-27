import { useMemo, useState } from 'react';
import s from '../styles/ui.module.css';
import { Card } from '../components/ui';
import { IC, Icon } from '../components/Icon';
import type { Bill } from '../data/transactions';
import type { Subscription } from '../lib/subscriptions';
import type { TxView } from '../lib/budget';
import {
  buildCalendarMonth,
  buildIcsExport,
  cycleKeyForDate,
  type CalendarDay,
  type CalendarEvent,
  type CalendarLayer,
  type CalendarMonthData,
} from '../lib/calendar';
import type { Cycle } from '../lib/cycle';
import type { FixedBillStatus } from '../lib/fixedBills';
import { dayLabel, dayMonth, tidyName, toISO } from '../lib/format';
import { haptic } from '../lib/haptics';
import type { PlanView } from '../lib/installments';
import { useSettings } from '../lib/settings';
import { useIsPhone } from '../lib/media';
import { C } from '../lib/tokens';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const LAYERS: [CalendarLayer, string][] = [
  ['all', 'All'],
  ['bills', 'Bills & cards'],
  ['inflows', 'Inflows'],
  ['spending', 'Spending'],
];

const eventVisible = (e: CalendarEvent, layer: CalendarLayer) => {
  if (layer === 'all') return true;
  if (layer === 'inflows') return e.kind === 'payday' || e.kind === 'inflow';
  if (layer === 'bills') return e.kind === 'fixed' || e.kind === 'subscription' || e.kind === 'installment' || e.kind === 'planned' || e.kind === 'card_statement' || e.kind === 'card_due';
  return false;
};

const eventTone = (e: CalendarEvent): 'good' | 'clay' | 'sky' | 'warn' => {
  if (e.kind === 'payday' || e.kind === 'inflow') return 'good';
  if (e.kind === 'card_statement' || e.kind === 'card_due') return 'sky';
  if (e.overdue) return 'warn';
  return 'clay';
};

export function useCalendarMonth({
  cycle,
  allTxs,
  fixedBillStatuses,
  subscriptions,
  plans,
  filterCat,
  hideTransfers,
  searchQ,
}: {
  cycle: Cycle;
  allTxs: TxView[];
  fixedBillStatuses: FixedBillStatus[];
  subscriptions: Record<string, Subscription>;
  plans: PlanView[];
  filterCat: { cat: string; sub?: string };
  hideTransfers?: boolean;
  searchQ?: string;
}) {
  const { settings } = useSettings();
  const [cursor, setCursor] = useState(() => ({ year: cycle.today.getFullYear(), month: cycle.today.getMonth() }));
  const [layer, setLayer] = useState<CalendarLayer>('all');
  const [selectedISO, setSelectedISO] = useState<string>(() => toISO(cycle.today));

  const data = useMemo(
    () =>
      buildCalendarMonth({
        year: cursor.year,
        month: cursor.month,
        cycle,
        allTxs,
        fixedBillStatuses,
        subscriptions,
        plans,
        settings,
        filterCat,
        hideTransfers,
        searchQ,
      }),
    [cursor.year, cursor.month, cycle, allTxs, fixedBillStatuses, subscriptions, plans, settings, filterCat.cat, filterCat.sub, hideTransfers, searchQ],
  );

  const shiftMonth = (delta: number) => {
    setCursor(c => {
      const d = new Date(c.year, c.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  };

  const jumpToday = () => {
    setCursor({ year: cycle.today.getFullYear(), month: cycle.today.getMonth() });
    setSelectedISO(toISO(cycle.today));
  };

  const selectedDay = data.days.find(d => d.iso === selectedISO) ?? null;

  return { data, layer, setLayer, selectedISO, setSelectedISO, selectedDay, shiftMonth, jumpToday };
}

/** Main calendar card: month nav, calm KPIs, 7-column Mon–Sun grid, and 4-week rhythm bar. */
export function CalendarMain({
  data,
  layer,
  setLayer,
  selectedISO,
  onSelectDay,
  onShiftMonth,
  onJumpToday,
  todayISO,
}: {
  data: CalendarMonthData;
  layer: CalendarLayer;
  setLayer: (l: CalendarLayer) => void;
  selectedISO: string;
  onSelectDay: (iso: string) => void;
  onShiftMonth: (delta: number) => void;
  onJumpToday: () => void;
  todayISO: string;
}) {
  const { settings, short } = useSettings();
  const phone = useIsPhone();

  const downloadIcs = () => {
    const ics = buildIcsExport(data.allEvents, settings.currency);
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `maxie-cashflow-${data.year}-${String(data.month + 1).padStart(2, '0')}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const maxWeekCommit = Math.max(1, ...data.weeks.map(w => w.commitments));

  return (
    <div className={s.stack}>
      <Card style={{ gap: 16 }}>
        <div className={s.cfCalHead}>
          <div className={s.cfCalNav}>
            <button
              type="button"
              className={s.iconBtnSm}
              aria-label="Previous month"
              onClick={() => {
                haptic('tick', settings.quietMode);
                onShiftMonth(-1);
              }}
            >
              <Icon d={IC.chevLeft} size={16} />
            </button>
            <h2 className={s.calTitle}>{data.label}</h2>
            <button
              type="button"
              className={s.iconBtnSm}
              aria-label="Next month"
              onClick={() => {
                haptic('tick', settings.quietMode);
                onShiftMonth(1);
              }}
            >
              <Icon d={IC.chevRight} size={16} />
            </button>
            <button
              type="button"
              className={s.modelPresetChip}
              onClick={() => {
                haptic('tick', settings.quietMode);
                onJumpToday();
              }}
              style={{ marginLeft: 4 }}
            >
              Today
            </button>
          </div>
          <div className={s.calActions}>
            <div className={s.sxMiniSeg} data-own-gestures role="group" aria-label="Calendar layers">
              {LAYERS.map(([id, label]) => (
                <button key={id} type="button" aria-pressed={layer === id} onClick={() => setLayer(id)}>
                  {label}
                </button>
              ))}
            </div>
            {data.allEvents.length > 0 && (
              <button type="button" className={s.btnOutlineSm} onClick={downloadIcs} title="Download scheduled bills & paydays as .ics for Apple or Google Calendar">
                Export .ics
              </button>
            )}
          </div>
        </div>

        {/* Calm 3-stat month summary */}
        <div className={s.calKpis}>
          <div className={s.modelKpi}>
            <span className={s.modelKpiLabel}>Scheduled inflows</span>
            <span className={s.calKpiVal} style={{ color: data.totalInflows > 0 ? C.good : undefined }}>
              {data.totalInflows > 0 ? short(data.totalInflows) : '—'}
            </span>
          </div>
          <div className={s.modelKpi}>
            <span className={s.modelKpiLabel}>Commitments</span>
            <span className={s.calKpiVal}>{data.totalCommitments > 0 ? short(data.totalCommitments) : '—'}</span>
          </div>
          <div className={s.modelKpi}>
            <span className={s.modelKpiLabel}>Clear days ahead</span>
            <span className={s.calKpiVal}>{data.clearDays}</span>
          </div>
        </div>

        {/* 7-column Mon–Sun calendar grid */}
        <div className={s.calGridWrap}>
          <div className={s.calWeekdays} aria-hidden="true">
            {WEEKDAYS.map(w => (
              <span key={w}>{w}</span>
            ))}
          </div>
          <div className={s.cfCalGrid} role="grid" aria-label={`Cashflow calendar for ${data.label}`}>
            {data.days.map((d, i) => {
              const visEvents = d.events.filter(e => eventVisible(e, layer));
              const showSpend = (layer === 'all' || layer === 'spending') && d.spend > 0;
              const heat = showSpend ? Math.min(0.24, 0.05 + (d.spend / data.maxSpend) * 0.19) : 0;
              const isSelected = d.iso === selectedISO;
              const prevDay = data.days[i - 1];
              const nextDay = data.days[i + 1];
              const quietStreak =
                !showSpend &&
                d.inMonth &&
                d.zeroSpend &&
                (layer === 'all' || layer === 'spending') &&
                ((prevDay?.inMonth && prevDay.zeroSpend) || (nextDay?.inMonth && nextDay.zeroSpend));
              const hasInflow = visEvents.some(e => e.kind === 'payday' || e.kind === 'inflow');
              const hasBill = visEvents.some(e => e.kind === 'fixed' || e.kind === 'subscription' || e.kind === 'installment' || e.kind === 'planned');
              const hasCard = visEvents.some(e => e.kind === 'card_statement' || e.kind === 'card_due');
              const hasOverdue = visEvents.some(e => e.overdue);
              return (
                <button
                  key={d.iso}
                  type="button"
                  className={s.calCell}
                  data-outside={!d.inMonth || undefined}
                  data-today={d.isToday || undefined}
                  data-selected={isSelected || undefined}
                  data-quiet-streak={quietStreak || undefined}
                  aria-pressed={isSelected}
                  aria-label={`${dayLabel(d.date)}${d.spend > 0 ? `, spent ${short(d.spend)}` : ''}${visEvents.length ? `, ${visEvents.length} scheduled` : ''}`}
                  style={heat > 0 ? { background: `color-mix(in srgb, var(--clay) ${Math.round(heat * 100)}%, var(--surface))` } : undefined}
                  onClick={() => {
                    haptic('tick', settings.quietMode);
                    onSelectDay(d.iso);
                    if (phone) requestAnimationFrame(() => document.getElementById('cal-day-detail')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
                  }}
                >
                  <span className={s.calDayNum}>{d.date.getDate()}</span>
                  {showSpend && <span className={s.calDaySpend}>{short(d.spend)}</span>}
                  {!showSpend && d.zeroSpend && (layer === 'all' || layer === 'spending') && (
                    <span className={s.calZeroTag} title="Zero-spend day">
                      quiet
                    </span>
                  )}
                  <span className={s.calDots} aria-hidden="true">
                    {hasInflow && <span className={s.calDot} data-tone="good" />}
                    {hasBill && <span className={s.calDot} data-tone={hasOverdue ? 'warn' : 'clay'} />}
                    {hasCard && <span className={s.calDotRing} />}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Calm legend */}
        <div className={s.calLegend} aria-hidden="true">
          <span>
            <span className={s.calDot} data-tone="good" /> Payday / inflow
          </span>
          <span>
            <span className={s.calDot} data-tone="clay" /> Bill / installment / sub
          </span>
          <span>
            <span className={s.calDotRing} /> Card date
          </span>
          <span style={{ marginLeft: 'auto', color: C.textMuted }}>
            {todayISO.slice(0, 7) === `${data.year}-${String(data.month + 1).padStart(2, '0')}` ? 'Tap any day to inspect or add' : 'Tap any date to inspect'}
          </span>
        </div>
      </Card>

      {/* Weekly commitments rhythm strip */}
      <Card style={{ gap: 10 }}>
        <div className={s.cardHead}>
          <h3 className={s.sideTitle}>Weekly rhythm</h3>
          <span className={s.caption}>Commitments by week</span>
        </div>
        <div className={s.calWeeks}>
          {data.weeks.map(w => {
            const pct = w.commitments > 0 ? Math.max(6, (w.commitments / maxWeekCommit) * 100) : 0;
            return (
              <div key={w.label} className={s.calWeekRow}>
                <span className={s.calWeekLabel}>{w.label}</span>
                <span className={s.recapTrack} style={{ flex: 1 }}>
                  <span style={{ width: `${pct}%`, background: w.commitments > 0 ? 'var(--clay)' : 'transparent' }} />
                </span>
                <span className={s.calWeekAmt} style={{ color: w.commitments === 0 ? C.good : C.text }}>
                  {w.commitments > 0 ? short(w.commitments) : 'Clear'}
                </span>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

/** Side panel (or mobile section below grid): Day Inspector + Quick-Add planned cost/inflow, or Month upcoming summary. */
export function CalendarSide({
  data,
  day,
  bare,
  onSelectDay,
  onViewInList,
  onMarkBillPaid,
  onDismissBill,
}: {
  data: CalendarMonthData;
  day: CalendarDay | null;
  bare?: boolean;
  onSelectDay: (iso: string) => void;
  onViewInList: (iso: string) => void;
  onMarkBillPaid?: (b: Bill) => void;
  onDismissBill?: (b: Bill) => void;
}) {
  const { settings, update, full, short } = useSettings();
  const idr = settings.currency === 'IDR';
  const [adding, setAdding] = useState<'cost' | 'extra' | null>(null);
  const [name, setName] = useState('');
  const [amtText, setAmtText] = useState('');

  const amount = idr ? Number(amtText.replace(/\D/g, '')) : Number(amtText.replace(/[^\d.]/g, ''));
  const valid = name.trim().length > 0 && amount > 0;

  const savePlanned = () => {
    if (!day || !adding || !valid) return;
    const ck = cycleKeyForDate(day.iso);
    const allPlans = settings.cyclePlans ?? {};
    const cur = allPlans[ck] ?? {};
    if (adding === 'cost') {
      const id = 'cost_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      update({
        cyclePlans: {
          ...allPlans,
          [ck]: { ...cur, costs: [...(cur.costs ?? []), { id, name: name.trim().slice(0, 50), amount, date: day.iso, category: 'Buffer' }] },
        },
      });
    } else {
      const id = 'in_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      update({
        cyclePlans: {
          ...allPlans,
          [ck]: { ...cur, extras: [...(cur.extras ?? []), { id, name: name.trim().slice(0, 50), amount }] },
        },
      });
    }
    setName('');
    setAmtText('');
    setAdding(null);
  };

  const removePlanned = (e: CalendarEvent) => {
    if (!e.cycleKeyStr) return;
    const allPlans = settings.cyclePlans ?? {};
    const cur = allPlans[e.cycleKeyStr] ?? {};
    if (e.costId) {
      update({ cyclePlans: { ...allPlans, [e.cycleKeyStr]: { ...cur, costs: (cur.costs ?? []).filter(c => c.id !== e.costId) } } });
    } else if (e.extraId) {
      update({ cyclePlans: { ...allPlans, [e.cycleKeyStr]: { ...cur, extras: (cur.extras ?? []).filter(x => x.id !== e.extraId) } } });
    }
  };

  const upcoming = useMemo(
    () =>
      data.allEvents
        .filter(e => !e.paid && e.kind !== 'card_statement')
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, 6),
    [data.allEvents],
  );

  const body = day ? (
    <>
      <section id="cal-day-detail" className={s.sideCard}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <h3 className={s.sideTitle}>{dayLabel(day.date)}</h3>
          {day.isToday && <span className={s.modelTag}>Today</span>}
        </div>

        {day.zeroSpend && (
          <span className={s.calQuietNote}>
            <Icon d={IC.check} size={13} strokeWidth={2.4} /> Quiet zero-spend day
          </span>
        )}

        {day.spend > 0 && (
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 13, color: C.textMuted }}>Spent this day</span>
            <strong style={{ fontFamily: 'var(--font-serif)', fontSize: 20, fontWeight: 500 }}>{full(day.spend)}</strong>
          </div>
        )}

        {day.events.length > 0 && (
          <div className={s.calEventList}>
            <span className={s.statLabel}>Scheduled</span>
            {day.events.map(e => (
              <div key={e.id} className={s.calEventRow}>
                <span className={s.calDot} data-tone={eventTone(e)} style={{ marginTop: 5 }} />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0 }}>
                  <span className={s.ellipsis} style={{ fontWeight: 500, fontSize: 14, textDecoration: e.paid ? 'line-through' : undefined, opacity: e.paid ? 0.65 : 1 }}>
                    {tidyName(e.title)}
                  </span>
                  {e.note && <span style={{ fontSize: 12, color: e.overdue ? C.redInk : C.textMuted }}>{e.note}</span>}
                </span>
                {e.amount != null && (
                  <span style={{ fontWeight: 600, fontSize: 13.5, whiteSpace: 'nowrap', color: e.kind === 'payday' || e.kind === 'inflow' ? C.good : C.text }}>
                    {e.kind === 'payday' || e.kind === 'inflow' ? `+ ${short(e.amount)}` : short(e.amount)}
                  </span>
                )}
                {e.bill && onMarkBillPaid && (
                  <button type="button" className={s.ubPayBtn} title="Mark paid" aria-label={`Mark ${e.title} paid`} onClick={() => onMarkBillPaid(e.bill!)}>
                    <Icon d={IC.check} size={14} strokeWidth={2.3} />
                  </button>
                )}
                {e.bill && onDismissBill && (
                  <button type="button" className={s.iconBtnSm} title="Skip this cycle" aria-label={`Skip ${e.title}`} onClick={() => onDismissBill(e.bill!)}>
                    <Icon d={IC.close} size={13} />
                  </button>
                )}
                {(e.costId || e.extraId) && (
                  <button type="button" className={s.iconBtnSm} title="Remove" aria-label={`Remove ${e.title}`} onClick={() => removePlanned(e)}>
                    <Icon d={IC.close} size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {day.txs.length > 0 && (
          <div className={s.calEventList}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span className={s.statLabel}>Transactions ({day.txs.length})</span>
              <button type="button" className={s.modelMicroLink} style={{ fontSize: 12 }} onClick={() => onViewInList(day.iso)}>
                Open in List
              </button>
            </div>
            {day.txs.slice(0, 6).map(t => (
              <div key={t.id} className={s.calTxRow}>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0 }}>
                  <span className={s.ellipsis} style={{ fontSize: 13.5, fontWeight: 500 }}>
                    {tidyName(t.title)}
                  </span>
                  <span style={{ fontSize: 12, color: C.textMuted }}>{t.cat}</span>
                </span>
                <span style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: 'nowrap', color: t.isIncome ? C.good : C.text }}>
                  {t.isIncome ? `+ ${short(t.amount)}` : short(t.net)}
                </span>
              </div>
            ))}
            {day.txs.length > 6 && (
              <button type="button" className={s.textBtnSm} style={{ padding: 0, alignSelf: 'flex-start' }} onClick={() => onViewInList(day.iso)}>
                +{day.txs.length - 6} more in List
              </button>
            )}
          </div>
        )}

        {day.events.length === 0 && day.txs.length === 0 && !day.zeroSpend && (
          <span style={{ fontSize: 13.5, color: C.textMuted }}>Nothing scheduled on this day — open and clear.</span>
        )}

        {/* Quick add planned cost or extra inflow directly on this date */}
        {!day.isPast && (
          <div style={{ paddingTop: 6, borderTop: `1px solid ${C.divider}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {adding ? (
              <form
                style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
                onSubmit={e => {
                  e.preventDefault();
                  savePlanned();
                }}
              >
                <span style={{ fontSize: 12.5, fontWeight: 600, color: C.textMuted }}>
                  {adding === 'cost' ? `Plan a one-off cost on ${dayMonth(day.date)}` : 'Plan an extra inflow for this cycle'}
                </span>
                <input
                  className={s.input}
                  style={{ minHeight: 36, padding: '6px 10px', fontSize: 13.5 }}
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder={adding === 'cost' ? 'e.g. Car service, gift' : 'e.g. Bonus, freelance'}
                  maxLength={50}
                  autoFocus
                />
                <input
                  className={s.input}
                  style={{ minHeight: 36, padding: '6px 10px', fontSize: 13.5 }}
                  inputMode="decimal"
                  value={amtText}
                  onChange={e => setAmtText(idr ? (Number(e.target.value.replace(/\D/g, '')) || '').toLocaleString('id-ID') : e.target.value)}
                  placeholder={idr ? 'Amount (Rp)' : 'Amount ($)'}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="submit" className={s.btnPrimarySm} disabled={!valid}>
                    Save
                  </button>
                  <button type="button" className={s.btnGhost} onClick={() => setAdding(null)}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button type="button" className={s.btnOutlineSm} onClick={() => setAdding('cost')}>
                  + Planned cost
                </button>
                <button type="button" className={s.btnOutlineSm} onClick={() => setAdding('extra')}>
                  + Extra inflow
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {upcoming.length > 0 && (
        <section className={s.sideCard}>
          <h3 className={s.sideTitle}>Key dates in {data.label.split(' ')[0]}</h3>
          <div className={s.calEventList}>
            {upcoming.map(e => (
              <button key={e.id} type="button" className={s.calJumpRow} onClick={() => onSelectDay(e.date)}>
                <span className={s.calDot} data-tone={eventTone(e)} />
                <span className={s.ellipsis} style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  {tidyName(e.title)}
                </span>
                <span style={{ fontSize: 12, color: C.textMuted, whiteSpace: 'nowrap' }}>{dayMonth(new Date(e.date + 'T00:00:00'))}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </>
  ) : null;

  return bare ? <>{body}</> : <aside className={s.splitSide}>{body}</aside>;
}
