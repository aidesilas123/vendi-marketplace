import type { Metadata } from "next";
import { Inter } from "next/font/google";
import IonicProvider from "./providers";
import { NetworkListener } from "@/shared/Modal/NetworkListener";
import { AppShell } from "@/shared/Navigation/AppShell"; 
import { StatusBarInitializer } from "@/shared/StatusBarInitializer";
import { HardwareBackButton } from "@/shared/HardwareBackButton";
// 1. IONIC CSS MUST BE IMPORTED FIRST
import '@ionic/react/css/core.css';
import '@ionic/react/css/normalize.css';
import '@ionic/react/css/structure.css';
import '@ionic/react/css/typography.css';
import '@ionic/react/css/padding.css';
import '@ionic/react/css/float-elements.css';
import '@ionic/react/css/text-alignment.css';
import '@ionic/react/css/text-transformation.css';
import '@ionic/react/css/flex-utils.css';
import '@ionic/react/css/display.css';

import "./globals.css";
import type { Viewport } from "next";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

// Initialize the Inter font for ultra-crisp mobile readability
const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Campus Marketplace",
  description: "Secure multi-campus trading platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      {/* antialiased makes the font incredibly smooth on all devices */}
      <body className={`${inter.className} antialiased`}>
        <HardwareBackButton />
        <StatusBarInitializer />
        <NetworkListener />
        <IonicProvider>
          {/* We wrap the entire application in the AppShell here */}
          <AppShell>
            {children}
          </AppShell>
        </IonicProvider>
      </body>
    </html>
  );
}