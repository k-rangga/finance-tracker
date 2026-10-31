import { useSettings } from './settings';
import { builtInCategory } from '../data/categories';

/** A change to category limits (% of income): built-in ones are stored as overrides, yours on the category. */
export function useSetLimits() {
  const { settings, update } = useSettings();
  return (patch: Record<string, number>) => {
    const limits = { ...settings.limitOverrides };
    let customs = settings.customCategories;
    for (const [name, raw] of Object.entries(patch)) {
      // Two decimals of a percent is finer than any amount you'd notice, and keeps the stored numbers clean.
      const pct = Math.round(raw * 100) / 100;
      const b = builtInCategory(name);
      if (!b) customs = customs.map(c => (c.name === name ? { ...c, limitPct: pct } : c));
      // Only store what differs from the default, so defaults can still change later.
      else if (Math.abs(pct - b.limitPct) < 1e-9) delete limits[name];
      else limits[name] = pct;
    }
    update({ limitOverrides: limits, customCategories: customs });
  };
}
