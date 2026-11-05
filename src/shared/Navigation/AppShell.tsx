"use client";
// src/shared/Navigation/AppShell.tsx

import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { isBackNavigation } from '@/shared/hooks/useScrollRestore';
import { StackContext, findPageScroller } from './StackOverlay';
import type { StackMode } from './StackOverlay';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { BottomNav } from './BottomNav';
import { PushBanner } from './PushBanner';
import { useRubberBand } from '@/shared/hooks/useRubberBand';
import { mutate as globalMutate } from 'swr';
import { ensurePresence, dropPresence, ensureChannel, dropChannel } from '@/lib/realtime';
import { registerPushToken } from '@/lib/push';
import { useUnreadNotifications } from '@/shared/hooks/useUnreadNotifications';
import { showGlobalToast } from '@/shared/Toast/Toast';

interface AppShellProps {
  children: React.ReactNode;
}

// Server render has no window: mirror useScrollRestore's iso pattern so the
// stack's scroll effect never warns there.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

// One kept page (depth 1): the route the user came from, still mounted so
// going back reveals it already painted instead of remounting it.
type KeptEntry = { pathname: string; element: React.ReactNode };
type StackTransition =
  | { kind: 'forward' }
  | { kind: 'back-zoom' };

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
  // /chats uses the same shell mechanism as every other page now: no
  // chat-room bypass. It goes through the stack and PageTransition
  // like feed, product, checkout and transactions do. BottomNav is
  // the exception: it slides down while a room is open (BottomNav).
  const showShell = !isAuthPage;

  // ---- Wallet-style page stack (depth 1) ----
  // Refs only; the transition is computed during render (below, before the
  // early return) so the overlays exist in the SAME commit as the route
  // change — an effect would flash one frame without them. The computation
  // is idempotent (guarded by prevPathRef) so StrictMode's double render
  // can't apply it twice.
  const stackModeRef = useRef<StackMode>('stack-none');
  const stackEntriesRef = useRef<KeptEntry[]>([]);
  const currentElRef = useRef<React.ReactNode>(null);
  const transitionRef = useRef<StackTransition | null>(null);
  const prevPathRef = useRef<string | null>(null);
  const prevChildrenRef = useRef<React.ReactNode>(null);
  const prevShellRef = useRef(false);
  // Fade build: no entering-page visibility gate. The fade's inline
  // opacity guard (see PageTransition) covers first paint on its own, so
  // the gate's hidden→visible flip is redundant — one less mechanism to
  // mistime. Modes, settling, scroll, and the loader are unchanged.
  const savedScrollRef = useRef<Record<string, number>>({});
  const wrapperRefs = useRef(new Map<string, HTMLElement>());
  const [, setStackTick] = useState(0);

  // Connection toasts: offline / back online / slow connection. Fires only on
  // transitions (tracked in refs), never on every render, so it can't spam.
  // Note: this is separate from the offline modal (NetworkListener), which
  // only reacts to the browser's online/offline events and misses the
  // bad-but-not-dead network case — the toast covers that gap.
  const netStateRef = useRef({ offline: false, slow: false });

  // Safe-area insets surviving a full page reload: MainActivity bridges
  // --native-sat/--native-sab via an insets listener that only fires on
  // inset CHANGES (plus a forced dispatch in onStart). A full WebView
  // reload (e.g. the error page's Reload button) recreates the document
  // WITHOUT restarting the Activity, so onStart doesn't run, no inset
  // change fires, and the vars reset to 0 — every header then sits under
  // the status bar. Fixed here, not natively: overriding Capacitor's
  // WebViewClient to re-inject on load would break the bridge, so instead
  // persist the last native values this app saw, restore them on mount
  // before paint if native hasn't set them yet, and keep saving whenever
  // native updates them. On a fresh launch native sets the true values
  // (onStart) so the restore is a no-op; on a reload it fills the gap.
  useIsoLayoutEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const read = (name: string) => getComputedStyle(root).getPropertyValue(name).trim();
    const save = () => {
      try {
        const sat = read('--native-sat');
        const sab = read('--native-sab');
        // Only save real values: an empty/0 top inset means native hasn't
        // reported yet (saving it would persist the broken state). Bottom
        // may legitimately be 0 (gesture nav), so save it whenever present.
        if (sat && sat !== '0px') localStorage.setItem('vendi-native-sat', sat);
        if (sab) localStorage.setItem('vendi-native-sab', sab);
      } catch { /* storage unavailable — native values still apply */ }
    };
    try {
      // Restore before paint if native hasn't set them yet (reload case).
      // Top restores even from a reported 0 (a status bar always exists);
      // bottom restores only when unset (0 is valid for gesture nav).
      if (!read('--native-sat') || read('--native-sat') === '0px') {
        const sat = localStorage.getItem('vendi-native-sat');
        if (sat) root.style.setProperty('--native-sat', sat);
      }
      if (!read('--native-sab')) {
        const sab = localStorage.getItem('vendi-native-sab');
        if (sab) root.style.setProperty('--native-sab', sab);
      }
    } catch { /* ignore */ }
    save();
    // Keep stored values fresh whenever native updates them (rotation,
    // nav-mode switch): native writes via inline style on documentElement.
    const observer = new MutationObserver(save);
    observer.observe(root, { attributes: true, attributeFilter: ['style'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const isSlow = () => {
      const et = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection?.effectiveType;
      return et === 'slow-2g' || et === '2g';
    };
    const syncSlow = (announce: boolean) => {
      const slow = isSlow();
      if (slow && !netStateRef.current.slow && announce) {
        showGlobalToast('Slow connection — things may take longer to load', 'info');
      }
      netStateRef.current.slow = slow;
    };
    const goOffline = () => {
      if (!netStateRef.current.offline) showGlobalToast('No internet connection', 'error');
      netStateRef.current.offline = true;
    };
    const goOnline = () => {
      if (netStateRef.current.offline) showGlobalToast('Back online', 'success');
      netStateRef.current.offline = false;
      syncSlow(true);
    };
    const onConnChange = () => syncSlow(true);
    if (!navigator.onLine) {
      netStateRef.current.offline = true;
      showGlobalToast('No internet connection', 'error');
    } else {
      syncSlow(false);
    }
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    const conn = (navigator as Navigator & { connection?: { addEventListener?: Function; removeEventListener?: Function } }).connection;
    conn?.addEventListener?.('change', onConnChange);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
      conn?.removeEventListener?.('change', onConnChange);
    };
  }, []);

  // Fired once when the shell knows the auth state — the SplashOverlay listens
  // for this to lift (it also has its own safety timeout, so this can't trap).
  const readyDispatched = useRef(false);
  // One avatar-backfill attempt per app lifetime (see fetchUser below).
  const avatarBackfillTriedRef = useRef(false);
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
  useRubberBand(bounceRef, { scrollerId: 'main-scroll-container', top: true, bottom: true, ready: showShell });

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

      // Display value: the row first, then the auth metadata (Google's
      // picture). The row is what cards, the sidebar and the profile page
      // read, so when it has no avatar, copy the metadata photo into it —
      // the creation trigger does not always do this for Google sign-ins.
      // Only ever fills a missing avatar, never overwrites one the user chose.
      const avatarUrl =
        profile?.avatar_url ||
        session.user.user_metadata?.avatar_url ||
        session.user.user_metadata?.picture;
      if (!profile?.avatar_url && avatarUrl && !avatarBackfillTriedRef.current) {
        avatarBackfillTriedRef.current = true;
        await supabase
          .from('users')
          .update({ avatar_url: avatarUrl })
          .eq('id', session.user.id);
      }

      setUser({
        id: session.user.id,
        name: profile?.full_name || session.user.user_metadata?.full_name || "Campus Student",
        email: session.user.email || "",
        avatarUrl,
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

  // Closing the sidebar on navigation only: scroll-to-top belongs to
  // PageTransition (which owns #main-scroll-container). The old
  // window.scrollTo here was a no-op anyway — html/body are overflow: clip.
  useEffect(() => {
    setIsSidebarOpen(false);
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

  // Drop transition overlays after their animation: 300ms covers the 220ms
  // forward zoom and the 220ms back zoom, both finished well inside it.
  // The zoom's forwards fill holds the final state, so even a late settle
  // can't blank the page. Cleanup on the next navigation so a rapid tap
  // can't leave a stale overlay up. The back-zoom marker (no overlay)
  // exists so settle runs for back reveals too — without it, settle
  // would early-return on the null transition and the zoom class +
  // guard would linger.
  // Settling matters as much as dropping the overlay: the enter class +
  // z-10 must not linger on the current page. Settled renders plain.
  useEffect(() => {
    if (!transitionRef.current) return;
    const id = setTimeout(() => {
      transitionRef.current = null;
      if (stackModeRef.current === 'stack-enter' || stackModeRef.current === 'stack-reveal' || stackModeRef.current === 'stack-back') {
        stackModeRef.current = 'stack-settled';
      }
      setStackTick((v) => v + 1);
    }, 300);
    return () => clearTimeout(id);
  }, [pathname]);

  // Stack-managed scroll. PageTransition's own scroll-to-top is gated off in
  // stack modes, so this owns it — layout effect, before paint, no flash.
  // Kept pages never remount, so their useScrollRestore hooks don't re-run
  // and can't fight this; the direct set below is the only positioning.
  useIsoLayoutEffect(() => {
    if (stackModeRef.current === 'stack-none') return;
    if (typeof document === 'undefined') return;
    const main = document.getElementById('main-scroll-container');
    if (!main) return;
    if (stackModeRef.current === 'stack-enter') {
      main.scrollTop = 0;
    } else if (stackModeRef.current === 'stack-reveal' || stackModeRef.current === 'stack-back') {
      const w = wrapperRefs.current.get(pathname ?? '');
      const scroller = findPageScroller(w ?? null, main);
      if (scroller) scroller.scrollTop = savedScrollRef.current[pathname ?? ''] ?? 0;
    }
  }, [pathname]);

  // ---- Page-stack transition, computed during render ----
  // Shell-to-shell navigations only; anything else clears the stack and
  // falls back to PageTransition's plain div (no animation, never stuck).
  // Note: query-only changes (?receipt=, ?topup=) don't change pathname, so
  // they skip this entirely — the wallet's own overlay markers are untouched.
  let stackMode: StackMode;
  let renderKept: KeptEntry[];
  let renderCurrent: React.ReactNode;
  let transition: StackTransition | null;
  if (pathname !== prevPathRef.current) {
    const from = prevPathRef.current;
    // reaches here and never animates.

    const fromEl = prevChildrenRef.current;
    const fromShell = prevShellRef.current;
    // Capture the outgoing page's scroll while its DOM is still laid out
    // (commit hasn't happened yet). For main-scrolling pages this is main's
    // scrollTop; for pull-to-refresh / own-scroller pages it's the inner
    // scroller's — findPageScroller returns whichever actually scrolls.
    if (from && fromEl && fromShell && typeof document !== 'undefined') {
      const w = wrapperRefs.current.get(from);
      const scroller = findPageScroller(w ?? null, document.getElementById('main-scroll-container'));
      if (scroller) savedScrollRef.current[from] = scroller.scrollTop;
    }
    if (from && fromEl && fromShell && showShell) {
      const keptMatch = stackEntriesRef.current.find((e) => e.pathname === pathname);
      const back = isBackNavigation(pathname);
      if (keptMatch && back) {
        // Back to a kept page: the kept page zooms in (stack-back mode,
        // same vendi-zoom-in as forward) — visible and uniform with
        // forward, no overlay sliding out over it. The kept page is
        // already mounted and painted; scroll is still restored.
        // transition 'back-zoom' renders NO overlay: it is only a settle
        // marker, so the settle timer runs and drops the zoom class +
        // guard at 300ms (without a non-null transition, settle would
        // early-return and the zoom transform would linger). Outgoing
        // is dropped. Back to feed uses this same branch (no loader).
        stackMode = 'stack-back';
        transition = { kind: 'back-zoom' };
        renderKept = [];
        renderCurrent = keptMatch.element;
      } else if (keptMatch) {
        // Forward tap back to a kept tab: reveal it instantly, no animation.
        // The kept page is already mounted and painted — animating it in
        // reads as a repeat ("shows, then slides on itself"). Tabs switch
        // like native tab bars: instant, scroll restored (reveal mode),
        // outgoing page kept for the way back.
        stackMode = 'stack-reveal';
        transition = null;
        renderKept = [{ pathname: from, element: fromEl }];
        renderCurrent = keptMatch.element;
      } else if (back) {
        // Back to a page that isn't kept (two-step back, or back to feed
        // after a longer chain dropped it): fresh mount, but still zooms
        // (stack-back + settle marker) so every back nav zooms, not just
        // kept ones. Scroll restores from the last saved position for
        // this route (or top if never visited) — better than leaving
        // the outgoing page's scroll in place, which plain mode did.
        stackMode = 'stack-back';
        transition = { kind: 'back-zoom' };
        renderKept = [];
        renderCurrent = children;
      } else {
        // Forward to a new page: keep `from` (depth 1, hidden) for the
        // way back, and zoom the new page in exactly like a back nav —
        // single layer over blank, NO snapshot of the previous page
        // beneath it. The snapshot (two layers moving at once) read as
        // "shows the next page, then zooms on it again"; back was smooth
        // precisely because it had nothing beneath it, so forward does
        // the same now. transition 'forward' is only a settle marker.
        stackMode = 'stack-enter';
        transition = { kind: 'forward' };
        renderKept = [{ pathname: from, element: fromEl }];
        renderCurrent = children;
      }
    } else {
      // First mount, or a shell boundary (auth only): no stack.
      stackMode = 'stack-none';
      transition = null;
      renderKept = [];
      renderCurrent = children;
    }
    stackEntriesRef.current = renderKept;
    stackModeRef.current = stackMode;
    currentElRef.current = renderCurrent;
    transitionRef.current = transition;
    prevPathRef.current = pathname;
    prevChildrenRef.current = children;
    prevShellRef.current = showShell;
  } else {
    stackMode = stackModeRef.current;
    renderKept = stackEntriesRef.current;
    renderCurrent = currentElRef.current ?? children;
    transition = transitionRef.current;
  }

  // Keyed by route, so React moves (never remounts) an entry when it goes
  // from current to kept and back. Each entry is cloned with its own
  // pagePath so PageTransition's slide div keeps a stable key per entry —
  // keying it by the global pathname would remount the page on every
  // navigation and defeat the keep-alive. display:none entries take no
  // space, so main's scroll height is the current page's alone.
  const renderEntries: KeptEntry[] = [...renderKept, { pathname: pathname ?? '', element: renderCurrent }];

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
          gesture-nav phones keep the tighter spacing. /chats is the one
          exception: its nav slides down while the room is open, so it
          needs only the bottom inset — the room fills the rest. */}
      <main
        id="main-scroll-container"
        className={`flex-1 w-full ${pathname === '/chats' ? 'overflow-hidden' : 'overflow-y-auto overflow-x-clip overscroll-y-contain'} relative`}
        style={{ paddingBottom: pathname === '/chats' ? 'calc(var(--sab))' : 'calc(6rem + var(--sab))' }}
      >
        {/* Bounce wrapper: the rubber-band transform applies here, around page
            content only. Fixed elements (bottom nav, modals, toasts) live
            outside it so a transform never breaks their positioning. */}
        <div ref={bounceRef}>
          <div className="max-w-[1600px] mx-auto w-full relative">
            <StackContext.Provider value={stackMode}>
              {renderEntries.map((e) => {
                const isCurrent = e.pathname === (pathname ?? '');
                const isVisible = isCurrent;
                return (
                  <div
                    key={e.pathname}
                    ref={(el) => {
                      if (el) wrapperRefs.current.set(e.pathname, el);
                      else wrapperRefs.current.delete(e.pathname);
                    }}
                    className={`${e.pathname === '/chats' ? 'w-full px-0' : 'w-full px-4 md:px-8'} ${isCurrent ? 'relative z-10' : 'relative z-0'}`}
                    style={{
                      display: isVisible ? 'block' : 'none',
                      pointerEvents: isCurrent ? 'auto' : 'none',
                    }}
                  >
                    {React.isValidElement(e.element)
                      ? React.cloneElement(e.element as React.ReactElement<{ pagePath?: string }>, { pagePath: e.pathname })
                      : e.element}
                  </div>
                );
              })}
            </StackContext.Provider>
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
