"use client";

// src/shared/PullToRefresh/PullToRefresh.tsx
//
// Pull-to-refresh where ONLY the spinner moves:
//   • dragging a finger down at the top of the page pulls a round spinner badge down from the top
//     edge. The page itself never moves.
//   • release past the threshold → the badge rests near the top and spins while onRefresh runs
//   • when the refresh finishes the badge slides smoothly back up and out of sight
//   • (optional) a small elastic bounce at the very bottom of the page
//
// Usage:
//   const ptr = useRef<PullToRefreshHandle>(null);
//   <PullToRefresh ref={ptr} onRefresh={() => mutate()} className="h-[100dvh]">...</PullToRefresh>
//   ptr.current?.refresh();   // plays the same spinner animation from code
//
// Render modals / sheets / full-screen pages as siblings of <PullToRefresh>, not children.

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { PullSpinner } from '@/shared/Loaders/PullSpinner';

export type PullToRefreshHandle = {
  /** Plays the spinner animation and runs onRefresh. */
  refresh: () => Promise<void>;
  scrollToTop: () => void;
};

type Props = {
  onRefresh?: () => Promise<unknown> | unknown;
  children: React.ReactNode;
  /** Sizing of the outer box, e.g. "h-[100dvh]" or "flex-1 min-h-0". Needs a real height. */
  className?: string;
  /** Extra classes for the scrolling element (text colour, etc.). */
  contentClassName?: string;
  /** Background of the page. Keep it opaque. */
  bgClassName?: string;
  /** How far (px) the spinner must be pulled before releasing triggers a refresh. */
  threshold?: number;
  /** Small elastic bounce when you drag past the bottom of the page. Default true. */
  bottomBounce?: boolean;
};

const BADGE = 44; // spinner badge size (px)
const HIDDEN_Y = -(BADGE + 16); // badge position when fully hidden above the page
const HOLD = 76; // pull distance where the badge rests while refreshing
const MAX_PULL = 130; // the badge never travels further than this
const RUBBER_DIM = 600;
const RESISTANCE = 1; // larger = badge follows the finger more closely
const MIN_SPIN_MS = 700; // keeps the spinner from flashing on fast refreshes
const SETTLE_MS = 450; // slide-away duration
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

// The further you pull, the harder it resists.
const rubber = (distance: number) =>
  (1 - 1 / ((distance * RESISTANCE) / RUBBER_DIM + 1)) * RUBBER_DIM;

