import { useState } from 'react';
import s from '../../styles/ui.module.css';
import { Modal, Options } from '../../components/ui';
import { useSettings } from '../../lib/settings';
import { C } from '../../lib/tokens';
import { entryRules, nat, numIn, type Draft, type Market, type Trade } from './model';
import { useInvestFmt } from './Invest';

type Props = { todayISO: string; portfolioValue: number; onClose: () => void; onSave: (t: Trade) => void };

export function EntryModal({ todayISO, portfolioValue, onClose, onSave }: Props) {
  const { settings } = useSettings();
  const { dF } = useInvestFmt();
  const [D, setDraft] = useState<Draft>({
    mk: 'IDX',
    tk: '',
    nm: '',
    d: todayISO,
    px: '',
    q: '',
    fee: '',
    st: 'Swing',
    th: '',
    cat: '',
    cd: '',
    tg: '',
    sl: '',
    cv: 3,
    lev: 1,
    dir: 'Long',
    tags: '',
  });
  const [err, setErr] = useState('');
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setDraft(d => ({ ...d, [k]: v }));
    setErr('');
  };

  const toIdr = (v: number, mk: Market) => (mk === 'IDX' ? v : v * settings.fxRate);
  const lev = D.mk === 'Crypto' ? D.lev || 1 : 1;
  const dr = lev > 1 && D.dir === 'Short' ? -1 : 1;
  const px = numIn(D.px, D.mk);
  const tg = numIn(D.tg, D.mk);
  const sl = numIn(D.sl, D.mk);
  const q = parseFloat(D.q.replace(/[^\d.]/g, '')) * (D.mk === 'IDX' ? 100 : 1);
  const rules = entryRules(D);
  const cur = D.mk === 'IDX' ? 'Rp' : '$';

  // Live preview: cost, reward:risk, max loss and leverage maths.
  const parts: string[] = [];
  if (px > 0 && q > 0) parts.push('Cost ' + dF(toIdr((px * q) / lev, D.mk)) + (lev > 1 ? ' margin' : ''));
  if (px > 0 && sl > 0 && (px - sl) * dr > 0) {
    if ((tg - px) * dr > 0) parts.push('Reward : risk ' + ((tg - px) / (px - sl)).toFixed(1) + ' : 1');
    if (q > 0) {
      const loss = toIdr((px - sl) * dr * q, D.mk);
      parts.push('Max loss at stop ' + dF(loss) + (portfolioValue ? ` (${((loss / portfolioValue) * 100).toFixed(1)}% of portfolio)` : ''));
    }
  }
  if (lev > 1 && px > 0) parts.push('Liquidation ≈ ' + nat(px * (1 - dr / lev), D.mk));
  const preview = parts.length ? parts.join(' · ') : 'Add price and quantity to see the cost, then a target and stop for reward : risk and max loss.';

  const save = () => {
    const tk = D.tk.trim().toUpperCase();
    const fee = numIn(D.fee, D.mk);
    if (!tk || !(px > 0) || !(q > 0)) return setErr('Ticker, entry price and quantity are required.');
    if (sl > 0 && (px - sl) * dr <= 0) return setErr(`Stop loss must be ${dr > 0 ? 'below' : 'above'} the entry price.`);
    if (tg > 0 && (tg - px) * dr <= 0) return setErr(`Target must be ${dr > 0 ? 'above' : 'below'} the entry price.`);
    const bad = rules.filter(r => !r.ok);
    if (bad.length) return setErr('Entry rules not met: ' + bad.map(r => r.label.toLowerCase()).join(', ') + '.');
    const t: Trade = {
      id: 'u' + Date.now(),
      mk: D.mk,
      tk,
      nm: D.nm.trim(),
      d: D.d || todayISO,
      px,
      q,
      st: D.st,
      cv: D.cv,
      th: D.th.trim(),
      ...(tg > 0 ? { tg } : {}),
      ...(sl > 0 ? { sl } : {}),
      ...(D.cat.trim() ? { cat: D.cat.trim() } : {}),
      ...(D.cd ? { cd: D.cd } : {}),
      ...(D.tags.trim() ? { tags: D.tags.trim() } : {}),
      ...(fee >= 0 ? { fee } : {}),
      ...(lev > 1 ? { lev, dir: dr < 0 ? 'Short' : 'Long' } : {}),
    };
    onSave(t);
  };

  const text = (k: 'tk' | 'nm' | 'px' | 'q' | 'fee' | 'tg' | 'sl' | 'cat' | 'tags', label: string, opts: { placeholder?: string; numeric?: boolean; upper?: boolean } = {}) => (
    <label className={s.field}>
      {label}
      <input
        className={s.input}
        value={D[k]}
        inputMode={opts.numeric ? 'decimal' : undefined}
        placeholder={opts.placeholder}
        style={opts.upper ? { textTransform: 'uppercase' } : undefined}
        onChange={e => set(k, e.target.value)}
      />
    </label>
  );
  const grid = (min: number) => ({ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: 12 }) as const;

  return (
    <Modal title="New journal entry" onClose={onClose} width={680}>
      <div style={{ ...grid(220), gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className={s.label}>Market</span>
          <Options label="Market" items={['IDX', 'US', 'Crypto'] as const} value={D.mk} onChange={v => set('mk', v)} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className={s.label}>Style</span>
          <Options label="Style" items={['Long-term', 'Swing'] as const} value={D.st} onChange={v => set('st', v)} />
        </div>
      </div>
      {D.mk === 'Crypto' && (
        <div style={{ ...grid(220), gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className={s.label}>Leverage</span>
            <Options label="Leverage" items={[1, 2, 3, 5, 10] as const} value={D.lev as 1} onChange={v => set('lev', v)} render={v => v + 'x'} />
          </div>
          {lev > 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span className={s.label}>Direction</span>
              <Options label="Direction" items={['Long', 'Short'] as const} value={D.dir} onChange={v => set('dir', v)} />
            </div>
          )}
        </div>
      )}
      <div style={grid(200)}>
        {text('tk', 'Ticker', { placeholder: D.mk === 'IDX' ? 'BBCA' : D.mk === 'US' ? 'AAPL' : 'BTC', upper: true })}
        {text('nm', 'Name (optional)')}
      </div>
      <div style={grid(140)}>
        <label className={s.field}>
          Buy date
          <input className={s.input} type="date" value={D.d} onChange={e => set('d', e.target.value)} />
        </label>
        {text('px', `Price (${cur})`, { numeric: true })}
        {text('q', D.mk === 'IDX' ? 'Lots (100 shares)' : D.mk === 'US' ? 'Shares' : 'Units', { numeric: true })}
        {text('fee', `Fee (${cur})`, { numeric: true, placeholder: D.mk === 'IDX' ? 'Auto 0.15%' : 'Auto 0.1%' })}
      </div>
      <div style={grid(200)}>
        {text('tg', `Target (${cur})`, { numeric: true, placeholder: D.st === 'Long-term' ? 'Optional for long-term' : '' })}
        {text('sl', `Stop (${cur})`, { numeric: true, placeholder: 'Price that proves you wrong' })}
      </div>
      <div style={grid(200)}>
        {text('cat', 'Catalyst', { placeholder: 'Earnings, dividend, RUPS, rate decision' })}
        <label className={s.field}>
          Catalyst date
          <input className={s.input} type="date" value={D.cd} onChange={e => set('cd', e.target.value)} />
        </label>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className={s.label}>Conviction</span>
        <Options label="Conviction" round items={[1, 2, 3, 4, 5] as const} value={D.cv} onChange={v => set('cv', v)} />
      </div>
      <label className={s.field}>
        Thesis
        <textarea className={s.input} rows={3} value={D.th} onChange={e => set('th', e.target.value)} placeholder="The setup, what the market is missing, and what would prove you wrong" />
      </label>
      {text('tags', 'Tags', { placeholder: 'bank, dividend' })}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className={s.label}>Entry rules</span>
        {rules.length === 0 ? (
          <span style={{ fontSize: 14, color: C.textMuted }}>Long-term spot holdings don't need a stop or target.</span>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {rules.map(r => (
              <span
                key={r.label}
                className={s.badge}
                style={{ fontSize: 13, padding: '6px 12px', background: r.ok ? C.accentTint : C.redTint, color: r.ok ? C.accent800 : C.redInk }}
              >
                {r.ok ? '✓' : '✕'} {r.label}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className={s.note} style={{ color: C.textSoft }} aria-live="polite">
        {preview}
      </div>
      {err && (
        <span className={s.error} role="alert">
          {err}
        </span>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className={s.btnPrimary} onClick={save}>
          Save entry
        </button>
        <button type="button" className={s.btnGhost} onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
