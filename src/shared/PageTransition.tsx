"use client";

import React, { useEffect } from "react";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";

export const PageTransition = ({ children }: { children: React.ReactNode }) => {
  const pathname = usePathname();
  const shouldReduceMotion = useReducedMotion();

  // Scroll to top whenever a new page arrives
  useEffect(() => {
    const main = document.getElementById("main-scroll-container");
    if (main) main.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
    document.body.scrollTop = 0;
    document.documentElement.scrollTop = 0;
  }, [pathname]);

  if (shouldReduceMotion) {
    return <>{children}</>;
  }

  return (
    <motion.div
      key={pathname}
      initial={{ opacity: 0, x: 24 }}
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