export const PullToRefresh = forwardRef<PullToRefreshHandle, Props>(function PullToRefresh(
  {
    onRefresh,
    children,
    className = '',
    contentClassName = '',
    bgClassName = 'bg-gray-50 dark:bg-[#0b1120]',
    threshold = HOLD,
    bottomBounce = true,
  },
  ref
) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [pull, setPull] = useState(0); // spinner travel (px)
  const [bounce, setBounce] = useState(0); // bottom elastic offset (px, negative)
  const [dragging, setDragging] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const pullRef = useRef(0);
  const bounceRef = useRef(0);
  const refreshingRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  const thresholdRef = useRef(threshold);
  const bottomBounceRef = useRef(bottomBounce);

  useEffect(() => {
    onRefreshRef.current = onRefresh;
    thresholdRef.current = threshold;
    bottomBounceRef.current = bottomBounce;
  }, [onRefresh, threshold, bottomBounce]);

  const applyPull = useCallback((value: number) => {
    pullRef.current = value;
    setPull(value);
  }, []);

  const applyBounce = useCallback((value: number) => {
    bounceRef.current = value;
    setBounce(value);
  }, []);

  const runRefresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    setDragging(false);
    applyBounce(0);
    applyPull(HOLD);

    try {
      await Promise.all([
        Promise.resolve(onRefreshRef.current?.()),
        new Promise((resolve) => setTimeout(resolve, MIN_SPIN_MS)),
      ]);
    } catch {
      // The caller shows its own errors (toast). We only need to slide away.
    }

    applyPull(0); // slides up and out
    setTimeout(() => {
      refreshingRef.current = false;
      setRefreshing(false);
    }, SETTLE_MS);
  }, [applyBounce, applyPull]);

  useImperativeHandle(
    ref,
    () => ({
      refresh: runRefresh,
      scrollToTop: () => scrollerRef.current?.scrollTo({ top: 0, behavior: 'smooth' }),
    }),
    [runRefresh]
  );

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    type Mode = 'idle' | 'top' | 'bottom';
    let mode: Mode = 'idle';
    let startX = 0;
    let startY = 0;
    let lastY = 0;
    let anchorY = 0;
    let horizontal = false;
    let crossed = false;

    const atTop = () => el.scrollTop <= 1;
    const atBottom = () => el.scrollTop + el.clientHeight >= el.scrollHeight - 1;

    const onStart = (e: TouchEvent) => {
      if (refreshingRef.current) return;
      const t = e.touches[0];
      startX = t.clientX;
      startY = lastY = t.clientY;
      mode = 'idle';
      horizontal = false;
      crossed = false;
    };

    const onMove = (e: TouchEvent) => {
      if (refreshingRef.current || horizontal) return;
      const t = e.touches[0];
      const y = t.clientY;

      if (mode === 'idle') {
        const dx = Math.abs(t.clientX - startX);
        const dy = Math.abs(y - startY);
        if (dx > 8 && dx > dy) {
          horizontal = true; // leave horizontal swipes alone
          return;
        }
        const step = y - lastY;
        if (step > 0 && atTop() && onRefreshRef.current) {
          mode = 'top';
          anchorY = lastY;
        } else if (step < 0 && atBottom() && bottomBounceRef.current) {
          mode = 'bottom';
          anchorY = lastY;
        }
      }

      if (mode === 'top') {
        const distance = y - anchorY;
        if (distance <= 0) {
          applyPull(0);
          setDragging(false);
          mode = 'idle';
        } else {
          if (e.cancelable) e.preventDefault();
          setDragging(true);
          const next = Math.min(rubber(distance), MAX_PULL);
          applyPull(next);
          const isPast = next >= thresholdRef.current;
          if (isPast && !crossed) {
            crossed = true;
            Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
          } else if (!isPast) {
            crossed = false;
          }
        }
      } else if (mode === 'bottom') {
        const distance = anchorY - y;
        if (distance <= 0) {
          applyBounce(0);
          setDragging(false);
          mode = 'idle';
        } else {
          if (e.cancelable) e.preventDefault();
          setDragging(true);
          applyBounce(-Math.min(rubber(distance), 90));
        }
      }

      lastY = y;
    };

    const onEnd = () => {
      const wasMode = mode;
      mode = 'idle';
      if (refreshingRef.current) return;

      if (wasMode === 'top' && onRefreshRef.current && pullRef.current >= thresholdRef.current) {
        void runRefresh();
        return;
      }
      setDragging(false);
      if (pullRef.current !== 0) applyPull(0);
      if (bounceRef.current !== 0) applyBounce(0);
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [applyBounce, applyPull, runRefresh]);

  const progress = Math.min(1, pull / HOLD);

  return (
    <div className={`relative overflow-hidden ${bgClassName} ${className}`}>
      {/* The spinner badge: the only thing that moves while you pull */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center"
        style={{
          transform: `translate3d(0, ${HIDDEN_Y + Math.min(pull, MAX_PULL)}px, 0)`,
          opacity: refreshing ? 1 : Math.min(1, pull / 24),
          transition: dragging ? 'none' : `transform ${SETTLE_MS}ms ${EASE}, opacity 200ms ease-out`,
        }}
      >
        <div
          className="flex items-center justify-center rounded-full bg-white shadow-lg dark:bg-[#1e293b]"
          style={{ width: BADGE, height: BADGE }}
        >
          <PullSpinner progress={progress} spinning={refreshing} />
        </div>
      </div>

      <div
        ref={scrollerRef}
        className={`h-full overflow-y-auto ${bgClassName} ${contentClassName}`}
        style={{
          // Only the bottom bounce ever moves the page. `none` at rest so fixed descendants behave.
          transform: bounce !== 0 ? `translate3d(0, ${bounce}px, 0)` : 'none',
          transition: dragging ? 'none' : `transform ${SETTLE_MS}ms ${EASE}`,
          overscrollBehaviorY: 'contain',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {children}
      </div>
    </div>
  );
});

export default PullToRefresh;