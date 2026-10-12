import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import IonicProvider from "./providers";
import { NetworkListener } from "@/shared/Modal/NetworkListener";
import { AppShell } from "@/shared/Navigation/AppShell"; 
import { StatusBarManager } from "@/shared/StatusBarManager";
import { HardwareBackButton } from "@/shared/HardwareBackButton";
import { PageTransition } from "@/shared/PageTransition";
import { GlobalToastHost } from "@/shared/Toast/Toast";
import { SplashScreen } from "@/shared/SplashScreen";
// 1. IONIC CSS MUST BE IMPORTED FIRST
import '@ionic/react/css/core.css';

import '@ionic/react/css/structure.css';
// NOTE: typography.css removed (2026-10-12) — its unlayered h1-h6/p/a rules
// beat Tailwind v4's layered utilities in the cascade, forcing 26px/24px/22px
// headings and Ionic blue links no matter what text-* class was set.
import '@ionic/react/css/padding.css';
import '@ionic/react/css/float-elements.css';
import '@ionic/react/css/text-alignment.css';
import '@ionic/react/css/text-transformation.css';
import '@ionic/react/css/flex-utils.css';
import '@ionic/react/css/display.css';

import "./globals.css";
import type { Viewport } from "next";

// Vendi's global typeface — professional, modern, self-hosted by Next so it
// works offline inside the Capacitor APK. Applied via the --font-jakarta
// variable (see globals.css @theme).
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-jakarta",
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "ABU Vendi",
  description: "Secure multi-campus trading platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={jakarta.variable} suppressHydrationWarning>
      {/* antialiased makes the font incredibly smooth on all devices */}
      <body className="font-sans antialiased">
        <HardwareBackButton />
        <StatusBarManager />
        <NetworkListener />
        <IonicProvider>
          {/* We wrap the entire application in the AppShell here */}
          <AppShell>
            <PageTransition>{children}</PageTransition>
          </AppShell>
        </IonicProvider>
        {/* Branded cold-start splash: covers the first paint so the header/nav
            never visibly snap into place, then fades away. */}
        <SplashScreen />
        {/* One toast host for the whole app. It portals to <body>, so it stays pinned to the
            bottom of the screen and survives route changes (e.g. toast, then navigate). */}
        <GlobalToastHost />
      </body>
    </html>
  );
}