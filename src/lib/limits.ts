import { useSettings } from './settings';
import { builtInCategory, categoryByName } from '../data/categories';
import { currentCycleKey } from './cyclePlans';

/** A change to category limits (% of income): built-in ones are stored as overrides, yours on the category. */
export function useSetLimits() {
  const { settings, update } = useSettings();
  return (patch: Record<string, number>) => {
    const limits = { ...settings.limitOverrides };
    let customs = settings.customCategories;
    // A category this cycle plans differently (set up as "next cycle"): the change goes to this cycle's plan.
    const key = currentCycleKey();
    const plan = settings.cyclePlans?.[key];
    const cycleLimits = { ...(plan?.limits ?? {}) };
    for (const [name, raw] of Object.entries(patch)) {
      if (name in cycleLimits) {
        cycleLimits[name] = Math.round(raw * 1e8) / 1e8;
        continue;
      }
      // Four decimals of a percent keeps an amount you typed (Rp 3.100.000) exact, without float noise.
      const pct = Math.round(raw * 1e4) / 1e4;
      const b = builtInCategory(name);
      // Installments' plan follows the schedule; it has no limit of its own to set.
      if (b?.auto) continue;
      if (!b) customs = customs.map(c => (c.name === name ? { ...c, limitPct: pct } : c));
      // Only store what differs from the default, so defaults can still change later.
      else if (Math.abs(pct - (categoryByName(name)?.defaultLimitPct ?? b.limitPct)) < 1e-9) delete limits[name];
      else limits[name] = pct;
    }
    update({
      limitOverrides: limits,
      customCategories: customs,
      ...(plan ? { cyclePlans: { ...settings.cyclePlans, [key]: { ...plan, limits: cycleLimits } } } : {}),
    });
  };
}
