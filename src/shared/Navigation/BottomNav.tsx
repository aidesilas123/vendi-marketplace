"use client";
// src/shared/Navigation/BottomNav.tsx

import React, { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import IonIcon from '@/shared/Icon/Icon';
import { 
  homeOutline, home, 
  receiptOutline, receipt, 
  walletOutline, wallet, 
  chatbubblesOutline, chatbubbles,
  storefrontOutline, storefront
} from 'ionicons/icons';
import { useHideOnScroll } from '@/shared/hooks/useHideOnScroll';
import { useSessionUserId } from '@/features/wallet/useWallet';
import useSWR from 'swr';
import { supabase } from '@/lib/supabase';

async function fetchUnreadChats(userId: string) {
  const { count, error } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('receiver_id', userId)
    .neq('status', 'read');
  if (error) throw error;
  return count ?? 0;
}

// Same counts the Sidebar badges use: unanswered questions + new reviews (last 7 days).
async function fetchSellerBadges(userId: string) {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const [productsRes, reviewsRes] = await Promise.all([
    supabase.from('products').select('id').eq('seller_id', userId),
    supabase.from('seller_reviews').select('id', { count: 'exact', head: true }).eq('seller_id', userId).gte('created_at', sevenDaysAgo.toISOString()),
  ]);
  const ids = (productsRes.data ?? []).map((p: any) => p.id);
  let unanswered = 0;
  if (ids.length > 0) {
    const { data: qa } = await supabase.from('product_reviews').select('id, parent_id').in('product_id', ids);
    const repliedTo = new Set((qa ?? []).filter((q: any) => q.parent_id).map((q: any) => q.parent_id));
    unanswered = (qa ?? []).filter((q: any) => !q.parent_id && !repliedTo.has(q.id)).length;
  }
  return { unanswered, newReviews: reviewsRes.count ?? 0 };
}

export const BottomNav = () => {
  const pathname = usePathname();
  const router = useRouter();
  const isVisible = useHideOnScroll('main-scroll-container');
  // undefined = session still being checked, null = signed out, string = signed in
  const sessionUserId = useSessionUserId();

  const { data: unreadChats, mutate: mutateChats } = useSWR(
    sessionUserId ? (['bottomnav-unread-chats', sessionUserId] as const) : null,
    ([, id]) => fetchUnreadChats(id)
  );
  const { data: sellerBadges, mutate: mutateSellerBadges } = useSWR(
    sessionUserId ? (['bottomnav-seller-badges', sessionUserId] as const) : null,
    ([, id]) => fetchSellerBadges(id)
  );
  // BottomNav stays mounted across pages, so refetch on navigation (plus SWR's
  // default focus/reconnect revalidation) to keep the badges fresh.
  useEffect(() => {
    void mutateChats();
    void mutateSellerBadges();
  }, [pathname, mutateChats, mutateSellerBadges]);

  const navItems = [
    { name: "Feed", route: "/", outline: homeOutline, solid: home },
    { name: "Orders", route: "/transactions", outline: receiptOutline, solid: receipt },
    { name: "Chats", route: "/messages", outline: chatbubblesOutline, solid: chatbubbles },
    { name: "Wallet", route: "/wallet", outline: walletOutline, solid: wallet },
  ];

  const handleHomeClick = (e: React.MouseEvent, route: string) => {
    if (pathname === '/' && route === '/') {
      e.preventDefault();
      const main = document.getElementById('main-scroll-container');
      if (main) main.scrollTo({ top: 0, behavior: 'smooth' });
      window.dispatchEvent(new Event('refresh-feed'));
    }
  };

  // Wallet needs an account: taps while signed out go to login, then back to Wallet.
  const handleProtectedClick = (e: React.MouseEvent, route: string) => {
    if (route === '/wallet' && sessionUserId === null) {
      e.preventDefault();
      router.push('/login?redirect=/wallet');
    }
  };

  const badgeFor = (name: string) => (name === 'Chats' ? (unreadChats ?? 0) : 0);
  const sellerBadgeCount = (sellerBadges?.unanswered ?? 0) + (sellerBadges?.newReviews ?? 0);

  return (
    // The nav is pinned to the very bottom of the screen (fixed bottom-0), so its
    // white background extends behind the system navigation bar. The safe-area
    // inset is applied ONCE, as bottom padding below, which lifts the icons above
    // the system buttons. --sab prefers the true native inset (bridged from
    // MainActivity) over env(), so 3-button phones lift the icons and gesture
    // phones stay full-screen. Don't add a bottom offset or safe-area padding to
    // the wrapper that renders <BottomNav />, or the gap will come back.
    <div
      className={`fixed bottom-0 inset-x-0 z-50 bg-white dark:bg-black border-t border-gray-200 dark:border-gray-800 shadow-[0_-4px_20px_rgba(0,0,0,0.05)] pt-2 px-2 sm:px-6 rounded-t-3xl sm:rounded-none select-none ${isVisible ? 'translate-y-0' : 'translate-y-[150%] transition-transform duration-300 ease-in-out'}`}
      style={{ paddingBottom: "var(--sab)" }}
    >
      {/* max-w-lg keeps spacing tight on tablets; a single justify-between flex wrapper */}
      <div className="max-w-lg mx-auto flex justify-between items-center relative h-14">
        
        {/* Left Icons */}
        {navItems.slice(0, 2).map((item) => {
          const isActive = pathname === item.route || (item.route !== '/' && pathname.startsWith(item.route));
          return (
            <Link
              key={item.name}
              href={item.route}
              onClick={(e) => handleHomeClick(e, item.route)}
              className="bottom-nav-link flex flex-col items-center justify-center gap-1 w-16 outline-none focus:outline-none focus:ring-0 active:outline-none border-0 shadow-none"
            >
              <span suppressHydrationWarning className="relative flex items-center justify-center">
                <IonIcon icon={isActive ? item.solid : item.outline} className={`text-[22px] transition-colors ${isActive ? 'text-orange-500' : 'text-gray-400 dark:text-gray-500'}`} />
                {badgeFor(item.name) > 0 && (
                  <span className="absolute -top-1.5 -right-2 min-w-[18px] h-[18px] px-1 rounded-full bg-orange-500 text-white text-[10px] font-black flex items-center justify-center">{badgeFor(item.name) > 99 ? '99+' : badgeFor(item.name)}</span>
                )}
              </span>
              <span className={`text-[10px] font-bold uppercase tracking-wider ${isActive ? 'text-orange-500' : 'text-gray-400 dark:text-gray-500'}`}>{item.name}</span>
            </Link>
          );
        })}

        {/* Empty spacer to force equal distribution around the floating Seller button */}
        <div className="w-16"></div>

        {/* Floating Seller Button (remains absolutely centered) */}
        <div className="absolute left-1/2 -translate-x-1/2 -top-8">
          <Link href="/seller" className="bottom-nav-link relative flex flex-col items-center justify-center outline-none focus:outline-none border-0 shadow-none">
            <div className={`w-14 h-14 rounded-full flex items-center justify-center shadow-xl transition-transform active:scale-95 ${pathname.includes('/seller') ? 'bg-orange-600 border-4 border-orange-200 dark:border-orange-900/30' : 'bg-orange-500 border-4 border-white dark:border-black'}`}>
              <span suppressHydrationWarning className="flex items-center justify-center">
                <IonIcon icon={pathname.includes('/seller') ? storefront : storefrontOutline} className="text-white text-2xl" />
              </span>
            </div>
            {sellerBadgeCount > 0 && (
              <span className="absolute -top-1 right-0 min-w-[18px] h-[18px] px-1 rounded-full bg-orange-500 text-white text-[10px] font-black flex items-center justify-center">{sellerBadgeCount > 99 ? '99+' : sellerBadgeCount}</span>
            )}
            <span className={`text-[10px] font-bold uppercase tracking-widest mt-1 ${pathname.includes('/seller') ? 'text-orange-500' : 'text-gray-500 dark:text-gray-400'}`}>Seller</span>
          </Link>
        </div>

        {/* Right Icons */}
        {navItems.slice(2, 4).map((item) => {
          const isActive = pathname === item.route || (item.route !== '/' && pathname.startsWith(item.route));
          return (
            <Link
              key={item.name}
              href={item.route}
              onClick={(e) => handleProtectedClick(e, item.route)}
              className="bottom-nav-link flex flex-col items-center justify-center gap-1 w-16 outline-none focus:outline-none focus:ring-0 active:outline-none border-0 shadow-none"
            >
              <span suppressHydrationWarning className="relative flex items-center justify-center">
                <IonIcon icon={isActive ? item.solid : item.outline} className={`text-[22px] transition-colors ${isActive ? 'text-orange-500' : 'text-gray-400 dark:text-gray-500'}`} />
                {badgeFor(item.name) > 0 && (
                  <span className="absolute -top-1.5 -right-2 min-w-[18px] h-[18px] px-1 rounded-full bg-orange-500 text-white text-[10px] font-black flex items-center justify-center">{badgeFor(item.name) > 99 ? '99+' : badgeFor(item.name)}</span>
                )}
              </span>
              <span className={`text-[10px] font-bold uppercase tracking-wider ${isActive ? 'text-orange-500' : 'text-gray-400 dark:text-gray-500'}`}>{item.name}</span>
            </Link>
          );
        })}

      </div>
    </div>
  );
};
