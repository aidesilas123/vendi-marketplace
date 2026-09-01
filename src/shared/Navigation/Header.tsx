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
  const [isCheckingAuth, setIsCheckingAuth] = useState(true); // New state to prevent flashing

  useEffect(() => {
    // If we already have the user prop, auth is resolved.
    if (user) {
      setIsCheckingAuth(false);
      return;
    }
    
    // Otherwise, quickly check the local session to see if we are actually logged out
    const checkLocalSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        setIsCheckingAuth(false); // Definitely logged out, safe to show Login button
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
    <div className="sticky top-0 z-40 bg-background/80 backdrop-blur-lg border-b border-border px-4 py-3 flex items-center justify-between shadow-sm">

      <div className="flex flex-col">
        <h1 className="text-lg font-black text-foreground leading-tight">Vendi</h1>
      </div>

      <div className="flex items-center gap-2">
        <button 
          onClick={handleRefresh}
          className="w-10 h-10 rounded-full bg-transparent flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
        >
          <span suppressHydrationWarning className="flex items-center justify-center">
            <IonIcon icon={refreshOutline} className={`text-xl ${isRefreshing ? 'animate-spin' : ''}`} />
          </span>
        </button>

        {user ? (
          <>
            <button className="relative w-10 h-10 rounded-full bg-transparent flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors">
              <span suppressHydrationWarning className="flex items-center justify-center">
                <IonIcon icon={notificationsOutline} className="text-xl" />
              </span>
              {unreadNotifications > 0 && (
                <span className="absolute top-2 right-2 w-2.5 h-2.5 bg-red-500 border-2 border-background rounded-full"></span>
              )}
            </button>

            <div onClick={onOpenSidebar} className="cursor-pointer ml-2">
              <Avatar src={user?.avatarUrl} name={user?.name || "Student"} size="sm" />
            </div>
          </>
        ) : isCheckingAuth ? (
          // SHOW SKELETON INSTEAD OF FLASHING "LOGIN"
          <div className="w-10 h-10 ml-2 rounded-full bg-muted animate-pulse" />
        ) : (
          <Link 
            href="/login" 
            className="bg-orange-500 hover:bg-orange-600 text-white font-black text-[10px] sm:text-xs px-4 py-2 sm:px-5 sm:py-2.5 rounded-full shadow-sm transition-colors uppercase tracking-wider ml-2"
          >
            Login
          </Link>
        )}
      </div>
    </div>
  );
};