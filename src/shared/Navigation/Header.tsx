"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import IonIcon from '@/shared/Icon/Icon';
import { notificationsOutline, refreshOutline } from 'ionicons/icons';
import { Avatar } from '@/shared/Avatar';

interface HeaderProps {
  onOpenSidebar: () => void;
  onRefreshData?: () => Promise<void>; 
  user: { name: string; avatarUrl?: string } | null;
  unreadNotifications?: number;
}

export const Header = ({ onOpenSidebar, onRefreshData, user, unreadNotifications = 0 }: HeaderProps) => {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  useEffect(() => {
    if (user) {
      setIsCheckingAuth(false);
      return;
    }
    const checkLocalSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        setIsCheckingAuth(false);
      }
    };
    checkLocalSession();
  }, [user]);

  const handleRefresh = async () => {
    const main = document.getElementById('main-scroll-container');
    if (main) main.scrollTo({ top: 0, behavior: 'smooth' });

    setIsRefreshing(true);
    if (onRefreshData) {
      await onRefreshData();
    } else {
      await new Promise(res => setTimeout(res, 1000));
    }
    setIsRefreshing(false);
  };

  return (
    <div className="sticky top-0 z-40 bg-background/80 backdrop-blur-lg border-b border-border px-4 pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-2 flex items-center justify-between shadow-sm">

      <div className="flex items-center gap-2">
        {/* Replace '/icon.png' with the actual path to your logo in the public folder */}
        <img src="/icon.png" alt="Vendi Logo" className="w-6 h-6 rounded-md object-contain shadow-sm" />
        <h1 className="text-lg font-black text-foreground leading-none mb-0">Vendi</h1>
      </div>

      <div className="flex items-center gap-2">
        <button 
          onClick={handleRefresh}
          className="w-9 h-9 flex-shrink-0 rounded-full bg-transparent flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
        >
          <span suppressHydrationWarning className="flex items-center justify-center">
            <IonIcon icon={refreshOutline} className={`text-xl ${isRefreshing ? 'animate-spin' : ''}`} />
          </span>
        </button>

        {user ? (
          <>
            <button className="relative w-9 h-9 flex-shrink-0 rounded-full bg-transparent flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors">
              <span suppressHydrationWarning className="flex items-center justify-center">
                <IonIcon icon={notificationsOutline} className="text-xl" />
              </span>
              {unreadNotifications > 0 && (
                <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-red-500 border-2 border-background rounded-full"></span>
              )}
            </button>

            <div 
              onClick={onOpenSidebar} 
              className="cursor-pointer w-9 h-9 flex-shrink-0 rounded-full overflow-hidden flex items-center justify-center"
            >
              <Avatar src={user?.avatarUrl} name={user?.name || "Student"} size="sm" />
            </div>
          </>
        ) : isCheckingAuth ? (
          <div className="w-9 h-9 flex-shrink-0 rounded-full bg-muted animate-pulse" />
        ) : (
          <Link 
            href="/login" 
            className="bg-orange-500 hover:bg-orange-600 text-white font-black text-[10px] sm:text-xs px-4 py-2 sm:px-5 sm:py-2.5 rounded-full shadow-sm transition-colors uppercase tracking-wider"
          >
            Login
          </Link>
        )}
      </div>
    </div>
  );
};