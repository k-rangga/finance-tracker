import { useCallback, useEffect, useMemo, useState } from 'react';
import s from '../../styles/ui.module.css';
import { IC, Icon } from '../../components/Icon';
import { KEYS, storage, usePersistent } from '../../lib/storage';
import { addDays, fmtFull, fmtShort, toISO } from '../../lib/format';
import { useSettings } from '../../lib/settings';
import type { Cycle } from '../../lib/cycle';
import { computePortfolio, SEED_JOURNAL, type Prices, type Snap, type Trade } from './model';
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
  const [journal, setJournal] = usePersistent<Trade[]>(KEYS.journal, () => SEED_JOURNAL);
  const [prices, setPrices] = usePersistent<Prices>(KEYS.prices, () => ({ map: {}, at: toISO(addDays(cycle.today, -4)) }));
  const [sub, setSub] = useState<Sub>('portfolio');
  const [jf, setJf] = useState<JournalFilter>('all');
  const [jOpen, setJOpen] = useState<string | null>(null);
  const [pxOpen, setPxOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [snaps, setSnaps] = useState<Snap[]>([]);

  const P = useMemo(() => computePortfolio(journal, prices, settings.fxRate, cycle.today.getFullYear()), [journal, prices, settings.fxRate, cycle.today]);

  // Record one value snapshot per day so Progress builds a real history over time.
  useEffect(() => {
    const list = storage.get<Snap[]>(KEYS.snaps, []);
    const last = list[list.length - 1];
    const c = Math.max(P.cost - P.realized, P.cost * 0.5);
    if (!last || last.d !== todayISO || Math.abs(last.v - P.tot) > 1) {
      if (last && last.d === todayISO) list.pop();
      list.push({ d: todayISO, v: P.tot, c });
      storage.set(KEYS.snaps, list);
    }
    setSnaps(list);
  }, [P.tot, P.cost, P.realized, todayISO]);

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
          onClose={(id, ex) => setJournal(j => j.map(t => (t.id === id ? { ...t, ex } : t)))}
        />
      )}
      {sub === 'review' && <Review today={cycle.today} P={P} onOpenTrade={goJournal} />}

      {pxOpen && (
        <PriceModal
          P={P}
          onClose={() => setPxOpen(false)}
          onSave={map => {
            setPrices({ map: { ...prices.map, ...map }, at: todayISO });
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
            setJournal(j => [t, ...j]);
            setFormOpen(false);
            goJournal(t.id);
          }}
        />
      )}
    </div>
  );
}
