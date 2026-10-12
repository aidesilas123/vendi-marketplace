"use client";

import React, { useState, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { BottomNav } from './BottomNav';
import { useRubberBand } from '@/shared/hooks/useRubberBand';

interface AppShellProps {
  children: React.ReactNode;
}

export const AppShell = ({ children }: AppShellProps) => {
  const pathname = usePathname();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [user, setUser] = useState<{ id?: string; name: string; email: string; avatarUrl?: string } | null>(null);

  const isAuthPage = pathname === '/login' || pathname === '/signup';
  const isChatRoom = pathname === '/chats' || pathname?.startsWith('/chats');
  const showShell = !isAuthPage && !isChatRoom;

  // Bottom rubber-band bounce for every page that scrolls in the shell's main
  // container. Top is off: pages with pull-to-refresh (feed, inbox) own that
  // edge. The hook ignores touches inside nested scrollers (e.g. the
  // transactions page's own container), so they never double-bounce.
  const bounceRef = useRef<HTMLDivElement>(null);
  useRubberBand(bounceRef, { scrollerId: 'main-scroll-container', top: false, bottom: true, ready: showShell });

  useEffect(() => {
    const fetchUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        setUser(null);
        return;
      }
      // The avatar comes from the `users` table, NOT auth metadata: profile
      // edits only write the table, so reading metadata here kept showing the
      // old photo after the user changed it.
      const { data: profile } = await supabase
        .from('users')
        .select('full_name, avatar_url')
        .eq('id', session.user.id)
        .single();
      setUser({
        id: session.user.id,
        name: profile?.full_name || session.user.user_metadata?.full_name || "Campus Student",
        email: session.user.email || "",
        avatarUrl: profile?.avatar_url || session.user.user_metadata?.avatar_url,
      });
    };
    fetchUser();
    // Pick up a fresh avatar after returning from the profile edit page, and
    // on any auth change (sign in/out).
    window.addEventListener('focus', fetchUser);
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => fetchUser());
    return () => {
      window.removeEventListener('focus', fetchUser);
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => setIsSidebarOpen(false), [pathname]);

  if (!showShell) return <>{children}</>;

  const isDashboard = pathname === '/';

  return (
    <div className="h-[100dvh] w-full bg-gray-50 dark:bg-[#0a1120] text-gray-900 dark:text-white flex flex-col font-sans antialiased overflow-clip relative pt-safe">
      
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
        {/* Bounce wrapper: the rubber-band transform applies here, around page
            content only. Fixed elements (bottom nav, modals, toasts) live
            outside it so a transform never breaks their positioning. */}
        <div ref={bounceRef}>
          <div className="max-w-[1600px] mx-auto w-full px-4 md:px-8">
            {children}
          </div>
        </div>
      </main>

      <div className="absolute bottom-0 left-0 right-0 w-full z-50 pointer-events-none">
        <div className="pointer-events-auto">
          <BottomNav />
        </div>
      </div>

    </div>
  );
};
