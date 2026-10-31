"use client";
// src/app/complete-profile/page.tsx

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { unregisterPushToken } from '@/lib/push';
import { Button } from '@/shared/Button';
import { Avatar } from '@/shared/Avatar';
import { showGlobalToast } from '@/shared/Toast/Toast';
import { Dropdown } from '@/shared/Dropdown';
import IonIcon from '@/shared/Icon/Icon';
import { NIGERIAN_UNIVERSITIES } from '@/constants/universities';
import {
  personOutline, callOutline, cameraOutline,
  checkmarkCircleOutline, closeCircleOutline, syncOutline
} from 'ionicons/icons';

// --- Cloudinary config — pull from env, unsigned upload preset only
// (same setup as the edit-profile page).
const CLOUDINARY_CLOUD_NAME = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_UPLOAD_PRESET = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;

export default function CompleteProfilePage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [university, setUniversity] = useState(NIGERIAN_UNIVERSITIES[0].id);
  const [campus, setCampus] = useState(NIGERIAN_UNIVERSITIES[0].campuses[0]);
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const [isLoading, setIsLoading] = useState(false);

  // Profile photo: starts as the Google photo (when there is one) so people
  // who are happy with it change nothing — and people who aren't can pick
  // their own here instead of living with Google's picture.
  const [avatarUrl, setAvatarUrl] = useState('');
  const [avatarFromGoogle, setAvatarFromGoogle] = useState(false);
  const [photoRemoved, setPhotoRemoved] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      // Start from the Google photo when the account has one.
      const metaAvatar = user.user_metadata?.avatar_url || user.user_metadata?.picture || '';
      if (metaAvatar) {
        setAvatarUrl(metaAvatar);
        setAvatarFromGoogle(true);
      }
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

  // Uploads straight to Cloudinary (same avatars folder as edit-profile).
  // The URL is only written to the users row when the form is saved, so
  // abandoning this page orphans nothing in the database.
  const uploadPhoto = async (file: File) => {
    if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_UPLOAD_PRESET) {
      showGlobalToast('Photo uploads are not configured yet.', 'error');
      return;
    }
    setUploadingPhoto(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
      form.append('folder', 'avatars');
      const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
        method: 'POST',
        body: form,
      });
      const data = await res.json();
      if (!res.ok || !data.secure_url) throw new Error('Upload failed. Please try again.');
      setAvatarUrl(data.secure_url as string);
      setAvatarFromGoogle(false);
      setPhotoRemoved(false);
      showGlobalToast('Photo uploaded — save to apply it.');
    } catch (err: any) {
      showGlobalToast(err.message || 'Upload failed. Please try again.', 'error');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handlePhotoPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void uploadPhoto(file);
    e.target.value = '';
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;
    if (usernameStatus !== 'available') {
      showGlobalToast('Please choose an available username.', 'error');
      return;
    }
    const normalized = normalizeWhatsapp(whatsapp);
    if (normalized.length < 10) {
      showGlobalToast('Please provide a valid WhatsApp number.', 'error');
      return;
    }
    setIsLoading(true);
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
        // A picked photo (or an explicit removal) is part of the profile;
        // leaving the key out keeps whatever the row already has.
        ...(avatarUrl ? { avatar_url: avatarUrl } : photoRemoved ? { avatar_url: null } : {}),
      };
      const { error: saveError } = existing
        ? await supabase.from('users').update(row).eq('id', userId)
        : await supabase.from('users').insert({ id: userId, ...row });
      if (saveError) {
        showGlobalToast(saveError.message, 'error');
        setIsLoading(false);
        return;
      }
      // Keep the auth metadata in step so the header fallback agrees with
      // the row (same as the edit-profile page does).
      if (avatarUrl || photoRemoved) {
        void supabase.auth.updateUser({ data: { avatar_url: avatarUrl || null } });
      }
      window.dispatchEvent(new Event('refresh-profile'));
      router.replace(savedTarget());
    } catch {
      showGlobalToast('Could not reach the server. Check your connection and try again.', 'error');
      setIsLoading(false);
    }
  };

  const handleSignOut = async () => {
    await unregisterPushToken();
    await supabase.auth.signOut();
    router.replace('/login');
  };

  const inputClasses = "w-full bg-transparent border border-orange-500/50 text-gray-900 dark:text-white px-12 py-4 rounded-2xl outline-none focus:border-orange-400 transition-colors";

  return (
    <div className="h-dvh overflow-y-auto bg-white dark:bg-background flex flex-col px-6 md:px-8 pt-safe pb-safe">


      <div className="max-w-md w-full mx-auto flex-1 flex flex-col pt-8 pb-20">
        <div className="flex justify-center mb-6">
          <img src="/logo.png" alt="Vendi Logo" className="w-16 h-16 object-contain drop-shadow-md" />
        </div>

        <h1 className="text-3xl font-black text-gray-900 dark:text-white mb-2 text-center">Complete Your Profile</h1>
        <p className="text-sm font-bold text-gray-500 mb-8 text-center">You signed in with Google. Add your campus identity to start trading.</p>

        <div className="flex flex-col items-center mb-6">
          <Avatar src={avatarUrl || undefined} name={username || 'V'} size="lg" />
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoPicked} />
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploadingPhoto} className="mt-3 flex items-center gap-1.5 text-sm font-black text-orange-500 disabled:opacity-50">
            <IonIcon icon={cameraOutline} className="text-lg" />
            {uploadingPhoto ? 'Uploading…' : avatarUrl ? 'Change photo' : 'Add a photo'}
          </button>
          {avatarUrl && !uploadingPhoto && (
            <button
              type="button"
              onClick={() => { setAvatarUrl(''); setAvatarFromGoogle(false); setPhotoRemoved(true); }}
              className="mt-1 text-xs font-bold text-gray-500"
            >
              Remove photo
            </button>
          )}
          <p className="text-xs font-bold text-gray-500 mt-2 text-center">
            {avatarFromGoogle ? 'Using your Google photo — change it if you prefer your own.' : 'Profile photo (optional).'}
          </p>
        </div>

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

          <Dropdown
            value={university}
            onChange={(uniId) => {
              const uni = NIGERIAN_UNIVERSITIES.find(u => u.id === uniId);
              setUniversity(uniId);
              setCampus(uni?.campuses[0] || '');
            }}
            options={NIGERIAN_UNIVERSITIES.map(u => ({ value: u.id, label: u.name }))}
            placeholder="Select institution"
            ariaLabel="Select institution"
          />

          <Dropdown
            value={campus}
            onChange={(campus) => setCampus(campus)}
            options={(NIGERIAN_UNIVERSITIES.find(u => u.id === university)?.campuses || [])}
            placeholder="Select campus"
            ariaLabel="Select campus"
          />

          <Button type="submit" disabled={isLoading || uploadingPhoto || !userId} className="w-full !rounded-2xl !py-4 !text-lg !font-black shadow-md hover:!bg-orange-600 mt-4">
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
