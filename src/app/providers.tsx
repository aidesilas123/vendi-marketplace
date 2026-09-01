"use client";

import { setupIonicReact } from '@ionic/react';
import { useEffect } from 'react';
import { ThemeProvider } from 'next-themes';

export default function IonicProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    setupIonicReact({ mode: 'md' });
  }, []);

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      {children}
    </ThemeProvider>
  );
}