"use client";

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Button } from '@/shared/Button';
import { Modal } from '@/shared/Modal/Modal';
import { IonIcon } from '@ionic/react';
import {
  chevronBackOutline,
  cameraOutline,
  alertCircleOutline,
  checkmarkCircleOutline,
  closeCircleOutline,
  saveOutline,
  syncOutline
} from 'ionicons/icons';
import { NIGERIAN_UNIVERSITIES } from '@/constants/universities';

// --- Cloudinary config — pull from env, unsigned upload preset only.
const CLOUDINARY_CLOUD_NAME = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_UPLOAD_PRESET = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;

type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken';

export default function EditProfilePage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const usernameCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const originalUsername = useRef<string>('');

  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Upload progress (blurs screen while true)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const [modalConfig, setModalConfig] = useState({ isOpen: false, title: '', message: '', type: 'success' });

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

  // Password State
  const [passwords, setPasswords] = useState({
    newPassword: '',
    confirmPassword: ''
  });

  useEffect(() => {
    const fetchUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/');
        return;
      }
      
      const { data: profile } = await supabase.from('users').select('*').eq('id', user.id).single();

      if (profile) {
        originalUsername.current = profile.username || '';
        setFormData({
          id: profile.id || user.id, // Failsafe ID assignment
          full_name: profile.full_name || '',
          username: profile.username || '',
          bio: profile.bio || '',
          whatsapp: profile.whatsapp || '',
          university_id: profile.university_id || NIGERIAN_UNIVERSITIES[0].id,
          campus: profile.campus || NIGERIAN_UNIVERSITIES[0].campuses[0],
          avatar_url: profile.avatar_url || ''
        });
      } else {
        // Absolute failsafe if the user row is missing
        setFormData(prev => ({ ...prev, id: user.id }));
      }
      setIsLoading(false);
    };
    fetchUser();
  }, [router]);

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

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadProgress(0);
    try {
      const url = await uploadToCloudinary(file);
      setFormData(prev => ({ ...prev, avatar_url: url }));
      setUploadProgress(null);
      setModalConfig({ isOpen: true, title: 'Photo Updated', message: 'Your new photo uploaded successfully.', type: 'success' });
    } catch (error: any) {
      setUploadProgress(null);
      setModalConfig({ isOpen: true, title: 'Upload Failed', message: error.message, type: 'error' });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSaveProfile = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (usernameStatus === 'taken' || usernameStatus === 'checking') return;

    setIsSubmitting(true);
    try {
      // 1. Password Update
      if (passwords.newPassword || passwords.confirmPassword) {
        if (passwords.newPassword !== passwords.confirmPassword) {
          setModalConfig({ isOpen: true, title: 'Error', message: 'Passwords do not match.', type: 'error' });
          return;
        }
        const { error: authError } = await supabase.auth.updateUser({ password: passwords.newPassword });
        if (authError) {
          setModalConfig({ isOpen: true, title: 'Password Error', message: authError.message, type: 'error' });
          return;
        }
      }

      // 2. Profile Update
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

      if (dbError) {
        setModalConfig({ isOpen: true, title: 'Database Error', message: dbError.message, type: 'error' });
      } else {
        originalUsername.current = formData.username;
        setModalConfig({ isOpen: true, title: 'Success', message: 'Profile updated successfully!', type: 'success' });
        setPasswords({ newPassword: '', confirmPassword: '' });
      }
    } catch (err: any) {
      console.error(err);
      setModalConfig({ isOpen: true, title: 'Unexpected Error', message: err.message || 'Something went wrong.', type: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputClasses = "w-full bg-card border border-border text-foreground px-5 py-4 rounded-2xl outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition-colors text-sm";
  const labelClasses = "block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2 ml-1";

  const isSaveDisabled = isSubmitting || uploadProgress !== null || usernameStatus === 'checking' || usernameStatus === 'taken';

  if (isLoading) {
    return <div className="min-h-screen bg-background flex items-center justify-center text-orange-500 font-bold animate-pulse">Loading Editor...</div>;
  }

  return (
    <div className="w-full min-h-screen bg-background text-foreground pb-24">

      {/* Upload progress overlay — blurs the whole screen while uploading */}
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

      {/* CORE FIX: Modal is always mounted in the DOM to prevent invisible transition traps */}
      <Modal isOpen={modalConfig.isOpen} onClose={() => setModalConfig(prev => ({ ...prev, isOpen: false }))}>
        <div className="p-6 text-center relative z-[999]">
          <IonIcon icon={modalConfig.type === 'success' ? checkmarkCircleOutline : alertCircleOutline} className={`text-5xl mb-4 ${modalConfig.type === 'success' ? 'text-green-500' : 'text-red-500'}`} />
          <h2 className="text-xl font-black mb-2 text-foreground">{modalConfig.title}</h2>
          <p className="text-muted-foreground mb-6">{modalConfig.message}</p>
          <Button onClick={() => {
            setModalConfig(prev => ({ ...prev, isOpen: false }));
            if (modalConfig.type === 'success' && modalConfig.title === 'Success') router.back();
          }} className="w-full !py-3">
            Understood
          </Button>
        </div>
      </Modal>

      {/* Sticky Header — full-bleed */}
      <div className="sticky top-0 z-50 w-full bg-background/95 backdrop-blur-sm border-b border-border py-3 flex items-center justify-between px-4">
        <button type="button" onClick={() => router.back()} className="w-10 h-10 flex items-center justify-center rounded-full active:bg-foreground/10 transition-colors text-foreground">
          <IonIcon icon={chevronBackOutline} className="text-2xl" />
        </button>
        <h1 className="text-sm font-black uppercase tracking-widest text-foreground">
          Edit Profile
        </h1>
        <div className="w-10"></div>
      </div>

      <form onSubmit={handleSaveProfile} className="max-w-xl mx-auto w-full px-4 pt-8">

        {/* Profile Picture Section */}
        <div className="flex flex-col items-center mb-10">
          <div className="relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
            <div className="w-32 h-32 rounded-full border-4 border-border shadow-lg overflow-hidden bg-muted relative">
              <img
                src={formData.avatar_url || `https://ui-avatars.com/api/?name=${formData.full_name}&background=f97316&color=fff`}
                alt="Profile"
                loading="lazy"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="absolute bottom-0 right-0 w-10 h-10 bg-orange-500 rounded-full border-4 border-background flex items-center justify-center text-white shadow-md active:bg-orange-600 transition-colors">
              <IonIcon icon={cameraOutline} className="text-lg" />
            </div>
            <input type="file" ref={fileInputRef} onChange={handleAvatarChange} accept="image/*" className="hidden" />
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
            <label className={labelClasses}>Bio / Business Description</label>
            <textarea value={formData.bio} onChange={(e) => setFormData({ ...formData, bio: e.target.value })} rows={3} className={`${inputClasses} resize-none`} placeholder="Tell buyers a bit about yourself or your store..." />
          </div>
          <div>
            <label className={labelClasses}>WhatsApp Number</label>
            <input type="tel" value={formData.whatsapp} onChange={(e) => setFormData({ ...formData, whatsapp: e.target.value })} className={inputClasses} placeholder="08012345678" />
          </div>
        </div>

        {/* Institution Form */}
        <div className="space-y-5 mb-10 pt-8 border-t border-border">
          <h3 className="font-black text-lg text-foreground mb-4">Campus Details</h3>
          <div>
            <label className={labelClasses}>Institution</label>
            <select
              value={formData.university_id}
              onChange={(e) => {
                const uniId = e.target.value;
                const uni = NIGERIAN_UNIVERSITIES.find(u => u.id === uniId);
                setFormData({ ...formData, university_id: uniId, campus: uni?.campuses[0] || '' });
              }}
              className={inputClasses}
            >
              {NIGERIAN_UNIVERSITIES.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClasses}>Campus</label>
            <select
              value={formData.campus}
              onChange={(e) => setFormData({ ...formData, campus: e.target.value })}
              className={inputClasses}
            >
              {(NIGERIAN_UNIVERSITIES.find(u => u.id === formData.university_id)?.campuses || []).map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Security Form */}
        <div className="space-y-5 mb-12 pt-8 border-t border-border">
          <h3 className="font-black text-lg text-foreground mb-4">Security</h3>
          <div>
            <label className={labelClasses}>New Password (Optional)</label>
            <input type="password" value={passwords.newPassword} onChange={(e) => setPasswords({ ...passwords, newPassword: e.target.value })} className={inputClasses} placeholder="Leave blank to keep current" />
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
        </div>

        {/* Fixed Save Button */}
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/95 backdrop-blur-sm border-t border-border z-40">
          <div className="max-w-xl mx-auto">
            <Button 
              type="submit" 
              disabled={isSaveDisabled} 
              className="w-full !py-4 !rounded-2xl !text-lg !font-black flex items-center justify-center gap-2 shadow-[0_8px_30px_rgba(249,115,22,0.3)] active:!bg-orange-600 disabled:opacity-50"
            >
              {isSubmitting ? <IonIcon icon={syncOutline} className="animate-spin text-xl" /> : <IonIcon icon={saveOutline} className="text-xl" />}
              {isSubmitting ? 'Saving Changes...' : 'Save Profile'}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}