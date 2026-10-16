"use client";

import React, { useEffect, useLayoutEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { isBackNavigation } from "@/shared/hooks/useScrollRestore";

/**
 * True when the browser runs same-document View Transitions for navigations
 * by itself (`@view-transition { navigation: auto }` in globals.css).
 * Only ever called client-side, after hydration (see vtReady below).
 */
function supportsViewTransitionAuto(): boolean {
  if (typeof window === "undefined" || typeof CSSStyleSheet === "undefined") return false;
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync("@view-transition { navigation: auto; }");
    const rule = sheet.cssRules[0] as { navigation?: string } | undefined;
    return rule?.navigation === "auto";
  } catch {
    return false;
  }
}

export const PageTransition = ({ children }: { children: React.ReactNode }) => {
  const pathname = usePathname();
  const shouldReduceMotion = useReducedMotion();
  // Evaluated every render, but only consumed at page boundaries (effects below).
  const isBack = isBackNavigation();
  // Decided AFTER hydration: the first client render must match the server
  // (motion.div with its initial styles). Computing this during render makes
  // the server emit the div and the client a fragment -> hydration mismatch
  // and a full client-side tree rebuild. Once mounted, VT-capable browsers
  // skip the motion enter animation and let the View Transition own it.
  // `initial` is re-read on every key remount, so later navigations get
  // initial={false} while the tree shape never changes.
  const [vtReady, setVtReady] = useState(false);
  useEffect(() => {
    setVtReady(supportsViewTransitionAuto());
  }, []);

  // Direction flag for the VT keyframes. Pre-paint, so the browser's transition
  // setup — which runs after commit — sees it. Runs every render: a push must
  // reset a stale "back" left by an earlier popstate.
  useLayoutEffect(() => {
    document.documentElement.dataset.vtDir = isBack ? "back" : "forward";
  });

  // Scroll to top whenever a NEW page arrives. Back navigations skip this:
  // scroll restore owns the position there. Layout effect (not passive) so the
  // VT "new" snapshot captures the page at the top.
  useLayoutEffect(() => {
    if (isBack) return;
    const main = document.getElementById("main-scroll-container");
    if (main) main.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
    document.body.scrollTop = 0;
    document.documentElement.scrollTop = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // View Transitions (GPU snapshots, see globals.css) own the animation once
  // vtReady is set. The motion slide below stays as the fallback for old
  // WebViews — and for the very first paint, where it must match the server.
  if (shouldReduceMotion) {
    return <>{children}</>;
  }

  return (
    <motion.div
      key={pathname}
      initial={vtReady ? false : { opacity: 0, x: isBack ? -24 : 24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{
        duration: 0.22,
        ease: [0.25, 0.1, 0.25, 1],
      }}
      className="w-full min-h-full"
    >
      {children}
    </motion.div>
  );
};

export default PageTransition;
