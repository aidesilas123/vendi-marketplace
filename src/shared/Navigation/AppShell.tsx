"use client";
// src/shared/Navigation/AppShell.tsx

import React, { useState, useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { BottomNav } from './BottomNav';
import { PushBanner } from './PushBanner';
import { useRubberBand } from '@/shared/hooks/useRubberBand';
import { mutate as globalMutate } from 'swr';
import { ensurePresence, dropPresence, ensureChannel, dropChannel } from '@/lib/realtime';
import { registerPushToken } from '@/lib/push';
import { useUnreadNotifications } from '@/shared/hooks/useUnreadNotifications';

interface AppShellProps {
  children: React.ReactNode;
}

const PAGE_TITLES: Record<string, string> = {
  chats: 'Messages',
  notifications: 'Notifications',
  notification: 'Notification',
  wallet: 'Wallet',
  transactions: 'Transactions',
  saved: 'Saved',
  profile: 'Profile',
  seller: 'Sell',
  settings: 'Settings',
  product: 'Listing',
  buy: 'Checkout',
  order: 'Order',
  dispute: 'Dispute',
  disputes: 'Disputes',
  questions: 'Questions',
  reviews: 'Reviews',
  verification: 'Verification',
  about: 'About',
  support: 'Support',
  safety: 'Safety',
  terms: 'Terms',
  'how-it-works': 'How it works',
  report: 'Report',
  login: 'Log in',
  signup: 'Sign up',
};

export const AppShell = ({ children }: AppShellProps) => {
  const pathname = usePathname();
  const router = useRouter();
  const { unread } = useUnreadNotifications();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [user, setUser] = useState<{ id?: string; name: string; email: string; avatarUrl?: string } | null>(null);

  const isAuthPage = pathname === '/login' || pathname === '/signup' || pathname === '/forgot-password' || pathname === '/reset-password' || pathname === '/auth/callback' || pathname === '/complete-profile';
  const isChatRoom = pathname === '/chats' || pathname?.startsWith('/chats');
  const showShell = !isAuthPage && !isChatRoom;

  // Fired once when the shell knows the auth state — the SplashOverlay listens
  // for this to lift (it also has its own safety timeout, so this can't trap).
  const readyDispatched = useRef(false);
  const dispatchAppReady = () => {
    if (!readyDispatched.current && typeof window !== 'undefined') {
      readyDispatched.current = true;
      window.dispatchEvent(new Event('vendi:app-ready'));
    }
  };

  // Bottom rubber-band bounce for every page that scrolls in the shell's main
  // container. Top is off: pages with pull-to-refresh (feed, inbox) own that
  // edge. The hook ignores touches inside nested scrollers (e.g. the
  // transactions page's own container), so they never double-bounce.
  const bounceRef = useRef<HTMLDivElement>(null);
  useRubberBand(bounceRef, { scrollerId: 'main-scroll-container', top: false, bottom: true, ready: showShell });

  // Browser tab title follows the page. Every page is a client component,
  // so per-page `metadata` exports aren't available — one map covers all.
  useEffect(() => {
    const seg = (pathname ?? '/').split('/')[1] ?? '';
    const label = PAGE_TITLES[seg];
    document.title = label ? `${label} | Vendi` : 'Vendi';
  }, [pathname]);

  useEffect(() => {
    const fetchUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        setUser(null);
        dispatchAppReady();
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
      dispatchAppReady();
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

  // Global Presence & WhatsApp-style Delivery on App Open.
  //
  // Two rules (violating either silently breaks realtime):
  //  1. ONE owner per channel topic — `supabase.channel(topic)` returns the same object
  //     everywhere, and `.on()` after `.subscribe()` throws. All channels go through
  //     src/lib/realtime.ts, which creates + subscribes each topic exactly once.
  //  2. Never `.send()` on a channel that was never `.subscribe()`d — the broadcast
  //     falls back to a deprecated REST endpoint. Delivery ticks propagate through
  //     the messages table instead: open chat rooms already listen to postgres_changes
  //     on it, so a DB status write is enough.
  useEffect(() => {
    if (!user?.id) return;
    const userId = user.id;

    // 0. Push: register this device's FCM token (native only, no-op on web).
    //    Tapping a notification deep-links via the payload's `route`.
    void registerPushToken((route) => router.push(route));

    // 1. This device owns global presence: the user appears online app-wide,
    //    from the moment the app opens (not only inside a chat room).
    ensurePresence(userId);

    // 2. Mark pending messages 'delivered' — the user has the app open.
    //    Open chat rooms pick the status change up via their postgres_changes
    //    subscription on the messages table, so no broadcast is needed.
    const deliverPending = async () => {
      try {
        const { data: undelivered } = await supabase
          .from('messages')
          .select('id')
          .eq('receiver_id', userId)
          .eq('status', 'sent');

        if (undelivered && undelivered.length > 0) {
          const ids = undelivered.map((m: any) => m.id);
          await supabase.from('messages').update({ status: 'delivered' }).in('id', ids);
        }
      } catch (err) {
        console.warn('[AppShell] deliverPending:', err);
      }
    };
    void deliverPending();

    // Resilience: broadcasts are ephemeral with no replay, so a message sent
    // while this device's socket was down stays 'sent' until something marks it
    // delivered. Sweep periodically and on reconnect / returning to the app —
    // not just on mount.
    const deliverInterval = setInterval(() => { void deliverPending(); }, 30000);
    const onVisible = () => { if (document.visibilityState === 'visible') void deliverPending(); };
    const onOnline = () => { void deliverPending(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);

    // 3. Personal inbox: a live new_message for ANY chat → mark it delivered.
    //    Never downgrade a message an open room already marked 'read'.
    ensureChannel(`user_inbox_${userId}`, (ch: any) => {
      ch.on('broadcast', { event: 'new_message' }, async (payload: any) => {
        const msg = payload?.payload;
        if (!msg?.id) return;
        try {
          await supabase.from('messages').update({ status: 'delivered' }).eq('id', msg.id).eq('status', 'sent');
        } catch {}
        void globalMutate((key: any) => Array.isArray(key) && key[0] === 'inbox');
      });
    });

    return () => {
      clearInterval(deliverInterval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      dropPresence();
      dropChannel(`user_inbox_${userId}`);
    };
  }, [user?.id]);

  useEffect(() => {
    setIsSidebarOpen(false);
    if (typeof window !== 'undefined') {
      window.scrollTo(0, 0);
    }
  }, [pathname]);

  // Native deep-link return (e.g. Google sign-in): the OS reopens the app with
  // com.vendi.app://auth/callback?code=... — forward it to the callback page,
  // which exchanges the code for a session. Skipped on web (not native).
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let removed = false;
    let handle: { remove: () => Promise<void> } | undefined;
    CapacitorApp.addListener('appUrlOpen', ({ url }) => {
      if (url.includes('auth/callback')) {
        const query = url.split('?')[1] ?? '';
        router.push(query ? `/auth/callback?${query}` : '/auth/callback');
      } else if (url.includes('reset-password')) {
        // Recovery links carry tokens in the query (?code=, PKCE) or the
        // fragment (#access_token=..., implicit). Forward both as query
        // params so /reset-password can consume them.
        const query = url.split('?')[1]?.split('#')[0] ?? '';
        const hash = url.split('#')[1] ?? '';
        const params = new URLSearchParams(query);
        if (hash) {
          new URLSearchParams(hash).forEach((v, k) => params.set(k, v));
        }
        const qs = params.toString();
        router.push(qs ? `/reset-password?${qs}` : '/reset-password');
      }
    }).then((l) => {
      if (removed) void l.remove();
      else handle = l;
    });
    return () => {
      removed = true;
      void handle?.remove();
    };
  }, [router]);

  if (!showShell) return <>{children}</>;

  const isDashboard = pathname === '/' || pathname === '' || pathname === '/index';

  return (
    <div className="fixed inset-0 w-full h-full bg-gray-50 dark:bg-background text-gray-900 dark:text-white flex flex-col font-sans antialiased overflow-hidden pt-safe">
      
      {isDashboard && (
        <div className="flex-shrink-0 z-40">
          <Header 
            onOpenSidebar={() => setIsSidebarOpen(true)} 
            user={user} 
            unreadNotifications={unread} 
            onOpenNotifications={() => router.push('/notifications')}
            onRefreshData={async () => {
              window.dispatchEvent(new Event('refresh-feed'));
            }}
          />
        </div>
      )}

      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} user={user} />

      {/* Content clearance = nav height + bottom inset, so the last row never
          hides behind the bottom nav on 3-button phones (larger inset) while
          gesture-nav phones keep the tighter spacing. */}
      <main
        id="main-scroll-container"
        className="flex-1 w-full overflow-y-auto overscroll-y-contain scroll-smooth relative"
        style={{ paddingBottom: 'calc(6rem + var(--sab))' }}
      >
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

      {/* In-app banner for foreground pushes (tap deep-links). */}
      <PushBanner />

    </div>
  );
};
