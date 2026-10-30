"use client";

import React, { useLayoutEffect } from "react";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { isBackNavigation } from "@/shared/hooks/useScrollRestore";

export const PageTransition = ({ children }: { children: React.ReactNode }) => {
  const pathname = usePathname();
  const shouldReduceMotion = useReducedMotion();
  const isBack = isBackNavigation();

  // Scroll to top whenever a NEW page arrives. Back navigations skip this:
  // scroll restore owns the position there.
  useLayoutEffect(() => {
    if (isBack) return;
    const main = document.getElementById("main-scroll-container");
    if (main) main.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
    document.body.scrollTop = 0;
    document.documentElement.scrollTop = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  if (shouldReduceMotion) {
    return <>{children}</>;
  }

  return (
    <motion.div
      key={pathname}
      initial={{ opacity: 0, x: isBack ? -24 : 24 }}
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
