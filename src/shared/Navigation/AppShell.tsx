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
    <div className="h-[100dvh] w-full bg-gray-50 dark:bg-[#0a1120] text-gray-900 dark:text-white flex flex-col font-sans antialiased overflow-hidden relative pt-safe">
      
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

      <main id="main-scroll-container" className="flex-1 w-full overflow-y-auto overscroll-y-contain scroll-smooth pb-24 relative">
        <div className="max-w-[1600px] mx-auto w-full px-4 md:px-8">
          {children}
        </div>
      </main>

      <div className="absolute bottom-0 left-0 right-0 w-full z-50 pointer-events-none pb-safe">
        <div className="pointer-events-auto">
          <BottomNav />
        </div>
      </div>

    </div>
  );
};