import { reducedMotion } from '../components/Delight';

export type HapticKind = 'tick' | 'tap' | 'success' | 'warn';

const PATTERNS: Record<HapticKind, number | number[]> = {
  tick: 8,
  tap: 12,
  success: [12, 38, 18],
  warn: [16, 28, 12],
};

/**
 * Subtle tactile haptic pulse on mobile browsers that support the Vibration API.
 * Silently skipped on desktop, in Quiet mode, or when reduced motion is preferred.
 */
export function haptic(kind: HapticKind = 'tap', quiet = false) {
  if (quiet || reducedMotion()) return;
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(PATTERNS[kind]);
  } catch {
    /* ignore unsupported environments */
  }
}
