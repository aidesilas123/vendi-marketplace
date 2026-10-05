"use client";

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface VendiLoaderProps {
  size?: number;
  fullScreen?: boolean;
  className?: string;
  /** 'spokes' = iOS-style activity indicator, 'arc' = Android/Material-style ring */
  variant?: 'spokes' | 'arc';
  color?: string;
  label?: string;
}

const SPOKES = 12;

export const VendiLoader = ({
  size = 72,
  fullScreen = false,
  className = '',
  variant = 'spokes',
  color = '#f97316',
  label = 'Loading page',
}: VendiLoaderProps) => {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const styles = (
    <style>{`
      .vendi-loader { --vendi-dur: 0.7s; }

      @keyframes vendi-fade { from { opacity: 1; } to { opacity: 0.15; } }
      @keyframes vendi-rotate { to { transform: rotate(360deg); } }
      @keyframes vendi-dash {
        0%   { stroke-dasharray: 1 200;  stroke-dashoffset: 0; }
        50%  { stroke-dasharray: 89 200; stroke-dashoffset: -35; }
        100% { stroke-dasharray: 89 200; stroke-dashoffset: -124; }
      }

      .vendi-spoke { opacity: 0.15; animation: vendi-fade var(--vendi-dur) linear infinite; }
      .vendi-arc { animation: vendi-rotate calc(var(--vendi-dur) * 1.6) linear infinite; }
      .vendi-arc-head { animation: vendi-dash calc(var(--vendi-dur) * 1.5) ease-in-out infinite; }

      @media (prefers-reduced-motion: reduce) {
        .vendi-loader { --vendi-dur: 1.8s; }
      }
    `}</style>
  );

  const spinner =
    variant === 'spokes' ? (
      <>
        {styles}
        <svg
          width={size}
          height={size}
          viewBox="0 0 100 100"
          role="status"
          aria-label={label}
          className={`vendi-loader ${className}`}
        >
          {Array.from({ length: SPOKES }, (_, i) => (
            <rect
              key={i}
              className="vendi-spoke"
              x="46"
              y="6"
              width="8"
              height="26"
              rx="4"
              fill={color}
              transform={`rotate(${i * (360 / SPOKES)} 50 50)`}
              style={{
                animationDelay: `calc(var(--vendi-dur) * ${(-(SPOKES - i) / SPOKES).toFixed(4)})`,
              }}
            />
          ))}
        </svg>
      </>
    ) : (
      <>
        {styles}
        <svg
          width={size}
          height={size}
          viewBox="0 0 50 50"
          role="status"
          aria-label={label}
          className={`vendi-loader vendi-arc ${className}`}
        >
          <circle
            cx="25"
            cy="25"
            r="20"
            fill="none"
            stroke={color}
            strokeOpacity="0.2"
            strokeWidth="4"
          />
          <circle
            className="vendi-arc-head"
            cx="25"
            cy="25"
            r="20"
            fill="none"
            stroke={color}
            strokeWidth="4"
            strokeLinecap="round"
          />
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