import { useEffect, useRef, useState } from 'react';
import s from '../styles/ui.module.css';
import { storage } from '../lib/storage';

/** True when the device asks for less motion: count-ups, confetti and fades are skipped. */
export const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** A number that counts up to `target` when it first appears (and glides when it changes). */
export function useCountUp(target: number, ms = 700): number {
  const [value, setValue] = useState(() => (reducedMotion() ? target : 0));
  const from = useRef(value);
  useEffect(() => {
    if (reducedMotion()) return setValue(target);
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = a + (target - a) * eased;
      from.current = v;
      setValue(v);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return value;
}

const CONFETTI_COLOURS = ['#c35f3d', '#d89a2c', '#2a9d86', '#7b5cc4', '#3b74c4', '#e8c47e', '#5e9a83'];

/**
 * A short confetti burst for a win (savings target reached, cycle ending under budget), once per `id`:
 * remembered on this device so it doesn't repeat on every visit.
 */
export function Celebrate({ id, when }: { id: string; when: boolean }) {
  const key = 'moneyTracker.celebrated.' + id;
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!when || reducedMotion() || storage.getRaw(key)) return;
    storage.setRaw(key, '1');
    setShow(true);
    const t = setTimeout(() => setShow(false), 2600);
    return () => clearTimeout(t);
  }, [when, key]);
  if (!show) return null;
  return (
    <div className={s.confetti} aria-hidden="true">
      {Array.from({ length: 70 }, (_, i) => (
        <span
          key={i}
          style={{
            left: `${(i * 37) % 100}%`,
            background: CONFETTI_COLOURS[i % CONFETTI_COLOURS.length],
            animationDelay: `${(i % 10) * 0.06}s`,
            animationDuration: `${1.6 + ((i * 7) % 10) / 10}s`,
            transform: `rotate(${(i * 47) % 360}deg)`,
            width: i % 3 ? 7 : 10,
            height: i % 3 ? 12 : 7,
          }}
        />
      ))}
    </div>
  );
}
