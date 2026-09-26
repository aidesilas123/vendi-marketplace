"use client";

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import IonIcon from '@/shared/Icon/Icon';
import { 
  homeOutline, home, 
  receiptOutline, receipt, 
  walletOutline, wallet, 
  chatbubblesOutline, chatbubbles,
  storefrontOutline, storefront
} from 'ionicons/icons';
import { useHideOnScroll } from '@/shared/hooks/useHideOnScroll';

export const BottomNav = () => {
  const pathname = usePathname();
  const isVisible = useHideOnScroll('main-scroll-container');

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

  return (
    <div className={`w-full bg-white dark:bg-[#0f172a] border-t border-gray-200 dark:border-gray-800 shadow-[0_-4px_20px_rgba(0,0,0,0.05)] pb-safe pt-2 px-2 sm:px-6 rounded-t-3xl sm:rounded-none transition-transform duration-300 ease-in-out ${isVisible ? 'translate-y-0' : 'translate-y-[150%]'}`}>
      {/* Changed to max-w-lg to keep spacing tight on tablets, and used a single justify-between flex wrapper */}
      <div className="max-w-lg mx-auto flex justify-between items-center relative h-14">
        
        {/* Left Icons */}
        {navItems.slice(0, 2).map((item) => {
          const isActive = pathname === item.route || pathname.startsWith(`${item.route}?`); 
          return (
            <Link key={item.name} href={item.route} onClick={(e) => handleHomeClick(e, item.route)} className="flex flex-col items-center justify-center gap-1 w-16">
              <span suppressHydrationWarning className="flex items-center justify-center">
                <IonIcon icon={isActive ? item.solid : item.outline} className={`text-[22px] transition-colors ${isActive ? 'text-orange-500' : 'text-gray-400 dark:text-gray-500'}`} />
              </span>
              <span className={`text-[9px] font-black uppercase tracking-wider ${isActive ? 'text-orange-500' : 'text-gray-400 dark:text-gray-500'}`}>{item.name}</span>
            </Link>
          );
        })}

        {/* Empty Spacer to force equal distribution around the floating Seller Button */}
        <div className="w-16"></div>

        {/* Floating Seller Button (Remains Absolute Centered) */}
        <div className="absolute left-1/2 -translate-x-1/2 -top-8">
          <Link href="/seller" className="flex flex-col items-center justify-center">
            <div className={`w-14 h-14 rounded-full flex items-center justify-center shadow-xl transition-transform active:scale-95 ${pathname.includes('/seller') ? 'bg-orange-600 border-4 border-orange-200 dark:border-orange-900/30' : 'bg-orange-500 border-4 border-white dark:border-[#0f172a]'}`}>
              <span suppressHydrationWarning className="flex items-center justify-center">
                <IonIcon icon={pathname.includes('/seller') ? storefront : storefrontOutline} className="text-white text-2xl" />
              </span>
            </div>
            <span className={`text-[10px] font-black uppercase tracking-widest mt-1 ${pathname.includes('/seller') ? 'text-orange-500' : 'text-gray-500 dark:text-gray-400'}`}>Seller</span>
          </Link>
        </div>

        {/* Right Icons */}
        {navItems.slice(2, 4).map((item) => {
          const isActive = pathname === item.route || pathname.startsWith(`${item.route}?`);
          return (
            <Link key={item.name} href={item.route} className="flex flex-col items-center justify-center gap-1 w-16">
              <span suppressHydrationWarning className="flex items-center justify-center">
                <IonIcon icon={isActive ? item.solid : item.outline} className={`text-[22px] transition-colors ${isActive ? 'text-orange-500' : 'text-gray-400 dark:text-gray-500'}`} />
              </span>
              <span className={`text-[9px] font-black uppercase tracking-wider ${isActive ? 'text-orange-500' : 'text-gray-400 dark:text-gray-500'}`}>{item.name}</span>
            </Link>
          );
        })}

      </div>
    </div>
  );
};