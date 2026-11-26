import { useEffect, useRef, useState } from 'react';
import s from '../../styles/ui.module.css';
import { MISTAKES, SETUPS } from '../../lib/perps';
import { C } from '../../lib/tokens';
import type { FollowedPlan } from './model';

/**
 * A trade's review, the same for typed-in entries and Hyperliquid trades. `rating` is kept from older reviews but no
 * longer asked: followed plan says the same thing more plainly.
 */
export type ReviewDraft = { followed: FollowedPlan | ''; rating: number; setup: string; mistakes: string[]; note: string };

export const emptyReview = (): ReviewDraft => ({ followed: '', rating: 0, setup: '', mistakes: [], note: '' });

/** The setups and mistakes shown before "+ more": the ones most reviews use. */
const FIRST_SETUPS = 4;
const FIRST_MISTAKES = 4;

/** Followed plan, tags (setup, then mistakes) and a one-line lesson: three compact rows. */
export function ReviewFields({ value: v, onChange }: { value: ReviewDraft; onChange: (v: ReviewDraft) => void }) {
  const set = (patch: Partial<ReviewDraft>) => onChange({ ...v, ...patch });
  // Show every tag when one past the first few is already picked.
  const [more, setMore] = useState(() => SETUPS.indexOf(v.setup) >= FIRST_SETUPS || v.mistakes.some(m => MISTAKES.indexOf(m) >= FIRST_MISTAKES));
  const setups = more ? SETUPS : SETUPS.slice(0, FIRST_SETUPS);
  const mistakes = more ? MISTAKES : MISTAKES.slice(0, FIRST_MISTAKES);
  const note = useRef<HTMLTextAreaElement>(null);
  // The lesson box grows with what's typed, from one line.
  useEffect(() => {
    const el = note.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 2 + 'px';
  }, [v.note]);

  return (
    <div className={s.reviewForm}>
      <div className={s.reviewRow}>
        <span className={s.reviewLabel}>Followed plan?</span>
        <div className={s.segment} role="group" aria-label="Followed plan">
          {(['Yes', 'Partly', 'No'] as const).map(x => (
            <button key={x} type="button" aria-pressed={v.followed === x} onClick={() => set({ followed: v.followed === x ? '' : x })}>
              {x}
            </button>
          ))}
        </div>
      </div>
      <div className={s.reviewRow}>
        <span className={s.reviewLabel}>Tags</span>
        <div className={s.tagRow} role="group" aria-label="Setup and mistakes">
          {setups.map(x => (
            <button key={x} type="button" className={s.tag} aria-pressed={v.setup === x} onClick={() => set({ setup: v.setup === x ? '' : x })}>
              {x}
            </button>
          ))}
          <span className={s.tagDivider} aria-hidden="true" />
          {mistakes.map(x => {
            const on = v.mistakes.includes(x);
            return (
              <button
                key={x}
                type="button"
                className={s.tag}
                data-mistake
                aria-pressed={on}
                onClick={() => set({ mistakes: on ? v.mistakes.filter(m => m !== x) : [...v.mistakes, x] })}
              >
                {x}
              </button>
            );
          })}
          <button type="button" className={s.tagMore} onClick={() => setMore(!more)} aria-expanded={more}>
            {more ? 'Fewer' : '+ more'}
          </button>
        </div>
      </div>
      <div className={s.reviewRow}>
        <span className={s.reviewLabel}>Lesson</span>
        <textarea
          ref={note}
          className={s.input}
          rows={1}
          value={v.note}
          onChange={e => set({ note: e.target.value })}
          placeholder="One line: what you'd repeat or change"
          style={{ resize: 'none', minHeight: 40, padding: '9px 12px', flex: 1 }}
        />
      </div>
    </div>
  );
}

/**
 * Saves a review as you go: taps at once, typing after a short pause. Shows "Saving…" / "Saved ✓".
 * `save` gets the draft; give the component a `key` per trade so another trade starts fresh.
 */
export function useAutosave(initial: ReviewDraft, save: (d: ReviewDraft) => void) {
  const [draft, setDraft] = useState(initial);
  const [state, setState] = useState<'' | 'saving' | 'saved'>('');
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const last = useRef(JSON.stringify(initial));
  const saveRef = useRef(save);
  saveRef.current = save;
  const pending = useRef<ReviewDraft | null>(null);
  const flush = () => {
    const d = pending.current;
    pending.current = null;
    if (!d) return;
    const json = JSON.stringify(d);
    if (json !== last.current) {
      last.current = json;
      saveRef.current(d);
    }
  };
  const change = (d: ReviewDraft) => {
    const typing = d.note !== draft.note;
    setDraft(d);
    pending.current = d;
    clearTimeout(timer.current);
    setState('saving');
    timer.current = setTimeout(
      () => {
        flush();
        setState('saved');
      },
      typing ? 700 : 0,
    );
  };
  // Closing the trade (or moving on) before the pause ends still saves what was typed.
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      flush();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const label = state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : '';
  return { draft, change, label };
}

export const SavedLabel = ({ label }: { label: string }) => (label ? <span style={{ fontSize: 12, color: label === 'Saved' ? C.good : C.textMuted }}>{label}</span> : null);
