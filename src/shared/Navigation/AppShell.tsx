"use client";

import React, { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { BottomNav } from './BottomNav';

interface AppShellProps {
  children: React.ReactNode;
}

export const AppShell = ({ children }: AppShellProps) => {
  const pathname = usePathname();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [user, setUser] = useState<{ name: string; email: string; avatarUrl?: string } | null>(null);

  useEffect(() => {
    const fetchUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setUser({
          name: session.user.user_metadata?.full_name || "Campus Student",
          email: session.user.email || "",
          avatarUrl: session.user.user_metadata?.avatar_url,
        });
      }
    };
    fetchUser();
  }, []);

  useEffect(() => setIsSidebarOpen(false), [pathname]);

  const isAuthPage = pathname === '/login' || pathname === '/signup';
  if (isAuthPage) return <>{children}</>;

  const isDashboard = pathname === '/';

  return (
    // 1. LOCKED CONTAINER: Takes up exactly the screen height, no window scrolling allowed
    <div className="h-[100dvh] w-full bg-gray-50 dark:bg-[#0a1120] text-gray-900 dark:text-white flex flex-col font-sans antialiased overflow-hidden relative">
      
      {/* HEADER: Flex item, naturally stays at the top */}
      {isDashboard && (
        <div className="flex-shrink-0 z-40">
          <Header 
            onOpenSidebar={() => setIsSidebarOpen(true)} 
            user={user} 
            unreadNotifications={2} 
            onRefreshData={async () => {
              window.dispatchEvent(new Event('refresh-feed'));
            }}
          />
        </div>
      )}

      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} user={user} />

      {/* 2. MAIN SCROLLER: This is the ONLY part of the app that scrolls! */}
      <main id="main-scroll-container" className="flex-1 w-full overflow-y-auto scroll-smooth pb-24 relative">
        {/* WIDE SCREEN SPREAD: Expanded to max-w-[1600px] to fill laptops beautifully */}
        <div className="max-w-[1600px] mx-auto w-full px-4 md:px-8">
          {children}
        </div>
      </main>

      {/* 3. ABSOLUTE BOTTOM NAV: Locked to the bottom of the AppShell container */}
      <div className="absolute bottom-0 left-0 right-0 w-full z-50 pointer-events-none">
        <div className="pointer-events-auto">
          <BottomNav />
        </div>
      </div>

    </div>
  );
};