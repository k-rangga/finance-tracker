import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import s from '../../styles/ui.module.css';
import { IC, Icon } from '../../components/Icon';
import { useData } from '../../lib/data';
import { fmtFull, fmtShort, toISO } from '../../lib/format';
import { useSettings } from '../../lib/settings';
import type { Cycle } from '../../lib/cycle';
import { fetchQuotes } from '../../lib/backend';
import { computePortfolio, effectiveTrade, type Trade } from './model';
import { Portfolio } from './Portfolio';
import { Progress } from './Progress';
import { Journal, type JournalFilter, type PriceRefresh } from './Journal';
import { Review } from './Review';
import { PriceModal } from './PriceModal';
import { EntryModal } from './EntryModal';

type Sub = 'portfolio' | 'progress' | 'journal' | 'review';

/** Google Finance prices are refreshed on open when older than this. */
const QUOTE_MAX_AGE_MS = 30 * 60 * 1000;

const SUBS: [Sub, string][] = [
  ['portfolio', 'Portfolio'],
  ['progress', 'Progress'],
  ['journal', 'Journal'],
  ['review', 'Review'],
];

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
  const [sub, setSub] = useState<Sub>('portfolio');
  const [jf, setJf] = useState<JournalFilter>('all');
  const [jOpen, setJOpen] = useState<string | null>(null);
  const [pxOpen, setPxOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const P = useMemo(() => computePortfolio(journal, prices, settings.fxRate, cycle.today.getFullYear()), [journal, prices, settings.fxRate, cycle.today]);

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
  const priceRefresh: PriceRefresh = { refresh: () => void refreshPrices(), busy: quoting, msg: quoteMsg };

  // Record one value snapshot per day so Progress builds a real history over time.
  const lastSnap = snaps[snaps.length - 1];
  useEffect(() => {
    if (!(P.tot > 0)) return;
    if (lastSnap && lastSnap.d === todayISO && Math.abs(lastSnap.v - P.tot) <= 1) return;
    saveSnapshot({ d: todayISO, v: P.tot, c: Math.max(P.cost - P.realized, P.cost * 0.5) });
  }, [P.tot, P.cost, P.realized, todayISO, lastSnap, saveSnapshot]);

  const goJournal = useCallback((id: string) => {
    setSub('journal');
    setJf('all');
    setJOpen(id);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className={s.subTabs}>
        <div className={s.subTabList} role="tablist" aria-label="Investment journal sections">
          {SUBS.map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={sub === k} className={sub === k ? s.subTabActive : s.subTab} onClick={() => setSub(k)}>
              {l}
            </button>
          ))}
        </div>
        <button type="button" className={s.btnPrimary} style={{ marginBottom: 6 }} onClick={() => setFormOpen(true)}>
          <Icon d={IC.plus} size={18} />
          New entry
        </button>
      </div>

      {sub === 'portfolio' && <Portfolio cycle={cycle} P={P} prices={prices} refresh={priceRefresh} onOpenPrices={() => setPxOpen(true)} onOpenTrade={goJournal} />}
      {sub === 'progress' && <Progress today={cycle.today} snaps={snaps} />}
      {sub === 'journal' && (
        <Journal
          today={cycle.today}
          todayISO={todayISO}
          P={P}
          journal={journal}
          filter={jf}
          setFilter={setJf}
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
          prices={priceRefresh}
        />
      )}
      {sub === 'review' && <Review today={cycle.today} P={P} onOpenTrade={goJournal} />}

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
