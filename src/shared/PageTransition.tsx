// src/shared/PageTransition.tsx
"use client";

import React, { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { isBackNavigation } from "@/shared/hooks/useScrollRestore";
import { StackContext } from "@/shared/Navigation/StackOverlay";

export const PageTransition = ({
  children,
  // The route this entry belongs to, set by AppShell. The transition div is keyed
  // by it (NOT by the global pathname): a kept page's key must stay stable
  // across navigations, or React would remount it the moment it becomes kept
  // and the whole keep-alive would be pointless. Outside AppShell this is
  // undefined and the div falls back to key={pathname}, exactly as before.
  pagePath,
}: {
  children: React.ReactNode;
  pagePath?: string;
}) => {
  const pathname = usePathname();
  const stackMode = useContext(StackContext);

  // Back direction is decided once per pathname: isBackNavigation() reads a
  // 2.5s popstate window, so calling it on every render could flip the
  // direction (and skip scroll-to-top) for a forward tap made shortly
  // after a back navigation. It also requires the popped-to path to match
  // this pathname, so a quick forward push after a back is not misread.
  const isBack = useMemo(() => isBackNavigation(pathname), [pathname]);

  const shouldReduceMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    []
  );

  // Self-contained animation for navigations the stack can't reach: auth
  // pages and any shell boundary all render with stack-none (AppShell
  // returns them bare, no settle marker), so the stack branches below
  // never fire for them. This covers them with the directional zoom
  // (back shrinks in, forward grows out). The /chats room no longer
  // uses this path: it is a shell page now, so it goes through the
  // stack branches like every other page. On a pathname change
  // that is NOT the first mount, animate, then drop the class + guard
  // after 300ms (local settle — the stack's settle never runs for
  // stack-none). Keyed by pathname so the animation restarts cleanly
  // on every nav (pagePath is undefined outside the shell). First mount
  // never animates (prev is null) — the app must not animate its first
  // paint. Shell navigations never reach this (stackMode is
  // enter/back/reveal there, not none), so a page can never animate
  // twice. Same-pathname changes (query params, e.g. switching chat
  // rooms) don't animate either — that's a content change, not a
  // page nav.
  const prevPathRef = useRef<string | null>(null);
  const [shellFreeAnim, setShellFreeAnim] = useState<null | 'zoom-in' | 'shrink-in'>(null);
  useEffect(() => {
    const prev = prevPathRef.current;
    prevPathRef.current = pathname;
    if (prev === null || prev === pathname) return;
    if (stackMode !== 'stack-none') return;
    setShellFreeAnim(isBack ? 'shrink-in' : 'zoom-in');
    const id = setTimeout(() => setShellFreeAnim(null), 300);
    return () => clearTimeout(id);
  }, [pathname, stackMode, isBack]);

  // Scroll to top whenever a NEW page arrives. Back navigations skip this:
  // scroll restore owns the position there.
  // Stack-managed navigations skip it entirely: AppShell owns scroll there
  // (it zeroes on forward, restores the saved position on back reveal), and
  // this effect running from a kept instance would fight it.
  useLayoutEffect(() => {
    if (stackMode !== 'stack-none') return;
    if (isBack) return;
    const main = document.getElementById("main-scroll-container");
    if (main) {
      // Direct assignment, not scrollTo: the scroller no longer has
      // scroll-smooth, so there is no smooth-scroll behaviour to override,
      // and the body/document writes were dead (html/body are overflow: clip).
      main.scrollTop = 0;
      main.scrollLeft = 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  if (shouldReduceMotion) {
    return <>{children}</>;
  }

  // Stack-managed forward: the new page grows out (vendi-zoom-in,
  // 220ms scale 0.96→1 + opacity 0→1) over blank, single layer. Keyed
  // by this entry's own route, never by the global pathname, so
  // becoming kept can't remount it. The scale transform is a containing
  // block only until settling (300ms) removes the class, so sheets
  // opened after settling are viewport-relative.
  if (stackMode === 'stack-enter') {
    return (
      <div
        key={pagePath ?? pathname}
        className="w-full min-h-full vendi-zoom-in"
        // First-paint guard: the entering page must never paint once at
        // full size and opacity before the zoom starts. This inline opacity
        // is present from the very first paint; the running animation
        // overrides it (animations beat inline styles), and settling
        // removes it. No visibility gate needed: with a zoom, this
        // inline opacity IS the guard, so there is no second hiding
        // mechanism to mistime.
        style={{ opacity: 0 }}
      >
        {children}
      </div>
    );
  }

  // Stack-managed back: the page you return to shrinks in
  // (vendi-shrink-in, 220ms scale 1.04→1 + opacity 0→1) — the reverse of
  // forward's grow, same duration, same fade, so direction is readable
  // by feel: forward grows toward you, back settles back to normal.
  // The inline guard is safe here: back carries a settle marker
  // (transition kind 'back-zoom'), so settling removes class + guard
  // at 300ms even if the animation never runs.
  if (stackMode === 'stack-back') {
    return (
      <div
        key={pagePath ?? pathname}
        className="w-full min-h-full vendi-shrink-in"
        style={{ opacity: 0 }}
      >
        {children}
      </div>
    );
  }

  // Kept-tab reveal (forward tap to a kept tab): the kept page is already
  // painted and in place — it must NOT animate. Native tab bars switch
  // instantly; a zoom here would read as a repeat. Back uses stack-back
  // (above), not this branch.
  // 'stack-settled' renders the same plain div: once the zoom finishes,
  // AppShell settles the mode so the enter class doesn't linger on
  // the current page.
  if (stackMode === 'stack-reveal' || stackMode === 'stack-settled') {
    return (
      <div key={pagePath ?? pathname} className="w-full min-h-full">
        {children}
      </div>
    );
  }

  // Self-contained animation for non-shell navigations (auth pages,
  // shell boundaries — see the effect above): directional zoom only
  // (back shrinks, forward grows). The local 300ms timer drops class +
  // guard. Safe if the timer ever fails: the animation's forwards fill
  // holds the final state (opacity 1, scale/translate at rest), which
  // beats the inline guard, so the page can never stick invisible.
  if (shellFreeAnim) {
    const animClass = shellFreeAnim === 'shrink-in' ? 'vendi-shrink-in' : 'vendi-zoom-in';
    return (
      <div
        key={pathname}
        className={`w-full min-h-full ${animClass}`}
        style={{ opacity: 0 }}
      >
        {children}
      </div>
    );
  }

  // Fallback: first mount (never animate the first paint) and
  // same-page re-renders. Navigations to non-shell routes zoom via the
  // self-contained branch above; shell routes zoom via the stack. A
  // plain div can never stick: it is visible no matter what.
  return (
    <div key={pagePath ?? pathname} className="w-full min-h-full">
      {children}
    </div>
  );
};

export default PageTransition;
