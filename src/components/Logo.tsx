import { useState } from 'react';

/** Circular cat logo. Uses assets/logo-cat.png when present, else the bundled SVG placeholder. */
export function Logo({ size }: { size: number }) {
  const [src, setSrc] = useState('/assets/logo-cat.png');
  return (
    <img
      src={src}
      onError={() => setSrc('/assets/logo-cat.svg')}
      alt="Personal Spending Tracker"
      width={size}
      height={size}
      style={{ flex: 'none', width: size, height: size, borderRadius: '50%', objectFit: 'cover' }}
    />
  );
}
