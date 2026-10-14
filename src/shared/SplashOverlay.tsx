"use client";

import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";

/**
 * Branded cold-start splash (native only).
 *
 * Sequence on app open:
 *   1. Android shows the native splash (solid #0B1120 + app icon) until first draw.
 *   2. This overlay continues seamlessly from there — same background, full logo.
 *   3. It lifts only when the app signals readiness (`vendi:app-ready`, fired by
 *      AppShell once auth state is known), with a minimum brand beat and a hard
 *      safety cap so it can never trap the user.
 *
 * Because the overlay covers the first paint, users never see a blank flash, a
 * half-laid-out shell, or the status-bar/bottom-nav inset "snap" on open.
 */
export function SplashOverlay() {
  const [visible, setVisible] = useState(true);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    // Web has no native splash and loads fast — never flash one there.
    if (!Capacitor.isNativePlatform()) {
      setVisible(false);
      return;
    }

    const start = Date.now();
    let ready = false;
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      setFading(true);
      setTimeout(() => setVisible(false), 450);
    };

    const tryHide = () => {
      if (!ready || finished) return;
      // Minimum brand beat so it never blips, then fade.
      const wait = Math.max(0, 900 - (Date.now() - start));
      setTimeout(finish, wait);
    };

    const onReady = () => {
      ready = true;
      // Wait for the brand font too — a font swap mid-reveal looks broken.
      const fonts = (document as any).fonts;
      if (fonts?.ready) {
        fonts.ready.then(tryHide).catch(tryHide);
      } else {
        tryHide();
      }
    };

    window.addEventListener("vendi:app-ready", onReady);
    // Safety net: never trap the user behind the splash.
    const fallback = setTimeout(finish, 6000);

    return () => {
      window.removeEventListener("vendi:app-ready", onReady);
      clearTimeout(fallback);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      aria-hidden
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#0B1120] transition-opacity duration-500 ${
        fading ? "opacity-0" : "opacity-100"
      }`}
    >
      <img
        src="/logo.png"
        alt=""
        draggable={false}
        className="w-28 h-28 object-contain animate-[splash-logo-in_0.45s_ease-out]"
      />
      <div className="mt-5 text-white text-2xl font-bold tracking-tight">Vendi</div>
      <div className="mt-1 text-white/40 text-[11px] tracking-[0.35em] uppercase">
        Your Trusted Campus Marketplace
      </div>
      <div className="mt-8 h-1 w-24 overflow-hidden rounded-full bg-white/10">
        <div className="h-full w-1/2 rounded-full bg-orange-500 animate-[splash-slide_1.1s_ease-in-out_infinite]" />
      </div>
    </div>
  );
}
