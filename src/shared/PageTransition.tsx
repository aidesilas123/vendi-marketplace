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
  // The route this entry belongs to, set by AppShell. The slide div is keyed
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

  // Stack-managed forward: the new page slides in from the right over the
  // previous page (vendi-stack-in, wallet timing). Keyed by this entry's own
  // route, never by the global pathname, so becoming kept can't remount it.
  // relative z-10 puts it above the forward underlay (z-[5]).
  if (stackMode === 'stack-enter') {
    return (
      <div
        key={pagePath ?? pathname}
        className="w-full min-h-full vendi-stack-in relative z-10"
        // First-paint guard against the flash-then-slide: the entering page
        // must never paint once at its final position before the keyframe's
        // from-state applies. This inline offset is present from the very
        // first paint; the running animation overrides it (animations beat
        // inline styles), and settling removes it, so it can never snap the
        // page back or stick.
        style={{ transform: 'translate3d(100%, 0, 0)' }}
      >
        {children}
      </div>
    );
  }

  // Stack-managed back reveal: the kept page is already painted and in
  // place — it must NOT animate. The outgoing snapshot sliding out over it
  // is the whole transition.
  // 'stack-settled' renders the same plain div: once the enter animation
  // finishes, AppShell settles the mode so the enter classes (will-change
  // + z-10) don't linger — left in place they become a containing block
  // and stacking context for every in-page fixed element, which is what
  // broke sheets (scrolling with the page, capped below the nav, inset by
  // the page padding).
  if (stackMode === 'stack-reveal' || stackMode === 'stack-settled') {
    return (
      <div key={pagePath ?? pathname} className="w-full min-h-full">
        {children}
      </div>
    );
  }

  // CSS keyframes, not Motion: Motion's `x` shorthand is not in its
  // WAAPI-accelerated set, so the old slide ran on Motion's JS frame loop
  // while opacity ran on the compositor — a main-thread stall mounting the
  // new page froze the position while the fade continued, which reads as
  // stutter. A keyframe transform animation runs on the compositor
  // regardless of what the main thread is doing. Keyframes also need no
  // two-paint enter trick: they run on mount automatically. No opacity:
  // the page appears fully opaque from frame one (just offset), so there
  // is no luminance flash and no whole-page group-opacity surface.
  return (
    <div
      key={pagePath ?? pathname}
      className={`w-full min-h-full ${isBack ? "vendi-page-in-back" : "vendi-page-in-forward"}`}
    >
      {children}
    </div>
  );
};

export default PageTransition;
