"use client";

import React, { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { supabase } from '@/lib/supabase';
import { IonIcon } from '@ionic/react';
import { 
  personOutline, 
  settingsOutline, 
  documentTextOutline, 
  shieldCheckmarkOutline, 
  logOutOutline, 
  closeOutline,
  chevronForwardOutline,
  starOutline,
  bookmarkOutline,
  alertCircleOutline,
  informationCircleOutline,
  shieldHalfOutline,
  flagOutline,
  helpCircleOutline,
  peopleOutline
} from 'ionicons/icons';
import { Avatar } from '@/shared/Avatar';
import { Modal } from '@/shared/Modal/Modal';
import { Button } from '@/shared/Button';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  user: { id?: string; name?: string; email?: string; avatarUrl?: string } | null;
}

export const Sidebar = ({ isOpen, onClose, user }: SidebarProps) => {
  const router = useRouter();

  // --- Hydration Mismatch Fix ---
  // We wait until the component mounts on the client before rendering Ionic web components
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // --- Modal State ---
  const [showSignOutModal, setShowSignOutModal] = useState(false);

  // --- Swipe-to-close State ---
  const touchStartX = useRef<number | null>(null);
  const [swipeOffset, setSwipeOffset] = useState(0);

  // 1. Fetch auth user to get the ID if not passed in props
  const { data: sessionUser } = useSWR('local-session', async () => {
    const { data } = await supabase.auth.getUser();
    return data?.user || null;
  });

  const targetId = user?.id || sessionUser?.id;

  // 2. Fetch real user profile dynamically via SWR
  const { data: profile, isLoading: isFetchingProfile } = useSWR(
    targetId ? `profile-${targetId}` : null,
    async () => {
      const { data, error } = await supabase
        .from('users')
        .select('full_name, avatar_url, email')
        .eq('id', targetId)
        .single();
        
      if (error) throw error;
      return data;
    }
  );

  const realAvatar = profile?.avatar_url || user?.avatarUrl;
  const realName = profile?.full_name || user?.name;
  const realEmail = profile?.email || user?.email;

  // Prevent body scroll when open
  useEffect(() => {
    if (isOpen || showSignOutModal) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => { document.body.style.overflow = 'unset'; };
  }, [isOpen, showSignOutModal]);

  // Handle Navigation with BFCache Trick
  const handleNavigation = (route: string) => {
    router.push(route);
    // Delay closing so the browser's Back-Forward Cache (BFCache) snapshots the page with the sidebar OPEN.
    // When the user presses the back button, it restores the open state.
    setTimeout(() => {
      onClose();
    }, 150);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setShowSignOutModal(false);
    onClose();
    window.location.href = '/'; 
  };

  // --- Swipe Gestures ---
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const diff = e.touches[0].clientX - touchStartX.current;
    // Only allow sliding to the right (positive diff)
    if (diff > 0) {
      setSwipeOffset(diff);
    }
  };

  const onTouchEnd = () => {
    // If they swiped more than 80px to the right, close it
    if (swipeOffset > 80) {
      onClose();
    }
    setSwipeOffset(0);
    touchStartX.current = null;
  };

  const ACCOUNT_LINKS = [
    { name: 'My Profile', icon: personOutline, path: targetId ? `/profile?id=${targetId}` : '/profile' },
    { name: 'Verification', icon: shieldCheckmarkOutline, path: '/verification' },
    { name: 'My Reviews', icon: starOutline, path: '/reviews' },
    { name: 'Saved Items', icon: bookmarkOutline, path: '/saved' },
    { name: 'Disputes & Resolutions', icon: alertCircleOutline, path: '/disputes' },
    { name: 'Settings', icon: settingsOutline, path: '/settings' },
  ];

  const SUPPORT_LINKS = [
    { name: 'How Vendi works', icon: informationCircleOutline, path: '/how-it-works' },
    { name: 'Safety Center', icon: shieldHalfOutline, path: '/safety' },
    { name: 'Report a User', icon: flagOutline, path: '/report' },
    { name: 'Help and Support', icon: helpCircleOutline, path: '/support' },
    { name: 'Terms and Policies', icon: documentTextOutline, path: '/terms' },
    { name: 'About Us', icon: peopleOutline, path: '/about' },
  ];

  // Calculate inline transform for smooth swipe interactions
  const panelTransform = isOpen 
    ? `translateX(${swipeOffset}px)` 
    : 'translateX(100%)';
  
  const panelTransition = swipeOffset > 0 ? 'none' : 'transform 300ms ease-in-out';

  return (
    <>
      <div className={`fixed inset-0 flex justify-end transition-all duration-300 ${showSignOutModal ? 'z-30' : 'z-[100]'} ${isOpen || showSignOutModal ? 'pointer-events-auto' : 'pointer-events-none'}`}>
        
        {/* Blurred Backdrop */}
        <div 
          className={`absolute inset-0 bg-[#0f172a]/40 dark:bg-black/70 backdrop-blur-sm transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0'}`}
          onClick={onClose}
        />

        {/* Sliding Panel */}
        <div 
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          style={{ transform: panelTransform, transition: panelTransition }}
          className="absolute top-0 right-0 h-full w-[85vw] max-w-[340px] bg-white dark:bg-[#111b21] shadow-2xl flex flex-col rounded-l-3xl overflow-hidden"
        >
          
          <div className="absolute top-6 right-6 z-10">
            <button 
              onClick={onClose} 
              className="!p-2 text-gray-400 hover:text-gray-900 dark:text-gray-500 dark:hover:text-white transition-colors active:scale-95 !rounded-full"
            >
              {isMounted ? <IonIcon icon={closeOutline} className="text-3xl" /> : <div className="w-[30px] h-[30px]" />}
            </button>
          </div>

          {/* Sidebar Header & User Info (Clickable!) */}
          <div 
            onClick={() => handleNavigation(targetId ? `/profile?id=${targetId}` : '/profile')}
            className="px-8 pt-12 pb-8 flex flex-col gap-5 cursor-pointer active:opacity-70 transition-opacity"
          >
            {isFetchingProfile && !realName ? (
              // SKELETON PREVENTS FLASHING
              <div className="animate-pulse flex flex-col gap-4">
                <div className="w-20 h-20 rounded-full bg-gray-200 dark:bg-gray-800" />
                <div className="flex flex-col gap-2 mt-2">
                  <div className="w-3/4 h-6 rounded bg-gray-200 dark:bg-gray-800" />
                  <div className="w-1/2 h-4 rounded bg-gray-200 dark:bg-gray-800" />
                </div>
              </div>
            ) : (
              <>
                <Avatar src={realAvatar} name={realName || "User"} size="xl" />
                <div className="flex flex-col mt-2">
                  <h3 className="font-black text-xl text-gray-900 dark:text-white mb-0.5 tracking-tight">
                    {realName || "Campus Student"}
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 font-medium truncate pr-4">
                    {realEmail || "Verify your account"}
                  </p>
                </div>
              </>
            )}
          </div>

          {/* Navigation Links */}
          <div className="flex-1 overflow-y-auto px-8 pb-12 scrollbar-hide">
            
            <div className="flex flex-col gap-6">
              <p className="text-[11px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-[0.2em] mb-2">
                Account
              </p>
              {ACCOUNT_LINKS.map((link) => (
                <button 
                  key={link.name}
                  onClick={() => handleNavigation(link.path)} 
                  className="w-full flex items-center justify-between py-3 group active:opacity-60 transition-opacity"
                >
                  <div className="flex items-center gap-6">
                    {isMounted ? (
                      <IonIcon icon={link.icon} className="text-[24px] text-orange-500 transition-colors" />
                    ) : (
                      <div className="w-[24px] h-[24px]" /> // Placeholder prevents layout shift
                    )}
                    <span className="text-[16px] font-bold text-gray-800 dark:text-gray-100">{link.name}</span>
                  </div>
                  {isMounted ? (
                    <IonIcon icon={chevronForwardOutline} className="text-gray-300 dark:text-gray-600 text-sm" />
                  ) : (
                    <div className="w-[14px] h-[14px]" /> // Placeholder
                  )}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-6 mt-12">
              <p className="text-[11px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-[0.2em] mb-2">
                Legal & Support
              </p>
              {SUPPORT_LINKS.map((link) => (
                <button 
                  key={link.name}
                  onClick={() => handleNavigation(link.path)} 
                  className="w-full flex items-center justify-between py-3 group active:opacity-60 transition-opacity"
                >
                  <div className="flex items-center gap-6">
                    {isMounted ? (
                      <IonIcon icon={link.icon} className="text-[24px] text-orange-500 transition-colors" />
                    ) : (
                      <div className="w-[24px] h-[24px]" /> // Placeholder prevents layout shift
                    )}
                    <span className="text-[16px] font-bold text-gray-800 dark:text-gray-100">{link.name}</span>
                  </div>
                  {isMounted ? (
                    <IonIcon icon={chevronForwardOutline} className="text-gray-300 dark:text-gray-600 text-sm" />
                  ) : (
                    <div className="w-[14px] h-[14px]" /> // Placeholder
                  )}
                </button>
              ))}
            </div>

          </div>

          {/* Bigger Sign Out Footer */}
          <div className="p-8 mt-auto border-t border-gray-100 dark:border-gray-800/50">
            <button 
              onClick={() => setShowSignOutModal(true)}
              className="w-full flex items-center justify-center gap-3 px-4 py-5 !rounded-full bg-red-50 dark:bg-red-500/10 border border-transparent dark:border-red-500/20 text-red-600 dark:text-red-500 hover:bg-red-100 dark:hover:bg-red-500/20 active:scale-[0.98] transition-all font-black text-lg"
            >
              {isMounted ? <IonIcon icon={logOutOutline} className="text-2xl" /> : <div className="w-[24px] h-[24px]" />}
              <span>Sign Out</span>
            </button>
          </div>

        </div>
      </div>

      {/* Sign Out Confirmation Modal */}
      <Modal isOpen={showSignOutModal} onClose={() => setShowSignOutModal(false)}>
        <div className="p-6 text-center relative z-[999]">
          {isMounted ? (
            <IonIcon icon={logOutOutline} className="text-6xl mb-4 text-red-500" />
          ) : (
            <div className="w-[60px] h-[60px] mx-auto mb-4" />
          )}
          <h2 className="text-xl font-black mb-2 text-gray-900 dark:text-white tracking-tight">Sign Out?</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-8 font-medium leading-relaxed">
            Are you sure you want to sign out of your Vendi account?
          </p>
          <div className="flex flex-col gap-3">
            <Button 
              onClick={handleSignOut} 
              className="w-full !rounded-full !py-3.5 !bg-red-500 hover:!bg-red-600 shadow-lg shadow-red-500/30 text-white font-black transition-all active:scale-[0.98]"
            >
              Yes, Sign Out
            </Button>
            <Button 
              onClick={() => setShowSignOutModal(false)} 
              className="w-full !rounded-full !py-3.5 !bg-gray-200 dark:!bg-gray-800 !text-gray-900 dark:!text-white font-bold hover:!bg-gray-300 dark:hover:!bg-gray-700 transition-colors"
            >
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
};