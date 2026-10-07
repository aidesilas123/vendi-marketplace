"use client";

// src/shared/PullToRefresh/PullToRefresh.tsx
//
// A scroll container that gives any page:
//   • rubber-band overscroll at the top AND bottom (works with or without onRefresh)
//   • pull-to-refresh: the WHOLE page follows the finger down, the PullSpinner is revealed
//     behind it, and when the refresh finishes the page eases gently back up
//
// Usage:
//   const ptr = useRef<PullToRefreshHandle>(null);
//   <PullToRefresh ref={ptr} onRefresh={() => mutate()} className="h-[100dvh]">
//     ...page content...
//   </PullToRefresh>
//   ptr.current?.refresh();   // run the same animated refresh from a button
//
// IMPORTANT: while the page is displaced it has a CSS transform, so `position: fixed`
// elements rendered INSIDE it would be positioned relative to it. Render modals, sheets and
// full-screen pages as siblings of <PullToRefresh>, not children.

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
  /** Plays the pull animation + spinner and runs onRefresh. */
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
  /** Must be opaque: it hides the spinner until the page is pulled down. */
  bgClassName?: string;
  /** Resting offset (px) needed before releasing triggers a refresh. */
  threshold?: number;
};

const HOLD = 64; // where the page rests while refreshing
const RUBBER_DIM = 600; // larger = stretches further before it feels tight
const RESISTANCE = 0.8; // larger = follows the finger more closely
const MIN_SPIN_MS = 700; // keeps the spinner from flashing on fast refreshes
const SETTLE_MS = 520; // slide-back duration (matches SPRING below)
const SPRING = `transform ${SETTLE_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;

// iOS-style rubber band: the further you pull, the harder it resists.
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
  },
  ref
) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const offsetRef = useRef(0);
  const refreshingRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  const thresholdRef = useRef(threshold);

  useEffect(() => {
    onRefreshRef.current = onRefresh;
    thresholdRef.current = threshold;
  }, [onRefresh, threshold]);

  const applyOffset = useCallback((value: number) => {
    offsetRef.current = value;
    setOffset(value);
  }, []);

  const runRefresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    setDragging(false);
    applyOffset(HOLD);

    try {
      await Promise.all([
        Promise.resolve(onRefreshRef.current?.()),
        new Promise((resolve) => setTimeout(resolve, MIN_SPIN_MS)),
      ]);
    } catch {
      // The caller surfaces its own errors (toast). We only need to slide back.
    }

    applyOffset(0); // gentle slide back
    setTimeout(() => {
      refreshingRef.current = false;
      setRefreshing(false);
    }, SETTLE_MS);
  }, [applyOffset]);

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
    let anchorY = 0; // finger position where the rubber band engaged
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
          horizontal = true; // let horizontal swipes (carousels, etc.) alone
          return;
        }
        const step = y - lastY;
        if (step > 0 && atTop()) {
          mode = 'top';
          anchorY = lastY;
        } else if (step < 0 && atBottom()) {
          mode = 'bottom';
          anchorY = lastY;
        }
      }

      if (mode === 'top') {
        const distance = y - anchorY;
        if (distance <= 0) {
          // finger went back above where it engaged → hand control back to normal scrolling
          applyOffset(0);
          setDragging(false);
          mode = 'idle';
        } else {
          if (e.cancelable) e.preventDefault();
          setDragging(true);
          const next = rubber(distance);
          applyOffset(next);
          const isPast = next >= thresholdRef.current && !!onRefreshRef.current;
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
          applyOffset(0);
          setDragging(false);
          mode = 'idle';
        } else {
          if (e.cancelable) e.preventDefault();
          setDragging(true);
          applyOffset(-rubber(distance));
        }
      }

      lastY = y;
    };

    const onEnd = () => {
      const wasMode = mode;
      mode = 'idle';
      if (refreshingRef.current) return;

      if (
        wasMode === 'top' &&
        onRefreshRef.current &&
        offsetRef.current >= thresholdRef.current
      ) {
        void runRefresh();
        return;
      }
      if (offsetRef.current !== 0) {
        setDragging(false);
        applyOffset(0); // springs back
      } else {
        setDragging(false);
      }
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
  }, [applyOffset, runRefresh]);

  const pulledDown = offset > 0;
  const progress = Math.min(1, offset / threshold);

  return (
    <div className={`relative overflow-hidden ${bgClassName} ${className}`}>
      {/* Spinner sits behind the page and is revealed as the page is pulled down */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 flex justify-center"
        style={{
          paddingTop: 18,
          opacity: pulledDown ? Math.min(1, offset / 36) : 0,
          transition: dragging ? 'none' : 'opacity 300ms ease-out',
        }}
      >
        <PullSpinner progress={progress} spinning={refreshing} />
      </div>

      <div
        ref={scrollerRef}
        className={`h-full overflow-y-auto ${bgClassName} ${contentClassName}`}
        style={{
          // `none` at rest so position:fixed descendants (if any) behave normally
          transform: offset !== 0 ? `translate3d(0, ${offset}px, 0)` : 'none',
          transition: dragging ? 'none' : SPRING,
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