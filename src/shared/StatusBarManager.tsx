"use client";

import { useEffect } from "react";
import {
  SystemBars,
  SystemBarsStyle,
  SystemBarType,
} from "@capacitor/core";

export function StatusBarManager() {
  useEffect(() => {
    const applyStatusBarStyle = async () => {
      try {
        const isDark = document.documentElement.classList.contains("dark");

        await SystemBars.setStyle({
          bar: SystemBarType.StatusBar,
          // SWAPPED THESE TWO:
          style: isDark
            ? SystemBarsStyle.Dark  // Usually yields white/light text
            : SystemBarsStyle.Light // Usually yields black/dark text
        });
        
      } catch (e) {
        console.log("SystemBars plugin not active on web");
      }
    };

    // Apply immediately
    applyStatusBarStyle();

    // Watch for Vendi's dark/light class changing.
    const observer = new MutationObserver(() => {
      applyStatusBarStyle();
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => {
      observer.disconnect();
    };
  }, []);

  return null;
}