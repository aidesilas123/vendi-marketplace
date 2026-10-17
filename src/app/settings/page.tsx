// src/app/settings/page.tsx
"use client";

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { safeBack } from '@/shared/safeBack';
import { Button } from '@/shared/Button';
import { Modal } from '@/shared/Modal/Modal';
import { ToggleSwitch } from '@/shared/ToggleSwitch';
import { useRubberBand } from '@/shared/hooks/useRubberBand';
import { IonIcon } from '@ionic/react';
import {
  chevronBackOutline,
  chevronForwardOutline,
  moonOutline,
  sunnyOutline,
  notificationsOutline,
  cartOutline,
  chatbubblesOutline,
  bookmarkOutline,
  lockClosedOutline,
  hardwareChipOutline,
  desktopOutline,
  informationCircleOutline
} from 'ionicons/icons';
import packageJson from '../../../package.json';

export default function SettingsPage() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Notification toggles — kept as local state; wired up when push notifications land.
  const [pushEnabled, setPushEnabled] = useState(true);
  const [orderEnabled, setOrderEnabled] = useState(true);
  const [chatEnabled, setChatEnabled] = useState(true);
  const [savedEnabled, setSavedEnabled] = useState(false);

  const [showCacheModal, setShowCacheModal] = useState(false);

  // Prevent hydration mismatch for next-themes
  useEffect(() => {
    setMounted(true);
  }, []);

  const bounceRef = useRef<HTMLDivElement>(null);
  useRubberBand(bounceRef, { ready: mounted });

  const handleClearCache = () => {
    // Preserve the auth session so the user stays signed in.
    // Browser navigation history is untouched (no reload, no redirect).
    const authEntries: [string, string][] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && /^sb-.*-auth-token$/.test(k)) {
        const v = localStorage.getItem(k);
        if (v) authEntries.push([k, v]);
      }
    }
    localStorage.clear();
    sessionStorage.clear();
    authEntries.forEach(([k, v]) => localStorage.setItem(k, v));
    setShowCacheModal(true);
  };

  if (!mounted) return null;

  const sectionTitle =
    'text-[12px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-widest px-2 mb-2 mt-10 first:mt-2';
  const rowClass =
    'w-full flex items-center justify-between py-4 px-2 active:bg-black/5 dark:active:bg-white/5 transition-colors';
  const iconCircle =
    'w-10 h-10 rounded-full bg-gray-100 dark:bg-[#171717] flex items-center justify-center flex-shrink-0';
  const labelPrimary = 'text-[15px] font-bold text-gray-900 dark:text-white leading-tight';
  const labelSecondary = 'text-[13px] text-gray-500 dark:text-gray-400 mt-0.5 leading-tight';
  const rowIcon = 'text-xl text-gray-900 dark:text-white';

  const themes = [
    { id: 'light', label: 'Light', icon: sunnyOutline },
    { id: 'dark', label: 'Dark', icon: moonOutline },
    { id: 'system', label: 'System', icon: desktopOutline },
  ] as const;

  const notifRows = [
    { icon: notificationsOutline, title: 'Push Notifications', sub: 'Master alert toggle', value: pushEnabled, set: setPushEnabled, locked: false },
    { icon: cartOutline, title: 'Order Updates', sub: 'Status changes', value: orderEnabled, set: setOrderEnabled, locked: !pushEnabled },
    { icon: chatbubblesOutline, title: 'Chat Messages', sub: 'Direct messages', value: chatEnabled, set: setChatEnabled, locked: !pushEnabled },
    { icon: bookmarkOutline, title: 'Saved Items', sub: 'Price drops or sold', value: savedEnabled, set: setSavedEnabled, locked: !pushEnabled },
  ];

  return (
    <div className="min-h-screen bg-background text-gray-900 dark:text-white selection:bg-orange-500/30">

      {/* HEADER — solid, no blur, no border, no shadow */}
      <div className="flex-shrink-0 w-full bg-background sticky top-0 z-50">
        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={() => safeBack(router)} aria-label="Go back" className="!p-2 -ml-2 text-gray-900 dark:text-white active:bg-black/5 dark:active:bg-white/10 transition-colors !rounded-full">
            <span suppressHydrationWarning className="flex items-center justify-center">
              <IonIcon icon={chevronBackOutline} className="text-3xl" />
            </span>
          </button>
          <h1 className="text-xl font-bold leading-tight">Settings</h1>
        </div>
      </div>

      <div ref={bounceRef} className="max-w-2xl mx-auto px-4 py-6 pb-24">

        {/* APPEARANCE */}
        <h2 className={sectionTitle}>Appearance</h2>
        <div className="flex px-2 gap-2">
          {themes.map((t) => (
            <button
              key={t.id}
              onClick={() => setTheme(t.id)}
              className={`flex-1 py-3 px-2 !rounded-2xl flex flex-col items-center gap-1.5 transition-all active:scale-[0.98] ${
                theme === t.id
                  ? 'bg-orange-500/10 text-orange-500'
                  : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              <span suppressHydrationWarning className="flex items-center justify-center">
                <IonIcon icon={t.icon} className="text-2xl" />
              </span>
              <span className="text-xs font-bold">{t.label}</span>
            </button>
          ))}
        </div>

        {/* NOTIFICATIONS */}
        <h2 className={sectionTitle}>Notifications</h2>
        <div>
          {notifRows.map((row) => (
            <div key={row.title} className={`${rowClass} ${row.locked ? 'opacity-50 pointer-events-none' : ''}`}>
              <div className="flex items-center gap-4">
                <div className={iconCircle}>
                  <span suppressHydrationWarning className="flex items-center justify-center">
                    <IonIcon icon={row.icon} className={rowIcon} />
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className={labelPrimary}>{row.title}</span>
                  <span className={labelSecondary}>{row.sub}</span>
                </div>
              </div>
              <ToggleSwitch
                enabled={row.value}
                onChange={row.set}
                ariaLabel={row.title}
              />
            </div>
          ))}
        </div>

        {/* SECURITY & DATA */}
        <h2 className={sectionTitle}>Security & Data</h2>
        <div>
          <button onClick={() => router.push('/profile/edit')} className={`${rowClass} text-left`}>
            <div className="flex items-center gap-4">
              <div className={iconCircle}>
                <span suppressHydrationWarning className="flex items-center justify-center">
                  <IonIcon icon={lockClosedOutline} className={rowIcon} />
                </span>
              </div>
              <span className={labelPrimary}>Change Password</span>
            </div>
            <span suppressHydrationWarning className="flex items-center justify-center">
              <IonIcon icon={chevronForwardOutline} className="text-lg text-gray-400 dark:text-gray-500" />
            </span>
          </button>

          <button onClick={handleClearCache} className={`${rowClass} text-left`}>
            <div className="flex items-center gap-4">
              <div className={iconCircle}>
                <span suppressHydrationWarning className="flex items-center justify-center">
                  <IonIcon icon={hardwareChipOutline} className={rowIcon} />
                </span>
              </div>
              <div className="flex flex-col">
                <span className={labelPrimary}>Clear App Cache</span>
                <span className={labelSecondary}>Frees up storage · keeps you signed in</span>
              </div>
            </div>
          </button>
        </div>

        {/* ABOUT */}
        <h2 className={sectionTitle}>About</h2>
        <div>
          <button onClick={() => router.push('/about')} className={`${rowClass} text-left`}>
            <div className="flex items-center gap-4">
              <div className={iconCircle}>
                <span suppressHydrationWarning className="flex items-center justify-center">
                  <IonIcon icon={informationCircleOutline} className={rowIcon} />
                </span>
              </div>
              <div className="flex flex-col">
                <span className={labelPrimary}>About Vendi</span>
                <span className={labelSecondary}>Version {packageJson.version}</span>
              </div>
            </div>
            <span suppressHydrationWarning className="flex items-center justify-center">
              <IonIcon icon={chevronForwardOutline} className="text-lg text-gray-400 dark:text-gray-500" />
            </span>
          </button>
        </div>

      </div>

      {/* Cache Cleared Modal */}
      <Modal isOpen={showCacheModal} onClose={() => setShowCacheModal(false)}>
        <div className="p-6 text-center">
          <span suppressHydrationWarning className="flex items-center justify-center">
            <IonIcon icon={hardwareChipOutline} className="text-6xl mb-4 text-orange-500" />
          </span>
          <h2 className="text-xl font-black mb-2 text-gray-900 dark:text-white">Cache Cleared</h2>
          <p className="text-gray-500 dark:text-gray-400 mb-8 text-sm leading-relaxed">
            Temporary files and cached data were removed. You're still signed in and your place in the app is unchanged.
          </p>
          <Button onClick={() => setShowCacheModal(false)} className="w-full !rounded-full !py-3.5 !bg-gray-100 dark:!bg-[#171717] !text-gray-900 dark:!text-white font-bold">
            Done
          </Button>
        </div>
      </Modal>

    </div>
  );
}
