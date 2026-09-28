"use client";

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface VendiLoaderProps {
  size?: number;
  fullScreen?: boolean;
  className?: string;
}

export const VendiLoader = ({ size = 72, fullScreen = false, className = '' }: VendiLoaderProps) => {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const stroke = Math.max(3, Math.round(size * 0.08));
  const dotR = stroke * 0.95;
  const c = size / 2;
  const r = c - dotR - 1;
  const dots = [0, 120, 240];

  const spinner = (
    <>
      <style>{`
        @keyframes vendi-orbit { to { transform: rotate(360deg); } }
      `}</style>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="status"
        aria-label="Loading page"
        className={className}
        style={{ animation: 'vendi-orbit 1s linear infinite' }}
      >
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke="#f97316"
          strokeOpacity="0.22"
          strokeWidth={stroke}
        />
        {dots.map((deg, i) => {
          const rad = (deg * Math.PI) / 180;
          return (
            <circle
              key={deg}
              cx={c + r * Math.sin(rad)}
              cy={c - r * Math.cos(rad)}
              r={dotR}
              fill="#f97316"
              opacity={1 - i * 0.3}
            />
          );
        })}
      </svg>
    </>
  );

  if (fullScreen) {
    if (!mounted) return null;
    return createPortal(
      <div className="fixed inset-0 z-[45] flex items-center justify-center pointer-events-none">
        {spinner}
      </div>,
      document.body
    );
  }

  return spinner;
};

export default VendiLoader;