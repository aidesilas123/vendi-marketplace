"use client";

import React, { useState, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { BottomNav } from './BottomNav';
import { useRubberBand } from '@/shared/hooks/useRubberBand';
import { mutate as globalMutate } from 'swr';

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

      // Query users table for live profile avatar & name
      const { data: profile } = await supabase
        .from('users')
        .select('id, full_name, avatar_url')
        .eq('id', session.user.id)
        .maybeSingle();

      setUser({
        id: session.user.id,
        name: profile?.full_name || session.user.user_metadata?.full_name || "Campus Student",
        email: session.user.email || "",
        avatarUrl: profile?.avatar_url || session.user.user_metadata?.avatar_url,
      });
    };

    fetchUser();

    // Pick up a fresh avatar after returning from the profile edit page, on focus, and on auth change
    const handleProfileRefresh = () => { void fetchUser(); };
    window.addEventListener('refresh-profile', handleProfileRefresh);
    window.addEventListener('focus', handleProfileRefresh);

    const { data: authListener } = supabase.auth.onAuthStateChange(() => {
      void fetchUser();
    });

    return () => {
      window.removeEventListener('refresh-profile', handleProfileRefresh);
      window.removeEventListener('focus', handleProfileRefresh);
      authListener?.subscription?.unsubscribe();
    };
  }, []);

  // Global Presence & WhatsApp-style Delivery on App Open
  useEffect(() => {
    if (!user?.id) return;
    const userId = user.id;

    // 1. Mark any pending messages as 'delivered' because the user has the app open
    const deliverPending = async () => {
      try {
        const { data: undelivered } = await supabase
          .from('messages')
          .select('id, transaction_ref')
          .eq('receiver_id', userId)
          .eq('status', 'sent');

        if (undelivered && undelivered.length > 0) {
          const ids = undelivered.map((m: any) => m.id);
          await supabase.from('messages').update({ status: 'delivered' }).in('id', ids);
          undelivered.forEach((m: any) => {
            supabase.channel(`chat_${m.transaction_ref}`).send({
              type: 'broadcast',
              event: 'messages_delivered',
              payload: { ids: [m.id] }
            }).catch(() => {});
          });
        }
      } catch (err) {
        console.warn('[AppShell] deliverPending:', err);
      }
    };
    deliverPending();

    // 2. Global presence channel: tracks who is online across the entire app
    const presenceChannel = supabase.channel('global_presence', {
      config: { presence: { key: userId } }
    });

    presenceChannel.subscribe(async (status: string) => {
      if (status === 'SUBSCRIBED') {
        await presenceChannel.track({
          user_id: userId,
          online_at: new Date().toISOString()
        });
      }
    });

    // 3. User notification/inbox channel: delivers incoming messages when app is open
    const userChannel = supabase.channel(`user_inbox_${userId}`);
    userChannel.on('broadcast', { event: 'new_message' }, async (payload: any) => {
      const msg = payload?.payload;
      if (!msg) return;
      await supabase.from('messages').update({ status: 'delivered' }).eq('id', msg.id);
      supabase.channel(`chat_${msg.transaction_ref}`).send({
        type: 'broadcast',
        event: 'messages_delivered',
        payload: { ids: [msg.id] }
      }).catch(() => {});
      void globalMutate((key: any) => Array.isArray(key) && key[0] === 'inbox');
    }).subscribe();

    return () => {
      void supabase.removeChannel(presenceChannel);
      void supabase.removeChannel(userChannel);
    };
  }, [user?.id]);

  useEffect(() => {
    setIsSidebarOpen(false);
    if (typeof window !== 'undefined') {
      window.scrollTo(0, 0);
    }
  }, [pathname]);

  if (!showShell) return <>{children}</>;

  const isDashboard = pathname === '/' || pathname === '' || pathname === '/index';

  return (
    <div className="fixed inset-0 w-full h-full bg-gray-50 dark:bg-[#0a1120] text-gray-900 dark:text-white flex flex-col font-sans antialiased overflow-hidden pt-safe">
      
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
