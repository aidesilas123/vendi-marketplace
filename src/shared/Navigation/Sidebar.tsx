// src/shared/Navigation/Sidebar.tsx
"use client";

import React, { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import useSWR, { useSWRConfig } from 'swr';
import { supabase } from '@/lib/supabase';
import { IonIcon } from '@/shared/Icon/Icon';
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
  chatbubblesOutline,
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
import { showGlobalToast } from '@/shared/Toast/Toast';
import { registerBackHandler } from '@/shared/HardwareBackButton';
import { unregisterPushToken } from '@/lib/push';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  user: { id?: string; name?: string; email?: string; avatarUrl?: string } | null;
}

export const Sidebar = ({ isOpen, onClose, user }: SidebarProps) => {
  const router = useRouter();

  // --- Modal State ---
  const [showSignOutModal, setShowSignOutModal] = useState(false);

  // --- Swipe-to-close State ---
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const isHorizontalSwipe = useRef<boolean | null>(null);
  const [swipeOffset, setSwipeOffset] = useState(0);

  // Keyboard Escape listener
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  // System back button: close the sign-out modal first, then the sidebar —
  // never let it exit the app or navigate while the drawer is open.
  useEffect(() => {
    if (!isOpen && !showSignOutModal) return;
    return registerBackHandler(() => {
      if (showSignOutModal) {
        setShowSignOutModal(false);
      } else {
        onClose();
      }
      return true;
    });
  }, [isOpen, showSignOutModal, onClose]);

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
    },
    // Live profile: re-read on app return too, not just on mount.
    { revalidateOnFocus: true }
  );

  // The sidebar stays mounted inside AppShell, so this key never changes on
  // its own — without this, an avatar saved on the edit page never showed
  // up here (the cached row kept winning over AppShell's fresh prop).
  // Re-read the row whenever any profile save dispatches refresh-profile.
  const { mutate: mutateProfile } = useSWRConfig();
  useEffect(() => {
    const refresh = () => {
      if (targetId) void mutateProfile(`profile-${targetId}`);
    };
    window.addEventListener('refresh-profile', refresh);
    return () => window.removeEventListener('refresh-profile', refresh);
  }, [targetId, mutateProfile]);

  const realAvatar = profile?.avatar_url || user?.avatarUrl;
  const realName = profile?.full_name || user?.name;
  const realEmail = profile?.email || user?.email;

  // 3. Badge counts: unanswered questions + new reviews (last 7 days)
  const { data: badgeCounts } = useSWR(
    targetId ? `sidebar-badges-${targetId}` : null,
    async () => {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const [productsRes, reviewsRes] = await Promise.all([
        supabase.from('products').select('id').eq('seller_id', targetId),
        supabase.from('seller_reviews').select('id', { count: 'exact', head: true }).eq('seller_id', targetId).gte('created_at', sevenDaysAgo.toISOString()),
      ]);
      const ids = (productsRes.data ?? []).map((p: any) => p.id);
      let unanswered = 0;
      if (ids.length > 0) {
        const { data: qa } = await supabase.from('product_reviews').select('id, parent_id').in('product_id', ids);
        const repliedTo = new Set((qa ?? []).filter((q: any) => q.parent_id).map((q: any) => q.parent_id));
        unanswered = (qa ?? []).filter((q: any) => !q.parent_id && !repliedTo.has(q.id)).length;
      }
      return { unanswered, newReviews: reviewsRes.count ?? 0, isSeller: ids.length > 0 };
    }
  );

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
    await unregisterPushToken();
    await supabase.auth.signOut();
    setShowSignOutModal(false);
    onClose();
    showGlobalToast('Logged out');
    // Let the toast be seen before the hard navigation wipes it
    setTimeout(() => {
      window.location.href = '/';
    }, 1200);
  };

  // --- Swipe Gestures ---
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    isHorizontalSwipe.current = null;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const diffX = e.touches[0].clientX - touchStartX.current;
    const diffY = e.touches[0].clientY - touchStartY.current;

    // Disambiguate horizontal swipe from vertical scrolling
    if (isHorizontalSwipe.current === null) {
      if (Math.abs(diffX) > 8 || Math.abs(diffY) > 8) {
        isHorizontalSwipe.current = Math.abs(diffX) > Math.abs(diffY);
      }
    }

    // Only allow sliding to the right if horizontal swipe is confirmed
    if (isHorizontalSwipe.current && diffX > 0) {
      setSwipeOffset(diffX);
    }
  };

  const onTouchEnd = () => {
    // If swiped more than 80px to the right, close it
    if (swipeOffset > 80) {
      onClose();
    }
    setSwipeOffset(0);
    touchStartX.current = null;
    touchStartY.current = null;
    isHorizontalSwipe.current = null;
  };

  const ACCOUNT_LINKS: { name: string; icon: string; path: string; badge?: number; hide?: boolean }[] = [
    { name: 'My Profile', icon: personOutline, path: targetId ? `/profile?id=${targetId}` : '/profile' },
    { name: 'Verification', icon: shieldCheckmarkOutline, path: '/verification' },
    { name: 'My Reviews', icon: starOutline, path: '/reviews', badge: badgeCounts?.newReviews ?? 0 },
    { name: 'Questions', icon: chatbubblesOutline, path: '/questions', badge: badgeCounts?.unanswered ?? 0, hide: !badgeCounts?.isSeller },
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
          role="dialog"
          aria-modal="true"
          aria-label="Navigation menu"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          style={{ transform: panelTransform, transition: panelTransition }}
          className="absolute top-0 right-0 h-full w-[85vw] max-w-[340px] bg-white dark:bg-background shadow-2xl flex flex-col rounded-l-3xl overflow-hidden"
        >
          
          <div className="absolute top-[max(env(safe-area-inset-top),1.5rem)] right-6 z-10">
            <button 
              type="button"
              aria-label="Close navigation"
              onClick={onClose} 
              className="!p-2 text-gray-400 hover:text-gray-900 dark:text-gray-500 dark:hover:text-white transition-colors active:scale-95 !rounded-full"
            >
              <IonIcon icon={closeOutline} className="text-2xl" />
            </button>
          </div>

          {/* Sidebar Header & User Info (Clickable!) */}
          <div 
            onClick={() => handleNavigation(targetId ? `/profile?id=${targetId}` : '/profile')}
            className="px-8 pt-[max(env(safe-area-inset-top),3rem)] pb-5 flex flex-col gap-3 cursor-pointer active:opacity-70 transition-opacity"
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
                  <h3 className="font-black text-lg text-gray-900 dark:text-white mb-0.5 tracking-tight">
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
            
            <div className="flex flex-col gap-1">
              <p className="text-[11px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-[0.2em] mb-1">
                Account
              </p>
              {ACCOUNT_LINKS.filter((link) => !link.hide).map((link) => {
                const badge = link.badge ?? 0;
                return (
                <button 
                  key={link.name}
                  onClick={() => handleNavigation(link.path)} 
                  className="w-full flex items-center justify-between py-2 group active:opacity-60 transition-opacity"
                >
                  <div className="flex items-center gap-4">
                    <IonIcon icon={link.icon} className="text-[22px] text-orange-500 transition-colors" />
                    <span className="text-[15px] font-bold text-gray-900 dark:text-white">{link.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {badge > 0 && (
                      <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-orange-500 text-white text-[11px] font-black flex items-center justify-center">
                        {badge > 99 ? '99+' : badge}
                      </span>
                    )}
                    <IonIcon icon={chevronForwardOutline} className="text-gray-300 dark:text-gray-600 text-sm" />
                  </div>
                </button>
                );
              })}
            </div>

            <div className="flex flex-col gap-1 mt-6">
              <p className="text-[11px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-[0.2em] mb-1">
                Legal & Support
              </p>
              {SUPPORT_LINKS.map((link) => (
                <button 
                  key={link.name}
                  onClick={() => handleNavigation(link.path)} 
                  className="w-full flex items-center justify-between py-2 group active:opacity-60 transition-opacity"
                >
                  <div className="flex items-center gap-4">
                    <IonIcon icon={link.icon} className="text-[22px] text-orange-500 transition-colors" />
                    <span className="text-[15px] font-bold text-gray-900 dark:text-white">{link.name}</span>
                  </div>
                  <IonIcon icon={chevronForwardOutline} className="text-gray-300 dark:text-gray-600 text-sm" />
                </button>
              ))}
            </div>

          </div>

          {/* Sign Out Footer */}
          <div className="p-6 pb-[max(env(safe-area-inset-bottom),1.5rem)] mt-auto">
            <button 
              type="button"
              onClick={() => setShowSignOutModal(true)}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 !rounded-full bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-500 hover:bg-red-100 dark:hover:bg-red-500/20 active:scale-[0.98] transition-all font-black text-sm"
            >
              <IonIcon icon={logOutOutline} className="text-xl" />
              <span>Sign Out</span>
            </button>
          </div>

        </div>
      </div>

      {/* Sign Out Confirmation Modal */}
      <Modal isOpen={showSignOutModal} onClose={() => setShowSignOutModal(false)}>
        <div className="p-6 text-center relative z-[999]">
          <IonIcon icon={logOutOutline} className="text-6xl mb-4 text-red-500" />
          <h2 className="text-xl font-black mb-2 text-gray-900 dark:text-white tracking-tight">Sign Out?</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-8 font-medium leading-relaxed">
            Are you sure you want to sign out of your Vendi account?
          </p>
          <div className="flex flex-row gap-3">
            <Button
              onClick={() => setShowSignOutModal(false)}
              className="flex-1 !rounded-full !py-2.5 !text-sm !bg-gray-200 dark:!bg-gray-800 !text-gray-900 dark:!text-white font-bold hover:!bg-gray-300 dark:hover:!bg-gray-700 transition-colors"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSignOut}
              className="flex-1 !rounded-full !py-2.5 !text-sm !bg-red-500 hover:!bg-red-600 shadow-lg shadow-red-500/30 text-white font-black transition-all active:scale-[0.98]"
            >
              Yes, Sign Out
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
};
