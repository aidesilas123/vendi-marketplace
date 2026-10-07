import React, { useId } from 'react';

interface BadgeProps {
  isVerified: boolean;
  className?: string;
  size?: number; // badge size in pixels
}

// Build the scalloped "seal" outline once (12 lobes)
const LOBES = 12;
const STEPS = 144;
const sealPath = (() => {
  const pts: string[] = [];
  for (let i = 0; i <= STEPS; i++) {
    const t = (i / STEPS) * Math.PI * 2;
    const r = 42 + 5 * Math.cos(LOBES * t);
    const x = 50 + r * Math.cos(t);
    const y = 50 + r * Math.sin(t);
    pts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return pts.join(' ') + ' Z';
})();

export const Badge = ({ isVerified, className = "", size = 16 }: BadgeProps) => {
  const gradId = useId();

  if (!isVerified) return null;

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center ${className}`}
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 100 100"
        width={size}
        height={size}
        aria-label="Verified"
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3FA9FF" />
            <stop offset="100%" stopColor="#0A6CE8" />
          </linearGradient>
        </defs>
        <path d={sealPath} fill={`url(#${gradId})`} />
        <path
          d="M30 52 L44 66 L71 36"
          fill="none"
          stroke="#fff"
          strokeWidth="9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
};