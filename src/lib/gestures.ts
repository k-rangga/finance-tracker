import { useRef, useState, type TouchEvent } from 'react';

/** Phones only: the desktop layout has its own navigation and no pull-to-refresh. */
const isPhone = () => typeof window !== 'undefined' && window.innerWidth < 760;

/** Swipes and pulls inside these are theirs (typing, dialogs, the date calendar, charts you drag over). */
const OWN_GESTURES = 'input, textarea, select, [role=dialog], [role=menu], [data-own-gestures]';

/** How far down you pull (px) before letting go syncs. */
export const PULL_TO_SYNC = 90;

/**
 * Touch handlers for the page: a sideways swipe moves to the next or previous tab, and pulling down from the
 * very top syncs Gmail. `pull` is how far you're pulling, for the indicator.
 */
export function usePageGestures({ onSwipe, onPull }: { onSwipe: (dir: 1 | -1) => void; onPull: () => void }) {
  const start = useRef<{ x: number; y: number; t: number; top: boolean } | null>(null);
  const [pull, setPull] = useState(0);

  const onTouchStart = (e: TouchEvent) => {
    if (!isPhone() || e.touches.length !== 1 || (e.target as Element).closest(OWN_GESTURES)) return void (start.current = null);
    const p = e.touches[0];
    start.current = { x: p.clientX, y: p.clientY, t: Date.now(), top: window.scrollY <= 0 };
  };
  const onTouchMove = (e: TouchEvent) => {
    const s = start.current;
    if (!s || !s.top) return;
    const dy = e.touches[0].clientY - s.y;
    const dx = e.touches[0].clientX - s.x;
    // Only a mostly-vertical pull counts, so a sideways swipe never starts a sync.
    setPull(dy > 0 && dy > Math.abs(dx) * 1.5 ? dy : 0);
  };
  const onTouchEnd = (e: TouchEvent) => {
    const s = start.current;
    start.current = null;
    const pulled = pull;
    setPull(0);
    if (!s) return;
    if (pulled >= PULL_TO_SYNC) return onPull();
    const p = e.changedTouches[0];
    const dx = p.clientX - s.x;
    const dy = p.clientY - s.y;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6 && Date.now() - s.t < 600) onSwipe(dx < 0 ? 1 : -1);
  };
  return { pull, handlers: { onTouchStart, onTouchMove, onTouchEnd } };
}
