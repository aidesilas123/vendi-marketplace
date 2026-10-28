// src/app/settings/page.tsx
"use client";

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import useSWR from 'swr';
import { supabase } from '@/lib/supabase';
import { safeBack } from '@/shared/safeBack';
import { Button } from '@/shared/Button';
import { Modal } from '@/shared/Modal/Modal';
import { ToggleSwitch } from '@/shared/ToggleSwitch';
import { useRubberBand } from '@/shared/hooks/useRubberBand';
import { IonIcon } from '@/shared/Icon/Icon';
import { TONES, previewTone, DEFAULT_TONE_ID } from '@/lib/notificationSound';
import {
  chevronBackOutline,
  chevronForwardOutline,
  moonOutline,
  sunnyOutline,
  notificationsOutline,
  cartOutline,
  chatbubblesOutline,
  helpCircleOutline,
  walletOutline,
  starOutline,
  warningOutline,
  megaphoneOutline,
  lockClosedOutline,
  hardwareChipOutline,
  desktopOutline,
  informationCircleOutline,
  musicalNoteOutline,
  checkmarkOutline
} from 'ionicons/icons';
import packageJson from '../../../package.json';

type NotifPrefs = {
  master: boolean;
  chat: boolean;
  question: boolean;
  order: boolean;
  wallet: boolean;
  review: boolean;
  dispute: boolean;
  announcement: boolean;
  sound: string;
};

const DEFAULT_PREFS: NotifPrefs = {
  master: true,
  chat: true,
  question: true,
  order: true,
  wallet: true,
  review: true,
  dispute: true,
  announcement: true,
  sound: DEFAULT_TONE_ID,
};

async function fetchNotifPrefs(): Promise<NotifPrefs> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not logged in');
  const { data, error } = await supabase
    .from('notification_preferences')
    .select('master, chat, question, "order", wallet, review, dispute, announcement, sound')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) throw error;
  return { ...DEFAULT_PREFS, ...(data ?? {}) };
}

