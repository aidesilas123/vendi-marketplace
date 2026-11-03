// src/shared/Navigation/StackOverlay.tsx
"use client";

import { createContext } from 'react';

/**
 * Wallet-style page stack — the transition layer.
 *
 * The wallet dashboard feels smooth because its subpages are fixed overlays
 * sliding over an intact, already-painted dashboard: nothing remounts on the
 * way back. This module gives App Router pages the same treatment, capped at
 * depth 1 (only the immediately previous page is kept):
 *
 *  - Forward: the new page mounts in main and zooms in (vendi-zoom-in,
 *    220ms scale + opacity) over blank — single layer, exactly like a
 *    back nav. The previous page stays kept but hidden (display:none)
 *    for the way back; it is never shown beneath the entering page.
 *    (An earlier version zoomed over a snapshot of the previous page;
 *    two layers moving at once read as "shows the next page, then zooms
 *    on it again", so the snapshot is gone.)
 *  - Back to a kept page: the kept page is unhidden in main (already
 *    painted, state intact) and zooms in with the same vendi-zoom-in.
 *  - Back to a page that isn't kept (two-step back, back to feed after
 *    a longer chain): fresh mount, still zooms (stack-back + settle
 *    marker) so every back nav zooms.
 *  - Forward tap to a kept tab: instant reveal, no animation (native
 *    tab bars switch instantly; a zoom here would read as a repeat).
 *  - Anything else (first mount, leaving the shell): PageTransition's
 *    plain div — except navigations to non-shell routes (auth pages,
 *    the /chats room), which PageTransition zooms itself with a local
 *    300ms settle, since the stack never sees them.
 *
 * Stacking, all below the bottom nav (z-50) so the nav never blinks:
 *  - kept entries: display:none (hidden, never shown beneath a zoom).
 * The entering page's wrapper carries no z-10 (nothing beneath it).
 */

export type StackMode = 'stack-none' | 'stack-enter' | 'stack-reveal' | 'stack-back' | 'stack-settled';

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
