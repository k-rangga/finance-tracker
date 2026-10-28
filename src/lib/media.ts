import { useEffect, useState } from 'react';

/** Matches the CSS phone breakpoint (max-width: 759px). */
const PHONE = '(max-width: 759px)';

/** True on phone-width screens; updates when the window is resized or rotated. */
export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(PHONE).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(PHONE);
    if (!mq) return;
    const on = () => setPhone(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return phone;
}
