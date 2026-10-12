import type { Metadata } from "next";
import IonicProvider from "./providers";
import { NetworkListener } from "@/shared/Modal/NetworkListener";
import { AppShell } from "@/shared/Navigation/AppShell"; 
import { StatusBarManager } from "@/shared/StatusBarManager";
import { HardwareBackButton } from "@/shared/HardwareBackButton";
import { PageTransition } from "@/shared/PageTransition";
import { GlobalToastHost } from "@/shared/Toast/Toast";
// 1. Core Ionic styles for web components (optional typography.css removed to prevent overriding Tailwind utility classes)
import '@ionic/react/css/core.css';
import '@ionic/react/css/structure.css';

import "./globals.css";
import type { Viewport } from "next";

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
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preload" href="/fonts/PlusJakartaSans-Regular.ttf" as="font" type="font/ttf" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/PlusJakartaSans-SemiBold.ttf" as="font" type="font/ttf" crossOrigin="anonymous" />
      </head>
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
        {/* One toast host for the whole app. It portals to <body>, so it stays pinned to the
            bottom of the screen and survives route changes (e.g. toast, then navigate). */}
        <GlobalToastHost />
      </body>
    </html>
  );
}