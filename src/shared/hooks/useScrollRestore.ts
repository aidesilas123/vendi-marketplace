"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

/**
 * Remembers how far down a page the user was, and puts them back there when they return.
 *
 *  - Call `saveScroll()` right before you navigate away (Buy Now, seller profile, a product card…).
 *  - When the page is shown again for the same `key`, the hook restores that position
 *    ONLY if the user came back (browser/Android back, router.back()).
 *  - A fresh visit, or a swap to a different listing, starts at the top.
 *
 * Positions live in memory, so nothing is written to disk and nothing survives an app restart.
 */

type ElRef = { readonly current: HTMLElement | null };

const BACK_WINDOW_MS = 2500; // a popstate this recent means the current page was reached by going back
const MAX_FRAMES = 60;       // ~1s of retries while late content gives the page its height back
const MAX_ENTRIES = 40;

const positions = new Map<string, number>();
let lastPopAt = 0;

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => { lastPopAt = Date.now(); });
}

const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

// The element that actually scrolls: the nearest scrollable ancestor, or the document.
function findScroller(from: HTMLElement | null): HTMLElement {
  let node = from?.parentElement ?? null;
  while (node && node !== document.body && node !== document.documentElement) {
    const oy = getComputedStyle(node).overflowY;
    if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return (document.scrollingElement ?? document.documentElement) as HTMLElement;
}

// 'instant' ignores any `scroll-behavior: smooth` set in CSS, so we never animate from the top.
const jumpTo = (el: HTMLElement, top: number) => el.scrollTo({ top, behavior: 'instant' as ScrollBehavior });

/**
 * @param ref   any element inside the page (used to find the scrolling container)
 * @param key   identifies the page state, e.g. the listing id (null = nothing to restore yet)
 * @param ready true once the real content is rendered, so the page is tall enough to scroll back
 */
export function useScrollRestore(ref: ElRef, key: string | null, ready: boolean) {
  const plan = useRef<{ key: string; target: number; done: boolean } | null>(null);

  const saveScroll = useCallback(() => {
    if (!key) return;
    positions.delete(key); // re-insert so the newest entries survive the size cap
    positions.set(key, findScroller(ref.current).scrollTop);
    if (positions.size > MAX_ENTRIES) positions.delete(positions.keys().next().value as string);
  }, [key, ref]);

  useIsoLayoutEffect(() => {
    if (!key || !ready) return;

    // Decide once per key whether this is a return trip. Kept in a ref so React StrictMode's
    // double-invoked effects don't consume the saved position twice.
    if (plan.current?.key !== key) {
      const cameBack = Date.now() - lastPopAt < BACK_WINDOW_MS;
      const saved = positions.get(key);
      positions.delete(key);
      lastPopAt = 0;
      plan.current = { key, target: cameBack && saved !== undefined ? saved : 0, done: false };
    }

    const p = plan.current;
    if (p.done) return;

    let frame = 0;
    let raf = 0;
    const userEvents = ['touchstart', 'wheel', 'mousedown', 'keydown'] as const;

    const stop = () => {
      cancelAnimationFrame(raf);
      userEvents.forEach((e) => window.removeEventListener(e, finish));
    };
    // The user took over the scroll, or we landed: stop fighting.
    function finish() { p.done = true; stop(); }

    const tick = () => {
      const scroller = findScroller(ref.current);
      const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      jumpTo(scroller, Math.min(p.target, max));
      frame += 1;
      const landed = Math.abs(scroller.scrollTop - p.target) < 2;
      // Keep re-applying for a few frames: Next/the browser can scroll after our first jump.
      if ((landed && frame >= 3) || frame >= MAX_FRAMES) { finish(); return; }
      raf = requestAnimationFrame(tick);
    };

    userEvents.forEach((e) => window.addEventListener(e, finish, { passive: true }));
    tick(); // runs before paint, so there is no flash at the top
    return stop;
  }, [key, ready, ref]);

  return { saveScroll };
}