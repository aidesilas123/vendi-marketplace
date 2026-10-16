"use client";

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { supabase } from '@/lib/supabase';
import { Button } from '@/shared/Button';
import { Modal } from '@/shared/Modal/Modal';
import { Toast, useToast } from '@/shared/Toast/Toast';
import { PullSpinner } from '@/shared/Loaders/PullSpinner';
import { GalleryPicker } from '@/app/chats/components/GalleryPicker';
import { useRubberBand } from '@/shared/hooks/useRubberBand';
import { safeBack } from '@/shared/safeBack';
import { IonIcon } from '@ionic/react';
import {
  chevronBackOutline,
  cameraOutline,
  imageOutline,
  saveOutline,
  syncOutline,
  checkmarkCircleOutline,
  closeCircleOutline
} from 'ionicons/icons';
import { NIGERIAN_UNIVERSITIES } from '@/constants/universities';

// --- Cloudinary config — pull from env, unsigned upload preset only.
const CLOUDINARY_CLOUD_NAME = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_UPLOAD_PRESET = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;

const BIO_MAX = 160;

type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken';

export default function EditProfilePage() {
  const router = useRouter();
  const { toast, showToast, hideToast } = useToast();
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const usernameCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const originalUsername = useRef<string>('');
  const initialFormRef = useRef<any>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSavingPassword, setIsSavingPassword] = useState(false);

  // Upload progress (blurs screen while true)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  // Avatar source sheet + gallery
  const [showAvatarSheet, setShowAvatarSheet] = useState(false);
  const [showGallery, setShowGallery] = useState(false);

  // Discard-changes guard
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  // Username availability
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle');

  // Form State
  const [formData, setFormData] = useState({
    id: '',
    full_name: '',
    username: '',
    bio: '',
    whatsapp: '',
    university_id: '',
    campus: '',
    avatar_url: ''
  });

  // Password State (saved separately from the profile)
  const [passwords, setPasswords] = useState({
    newPassword: '',
    confirmPassword: ''
  });

  const bounceRef = useRef<HTMLDivElement>(null);

  /* --- Session user via SWR --- */
  const { data: sessionUser } = useSWR('session-user', async () => {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
  });
  const authChecked = sessionUser !== undefined;

  useEffect(() => {
    if (authChecked && !sessionUser) router.push('/');
  }, [authChecked, sessionUser, router]);

  /* --- Profile via SWR --- */
  const { data: profileData } = useSWR(
    sessionUser ? ['edit-profile', sessionUser.id] : null,
    async ([, id]: [string, string]) => {
      const { data: profile } = await supabase.from('users').select('*').eq('id', id).single();
      return profile;
    }
  );

  useEffect(() => {
    if (!profileData || !sessionUser) return;
    originalUsername.current = profileData.username || '';
    const initial = {
      id: profileData.id || sessionUser.id,
      full_name: profileData.full_name || '',
      username: profileData.username || '',
      bio: profileData.bio || '',
      whatsapp: profileData.whatsapp || '',
      university_id: profileData.university_id || NIGERIAN_UNIVERSITIES[0].id,
      campus: profileData.campus || NIGERIAN_UNIVERSITIES[0].campuses[0],
      avatar_url: profileData.avatar_url || ''
    };
    setFormData(initial);
    initialFormRef.current = initial;
  }, [profileData, sessionUser]);

  const isLoading = !authChecked || (!!sessionUser && !profileData);

  useRubberBand(bounceRef, { ready: !isLoading });

  /* --- Dirty tracking for the discard guard --- */
  const isDirty =
    !!initialFormRef.current &&
    (JSON.stringify(formData) !== JSON.stringify(initialFormRef.current) ||
      passwords.newPassword !== '' ||
      passwords.confirmPassword !== '');

  const handleBack = () => {
    if (isDirty) setShowDiscardConfirm(true);
    else safeBack(router);
  };

  // --- Live username uniqueness check, debounced while typing ---
  const checkUsername = useCallback((value: string, userId: string) => {
    if (usernameCheckTimer.current) clearTimeout(usernameCheckTimer.current);

    if (!value || value === originalUsername.current) {
      setUsernameStatus('idle');
      return;
    }

    setUsernameStatus('checking');
    usernameCheckTimer.current = setTimeout(async () => {
      const { data } = await supabase
        .from('users')
        .select('id')
        .eq('username', value)
        .neq('id', userId)
        .maybeSingle();

      setUsernameStatus(data ? 'taken' : 'available');
    }, 500);
  }, []);

  const handleUsernameChange = (value: string) => {
    const clean = value.toLowerCase().replace(/\s/g, '');
    setFormData(prev => ({ ...prev, username: clean }));
    checkUsername(clean, formData.id);
  };

  // --- Cloudinary upload with progress via XHR ---
  const uploadToCloudinary = (file: File) => {
    return new Promise<string>((resolve, reject) => {
      if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_UPLOAD_PRESET) {
        reject(new Error('Cloudinary env vars are missing.'));
        return;
      }

      const xhr = new XMLHttpRequest();
      const form = new FormData();
      form.append('file', file);
      form.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
      form.append('folder', 'avatars');

      xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`);

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          setUploadProgress(Math.round((event.loaded / event.total) * 100));
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const res = JSON.parse(xhr.responseText);
          resolve(res.secure_url as string);
        } else {
          reject(new Error('Upload failed. Please try again.'));
        }
      };

      xhr.onerror = () => reject(new Error('Network error during upload.'));
      xhr.send(form);
    });
  };

  const uploadAvatarFile = async (file: File) => {
    setUploadProgress(0);
    setShowAvatarSheet(false);
    try {
      const url = await uploadToCloudinary(file);
      setFormData(prev => ({ ...prev, avatar_url: url }));
      showToast('Photo updated!');
    } catch (error: any) {
      showToast(error.message || 'Upload failed. Please try again.', 'error');
    } finally {
      setUploadProgress(null);
    }
  };

  const handleCameraCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void uploadAvatarFile(file);
    e.target.value = '';
  };

  /* Gallery selection -> blob -> upload (works for native webPath + web blob URLs) */
  const handleGallerySelect = async (url: string) => {
    setShowGallery(false);
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      await uploadAvatarFile(new File([blob], `avatar-${Date.now()}.jpg`, { type: 'image/jpeg' }));
    } catch {
      showToast('Could not read the selected photo.', 'error');
    }
  };

  /* --- Profile save (header save icon). Password is saved separately below. --- */
  const handleSaveProfile = async () => {
    if (usernameStatus === 'taken' || usernameStatus === 'checking' || uploadProgress !== null) return;

    setIsSubmitting(true);
    try {
      const { error: dbError } = await supabase
        .from('users')
        .update({
          full_name: formData.full_name,
          username: formData.username,
          bio: formData.bio,
          whatsapp: formData.whatsapp,
          university_id: formData.university_id,
          campus: formData.campus,
          avatar_url: formData.avatar_url
        })
        .eq('id', formData.id);

      if (dbError) throw dbError;

      originalUsername.current = formData.username;
      initialFormRef.current = { ...formData };
      setPasswords({ newPassword: '', confirmPassword: '' });
      // Notify AppShell & Header to update avatar immediately
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('refresh-profile'));
      }
      void supabase.auth.updateUser({
        data: { avatar_url: formData.avatar_url, full_name: formData.full_name }
      });
      showToast('Profile updated!');
      setTimeout(() => safeBack(router), 1200);
    } catch (err: any) {
      showToast(err.message || 'Could not save your profile. Please try again.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  /* --- Password update: its own action, never blocks the profile save --- */
  const handlePasswordUpdate = async () => {
    if (!passwords.newPassword) {
      showToast('Enter a new password first.', 'error');
      return;
    }
    if (passwords.newPassword !== passwords.confirmPassword) {
      showToast('Passwords do not match.', 'error');
      return;
    }
    setIsSavingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: passwords.newPassword });
      if (error) throw error;
      setPasswords({ newPassword: '', confirmPassword: '' });
      showToast('Password updated!');
    } catch (err: any) {
      showToast(err.message || 'Could not update password.', 'error');
    } finally {
      setIsSavingPassword(false);
    }
  };

  const inputClasses = "w-full bg-background border border-orange-500/30 text-foreground px-5 py-4 rounded-2xl outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition-colors text-sm";
  const labelClasses = "block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2 ml-1";

  const isSaveDisabled = isSubmitting || uploadProgress !== null || usernameStatus === 'checking' || usernameStatus === 'taken';

  if (isLoading) {
    return (
      <div className="min-h-screen w-full bg-background flex items-center justify-center">
        <PullSpinner spinning size={44} />
      </div>
    );
  }

  return (
    <>
      <Toast {...toast} onClose={hideToast} />

      {/* Discard-changes confirmation */}
      <Modal isOpen={showDiscardConfirm} onClose={() => setShowDiscardConfirm(false)} title="Discard changes?">
        <p className="text-muted-foreground mb-6">You have unsaved changes. Are you sure you want to leave?</p>
        <div className="flex gap-4">
          <Button variant="outline" onClick={() => setShowDiscardConfirm(false)} className="flex-1 !py-3">Keep Editing</Button>
          <Button onClick={() => { setShowDiscardConfirm(false); safeBack(router); }} className="flex-1 !bg-red-500 active:!bg-red-600 !py-3">
            Discard
          </Button>
        </div>
      </Modal>

      {/* Upload progress overlay */}
      {uploadProgress !== null && (
        <div className="fixed inset-0 z-[110] bg-background/80 backdrop-blur-md flex flex-col items-center justify-center gap-4">
          <div className="w-16 h-16 rounded-full border-4 border-border border-t-orange-500 animate-spin"></div>
          <p className="font-black text-foreground">Uploading photo…</p>
          <div className="w-48 h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-orange-500 transition-all duration-150"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
          <p className="text-xs font-bold text-muted-foreground">{uploadProgress}%</p>
        </div>
      )}

      {/* Avatar source choice sheet */}
      {showAvatarSheet && (
        <div className="fixed inset-0 z-[100]">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowAvatarSheet(false)} />
          <div className="absolute bottom-0 left-0 right-0 bg-background rounded-t-3xl p-4 pb-[max(1rem,var(--sab))]">
            <div className="max-w-xl mx-auto">
              <div className="w-12 h-1.5 bg-muted rounded-full mx-auto mb-4" />
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                className="w-full flex items-center gap-4 p-4 rounded-2xl active:bg-muted transition-colors text-left"
              >
                <span className="w-11 h-11 rounded-full bg-orange-500/10 flex items-center justify-center shrink-0">
                  <IonIcon icon={cameraOutline} className="text-orange-500 text-xl" />
                </span>
                <span>
                  <span className="block font-bold text-foreground">Take Photo</span>
                  <span className="block text-xs text-muted-foreground">Use your camera</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => { setShowAvatarSheet(false); setShowGallery(true); }}
                className="w-full flex items-center gap-4 p-4 rounded-2xl active:bg-muted transition-colors text-left"
              >
                <span className="w-11 h-11 rounded-full bg-orange-500/10 flex items-center justify-center shrink-0">
                  <IonIcon icon={imageOutline} className="text-orange-500 text-xl" />
                </span>
                <span>
                  <span className="block font-bold text-foreground">Choose from Gallery</span>
                  <span className="block text-xs text-muted-foreground">Pick an existing photo</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => setShowAvatarSheet(false)}
                className="w-full mt-2 py-3.5 rounded-full font-bold text-muted-foreground active:bg-muted transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Shared gallery picker */}
      {showGallery && (
        <GalleryPicker onSelect={handleGallerySelect} onClose={() => setShowGallery(false)} />
      )}

      {/* Hidden camera input */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="user"
        className="hidden"
        onChange={handleCameraCapture}
      />

      {/* Rubber-band wrapper: content only — overlays stay outside */}
      <div ref={bounceRef} className="w-full min-h-full bg-background text-foreground pb-10 relative">

        {/* Solid header — save lives top-right, no blur, no border, full-bleed */}
        <div className="sticky top-0 z-50 w-full bg-background">
          <div className="flex items-center justify-between px-4 py-3">
            <button type="button" onClick={handleBack} aria-label="Back" className="w-10 h-10 flex items-center justify-center rounded-full active:bg-foreground/10 transition-colors text-foreground">
              <IonIcon icon={chevronBackOutline} className="text-2xl" />
            </button>
            <h1 className="text-sm font-black uppercase tracking-widest text-foreground">
              Edit Profile
            </h1>
            <button
              type="button"
              onClick={handleSaveProfile}
              disabled={isSaveDisabled}
              aria-label="Save profile"
              className="w-10 h-10 flex items-center justify-center rounded-full text-orange-500 active:bg-foreground/10 transition-colors disabled:opacity-40"
            >
              {isSubmitting
                ? <IonIcon icon={syncOutline} className="text-2xl animate-spin" />
                : <IonIcon icon={saveOutline} className="text-2xl" />}
            </button>
          </div>
        </div>

        <div className="max-w-xl mx-auto w-full px-4 pt-8">

          {/* Profile Picture Section */}
          <div className="flex flex-col items-center mb-10">
            <div className="relative cursor-pointer" onClick={() => setShowAvatarSheet(true)}>
              <div className="w-32 h-32 rounded-full overflow-hidden bg-muted relative">
                <img
                  src={formData.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(formData.full_name || 'V')}&background=f97316&color=fff`}
                  alt="Profile"
                  loading="lazy"
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="absolute bottom-0 right-0 w-10 h-10 bg-orange-500 rounded-full border-4 border-background flex items-center justify-center text-white shadow-md active:bg-orange-600 transition-colors">
                <IonIcon icon={cameraOutline} className="text-lg" />
              </div>
            </div>
            <p className="text-xs font-bold text-muted-foreground mt-4 uppercase tracking-wider">Tap to change photo</p>
          </div>

          {/* Primary Info Form */}
          <div className="space-y-5 mb-10">
            <div>
              <label className={labelClasses}>Full Name</label>
              <input type="text" value={formData.full_name} onChange={(e) => setFormData({ ...formData, full_name: e.target.value })} className={inputClasses} placeholder="John Doe" />
            </div>

            <div>
              <label className={labelClasses}>Username</label>
              <div className="relative">
                <span className="absolute left-5 top-1/2 -translate-y-1/2 text-muted-foreground font-bold">@</span>
                <input
                  type="text"
                  value={formData.username}
                  onChange={(e) => handleUsernameChange(e.target.value)}
                  className={`${inputClasses} pl-9 pr-11`}
                  placeholder="username"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2">
                  {usernameStatus === 'checking' && (
                    <IonIcon icon={syncOutline} className="text-lg text-muted-foreground animate-spin" />
                  )}
                  {usernameStatus === 'available' && (
                    <IonIcon icon={checkmarkCircleOutline} className="text-lg text-green-500" />
                  )}
                  {usernameStatus === 'taken' && (
                    <IonIcon icon={closeCircleOutline} className="text-lg text-red-500" />
                  )}
                </span>
              </div>
              {usernameStatus === 'taken' && (
                <p className="text-xs font-bold text-red-500 mt-1.5 ml-1">This username is already taken.</p>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider ml-1">Bio / Business Description</label>
                <span className="text-[11px] font-bold text-muted-foreground mr-1">{formData.bio.length}/{BIO_MAX}</span>
              </div>
              <textarea value={formData.bio} onChange={(e) => setFormData({ ...formData, bio: e.target.value })} rows={3} maxLength={BIO_MAX} className={`${inputClasses} resize-none`} placeholder="Tell buyers a bit about yourself or your store..." />
            </div>
            <div>
              <label className={labelClasses}>WhatsApp Number</label>
              <input type="tel" value={formData.whatsapp} onChange={(e) => setFormData({ ...formData, whatsapp: e.target.value })} className={inputClasses} placeholder="08012345678" />
            </div>
          </div>

          {/* Security Form — password has its own save action */}
          <div className="space-y-5 mb-12">
            <h3 className="font-black text-lg text-foreground mb-4">Security</h3>
            <div>
              <label className={labelClasses}>New Password</label>
              <input type="password" value={passwords.newPassword} onChange={(e) => setPasswords({ ...passwords, newPassword: e.target.value })} className={inputClasses} placeholder="Enter new password" />
            </div>
            <div>
              <label className={labelClasses}>Confirm New Password</label>
              <input
                type="password"
                value={passwords.confirmPassword}
                onChange={(e) => setPasswords({ ...passwords, confirmPassword: e.target.value })}
                className={inputClasses}
                placeholder="Repeat new password"
                disabled={!passwords.newPassword}
              />
              {passwords.newPassword && passwords.confirmPassword && passwords.newPassword !== passwords.confirmPassword && (
                <p className="text-xs font-bold text-red-500 mt-1.5 ml-1">Passwords don't match.</p>
              )}
            </div>
            <Button
              type="button"
              onClick={handlePasswordUpdate}
              disabled={isSavingPassword || !passwords.newPassword}
              variant="outline"
              className="!py-3 !rounded-2xl !font-bold w-full flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isSavingPassword && <IonIcon icon={syncOutline} className="animate-spin text-lg" />}
              {isSavingPassword ? 'Updating Password...' : 'Update Password'}
            </Button>
          </div>

        </div>
      </div>
    </>
  );
}
