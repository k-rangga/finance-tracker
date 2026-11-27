import { useEffect, useState } from 'react';

export type ViewportBox = {
  /** Live visual viewport height in px (tracks virtual keyboard on iOS/Android), or null when not active. */
  height: number | null;
  /** Live visual viewport top offset in px (prevents iOS Safari scroll drift when keyboard opens). */
  top: number;
  /** True when a mobile virtual keyboard appears to be open. */
  keyboardOpen: boolean;
};

/**
 * Tracks `window.visualViewport` so fixed full-screen overlays (Chat, Journal composer) hug the top of the
 * mobile virtual keyboard smoothly while keeping their background intact.
 */
export function useVisualViewport(enabled = true): ViewportBox {
  const [box, setBox] = useState<ViewportBox>({ height: null, top: 0, keyboardOpen: false });

  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || !window.visualViewport) return;
    const vv = window.visualViewport;
    let baseH = Math.max(window.innerHeight, vv.height);

    const update = () => {
      if (vv.height > baseH) baseH = vv.height;
      const kbOpen = baseH - vv.height > 110;
      setBox(prev => {
        const nextH = kbOpen ? Math.round(vv.height) : null;
        const nextTop = kbOpen ? Math.round(vv.offsetTop) : 0;
        if (prev.height === nextH && prev.top === nextTop && prev.keyboardOpen === kbOpen) return prev;
        return { height: nextH, top: nextTop, keyboardOpen: kbOpen };
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
