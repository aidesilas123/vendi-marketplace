"use client";

import { setupIonicReact } from '@ionic/react';
import { useEffect } from 'react';
import { ThemeProvider } from 'next-themes';
import { SWRConfig } from 'swr';

export default function IonicProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    setupIonicReact({ mode: 'md' });
  }, []);

  return (
    <SWRConfig
      value={{
        revalidateOnFocus: false,
        revalidateOnReconnect: true,
        dedupingInterval: 10000,
      }}
    >
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        {children}
      </ThemeProvider>
    </SWRConfig>
  );
}
