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
        // Use Vendi's actual theme instead of the device's
        // prefers-color-scheme setting.
        const isDark = document.documentElement.classList.contains("dark");

        await SystemBars.setStyle({
          bar: SystemBarType.StatusBar,
          style: isDark
            ? SystemBarsStyle.Light
            : SystemBarsStyle.Dark,
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