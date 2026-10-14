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
        const style = isDark ? SystemBarsStyle.Dark : SystemBarsStyle.Light;

        await SystemBars.setStyle({ bar: SystemBarType.StatusBar, style });
        // The navigation bar is transparent (see styles.xml) with the app's
        // bottom nav behind it — keep its buttons contrasted the same way.
        await SystemBars.setStyle({ bar: SystemBarType.NavigationBar, style });
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