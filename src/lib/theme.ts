import { storage } from './storage';

/** Light, dark, or follow the device. Kept per device, like the sidebar and last tab. */
export type Theme = 'auto' | 'light' | 'dark';

const KEY = 'moneyTracker.theme';

export const getTheme = (): Theme => {
  const t = storage.getRaw(KEY);
  return t === 'light' || t === 'dark' ? t : 'auto';
};

/** Sets `data-theme` on <html>; global.css picks the palette from it (none = follow the device). */
export function applyTheme(t: Theme) {
  storage.setRaw(KEY, t);
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}
