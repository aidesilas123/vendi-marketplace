"use client";

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import IonIcon from '@/shared/Icon/Icon';
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

  // --- Real Profile State ---
  const [realAvatar, setRealAvatar] = useState<string | undefined>(user?.avatarUrl);
  const [realName, setRealName] = useState<string | undefined>(user?.name);
  const [realEmail, setRealEmail] = useState<string | undefined>(user?.email);
  const [isFetchingProfile, setIsFetchingProfile] = useState(false); // Prevents name flashing

  // --- Modal State ---
  const [showSignOutModal, setShowSignOutModal] = useState(false);

  // 1. Fetch real user data dynamically from the database
  useEffect(() => {
    const fetchProfile = async () => {
      setIsFetchingProfile(true);
      const targetId = user?.id || (await supabase.auth.getUser()).data.user?.id;
      
      if (targetId) {
        const { data, error } = await supabase
          .from('users')
          .select('full_name, avatar_url, email')
          .eq('id', targetId)
          .single();
          
        if (data && !error) {
          if (data.avatar_url) setRealAvatar(data.avatar_url);
          if (data.full_name) setRealName(data.full_name);
          setRealEmail(data.email || user?.email);
        }
      }
      setIsFetchingProfile(false);
    };
    
    if (isOpen) fetchProfile();
  }, [user?.id, user?.email, isOpen]);

  // 2. Prevent body scroll when open
  useEffect(() => {
    if (isOpen || showSignOutModal) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => { document.body.style.overflow = 'unset'; };
  }, [isOpen, showSignOutModal]);

  const handleNavigation = (route: string) => {
    router.push(route);
    onClose();
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setShowSignOutModal(false);
    onClose();
    window.location.href = '/'; 
  };

  const ACCOUNT_LINKS = [
    { name: 'My Profile', icon: personOutline, path: user?.id ? `/profile?id=${user.id}` : '/profile' },
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

  return (
    <>
      <div className={`fixed inset-0 flex justify-end transition-all duration-300 ${showSignOutModal ? 'z-30' : 'z-[100]'} ${isOpen || showSignOutModal ? 'pointer-events-auto' : 'pointer-events-none'}`}>
        
        {/* Blurred Backdrop */}
        <div 
          className={`absolute inset-0 bg-[#0f172a]/40 dark:bg-black/70 backdrop-blur-sm transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0'}`}
          onClick={onClose}
        />

        {/* Sliding Panel - Restored explicit solid background colors */}
        <div 
          className={`absolute top-0 right-0 h-full w-[85vw] max-w-[340px] bg-white dark:bg-[#111b21] shadow-2xl flex flex-col transition-transform duration-300 ease-in-out rounded-l-3xl overflow-hidden ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
        >
          
          <div className="absolute top-6 right-6 z-10">
            <button 
              onClick={onClose} 
              className="!p-2 text-gray-400 hover:text-gray-900 dark:text-gray-500 dark:hover:text-white transition-colors active:scale-95 !rounded-full"
            >
              <IonIcon icon={closeOutline} className="text-3xl" />
            </button>
          </div>

          {/* Sidebar Header & User Info */}
          <div className="px-8 pt-12 pb-8 flex flex-col gap-5">
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
                    <IonIcon icon={link.icon} className="text-[24px] text-gray-400 group-hover:text-orange-500 transition-colors" />
                    <span className="text-[16px] font-bold text-gray-800 dark:text-gray-100">{link.name}</span>
                  </div>
                  <IonIcon icon={chevronForwardOutline} className="text-gray-300 dark:text-gray-600 text-sm" />
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
                    <IonIcon icon={link.icon} className="text-[24px] text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-200 transition-colors" />
                    <span className="text-[16px] font-bold text-gray-800 dark:text-gray-100">{link.name}</span>
                  </div>
                  <IonIcon icon={chevronForwardOutline} className="text-gray-300 dark:text-gray-600 text-sm" />
                </button>
              ))}
            </div>

          </div>

          {/* Sign Out Footer */}
          <div className="p-8 mt-auto border-t border-gray-100 dark:border-gray-800/50">
            <button 
              onClick={() => setShowSignOutModal(true)}
              className="w-full flex items-center justify-center gap-3 px-4 py-4 !rounded-full bg-red-50 dark:bg-red-500/10 border border-transparent dark:border-red-500/20 text-red-600 dark:text-red-500 hover:bg-red-100 dark:hover:bg-red-500/20 active:scale-[0.98] transition-all font-black"
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
          <IonIcon 
            suppressHydrationWarning
            icon={logOutOutline} 
            className="text-6xl mb-4 text-red-500" 
          />
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