export default function SettingsPage() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Notification preferences — persisted per user, enforced by send-push/broadcast.
  // Missing row = everything on.
  const { data: prefsData, mutate: mutatePrefs } = useSWR('notif-prefs', fetchNotifPrefs, {
    revalidateOnFocus: false,
    dedupingInterval: 30000,
  });
  const prefs: NotifPrefs = { ...DEFAULT_PREFS, ...(prefsData ?? {}) };

  const setPref = async (key: keyof NotifPrefs, value: boolean) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    // Optimistic: flip instantly, roll back on failure.
    const prev = prefs;
    void mutatePrefs({ ...prev, [key]: value }, { revalidate: false });
    const { error } = await supabase
      .from('notification_preferences')
      .upsert(
        { user_id: user.id, [key]: value, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );
    if (error) void mutatePrefs(prev, { revalidate: false });
  };

  // Notification sound — optimistic save; the tone preview plays on tap.
  const [showSoundPicker, setShowSoundPicker] = useState(false);
  const setSound = async (toneId: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const prev = prefs;
    void mutatePrefs({ ...prev, sound: toneId }, { revalidate: false });
    const { error } = await supabase
      .from('notification_preferences')
      .upsert(
        { user_id: user.id, sound: toneId, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );
    if (error) void mutatePrefs(prev, { revalidate: false });
  };
  const currentTone = TONES.find((t) => t.id === prefs.sound) ?? TONES.find((t) => t.id === DEFAULT_TONE_ID) ?? TONES[0];

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

  const notifRows = (
    [
      { icon: notificationsOutline, title: 'Push Notifications', sub: 'Master alert toggle', key: 'master', locked: false },
      { icon: chatbubblesOutline, title: 'Chat Messages', sub: 'Direct messages', key: 'chat', locked: !prefs.master },
      { icon: helpCircleOutline, title: 'Questions & Replies', sub: 'Listing Q&A activity', key: 'question', locked: !prefs.master },
      { icon: cartOutline, title: 'Order Updates', sub: 'New orders and payouts', key: 'order', locked: !prefs.master },
      { icon: walletOutline, title: 'Wallet Activity', sub: 'Top-ups and withdrawals', key: 'wallet', locked: !prefs.master },
      { icon: starOutline, title: 'Reviews', sub: 'New ratings on your profile', key: 'review', locked: !prefs.master },
      { icon: warningOutline, title: 'Dispute Alerts', sub: 'Disputes on your orders', key: 'dispute', locked: !prefs.master },
      { icon: megaphoneOutline, title: 'Announcements', sub: 'News from Vendi', key: 'announcement', locked: !prefs.master },
    ] as const
  ).map((row) => ({
    ...row,
    value: prefs[row.key],
    set: (v: boolean) => setPref(row.key, v),
  }));

  return (
    <div className="min-h-screen bg-background text-gray-900 dark:text-white selection:bg-orange-500/30">

      {/* HEADER — solid, no blur, no border, no shadow */}
      <div className="flex-shrink-0 w-full bg-background sticky top-0 z-50">
        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={() => safeBack(router)} aria-label="Go back" className="!p-2 -ml-2 text-gray-900 dark:text-white active:bg-black/5 dark:active:bg-white/10 transition-colors !rounded-full">
            <IonIcon icon={chevronBackOutline} className="text-3xl" />
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
              <IonIcon icon={t.icon} className="text-2xl" />
              <span className="text-xs font-bold">{t.label}</span>
            </button>
          ))}
        </div>

        {/* NOTIFICATIONS */}
        <h2 className={sectionTitle}>Notifications</h2>
        <div>
          {/* Sound picker row */}
          <button
            onClick={() => setShowSoundPicker(true)}
            className={`${rowClass} w-full text-left ${!prefs.master ? 'opacity-50 pointer-events-none' : ''}`}
          >
            <div className="flex items-center gap-4">
              <div className={iconCircle}>
                <IonIcon icon={musicalNoteOutline} className={rowIcon} />
              </div>
              <div className="flex flex-col">
                <span className={labelPrimary}>Notification Sound</span>
                <span className={labelSecondary}>{currentTone.name}</span>
              </div>
            </div>
            <IonIcon icon={chevronForwardOutline} className="text-gray-300 dark:text-gray-600 text-lg" />
          </button>
          {notifRows.map((row) => (
            <div key={row.title} className={`${rowClass} ${row.locked ? 'opacity-50 pointer-events-none' : ''}`}>
              <div className="flex items-center gap-4">
                <div className={iconCircle}>
                  <IonIcon icon={row.icon} className={rowIcon} />
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
                <IonIcon icon={lockClosedOutline} className={rowIcon} />
              </div>
              <span className={labelPrimary}>Change Password</span>
            </div>
            <IonIcon icon={chevronForwardOutline} className="text-lg text-gray-400 dark:text-gray-500" />
          </button>

          <button onClick={handleClearCache} className={`${rowClass} text-left`}>
            <div className="flex items-center gap-4">
              <div className={iconCircle}>
                <IonIcon icon={hardwareChipOutline} className={rowIcon} />
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
                <IonIcon icon={informationCircleOutline} className={rowIcon} />
              </div>
              <div className="flex flex-col">
                <span className={labelPrimary}>About Vendi</span>
                <span className={labelSecondary}>Version {packageJson.version}</span>
              </div>
            </div>
            <IonIcon icon={chevronForwardOutline} className="text-lg text-gray-400 dark:text-gray-500" />
          </button>
        </div>

      </div>

      {/* Cache Cleared Modal */}
      <Modal isOpen={showCacheModal} onClose={() => setShowCacheModal(false)}>
        <div className="p-6 text-center">
          <IonIcon icon={hardwareChipOutline} className="text-6xl mb-4 text-orange-500" />
          <h2 className="text-xl font-black mb-2 text-gray-900 dark:text-white">Cache Cleared</h2>
          <p className="text-gray-500 dark:text-gray-400 mb-8 text-sm leading-relaxed">
            Temporary files and cached data were removed. You're still signed in and your place in the app is unchanged.
          </p>
          <Button onClick={() => setShowCacheModal(false)} className="w-full !rounded-full !py-3.5 !bg-gray-100 dark:!bg-[#171717] !text-gray-900 dark:!text-white font-bold">
            Done
          </Button>
        </div>
      </Modal>

      {/* Sound Picker Modal */}
      <Modal isOpen={showSoundPicker} onClose={() => setShowSoundPicker(false)} title="Notification Sound">
        <div className="px-2 py-2">
          {TONES.map((tone) => {
            const selected = prefs.sound === tone.id;
            return (
              <button
                key={tone.id}
                onClick={() => {
                  previewTone(tone);
                  void setSound(tone.id);
                }}
                className="w-full flex items-center gap-4 px-4 py-3.5 text-left active:bg-black/5 dark:active:bg-white/5 transition-colors !rounded-2xl"
              >
                <div className={`${iconCircle} ${selected ? '!bg-orange-500/15' : ''}`}>
                  <IonIcon icon={musicalNoteOutline} className={`${rowIcon} ${selected ? '!text-orange-500' : ''}`} />
                </div>
                <span className={`flex-1 text-[15px] font-bold ${selected ? 'text-orange-500' : 'text-gray-900 dark:text-white'}`}>
                  {tone.name}
                </span>
                {selected && <IonIcon icon={checkmarkOutline} className="text-xl text-orange-500" />}
              </button>
            );
          })}
          <p className="px-4 pt-2 pb-4 text-xs text-gray-400 leading-relaxed">
            Applies to new notifications. Tap a tone to preview and save it.
          </p>
          <button onClick={() => router.push('/push-debug')} className="w-full px-4 py-3 text-left text-sm font-bold text-orange-500">Push diagnostics (temporary)</button>
        </div>
      </Modal>

    </div>
  );
}
