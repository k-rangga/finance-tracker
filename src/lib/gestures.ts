import { useRef, useState, type TouchEvent } from 'react';
import { haptic } from './haptics';

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
export function usePageGestures({ onSwipe, onPull, quiet = false }: { onSwipe: (dir: 1 | -1) => void; onPull: () => void; quiet?: boolean }) {
  const start = useRef<{ x: number; y: number; t: number; top: boolean; ticked: boolean } | null>(null);
  const [pull, setPull] = useState(0);

  const onTouchStart = (e: TouchEvent) => {
    if (!isPhone() || e.touches.length !== 1 || (e.target as Element).closest(OWN_GESTURES)) return void (start.current = null);
    const p = e.touches[0];
    start.current = { x: p.clientX, y: p.clientY, t: Date.now(), top: window.scrollY <= 0, ticked: false };
  };
  const onTouchMove = (e: TouchEvent) => {
    const s = start.current;
    if (!s || !s.top) return;
    const dy = e.touches[0].clientY - s.y;
    const dx = e.touches[0].clientX - s.x;
    // Only a mostly-vertical pull counts, so a sideways swipe never starts a sync.
    const next = dy > 0 && dy > Math.abs(dx) * 1.5 ? dy : 0;
    if (next >= PULL_TO_SYNC && !s.ticked) {
      s.ticked = true;
      haptic('tick', quiet);
    }
    setPull(next);
  };
  const onTouchEnd = (e: TouchEvent) => {
    const s = start.current;
    start.current = null;
    const pulled = pull;
    setPull(0);
    if (!s) return;
    if (pulled >= PULL_TO_SYNC) {
      haptic('tap', quiet);
      return onPull();
    }
    const p = e.changedTouches[0];
    const dx = p.clientX - s.x;
    const dy = p.clientY - s.y;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6 && Date.now() - s.t < 600) {
      haptic('tick', quiet);
      onSwipe(dx < 0 ? 1 : -1);
    }
  };
  return { pull, handlers: { onTouchStart, onTouchMove, onTouchEnd } };
}

/**
 * Drag down from the top of a mobile bottom sheet to dismiss it smoothly.
 * Only activates on phones when the sheet itself is scrolled to the top (`scrollTop <= 0`).
 */
export function useSwipeDown(onClose: () => void, threshold = 72) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const [dy, setDy] = useState(0);

  const onTouchStart = (e: TouchEvent<HTMLElement>) => {
    if (!isPhone() || e.touches.length !== 1) return void (start.current = null);
    if (e.currentTarget.scrollTop > 2) return void (start.current = null);
    const t = e.target as Element;
    if (t.closest('input, textarea, select')) return void (start.current = null);
    start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchMove = (e: TouchEvent<HTMLElement>) => {
    const s = start.current;
    if (!s) return;
    const y = e.touches[0].clientY - s.y;
    const x = e.touches[0].clientX - s.x;
    if (y <= 0 || Math.abs(x) > Math.abs(y) * 1.2) {
      if (dy > 0) setDy(0);
      return;
    }
    setDy(Math.min(220, y));
  };
  const onTouchEnd = () => {
    const pulled = dy;
    start.current = null;
    setDy(0);
    if (pulled >= threshold) {
      haptic('tick');
      onClose();
    }
  };
  const onTouchCancel = () => {
    start.current = null;
    setDy(0);
  };

  return {
    dy,
    style: dy > 0 ? { transform: `translateY(${dy}px)`, transition: 'none' } : undefined,
    handlers: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel },
  };
}
