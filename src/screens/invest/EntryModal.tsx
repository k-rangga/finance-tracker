import { useState } from 'react';
import s from '../../styles/ui.module.css';
import { Modal, Options } from '../../components/ui';
import { useSettings } from '../../lib/settings';
import { C } from '../../lib/tokens';
import { entryRules, nat, numIn, type Draft, type FollowedPlan, type Market, type Trade } from './model';
import { useInvestFmt } from './Invest';

type Props = {
  todayISO: string;
  portfolioValue: number;
  /** The stored entry to edit (never the averaged position); omit for a new entry. */
  editing?: Trade;
  onClose: () => void;
  onSave: (t: Trade) => void;
};

type ExitDraft = { px: string; d: string; fp: FollowedPlan; rt: number; ls: string };

const str = (v: number | undefined) => (v == null ? '' : String(v));

/** Draft from a stored entry (IDX quantity back to lots). */
const draftOf = (t: Trade): Draft => ({
  mk: t.mk,
  tk: t.tk,
  nm: t.nm ?? '',
  d: t.d,
  px: str(t.px),
  q: str(t.mk === 'IDX' ? t.q / 100 : t.q),
  fee: str(t.fee),
  st: t.st,
  th: t.th ?? '',
  cat: t.cat ?? '',
  cd: t.cd ?? '',
  tg: str(t.tg),
  sl: str(t.sl),
  cv: t.cv ?? null,
  lev: t.lev ?? 1,
  dir: t.dir ?? 'Long',
  tags: t.tags ?? '',
});

export function EntryModal({ todayISO, portfolioValue, editing, onClose, onSave }: Props) {
  const { settings } = useSettings();
  const { dF } = useInvestFmt();
  const [D, setDraft] = useState<Draft>(() =>
    editing
      ? draftOf(editing)
      : { mk: 'IDX', tk: '', nm: '', d: todayISO, px: '', q: '', fee: '', st: 'Swing', th: '', cat: '', cd: '', tg: '', sl: '', cv: null, lev: 1, dir: 'Long', tags: '' },
  );
  const ex0 = editing?.ex;
  const [X, setX] = useState<ExitDraft | null>(() => (ex0 ? { px: String(ex0.px), d: ex0.d, fp: ex0.fp ?? 'Yes', rt: ex0.rt ?? 3, ls: ex0.ls ?? '' } : null));
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
    if (D.cv == null) return setErr('Choose a conviction level from 1 to 5.');
    const exPx = X ? numIn(X.px, D.mk) : NaN;
    if (X && !(exPx > 0)) return setErr('Enter the exit price.');
    if (sl > 0 && (px - sl) * dr <= 0) return setErr(`Stop loss must be ${dr > 0 ? 'below' : 'above'} the entry price.`);
    if (tg > 0 && (tg - px) * dr <= 0) return setErr(`Target must be ${dr > 0 ? 'above' : 'below'} the entry price.`);
    const bad = rules.filter(r => !r.ok);
    // New entries must meet the rules; edits of older entries can still be saved (the rules stay visible).
    if (bad.length && !editing) return setErr('Entry rules not met: ' + bad.map(r => r.label.toLowerCase()).join(', ') + '.');
    const t: Trade = {
      id: editing?.id ?? 'u' + Date.now(),
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
      ...(X ? { ex: { px: exPx, d: X.d || todayISO, fp: X.fp, rt: X.rt, ls: X.ls.trim() } } : {}),
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
    <Modal title={editing ? `Edit ${editing.tk}` : 'New journal entry'} onClose={onClose} width={680}>
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
        {text('tg', `Target (${cur}, optional)`, { numeric: true })}
        {text('sl', `Stop (${cur})`, { numeric: true, placeholder: 'Price that proves you wrong' })}
      </div>
      <div style={grid(200)}>
        {text('cat', 'Catalyst (optional)', { placeholder: 'Earnings, dividend, RUPS, rate decision' })}
        <label className={s.field}>
          Catalyst date (optional)
          <input className={s.input} type="date" value={D.cd} onChange={e => set('cd', e.target.value)} />
        </label>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className={s.label}>
          Conviction <span style={{ fontWeight: 500, color: C.textMuted }}>(required)</span>
        </span>
        <Options label="Conviction" round items={[1, 2, 3, 4, 5] as const} value={D.cv as Trade['cv']} onChange={v => set('cv', v)} />
      </div>
      <label className={s.field}>
        Thesis
        <textarea className={s.input} rows={3} value={D.th} onChange={e => set('th', e.target.value)} placeholder="The setup, what the market is missing, and what would prove you wrong" />
      </label>
      {text('tags', 'Tags', { placeholder: 'bank, dividend' })}
      {X && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, borderTop: `1px solid ${C.divider}`, paddingTop: 16 }}>
          <span className={s.label}>Exit</span>
          <div style={grid(160)}>
            <label className={s.field}>
              Exit price ({cur})
              <input className={s.input} inputMode="decimal" value={X.px} onChange={e => {
                  setX({ ...X, px: e.target.value });
                  setErr('');
                }} />
            </label>
            <label className={s.field}>
              Exit date
              <input className={s.input} type="date" value={X.d} onChange={e => setX({ ...X, d: e.target.value })} />
            </label>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className={s.label}>Followed plan?</span>
            <Options label="Followed plan" items={['Yes', 'Partly', 'No'] as const} value={X.fp} onChange={fp => setX({ ...X, fp })} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className={s.label}>Rating (process, not outcome)</span>
            <Options label="Rating" round items={[1, 2, 3, 4, 5] as const} value={X.rt as 1} onChange={rt => setX({ ...X, rt })} />
          </div>
          <label className={s.field}>
            Lesson
            <textarea className={s.input} rows={3} value={X.ls} onChange={e => setX({ ...X, ls: e.target.value })} />
          </label>
        </div>
      )}

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
          {editing ? 'Save changes' : 'Save entry'}
        </button>
        <button type="button" className={s.btnGhost} onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
