// src/shared/Navigation/StackOverlay.tsx
"use client";

import React, { createContext, useCallback, useEffect, useState } from 'react';
import { VendiLoader } from '@/shared/VendiLoader';

/**
 * Wallet-style page stack — the transition layer.
 *
 * The wallet dashboard feels smooth because its subpages are fixed overlays
 * sliding over an intact, already-painted dashboard: nothing remounts on the
 * way back. This module gives App Router pages the same treatment, capped at
 * depth 1 (only the immediately previous page is kept):
 *
 *  - Forward: the new page mounts in main and fades in (vendi-fade-in,
 *    180ms opacity only) over a static snapshot of the previous page.
 *    The snapshot lives 300ms, then drops.
 *  - Back to a kept page: the kept page is unhidden in main (already
 *    painted, state intact) and simply appears — no overlay slides out
 *    over it. The old sliding snapshot is removed: it read as the same
 *    page sliding out on itself instead of the current page sliding out.
 *  - Back to the feed: an opaque loader holds, then fades (see below).
 *  - Anything else (back to a page that isn't kept, leaving the shell):
 *    falls back to PageTransition's plain div (no animation, never stuck).
 *
 * Stacking, all below the bottom nav (z-50) so the nav never blinks:
 *  - forward underlay: z-[5] (below the entering page's z-10 wrapper)
 * The entering page's wrapper carries `relative z-10` (see PageTransition).
 */

export type StackMode = 'stack-none' | 'stack-enter' | 'stack-reveal' | 'stack-settled';

export const StackContext = createContext<StackMode>('stack-none');

/** Find the element that actually scrolls a page: the outermost scrollable
 *  descendant of the page wrapper (e.g. the feed's pull-to-refresh scroller,
 *  the transactions page's own scroller), or `fallback` (main) when the page
 *  scrolls in main. Walk is capped: the scroller sits a few levels down, and
 *  a full-subtree walk of a 90-card feed during render would jank. */
export function findPageScroller(wrapper: HTMLElement | null, fallback: HTMLElement | null): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  if (wrapper) {
    const queue: Element[] = [...wrapper.children];
    let visited = 0;
    while (queue.length > 0 && visited < 400) {
      const el = queue.shift()!;
      visited += 1;
      if (el instanceof HTMLElement) {
        // scrollHeight first (cheap read); computed style only for candidates.
        if (el.scrollHeight > el.clientHeight + 1) {
          const oy = getComputedStyle(el).overflowY;
          if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') return el;
        }
        queue.push(...el.children);
      }
    }
  }
  return fallback;
}

/** Shared snapshot shell: a fixed, independently scrolling layer holding a
 *  static copy of a page (a cloned PageTransition with stackStatic, so it
 *  renders no animation and runs no scroll effects). `scrollTop` is applied
 *  to the container and, when the page has its own inner scroller, to that
 *  scroller too — one of the two is always the right one, the other no-ops. */
function SnapshotShell({
  element,
  scrollTop,
  className,
}: {
  element: React.ReactNode;
  scrollTop: number;
  className: string;
}) {
  const setScroll = useCallback(
    (el: HTMLElement | null) => {
      if (!el) return;
      el.scrollTop = scrollTop;
      const inner = findPageScroller(el, el);
      if (inner && inner !== el) inner.scrollTop = scrollTop;
    },
    [scrollTop],
  );

  return (
    <div
      ref={setScroll}
      aria-hidden
      className={className}
      // Bottom inset lifts the snapshot above the nav (same as the real
      // page's main padding). Top inset is just as important: real pages
      // sit below AppShell's pt-safe, so without it the snapshot's heading
      // starts under the status bar and appears to slide down to its real
      // position when the snapshot drops.
      style={{ paddingTop: 'var(--sat)', paddingBottom: 'calc(6rem + var(--sab))' }}
    >
      <div className="max-w-[1600px] mx-auto w-full px-4 md:px-8">{element}</div>
    </div>
  );
}

/** Forward underlay: the previous page, frozen, beneath the entering page. */
export function StackUnderlay({ element, scrollTop }: { element: React.ReactNode; scrollTop: number }) {
  return (
    <SnapshotShell
      element={element}
      scrollTop={scrollTop}
      className="fixed inset-0 z-[5] overflow-y-auto bg-gray-50 dark:bg-background"
    />
  );
}

/** Back-to-feed loader: replaces the slide-out cover when the back
 *  destination is the feed. An opaque loader holds 300ms (the wallet's
 *  beat) then fades over 300ms; the kept feed is already revealed beneath
 *  it, scroll restored, so lifting the loader is the whole transition —
 *  nothing slides. onDone drops the overlay (AppShell clears the
 *  transition); timers clean up if the user navigates away mid-loader. */
export function FeedLoaderOverlay({ onDone }: { onDone: () => void }) {
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const hold = setTimeout(() => setFading(true), 300);
    const done = setTimeout(onDone, 600);
    return () => {
      clearTimeout(hold);
      clearTimeout(done);
    };
  }, [onDone]);

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center bg-gray-50 dark:bg-background transition-opacity duration-300 ${
        fading ? 'opacity-0' : 'opacity-100'
      }`}
    >
      <VendiLoader />
    </div>
  );
}
