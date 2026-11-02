// src/shared/PageTransition.tsx
"use client";

import React, { useContext, useLayoutEffect, useMemo } from "react";
import { usePathname } from "next/navigation";
import { isBackNavigation } from "@/shared/hooks/useScrollRestore";
import { StackContext } from "@/shared/Navigation/StackOverlay";

export const PageTransition = ({
  children,
  // Set by AppShell when this page is rendered as a stack snapshot (the
  // forward underlay / back overlay): a static copy, no animation, no
  // scroll effects — it only has to look right for ~300ms.
  stackStatic,
  // The route this entry belongs to, set by AppShell. The transition div is keyed
  // by it (NOT by the global pathname): a kept page's key must stay stable
  // across navigations, or React would remount it the moment it becomes kept
  // and the whole keep-alive would be pointless. Outside AppShell this is
  // undefined and the div falls back to key={pathname}, exactly as before.
  pagePath,
}: {
  children: React.ReactNode;
  stackStatic?: boolean;
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

  // Scroll to top whenever a NEW page arrives. Back navigations skip this:
  // scroll restore owns the position there.
  // Stack-managed navigations skip it entirely: AppShell owns scroll there
  // (it zeroes on forward, restores the saved position on back reveal), and
  // this effect running from a kept instance would fight it.
  useLayoutEffect(() => {
    if (stackStatic || stackMode !== 'stack-none') return;
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

  // Stack snapshot copies render bare: no animation, no scroll handling.
  if (stackStatic) {
    return <>{children}</>;
  }

  // Stack-managed forward: the new page zooms in over the previous page
  // (vendi-zoom-in, 220ms scale + opacity). Keyed by this entry's own
  // route, never by the global pathname, so becoming kept can't remount it.
  // relative z-10 puts it above the forward underlay (z-[5]). The scale
  // transform is a containing block only until settling (300ms) removes
  // the class, so sheets opened after settling are viewport-relative.
  if (stackMode === 'stack-enter') {
    return (
      <div
        key={pagePath ?? pathname}
        className="w-full min-h-full vendi-zoom-in relative z-10"
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

  // Stack-managed back to a kept page: the kept page zooms in with the
  // same vendi-zoom-in as forward, so back feels like forward (visible,
  // native) instead of an instant cut. No z-10 (no underlay beneath a
  // back reveal). The inline guard is safe here (unlike the fallback):
  // back carries a settle marker (transition kind 'back-zoom'), so
  // settling removes class + guard at 300ms even if the animation
  // never runs.
  if (stackMode === 'stack-back') {
    return (
      <div
        key={pagePath ?? pathname}
        className="w-full min-h-full vendi-zoom-in"
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
  // AppShell settles the mode so the enter class + z-10 don't linger on
  // the current page. Settling still drops the animation class and the
  // underlay.
  if (stackMode === 'stack-reveal' || stackMode === 'stack-settled') {
    return (
      <div key={pagePath ?? pathname} className="w-full min-h-full">
        {children}
      </div>
    );
  }

  // Fallback (non-shell routes, two-step back, first mount): a plain div,
  // deliberately NOT faded. The fallback has no settle safety net (its
  // transition is null, so the settle effect never runs) — if the fade
  // animation ever failed to run here (stale CSS, paused animation), the
  // inline opacity guard would stick and the page would stay white with
  // only the header and nav visible. A plain div can never stick: it is
  // visible no matter what. The main flows (stack-enter/reveal) still
  // fade; only this rare path renders instantly.
  return (
    <div key={pagePath ?? pathname} className="w-full min-h-full">
      {children}
    </div>
  );
};

export default PageTransition;
