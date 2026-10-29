"use client";
// src/app/complete-profile/page.tsx

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { unregisterPushToken } from '@/lib/push';
import { Button } from '@/shared/Button';
import { Modal } from '@/shared/Modal/Modal';
import IonIcon from '@/shared/Icon/Icon';
import { NIGERIAN_UNIVERSITIES } from '@/constants/universities';
import {
  personOutline, callOutline, schoolOutline,
  checkmarkCircleOutline, closeCircleOutline, syncOutline,
  alertCircleOutline
} from 'ionicons/icons';

export default function CompleteProfilePage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [university, setUniversity] = useState(NIGERIAN_UNIVERSITIES[0].id);
  const [campus, setCampus] = useState(NIGERIAN_UNIVERSITIES[0].campuses[0]);
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const savedTarget = () => {
    const raw = localStorage.getItem('vendi_post_auth_redirect');
    localStorage.removeItem('vendi_post_auth_redirect');
    return raw && raw.startsWith('/') && !raw.startsWith('//') && raw !== '/login' && raw !== '/signup'
      ? raw
      : '/';
  };

  // Anyone without a session does not belong here. Anyone whose profile is
  // already complete skips straight to where they were headed.
  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace('/login');
        return;
      }
      setUserId(user.id);
      const { data: profile } = await supabase
        .from('users')
        .select('username')
        .eq('id', user.id)
        .maybeSingle();
      if (profile?.username) {
        router.replace(savedTarget());
      }
    };
    void init();
  }, [router]);

  // Debounced username availability (same pattern as signup).
  useEffect(() => {
    if (username.length < 3) {
      setUsernameStatus('idle');
      return;
    }
    setUsernameStatus('checking');
    const delayDebounceFn = setTimeout(async () => {
      try {
        const { data } = await supabase
          .from('users')
          .select('username')
          .ilike('username', username)
          .maybeSingle();
        if (data) setUsernameStatus('taken');
        else setUsernameStatus('available');
      } catch {
        setUsernameStatus('available'); // Fallback if RLS blocks it
      }
    }, 500);
    return () => clearTimeout(delayDebounceFn);
  }, [username]);

  // Same normalization as signup: the order page builds wa.me links from the
  // stored value, expecting either 234... or 0....
  const normalizeWhatsapp = (raw: string) => {
    const digits = raw.replace(/\D/g, '');
    if (digits.startsWith('234')) return digits;
    if (digits.startsWith('0')) return digits;
    return digits.length === 9 ? `0${digits}` : digits;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;
    if (usernameStatus !== 'available') {
      setError('Please choose an available username.');
      return;
    }
    const normalized = normalizeWhatsapp(whatsapp);
    if (normalized.length < 10) {
      setError('Please provide a valid WhatsApp number.');
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      // The users row normally already exists (created from the auth trigger);
      // update it, and only insert when it somehow does not.
      const { data: existing } = await supabase
        .from('users')
        .select('id')
        .eq('id', userId)
        .maybeSingle();
      const row = {
        username: username.toLowerCase(),
        whatsapp: normalized,
        university_id: university,
        campus,
      };
      const { error: saveError } = existing
        ? await supabase.from('users').update(row).eq('id', userId)
        : await supabase.from('users').insert({ id: userId, ...row });
      if (saveError) {
        setError(saveError.message);
        setIsLoading(false);
        return;
      }
      window.dispatchEvent(new Event('refresh-profile'));
      router.replace(savedTarget());
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setIsLoading(false);
    }
  };

  const handleSignOut = async () => {
    await unregisterPushToken();
    await supabase.auth.signOut();
    router.replace('/login');
  };

  const inputClasses = "w-full bg-gray-50 dark:bg-[#171717] border border-gray-200 dark:border-gray-800 text-gray-900 dark:text-white px-12 py-4 rounded-2xl outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition-colors shadow-sm";

  return (
    <div className="h-dvh overflow-y-auto bg-white dark:bg-background flex flex-col px-6 md:px-8 pt-safe pb-safe">

      {error && (
        <Modal isOpen={!!error} onClose={() => setError('')}>
          <div className="p-6 text-center">
            <IonIcon icon={alertCircleOutline} className="text-5xl text-red-500 mb-4" />
            <h2 className="text-xl font-black mb-2 text-gray-900 dark:text-white">Wait a minute</h2>
            <p className="text-gray-600 dark:text-gray-300 mb-6">{error}</p>
            <Button onClick={() => setError('')} className="w-full !py-3">Got it</Button>
          </div>
        </Modal>
      )}

      <div className="max-w-md w-full mx-auto flex-1 flex flex-col pt-8 pb-20">
        <div className="flex justify-center mb-6">
          <img src="/logo.png" alt="Vendi Logo" className="w-16 h-16 object-contain drop-shadow-md" />
        </div>

        <h1 className="text-3xl font-black text-gray-900 dark:text-white mb-2 text-center">Complete Your Profile</h1>
        <p className="text-sm font-bold text-gray-500 mb-8 text-center">You signed in with Google. Add your campus identity to start trading.</p>

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <div className="relative">
              <IonIcon icon={personOutline} className="absolute left-4 top-1/2 -translate-y-1/2 text-xl text-gray-400" />
              <input type="text" placeholder="Unique Username" value={username} onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s/g, ''))} className={inputClasses} />
              <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center">
                {usernameStatus === 'checking' && <IonIcon icon={syncOutline} className="text-xl text-gray-400 animate-spin" />}
                {usernameStatus === 'available' && <IonIcon icon={checkmarkCircleOutline} className="text-xl text-green-500" />}
                {usernameStatus === 'taken' && <IonIcon icon={closeCircleOutline} className="text-xl text-red-500" />}
              </div>
            </div>
            {usernameStatus === 'taken' && <p className="text-xs font-bold text-red-500 mt-2 pl-2">Username is already taken.</p>}
          </div>

          <div className="relative">
            <IonIcon icon={callOutline} className="absolute left-4 top-1/2 -translate-y-1/2 text-xl text-gray-400" />
            <span className="absolute left-10 top-1/2 -translate-y-1/2 font-bold text-gray-500">+234</span>
            <input type="tel" placeholder="WhatsApp Number" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} className={`${inputClasses} !pl-20`} />
          </div>

          <div className="relative">
            <IonIcon icon={schoolOutline} className="absolute left-4 top-1/2 -translate-y-1/2 text-xl text-gray-400" />
            <select value={university} onChange={(e) => {
              const uniId = e.target.value;
              const uni = NIGERIAN_UNIVERSITIES.find(u => u.id === uniId);
              setUniversity(uniId);
              setCampus(uni?.campuses[0] || '');
            }} className={inputClasses}>
              {NIGERIAN_UNIVERSITIES.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>

          <select value={campus} onChange={(e) => setCampus(e.target.value)} className={`${inputClasses} !pl-5`}>
            {(NIGERIAN_UNIVERSITIES.find(u => u.id === university)?.campuses || []).map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          <Button type="submit" disabled={isLoading || !userId} className="w-full !rounded-2xl !py-4 !text-lg !font-black shadow-md hover:!bg-orange-600 mt-4">
            {isLoading ? 'Saving...' : 'Save & Continue'}
          </Button>
        </form>

        <button onClick={() => void handleSignOut()} className="text-sm font-bold text-gray-500 hover:text-orange-500 mt-6 text-center">
          Sign out instead
        </button>
        <p className="text-center text-sm font-bold text-gray-500 mt-4">
          <Link href="/terms" className="text-orange-500 hover:underline">Terms of Service</Link>
        </p>
      </div>
    </div>
  );
}
