"use client";

import React, { useEffect } from "react";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";

export const PageTransition = ({ children }: { children: React.ReactNode }) => {
  const pathname = usePathname();
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
  const main = document.getElementById("main-scroll-container");
  if (main) main.scrollTo({ top: 0, left: 0, behavior: "auto" });
  document.body.scrollTop = 0;
  document.documentElement.scrollTop = 0;
}, [pathname]);

  return (
  <motion.div
    key={pathname}
    initial={shouldReduceMotion ? false : { opacity: 0, x: 60 }}
    animate={{ opacity: 1, x: 0 }}
    transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
  >
    {children}
  </motion.div>
);
};