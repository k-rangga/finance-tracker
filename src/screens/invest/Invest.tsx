import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import s from '../../styles/ui.module.css';
import { IC, Icon } from '../../components/Icon';
import { useData } from '../../lib/data';
import { fmtFull, fmtShort, toISO } from '../../lib/format';
import { useSettings } from '../../lib/settings';
import type { Cycle } from '../../lib/cycle';
import { fetchQuotes } from '../../lib/backend';
import { computePortfolio, effectiveTrade, type Trade } from './model';
import { Portfolio, priceNote } from './Portfolio';
import { Progress } from './Progress';
import { HL_COLOR, Journal } from './Journal';
import { Review } from './Review';
import { PriceModal } from './PriceModal';
import { EntryModal } from './EntryModal';
import { ConnectWallet, usePerps } from './Perps';
import { allTrades, needsReview, type AnyTrade, type Source } from './trades';
import { QuickReview } from './QuickReview';
import { JournalFeed } from './JournalFeed';
import { Select } from '../../components/Select';
import { usd } from '../../lib/perps';
import { C, plInk } from '../../lib/tokens';
import { storage } from '../../lib/storage';

/** Two accounts that never mix, each with its trades (the journal) and what they say (insights). */
type View = 'trades' | 'journal' | 'insights';
type Status = 'all' | 'open' | 'closed';
type Period = 'all' | 'year' | '30' | '7';
const WORLD_KEY = 'moneyTracker.investWorld';
const WORLDS: [Source, string, string][] = [
  ['manual', 'Stocks & crypto', '#2fc2a4'],
  ['perp', 'Perps', HL_COLOR],
];

/** Google Finance prices are refreshed on open when older than this. */
const QUOTE_MAX_AGE_MS = 30 * 60 * 1000;

/** Money formatters for rupiah amounts, shown in the display currency. */
export function useInvestFmt() {
  const { settings } = useSettings();
  return useMemo(() => {
    const conv = (idr: number) => (settings.currency === 'USD' ? idr / settings.fxRate : idr);
    return {
      dF: (idr: number, signed = false) => fmtFull(conv(idr), settings.currency, signed),
      dS: (idr: number, signed = false) => fmtShort(conv(idr), settings.currency, signed),
    };
  }, [settings.currency, settings.fxRate]);
}

