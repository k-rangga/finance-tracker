import logoUrl from '../assets/logo-cat.jpg';

/** Circular cat logo, inlined into the single-file build. Replace src/assets/logo-cat.jpg to change it. */
export function Logo({ size }: { size: number }) {
  return (
    <img
      src={logoUrl}
      alt="Personal Spending Tracker"
      width={size}
      height={size}
      style={{ flex: 'none', width: size, height: size, borderRadius: '50%', objectFit: 'cover' }}
    />
  );
}
