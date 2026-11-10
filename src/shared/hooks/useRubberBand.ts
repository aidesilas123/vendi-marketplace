"use client";

// src/shared/hooks/useRubberBand.ts
//
// Rubber-band bounce for Android WebView, which has no native overscroll bounce
// (and globals.css sets overscroll-behavior: none, which also removes the glow).
//
// Usage:
//   const bounceRef = useRef<HTMLDivElement>(null);
//   useRubberBand(bounceRef);
//   return <div> ...modals / fixed bars... <div ref={bounceRef}> page content </div> </div>
//
// Rules:
//  - Put the ref on a wrapper around the page CONTENT only. Keep `position: fixed`
//    things (bottom bars, modals, spinners) OUTSIDE it, because a transformed parent
//    turns `fixed` into "fixed relative to the parent".
//  - `scrollerId` is the element that actually scrolls. Pages inside the app shell use
//    the default, 'main-scroll-container'. A page with its own scroller passes its id.
//  - `ready` is for pages that return early (loading / not-found) before the wrapper
//    exists. Pass false until the wrapper is rendered so the listeners attach later.
//
// Perf: the touchmove handler must NEVER read layout (scrollTop / scrollHeight /
// clientHeight). A read forces a synchronous layout whenever the DOM is dirty —
// images landing, live updates — so every touchmove frame paid a layout and the
// fling died instead of gliding. Edge state is cached and refreshed only from the
// scroller's `scroll` event (layout is already clean there), a ResizeObserver, and
// once per gesture on touchstart. onMove reads plain variables only.

import { useEffect, RefObject } from 'react';

type Options = {
  scrollerId?: string;
  /** Bounce when pulled down at the very top. Turn off where pull-to-refresh owns that edge. */
  top?: boolean;
  /** Bounce when pulled up at the very bottom. */
  bottom?: boolean;
  ready?: boolean;
};

const MAX_PULL_PX = 80;
const RESISTANCE = 0.35;
const AXIS_LOCK_PX = 8;

export function useRubberBand(
  contentRef: RefObject<HTMLElement | null>,
  { scrollerId = 'main-scroll-container', top = true, bottom = true, ready = true }: Options = {}
) {
  useEffect(() => {
    if (!ready) return;
    const content = contentRef.current;
    const scroller = document.getElementById(scrollerId);
    if (!content || !scroller) return;

    let tracking = false;
    let startX = 0;
    let startY = 0;
    let axis: 'x' | 'y' | null = null;
    let edge: 1 | -1 | 0 = 0; // 1 = pulling down at the top, -1 = pulling up at the bottom

    // Cached edge state — the ONLY layout reads live here, refreshed from
    // scroll/resize (layout already clean) and once per gesture.
    let scrollable = false;
    let atTop = true;
    let atBottom = false;

    const refreshEdge = () => {
      scrollable = scroller.scrollHeight > scroller.clientHeight + 1;
      atTop = scroller.scrollTop <= 0;
      atBottom = scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 1;
    };
    refreshEdge();

    const onScroll = () => refreshEdge();
    scroller.addEventListener('scroll', onScroll, { passive: true });

    const ro = new ResizeObserver(refreshEdge);
    ro.observe(scroller);
    ro.observe(content);

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      refreshEdge();
      if (!scrollable) return;
      // If the touch starts inside a nested scroller (a page with its own
      // scroll container, e.g. the transactions list or a PullToRefresh
      // body), that scroller owns the gesture — otherwise the page would
      // bounce twice, once per scroller.
      let el: HTMLElement | null = e.target as HTMLElement;
      while (el && el !== scroller) {
        if (el.scrollHeight > el.clientHeight + 1) return;
        el = el.parentElement;
      }
      tracking = true;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      axis = null;
      edge = 0;
      content.style.transition = 'none';
    };

    const onMove = (e: TouchEvent) => {
      if (!tracking) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;

      // Decide horizontal vs vertical once, so tab swipes and carousels are left alone
      if (!axis) {
        if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
        axis = Math.abs(dy) > Math.abs(dx) ? 'y' : 'x';
      }
      if (axis !== 'y') return;

      if (edge === 0) {
        if (!scrollable) return;
        if (top && dy > 0 && atTop) edge = 1;
        else if (bottom && dy < 0 && atBottom) edge = -1;
        else return;
        startY = t.clientY; // measure the pull from the moment the edge was reached
        return;
      }

      const pull = (t.clientY - startY) * edge;
      if (pull <= 0) {
        content.style.transform = '';
        edge = 0;
        return;
      }
      content.style.transform = `translate3d(0, ${edge * Math.min(pull * RESISTANCE, MAX_PULL_PX)}px, 0)`;
    };

    const release = () => {
      tracking = false;
      if (!edge) return;
      content.style.transition = 'transform 0.45s cubic-bezier(0.22, 1, 0.36, 1)';
      content.style.transform = '';
      edge = 0;
    };

    scroller.addEventListener('touchstart', onStart, { passive: true });
    scroller.addEventListener('touchmove', onMove, { passive: true });
    scroller.addEventListener('touchend', release);
    scroller.addEventListener('touchcancel', release);

    return () => {
      scroller.removeEventListener('scroll', onScroll);
      scroller.removeEventListener('touchstart', onStart);
      scroller.removeEventListener('touchmove', onMove);
      scroller.removeEventListener('touchend', release);
      scroller.removeEventListener('touchcancel', release);
      ro.disconnect();
      content.style.transition = '';
      content.style.transform = '';
    };
  }, [contentRef, scrollerId, top, bottom, ready]);
}
