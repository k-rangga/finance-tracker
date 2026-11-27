import { useEffect, useState } from 'react';

export type ViewportBox = {
  /** Live visual viewport height in px when keyboard is open, or null otherwise. */
  height: number | null;
  /** Live visual viewport top offset in px (prevents iOS Safari scroll drift when keyboard opens). */
  top: number;
  /** Pixels covered by the mobile virtual keyboard at the bottom of the layout viewport. */
  kbHeight: number;
  /** True when a mobile virtual keyboard appears to be open. */
  keyboardOpen: boolean;
};

/**
 * Tracks `window.visualViewport` so fixed full-screen overlays (Chat, Journal composer) keep a solid full-screen
 * background behind translucent iOS/Android keyboards while lifting only the bottom composer bar above the keypad.
 */
export function useVisualViewport(enabled = true): ViewportBox {
  const [box, setBox] = useState<ViewportBox>({ height: null, top: 0, kbHeight: 0, keyboardOpen: false });

  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || !window.visualViewport) return;
    const vv = window.visualViewport;
    let baseH = Math.max(window.innerHeight, vv.height);

    const update = () => {
      if (vv.height > baseH) baseH = vv.height;
      const kbOpen = baseH - vv.height > 110;
      const nextTop = kbOpen ? Math.max(0, Math.round(vv.offsetTop)) : 0;
      const nextKb = kbOpen ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0;
      const nextH = kbOpen ? Math.round(vv.height) : null;
      setBox(prev => {
        if (prev.height === nextH && prev.top === nextTop && prev.kbHeight === nextKb && prev.keyboardOpen === kbOpen) return prev;
        return { height: nextH, top: nextTop, kbHeight: nextKb, keyboardOpen: kbOpen };
      });
    };

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [enabled]);

  return box;
}
