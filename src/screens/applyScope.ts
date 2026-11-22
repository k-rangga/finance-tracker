import { useState } from 'react';

const KEY = 'moneyTracker.recatAll';

/** "This one" (false) or "All <merchant>" (true) for a category change; your last choice, remembered on this device. */
export function useApplyAll() {
  const [all, setAll] = useState(() => {
    try {
      return localStorage.getItem(KEY) !== '0';
    } catch {
      return true;
    }
  });
  const pick = (v: boolean) => {
    setAll(v);
    try {
      localStorage.setItem(KEY, v ? '1' : '0');
    } catch {
      /* fine without */
    }
  };
  return [all, pick] as const;
}
