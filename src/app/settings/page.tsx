"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { Button } from '@/shared/Button';
import { Modal } from '@/shared/Modal/Modal';
import { ToggleSwitch } from '@/shared/ToggleSwitch';
import { IonIcon } from '@ionic/react';
import { 
  chevronBackOutline, 
  moonOutline,
  sunnyOutline,
  notificationsOutline,
  cartOutline,
  chatbubblesOutline,
  bookmarkOutline,
  lockClosedOutline,
  hardwareChipOutline,
  desktopOutline
} from 'ionicons/icons';

export default function SettingsPage() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Notification States
  const [pushEnabled, setPushEnabled] = useState(true);
  const [orderEnabled, setOrderEnabled] = useState(true);
  const [chatEnabled, setChatEnabled] = useState(true);
  const [savedEnabled, setSavedEnabled] = useState(false);

  // Modal States
  const [showCacheModal, setShowCacheModal] = useState(false);

  // Prevent hydration mismatch for next-themes
  useEffect(() => {
    setMounted(true);
  }, []);

  const handleClearCache = () => {
    localStorage.clear();
    sessionStorage.clear();
    setShowCacheModal(true);
  };

  if (!mounted) return null;

  const sectionHeaderClass = "text-[12px] font-black text-muted-foreground uppercase tracking-widest px-2 mb-4 mt-10 first:mt-2";
  const cardClass = "bg-card rounded-[1.5rem] shadow-sm"; 
  
  // Increased vertical padding (py-5) for much better spacing
  const rowClass = "flex items-center justify-between py-5 px-5 border-b border-border/40 last:border-b-0";

  return (
    <div className="min-h-screen bg-background text-foreground pt-safe pb-safe selection:bg-orange-500/30">
      
      {/* HEADER */}
      <div className="flex-shrink-0 w-full bg-background/95 backdrop-blur-sm shadow-sm sticky top-0 z-50">
        <div className="flex items-center gap-3 px-4 py-4">
          <button onClick={() => router.back()} className="!p-2 -ml-2 text-foreground active:bg-muted transition-colors !rounded-full">
            <IonIcon icon={chevronBackOutline} className="text-3xl" />
          </button>
          <h1 className="text-xl font-bold leading-tight">Settings</h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 pb-24">
        
        {/* APPEARANCE */}
        <h2 className={sectionHeaderClass}>Appearance</h2>
        <div className={cardClass}>
          <div className="flex p-2 gap-2">
            {/* Added !rounded-2xl for smooth, pill-shaped active states */}
            <button 
              onClick={() => setTheme('light')}
              className={`flex-1 py-3 px-2 !rounded-2xl flex flex-col items-center gap-1.5 transition-all ${theme === 'light' ? 'bg-orange-500/10 text-orange-500' : 'text-muted-foreground hover:bg-muted'}`}
            >
              <IonIcon icon={sunnyOutline} className="text-2xl" />
              <span className="text-xs font-bold">Light</span>
            </button>
            <button 
              onClick={() => setTheme('dark')}
              className={`flex-1 py-3 px-2 !rounded-2xl flex flex-col items-center gap-1.5 transition-all ${theme === 'dark' ? 'bg-orange-500/10 text-orange-500' : 'text-muted-foreground hover:bg-muted'}`}
            >
              <IonIcon icon={moonOutline} className="text-2xl" />
              <span className="text-xs font-bold">Dark</span>
            </button>
            <button 
              onClick={() => setTheme('system')}
              className={`flex-1 py-3 px-2 !rounded-2xl flex flex-col items-center gap-1.5 transition-all ${theme === 'system' ? 'bg-orange-500/10 text-orange-500' : 'text-muted-foreground hover:bg-muted'}`}
            >
              <IonIcon icon={desktopOutline} className="text-2xl" />
              <span className="text-xs font-bold">System</span>
            </button>
          </div>
        </div>

        {/* NOTIFICATIONS */}
        <h2 className={sectionHeaderClass}>Notifications</h2>
        <div className={cardClass}>
          <div className={rowClass}>
            <div className="flex items-center gap-4">
              <IonIcon icon={notificationsOutline} className="text-2xl text-muted-foreground flex-shrink-0" />
              <div className="flex flex-col">
                <span className="text-[15px] font-bold text-foreground">Push Notifications</span>
                <span className="text-[13px] text-muted-foreground mt-0.5">Master alert toggle</span>
              </div>
            </div>
            <ToggleSwitch enabled={pushEnabled} onChange={setPushEnabled} />
          </div>
          
          <div className={`${rowClass} ${!pushEnabled && 'opacity-50 pointer-events-none transition-opacity'}`}>
            <div className="flex items-center gap-4">
              <IonIcon icon={cartOutline} className="text-2xl text-muted-foreground flex-shrink-0" />
              <div className="flex flex-col">
                <span className="text-[15px] font-bold text-foreground">Order Updates</span>
                <span className="text-[13px] text-muted-foreground mt-0.5">Status changes</span>
              </div>
            </div>
            <ToggleSwitch enabled={orderEnabled} onChange={setOrderEnabled} />
          </div>

          <div className={`${rowClass} ${!pushEnabled && 'opacity-50 pointer-events-none transition-opacity'}`}>
            <div className="flex items-center gap-4">
              <IonIcon icon={chatbubblesOutline} className="text-2xl text-muted-foreground flex-shrink-0" />
              <div className="flex flex-col">
                <span className="text-[15px] font-bold text-foreground">Chat Messages</span>
                <span className="text-[13px] text-muted-foreground mt-0.5">Direct messages</span>
              </div>
            </div>
            <ToggleSwitch enabled={chatEnabled} onChange={setChatEnabled} />
          </div>

          <div className={`${rowClass} ${!pushEnabled && 'opacity-50 pointer-events-none transition-opacity'}`}>
            <div className="flex items-center gap-4">
              <IonIcon icon={bookmarkOutline} className="text-2xl text-muted-foreground flex-shrink-0" />
              <div className="flex flex-col">
                <span className="text-[15px] font-bold text-foreground">Saved Items</span>
                <span className="text-[13px] text-muted-foreground mt-0.5">Price drops or sold</span>
              </div>
            </div>
            <ToggleSwitch enabled={savedEnabled} onChange={setSavedEnabled} />
          </div>
        </div>

        {/* SECURITY & DATA */}
<h2 className={sectionHeaderClass}>Security & Data</h2>
<div className={cardClass}>

  <button 
    onClick={() => router.push('/profile/edit')}
    className="w-full text-left flex items-center justify-between py-8 px-7 border-b border-border/40 hover:bg-muted/50 transition-colors active:bg-muted"
  >
    <div className="flex items-center gap-4">
      <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
        <IonIcon icon={lockClosedOutline} className="text-xl text-foreground" />
      </div>
      <span className="text-[15px] font-bold text-foreground">Change Password</span>
    </div>
    <IonIcon icon={chevronBackOutline} className="text-muted-foreground rotate-180 text-lg" />
  </button>

  <button 
    onClick={handleClearCache}
    className="w-full text-left flex items-center justify-between py-6 px-5 hover:bg-muted/50 transition-colors active:bg-muted"
  >
    <div className="flex items-center gap-4">
      <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
        <IonIcon icon={hardwareChipOutline} className="text-xl text-foreground" />
      </div>
      <div className="flex flex-col justify-center">
        <span className="text-[15px] font-bold text-foreground leading-tight">Clear App Cache</span>
        <span className="text-[13px] text-muted-foreground mt-1 leading-tight">Frees up storage</span>
      </div>
    </div>
  </button>

</div>

      </div>

      {/* Cache Cleared Modal */}
      <Modal isOpen={showCacheModal} onClose={() => setShowCacheModal(false)}>
        <div className="p-6 text-center">
          <IonIcon icon={hardwareChipOutline} className="text-6xl mb-4 text-orange-500" />
          <h2 className="text-xl font-black mb-2 text-foreground">Cache Cleared</h2>
          <p className="text-muted-foreground mb-8">Temporary files and local data have been successfully removed.</p>
          <Button onClick={() => setShowCacheModal(false)} className="w-full !rounded-full !py-3.5 !bg-muted !text-foreground font-bold hover:!bg-muted/80">
            Done
          </Button>
        </div>
      </Modal>

    </div>
  );
}