import s from '../../styles/ui.module.css';
import { Options } from '../../components/ui';
import { MISTAKES, SETUPS } from '../../lib/perps';
import type { FollowedPlan } from './model';

/** A trade's review, the same for typed-in entries and Hyperliquid trades. */
export type ReviewDraft = { followed: FollowedPlan | ''; rating: number; setup: string; mistakes: string[]; note: string };

export const emptyReview = (): ReviewDraft => ({ followed: '', rating: 0, setup: '', mistakes: [], note: '' });

/** Followed plan, rating, setup, mistakes and a note: one form wherever a trade is reviewed. */
export function ReviewFields({ value: v, onChange, noteLabel = 'Lesson' }: { value: ReviewDraft; onChange: (v: ReviewDraft) => void; noteLabel?: string }) {
  const set = (patch: Partial<ReviewDraft>) => onChange({ ...v, ...patch });
  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className={s.label}>Followed plan?</span>
        <Options<FollowedPlan>
          label="Followed plan"
          items={['Yes', 'Partly', 'No'] as const}
          value={v.followed as FollowedPlan}
          onChange={followed => set({ followed: v.followed === followed ? '' : followed })}
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className={s.label}>Rating (process, not outcome)</span>
        <Options label="Rating" round items={[1, 2, 3, 4, 5] as const} value={v.rating as 1 | 2 | 3 | 4 | 5} onChange={rating => set({ rating: v.rating === rating ? 0 : rating })} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className={s.label}>Setup</span>
        <div className={s.pills} role="group" aria-label="Setup">
          {SETUPS.map(x => (
            <button key={x} type="button" className={v.setup === x ? s.optOn : s.opt} aria-pressed={v.setup === x} onClick={() => set({ setup: v.setup === x ? '' : x })}>
              {x}
            </button>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className={s.label}>Mistakes</span>
        <div className={s.pills} role="group" aria-label="Mistakes">
          {MISTAKES.map(x => {
            const on = v.mistakes.includes(x);
            return (
              <button key={x} type="button" className={on ? s.optOn : s.opt} aria-pressed={on} onClick={() => set({ mistakes: on ? v.mistakes.filter(m => m !== x) : [...v.mistakes, x] })}>
                {x}
              </button>
            );
          })}
        </div>
      </div>
      <label className={s.field}>
        {noteLabel}
        <textarea className={s.input} rows={3} value={v.note} onChange={e => set({ note: e.target.value })} placeholder="What would you repeat or change next time?" />
      </label>
    </>
  );
}