export function Invest({ cycle }: { cycle: Cycle }) {
  const { settings } = useSettings();
  const todayISO = toISO(cycle.today);
  const { journal: stored, updates, prices, snaps, saveTrade, saveUpdate, deleteUpdate, savePrices, saveSnapshot } = useData();
  // Positions with their avg ups/downs folded in; the stored entries stay as first bought.
  const journal = useMemo(() => stored.map(t => effectiveTrade(t, updates)), [stored, updates]);
  const [editing, setEditing] = useState<Trade | null>(null);
  const [world, setWorldState] = useState<Source>(() => (storage.getRaw(WORLD_KEY) === 'perp' ? 'perp' : 'manual'));
  const setWorld = (w: Source) => {
    storage.setRaw(WORLD_KEY, w);
    setWorldState(w);
  };
  const [view, setView] = useState<View>('trades');
  const [status, setStatus] = useState<Status>('all');
  const [period, setPeriod] = useState<Period>('all');
  const [q, setQ] = useState('');
  /** The quick review's queue, fixed when it opens so reviewed trades don't shift it. */
  const [reviewing, setReviewing] = useState<AnyTrade[] | null>(null);
  const { dS } = useInvestFmt();
  const [jOpen, setJOpen] = useState<string | null>(null);
  const [pxOpen, setPxOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const P = useMemo(() => computePortfolio(journal, prices, settings.fxRate, cycle.today.getFullYear()), [journal, prices, settings.fxRate, cycle.today]);
  // Hyperliquid, synced once for every tab; its trades join the typed-in ones in one list, in rupiah.
  const hl = usePerps();
  const items = useMemo(() => allTrades(P, journal, hl.trades, hl.notes, settings.fxRate), [P, journal, hl.trades, hl.notes, settings.fxRate]);

  // Prices from Google Finance (GOOGLEFINANCE via the data spreadsheet). Symbols it can't price keep the typed price.
  const [quoting, setQuoting] = useState(false);
  const [quoteMsg, setQuoteMsg] = useState('');
  const refreshPrices = useCallback(
    async (quiet = false) => {
      const items = P.openTks.map(t => ({ tk: t.tk, mk: t.mk }));
      if (!items.length) return;
      setQuoting(true);
      try {
        const got = await fetchQuotes(items);
        const map = { ...prices.map };
        const auto = { ...(prices.auto ?? {}) };
        Object.entries(got).forEach(([tk, x]) => {
          map[tk] = x.price;
          auto[tk] = x.at;
        });
        const n = Object.keys(got).length;
        savePrices({ map, auto, at: n ? todayISO : prices.at, quotedAt: new Date().toISOString() });
        const manual = items.filter(i => !got[i.tk]).map(i => i.tk);
        setQuoteMsg(
          `${n} of ${items.length} updated from Google Finance (can be up to 20 min delayed)` + (manual.length ? ` · kept your price for ${manual.join(', ')}` : ''),
        );
      } catch (e) {
        if (!quiet) setQuoteMsg("Couldn't get prices from Google Finance: " + (e instanceof Error ? e.message : String(e)));
      } finally {
        setQuoting(false);
      }
    },
    [P.openTks, prices, savePrices, todayISO],
  );
  // Once per visit, when the last Google Finance check is over 30 minutes old.
  const autoQuoted = useRef(false);
  useEffect(() => {
    if (autoQuoted.current || !P.openTks.length) return;
    autoQuoted.current = true;
    if (!prices.quotedAt || Date.now() - new Date(prices.quotedAt).getTime() > QUOTE_MAX_AGE_MS) void refreshPrices(true);
  }, [P.openTks.length, prices.quotedAt, refreshPrices]);

  // Record one value snapshot per day so Progress builds a real history over time.
  const lastSnap = snaps[snaps.length - 1];
  useEffect(() => {
    if (!(P.tot > 0)) return;
    if (lastSnap && lastSnap.d === todayISO && Math.abs(lastSnap.v - P.tot) <= 1) return;
    saveSnapshot({ d: todayISO, v: P.tot, c: Math.max(P.cost - P.realized, P.cost * 0.5) });
  }, [P.tot, P.cost, P.realized, todayISO, lastSnap, saveSnapshot]);

  const goJournal = useCallback((id: string) => {
    setWorldState('manual');
    setView('trades');
    setStatus('all');
    setQ('');
    setJOpen('m:' + id);
  }, []);

  // One account at a time: its trades, then the filters (period applies to Insights too).
  const year = cycle.today.getFullYear();
  const from = period === 'all' ? 0 : period === 'year' ? new Date(year, 0, 1).getTime() : cycle.today.getTime() - Number(period) * 864e5;
  const mine = items.filter(t => t.source === world);
  const toReview = mine.filter(t => needsReview(t) && t.closed!.getTime() >= from);
  const needle = q.trim().toLowerCase();
  const shown = mine.filter(
    t =>
      (status === 'all' || (status === 'open') === !t.closed) &&
      (!t.closed || t.closed.getTime() >= from) &&
      (!needle || t.name.toLowerCase().includes(needle) || (t.manual?.nm ?? '').toLowerCase().includes(needle)),
  );
  const perps = world === 'perp';
  /** Money in this account's own currency: rupiah for stocks (or your display currency), dollars for perps. */
  const money = (idr: number, signed = false) => (perps ? usd(idr / settings.fxRate, signed) : dS(idr, signed));

  // The three numbers on top: what's in the account, what's open, what's realised this year.
  const realizedYear = mine.filter(t => t.closed && t.closed.getFullYear() === year).reduce((a, t) => a + t.pnl, 0);
  const hlOpen = (hl.state?.positions ?? []).reduce((a, p) => a + p.unrealized, 0);
  const strip: { label: string; value: string; ink?: string }[] = perps
    ? [
        { label: 'Account', value: hl.state?.equity != null ? usd(hl.state.equity) : '—' },
        { label: 'Open', value: usd(hlOpen, true), ink: plInk(hlOpen) },
        { label: `Realised ${year}`, value: money(realizedYear, true), ink: plInk(realizedYear) },
      ]
    : [
        { label: 'Value', value: dS(P.tot) },
        { label: 'Open', value: dS(P.upl, true), ink: plInk(P.upl) },
        { label: `Realised ${year}`, value: dS(P.realized, true), ink: plInk(P.realized) },
      ];
  const allAccounts = P.tot + (hl.state?.equity ?? 0) * settings.fxRate;
  const px = priceNote(prices, cycle.today);
  const status_ = perps
    ? hl.error || (hl.state?.syncedAt ? `Synced ${new Date(hl.state.syncedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : '')
    : quoteMsg || px.text;
  const refreshing = perps ? hl.syncing : quoting;
  const refresh = () => (perps ? void hl.sync() : void refreshPrices());

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Which account, and which view of it. */}
      <div className={s.invHead}>
        <div className={s.pills} role="group" aria-label="Account">
          {WORLDS.map(([k, label, ink]) => (
            <button
              key={k}
              type="button"
              aria-pressed={world === k}
              className={world === k ? s.optOn : s.opt}
              onClick={() => {
                setWorld(k);
                setQ('');
              }}
            >
              <span className={s.badgeDot} style={{ background: ink, display: 'inline-block', marginRight: 7, verticalAlign: 'middle' }} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
        <div className={s.subTabList} role="tablist" aria-label="View">
          {(['trades', 'journal', 'insights'] as const).map(k => (
            <button key={k} type="button" role="tab" aria-selected={view === k} className={view === k ? s.subTabActive : s.subTab} onClick={() => setView(k)}>
              {k === 'trades' ? 'Trades' : k === 'journal' ? 'Journal' : 'Insights'}
            </button>
          ))}
        </div>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button
            type="button"
            className={s.iconBtn}
            onClick={refresh}
            disabled={refreshing}
            aria-label={perps ? 'Sync Hyperliquid' : 'Refresh prices'}
            title={perps ? 'Sync Hyperliquid' : 'Refresh prices'}
          >
            <Icon d={IC.refresh} size={16} style={refreshing ? { animation: 'spin 1s linear infinite' } : undefined} />
          </button>
          {!perps && (
            <button type="button" className={s.btnPrimarySm} onClick={() => setFormOpen(true)} aria-label="New entry">
              <Icon d={IC.plus} size={16} />
              New entry
            </button>
          )}
        </span>
      </div>

      {perps && hl.state && !hl.state.address ? (
        <ConnectWallet hl={hl} />
      ) : (
        <>
          {/* What's in the account now, in its own currency. */}
          <div className={s.invStrip}>
            {strip.map(x => (
              <span key={x.label} className={s.invStat}>
                <span className={s.invStatLabel}>{x.label}</span>
                <span className={s.invStatValue} style={{ color: x.ink }}>
                  {x.value}
                </span>
              </span>
            ))}
            <span className={s.invStatus}>
              <span style={{ color: hl.error && perps ? C.redInk : px.stale && !perps ? C.amberInk : undefined }}>{status_}</span>
              {!perps && (
                <button type="button" className={s.linkBtn} style={{ fontSize: 13 }} onClick={() => setPxOpen(true)}>
                  Enter prices
                </button>
              )}
              <span>All accounts {dS(allAccounts)}</span>
            </span>
          </div>

          {/* One filter bar: open or closed, when, which name, and what still needs a review. The Journal goes by month. */}
          {view !== 'journal' && <div className={s.invFilters}>
            {view === 'trades' && (
              <Select
                ariaLabel="Open or closed"
                value={status}
                onChange={setStatus}
                options={[
                  { value: 'all' as const, label: 'Open & closed' },
                  { value: 'open' as const, label: 'Open' },
                  { value: 'closed' as const, label: 'Closed' },
                ]}
              />
            )}
            <Select
              ariaLabel="Period"
              value={period}
              onChange={setPeriod}
              options={[
                { value: 'all' as const, label: 'All time' },
                { value: 'year' as const, label: 'This year' },
                { value: '30' as const, label: 'Last 30 days' },
                { value: '7' as const, label: 'Last 7 days' },
              ]}
            />
            {view === 'trades' && (
              <>
                <label className={s.invSearch}>
                  <Icon d={IC.search} size={15} color={C.textMuted} />
                  <input value={q} onChange={e => setQ(e.target.value)} placeholder={perps ? 'Search BTC, HYPE…' : 'Search BBCA, NVDA…'} aria-label="Search trades" />
                </label>
                {toReview.length > 0 && (
                  <button type="button" className={s.opt} onClick={() => setReviewing(toReview)}>
                    <span className={s.badgeDot} style={{ background: C.amber, display: 'inline-block', marginRight: 7, verticalAlign: 'middle' }} aria-hidden="true" />
                    Review {toReview.length}
                  </button>
                )}
              </>
            )}
          </div>}

          {view === 'journal' ? (
            <JournalFeed key={world} account={world} items={mine} dS={money} onReview={toReview.length ? () => setReviewing(toReview) : undefined} />
          ) : view === 'trades' ? (
            <Journal
              today={cycle.today}
              todayISO={todayISO}
              P={P}
              items={shown}
              hl={hl}
              openId={jOpen}
              setOpenId={setJOpen}
              onClose={(id, ex) => {
                const t = stored.find(x => x.id === id);
                if (t) saveTrade({ ...t, ex });
              }}
              stored={stored}
              updates={updates}
              onEdit={setEditing}
              onSaveUpdate={saveUpdate}
              onDeleteUpdate={deleteUpdate}
            />
          ) : (
            <>
              <Review today={cycle.today} items={mine} from={from} dS={money} />
              {!perps && (
                <>
                  <Portfolio cycle={cycle} P={P} />
                  <Progress today={cycle.today} snaps={snaps} />
                </>
              )}
            </>
          )}
        </>
      )}

      {reviewing && (
        <QuickReview
          queue={reviewing}
          hl={hl}
          onSaveManual={(id, ex) => {
            const t = stored.find(x => x.id === id);
            if (t) saveTrade({ ...t, ex });
          }}
          onClose={() => setReviewing(null)}
        />
      )}
      {pxOpen && (
        <PriceModal
          P={P}
          onClose={() => setPxOpen(false)}
          onSave={map => {
            // Typed prices are manual: they stop counting as Google Finance quotes.
            const auto = Object.fromEntries(Object.entries(prices.auto ?? {}).filter(([tk]) => !(tk in map)));
            savePrices({ ...prices, map: { ...prices.map, ...map }, auto, at: todayISO });
            setPxOpen(false);
          }}
        />
      )}
      {editing && (
        <EntryModal
          todayISO={todayISO}
          portfolioValue={P.tot}
          editing={editing}
          onClose={() => setEditing(null)}
          onSave={t => {
            saveTrade(t);
            setEditing(null);
          }}
        />
      )}
      {formOpen && (
        <EntryModal
          todayISO={todayISO}
          portfolioValue={P.tot}
          onClose={() => setFormOpen(false)}
          onSave={t => {
            saveTrade(t);
            setFormOpen(false);
            goJournal(t.id);
          }}
        />
      )}
    </div>
  );
}
