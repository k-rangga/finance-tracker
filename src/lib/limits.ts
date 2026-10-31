import { useSettings } from './settings';
import { builtInCategory } from '../data/categories';

/** A change to category limits (% of income): built-in ones are stored as overrides, yours on the category. */
export function useSetLimits() {
  const { settings, update } = useSettings();
  return (patch: Record<string, number>) => {
    const limits = { ...settings.limitOverrides };
    let customs = settings.customCategories;
    for (const [name, raw] of Object.entries(patch)) {
      // Four decimals of a percent keeps an amount you typed (Rp 3.100.000) exact, without float noise.
      const pct = Math.round(raw * 1e4) / 1e4;
      const b = builtInCategory(name);
      if (!b) customs = customs.map(c => (c.name === name ? { ...c, limitPct: pct } : c));
      // Only store what differs from the default, so defaults can still change later.
      else if (Math.abs(pct - b.limitPct) < 1e-9) delete limits[name];
      else limits[name] = pct;
    }
    update({ limitOverrides: limits, customCategories: customs });
  };
}
