// src/shared/PageTransition.tsx
"use client";

import React, { useLayoutEffect, useMemo } from "react";
import { usePathname } from "next/navigation";
import { isBackNavigation } from "@/shared/hooks/useScrollRestore";

export const PageTransition = ({ children }: { children: React.ReactNode }) => {
  const pathname = usePathname();

  // Back direction is decided once per pathname: isBackNavigation() reads a
  // 2.5s popstate window, so calling it on every render could flip the
  // direction (and skip scroll-to-top) for a forward tap made shortly
  // after a back navigation.
  const isBack = useMemo(() => isBackNavigation(), [pathname]);

  const shouldReduceMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    []
  );

  // Scroll to top whenever a NEW page arrives. Back navigations skip this:
  // scroll restore owns the position there.
  useLayoutEffect(() => {
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
      key={pathname}
      className={`w-full min-h-full ${isBack ? "vendi-page-in-back" : "vendi-page-in-forward"}`}
    >
      {children}
    </div>
  );
};

export default PageTransition;
