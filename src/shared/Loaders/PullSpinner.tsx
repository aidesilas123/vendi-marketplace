"use client";

import React from 'react';

interface PullSpinnerProps {
  progress?: number;      // 0 to 1, how far the user has pulled
  spinning?: boolean;     // true while refreshing
  size?: number;
}

const TICKS = 12;

export const PullSpinner = ({ progress = 1, spinning = false, size = 28 }: PullSpinnerProps) => {
  const visibleTicks = spinning ? TICKS : Math.round(progress * TICKS);

  return (
    <>
      <style>{`
        @keyframes vendi-tick-spin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) {
          .vendi-pull-spinner-spin { animation-duration: 2s !important; }
        }
      `}</style>
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        className={spinning ? 'vendi-pull-spinner-spin' : ''}
        style={spinning ? { animation: 'vendi-tick-spin 0.9s steps(12) infinite' } : undefined}
        aria-label="Refreshing"
      >
        {Array.from({ length: TICKS }).map((_, i) => {
          const angle = (i * 360) / TICKS;
          // trailing fade so the spin reads as motion
          const opacity = spinning ? 0.25 + (i / TICKS) * 0.75 : i < visibleTicks ? 1 : 0.15;
          return (
            <line
              key={i}
              x1="16" y1="3.5" x2="16" y2="9"
              stroke="#f97316"
              strokeWidth="3"
              strokeLinecap="round"
              opacity={opacity}
              transform={`rotate(${angle} 16 16)`}
            />
          );
        })}
      </svg>
    </>
  );
};