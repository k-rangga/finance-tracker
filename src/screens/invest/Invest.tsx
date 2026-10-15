import { useCallback, useEffect, useMemo, useState } from 'react';
import s from '../../styles/ui.module.css';
import { IC, Icon } from '../../components/Icon';
import { useData } from '../../lib/data';
import { fmtFull, fmtShort, toISO } from '../../lib/format';
import { useSettings } from '../../lib/settings';
import type { Cycle } from '../../lib/cycle';
import { computePortfolio } from './model';
import { Portfolio } from './Portfolio';
import { Progress } from './Progress';
import { Journal, type JournalFilter } from './Journal';
import { Review } from './Review';
import { PriceModal } from './PriceModal';
import { EntryModal } from './EntryModal';

type Sub = 'portfolio' | 'progress' | 'journal' | 'review';

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
  const { journal, prices, snaps, saveTrade, savePrices, saveSnapshot } = useData();
  const [sub, setSub] = useState<Sub>('portfolio');
  const [jf, setJf] = useState<JournalFilter>('all');
  const [jOpen, setJOpen] = useState<string | null>(null);
  const [pxOpen, setPxOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const P = useMemo(() => computePortfolio(journal, prices, settings.fxRate, cycle.today.getFullYear()), [journal, prices, settings.fxRate, cycle.today]);

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

      {sub === 'portfolio' && <Portfolio cycle={cycle} P={P} prices={prices} onOpenPrices={() => setPxOpen(true)} onOpenTrade={goJournal} />}
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
            const t = journal.find(x => x.id === id);
            if (t) saveTrade({ ...t, ex });
          }}
        />
      )}
      {sub === 'review' && <Review today={cycle.today} P={P} onOpenTrade={goJournal} />}

      {pxOpen && (
        <PriceModal
          P={P}
          onClose={() => setPxOpen(false)}
          onSave={map => {
            savePrices({ map: { ...prices.map, ...map }, at: todayISO });
            setPxOpen(false);
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
