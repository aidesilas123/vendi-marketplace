"use client";

import { useEffect } from "react";
import {
  SystemBars,
  SystemBarsStyle,
  SystemBarType,
} from "@capacitor/core";

import { StatusBar, Style } from "@capacitor/status-bar";

export function StatusBarManager() {
  useEffect(() => {
    const applyStatusBarStyle = async () => {
      try {
        const isDark = document.documentElement.classList.contains("dark");
        const bgColor = isDark ? "#0b1120" : "#f9fafb";

        try {
          await StatusBar.setOverlaysWebView({ overlay: false });
          await StatusBar.setStyle({ style: isDark ? Style.Dark : Style.Light });
          await StatusBar.setBackgroundColor({ color: bgColor });
        } catch {
          // StatusBar plugin fallback
        }

        try {
          await SystemBars.setStyle({
            bar: SystemBarType.StatusBar,
            style: isDark ? SystemBarsStyle.Dark : SystemBarsStyle.Light
          });
        } catch {
          // SystemBars plugin fallback
        }
      } catch (e) {
        console.log("StatusBar plugins not active on web");
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