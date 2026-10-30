"use client";

import React, { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { signInWithGoogleNative } from '@/lib/googleSignIn';
import { Capacitor } from '@capacitor/core';
import { Button } from '@/shared/Button';
import { showGlobalToast } from '@/shared/Toast/Toast';
import { Dropdown } from '@/shared/Dropdown';
import { GalleryPicker } from '@/app/chats/components/GalleryPicker';
import { NIGERIAN_UNIVERSITIES } from '@/constants/universities';
import IonIcon from '@/shared/Icon/Icon';
import { 
  personOutline, mailOutline, lockClosedOutline,
  eyeOutline, eyeOffOutline, callOutline,
  checkmarkCircleOutline, closeCircleOutline, syncOutline,
  chevronBackOutline, logoGoogle, cameraOutline, imageOutline
} from 'ionicons/icons';

const CLOUDINARY_CLOUD_NAME = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_UPLOAD_PRESET = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;

function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Same redirect rules as the login page: same-app paths only, never an auth page.
  const getSafeRedirectParam = () => {
    const redirect = searchParams.get('redirect');
    if (!redirect || !redirect.startsWith('/') || redirect.startsWith('//')) return null;
    if (redirect === '/login' || redirect === '/signup') return null;
    return redirect;
  };
  const redirectTarget = getSafeRedirectParam() ?? '/';
  const loginHref = (() => {
    const param = getSafeRedirectParam();
    return param ? `/login?redirect=${encodeURIComponent(param)}` : '/login';
  })();
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    username: '',
    whatsapp: '',
    university: NIGERIAN_UNIVERSITIES[0].id,
    campus: NIGERIAN_UNIVERSITIES[0].campuses[0],
    termsAccepted: false
  });

  const [showPassword, setShowPassword] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  // Photo upload (same flow as edit profile: sheet -> camera/gallery -> Cloudinary)
  const [avatarUrl, setAvatarUrl] = useState('');
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [showAvatarSheet, setShowAvatarSheet] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const [confirmationSent, setConfirmationSent] = useState(false);

  // Auto-redirect if already logged in
  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) router.replace(redirectTarget);
    };
    checkSession();
  }, [router, redirectTarget]);

  // Debounced Username Check (Now works because of SQL fix)
  useEffect(() => {
    if (formData.username.length < 3) {
      setUsernameStatus('idle');
      return;
    }

    setUsernameStatus('checking');
    const delayDebounceFn = setTimeout(async () => {
      try {
        // maybeSingle: no row is a normal null, not an exception. Real errors
        // (e.g. RLS) still fall through to the 'available' fallback below.
        const { data } = await supabase
          .from('users')
          .select('username')
          .ilike('username', formData.username)
          .maybeSingle();

        if (data) setUsernameStatus('taken');
        else setUsernameStatus('available');
      } catch (err) {
        setUsernameStatus('available'); // Fallback if RLS blocks it
      }
    }, 500);

    return () => clearTimeout(delayDebounceFn);
  }, [formData.username]);

  // WhatsApp numbers arrive in every shape (+234..., 234..., 0803..., 803...).
  // The order page builds wa.me links from the stored value, expecting either
  // 234... or 0... — so normalize to digits and keep one of those two forms.
  const normalizeWhatsapp = (raw: string) => {
    const digits = raw.replace(/\D/g, '');
    if (digits.startsWith('234')) return digits;
    if (digits.startsWith('0')) return digits;
    return digits.length === 9 ? `0${digits}` : digits;
  };

  // --- Cloudinary upload with progress via XHR (same as edit profile) ---
  const uploadToCloudinary = (file: File) => {
    return new Promise<string>((resolve, reject) => {
      if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_UPLOAD_PRESET) {
        reject(new Error('Photo upload is not configured.'));
        return;
      }
      const form = new FormData();
      form.append('file', file);
      form.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
      form.append('folder', 'avatars');
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) setUploadProgress(Math.round((event.loaded / event.total) * 100));
      };
      xhr.onload = () => {
        try {
          const res = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300 && res.secure_url) resolve(res.secure_url);
          else reject(new Error('Upload failed. Please try again.'));
        } catch {
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
      setAvatarUrl(url);
      showGlobalToast('Photo added!');
    } catch (error: any) {
      showGlobalToast(error.message || 'Upload failed. Please try again.', 'error');
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
      showGlobalToast('Could not read the selected photo.', 'error');
    }
  };

  const handleNext = () => {
    if (step === 1) {
      // Step 1 has no <form>, so the inputs' type="email"/required attributes
      // never run browser validation — check the format here instead.
      const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim());
      if (!formData.firstName.trim() || !formData.lastName.trim() || !emailOk || formData.password.length < 6) {
        showGlobalToast("Please fill all fields with a valid email. Password must be at least 6 characters.", 'error');
        return;
      }
      if (formData.password !== confirmPassword) {
        showGlobalToast('Passwords do not match.', 'error');
        return;
      }
    }
    if (step === 2 && (usernameStatus !== 'available' || normalizeWhatsapp(formData.whatsapp).length < 10)) {
      showGlobalToast("Please provide a valid WhatsApp number and ensure your username is available.", 'error');
      return;
    }
    setStep(step + 1);
  };

  const handleGoogleSignIn = async () => {
    setIsGoogleLoading(true);
    try {
      // Remember where to land after sign-in; the callback page reads it back.
      localStorage.setItem('vendi_post_auth_redirect', redirectTarget);
      if (Capacitor.isNativePlatform()) {
        // Native: the system account sheet, no browser. The callback page
        // finishes routing (it already handles an existing session).
        const result = await signInWithGoogleNative();
        if (result === 'signed-in') router.push('/auth/callback');
        // 'cancelled' = user dismissed the sheet; stay put, no error.
      } else {
        const { error: oauthError } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: `${window.location.origin}/auth/callback`,
          },
        });
        if (oauthError) showGlobalToast(oauthError.message, 'error');
        // On success the browser leaves the app; nothing more to do here.
      }
    } catch (err: any) {
      showGlobalToast(err?.message || 'Could not reach the server. Check your connection and try again.', 'error');
    } finally {
      setIsGoogleLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.termsAccepted) {
      showGlobalToast("You must agree to the Terms & Conditions.", 'error');
      return;
    }

    setIsLoading(true);

    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: formData.email.trim(),
        password: formData.password,
        options: {
          data: {
            full_name: `${formData.firstName.trim()} ${formData.lastName.trim()}`,
            username: formData.username,
            whatsapp: normalizeWhatsapp(formData.whatsapp),
            university_id: formData.university,
            campus: formData.campus,
            avatar_url: avatarUrl || null,
          }
        }
      });

      if (signUpError) {
        showGlobalToast(signUpError.message, 'error');
        setIsLoading(false);
        return;
      }
      // If email confirmation is on, there is no session yet: the account exists
      // but the user must confirm first. Say so instead of dropping them on the
      // feed as a guest. If confirmation is off, they are already logged in.
      if (data.session) {
        window.dispatchEvent(new Event('refresh-profile'));
        router.replace(redirectTarget);
      } else {
        setConfirmationSent(true);
        setIsLoading(false);
      }
    } catch {
      showGlobalToast('Could not reach the server. Check your connection and try again.', 'error');
      setIsLoading(false);
    }
  };

  const inputClasses = "w-full bg-transparent border border-orange-500/50 text-gray-900 dark:text-white px-12 py-4 rounded-2xl outline-none focus:border-orange-400 transition-colors";

  return (
    <div className="h-dvh overflow-y-auto bg-white dark:bg-background flex flex-col px-6 md:px-8 pt-safe pb-safe">
      

      {/* Transparent Back Button & Progress Indicator */}
      <div className="pt-8 flex items-center justify-between mb-4">
        <button onClick={() => step > 1 ? setStep(step - 1) : router.push('/')} className="w-10 h-10 rounded-full bg-transparent flex items-center justify-center text-gray-900 dark:text-white transition-colors hover:bg-black/5 dark:hover:bg-white/10">
          <IonIcon icon={chevronBackOutline} className="text-2xl" />
        </button>
        <div className="flex gap-1.5">
          {[1, 2, 3].map((i) => (
            <div key={i} className={`h-2 rounded-full transition-all duration-300 ${step >= i ? 'w-8 bg-orange-500' : 'w-2 bg-gray-200 dark:bg-gray-800'}`} />
          ))}
        </div>
      </div>

      <div className="max-w-md w-full mx-auto flex-1 flex flex-col pb-20">
        
        {confirmationSent ? (
          <div className="animate-in fade-in space-y-4 pt-10 text-center">
            <IonIcon icon={checkmarkCircleOutline} className="text-6xl text-green-500 mb-6 mx-auto" />
            <h1 className="text-3xl font-black text-gray-900 dark:text-white mb-2">Check your email</h1>
            <p className="text-sm font-bold text-gray-500 leading-relaxed">
              We sent a confirmation link to {formData.email.trim()}. Open it to activate your account, then log in.
            </p>
            <Button onClick={() => router.push('/login')} className="w-full !rounded-2xl !py-4 !text-lg !font-black shadow-md hover:!bg-orange-600 mt-4">
              Back to Log In
            </Button>
          </div>
        ) : (
          <>
        {step === 1 && (
          <div className="animate-in fade-in slide-in-from-right-4 space-y-4">
            
            <div className="flex justify-center mb-6">
              <img src="/logo.png" alt="Vendi Logo" className="w-16 h-16 object-contain drop-shadow-md" />
            </div>

            <h1 className="text-3xl font-black text-gray-900 dark:text-white mb-2 text-center">Create Account</h1>
            <p className="text-sm font-bold text-gray-500 mb-8 text-center">Let's start with the basics.</p>

            <div className="grid grid-cols-2 gap-4">
              <div className="relative min-w-0">
                <IonIcon icon={personOutline} className="absolute left-4 top-1/2 -translate-y-1/2 text-xl text-gray-400" />
                <input type="text" placeholder="First Name" value={formData.firstName} onChange={(e) => setFormData({...formData, firstName: e.target.value})} className={`${inputClasses} !pl-11 !pr-4`} />
              </div>
              <input type="text" placeholder="Last Name" value={formData.lastName} onChange={(e) => setFormData({...formData, lastName: e.target.value})} className={`${inputClasses} !px-4 min-w-0`} />
            </div>

            <div className="relative">
              <IonIcon icon={mailOutline} className="absolute left-4 top-1/2 -translate-y-1/2 text-xl text-gray-400" />
              <input type="email" placeholder="Email Address" value={formData.email} onChange={(e) => setFormData({...formData, email: e.target.value})} className={inputClasses} />
            </div>

            <div className="relative">
              <IonIcon icon={lockClosedOutline} className="absolute left-4 top-1/2 -translate-y-1/2 text-xl text-gray-400" />
              <input type={showPassword ? "text" : "password"} placeholder="Password (Min 6 chars)" value={formData.password} onChange={(e) => setFormData({...formData, password: e.target.value})} className={inputClasses} />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400">
                <IonIcon icon={showPassword ? eyeOffOutline : eyeOutline} className="text-xl" />
              </button>
            </div>

            <div className="relative">
              <IonIcon icon={lockClosedOutline} className="absolute left-4 top-1/2 -translate-y-1/2 text-xl text-gray-400" />
              <input type={showConfirmPassword ? "text" : "password"} placeholder="Confirm Password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className={inputClasses} />
              <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400">
                <IonIcon icon={showConfirmPassword ? eyeOffOutline : eyeOutline} className="text-xl" />
              </button>
            </div>

            <Button onClick={handleNext} className="w-full !rounded-2xl !py-4 !text-lg !font-black shadow-md hover:!bg-orange-600 mt-8">
              Continue
            </Button>

            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-gray-200 dark:bg-gray-800" />
              <span className="text-xs font-bold text-gray-400">or continue with</span>
              <div className="h-px flex-1 bg-gray-200 dark:bg-gray-800" />
            </div>

<button type="button" onClick={handleGoogleSignIn} disabled={isGoogleLoading} className="w-full flex items-center justify-center gap-3 !rounded-2xl py-4 text-lg font-black bg-transparent text-gray-900 dark:text-white border border-orange-500/50 hover:border-orange-400 transition-colors active:scale-[0.98] disabled:opacity-60">
          <IonIcon icon={logoGoogle} className="text-xl" />
          {isGoogleLoading ? 'Connecting...' : 'Continue with Google'}
        </button>
          </div>
        )}

        {step === 2 && (
          <div className="animate-in fade-in slide-in-from-right-4 space-y-4 pt-4">
            <h1 className="text-3xl font-black text-gray-900 dark:text-white mb-2 text-center">Campus Identity</h1>
            <p className="text-sm font-bold text-gray-500 mb-8 text-center">How buyers and sellers will find you.</p>

            <div>
              <div className="relative">
                <IonIcon icon={personOutline} className="absolute left-4 top-1/2 -translate-y-1/2 text-xl text-gray-400" />
                <input type="text" placeholder="Unique Username" value={formData.username} onChange={(e) => setFormData({...formData, username: e.target.value.toLowerCase().replace(/\s/g, '')})} className={inputClasses} />
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
              <input type="tel" placeholder="WhatsApp Number" value={formData.whatsapp} onChange={(e) => setFormData({...formData, whatsapp: e.target.value})} className={`${inputClasses} !pl-20`} />
            </div>

            <Dropdown
              value={formData.university}
              onChange={(uniId) => {
                const uni = NIGERIAN_UNIVERSITIES.find(u => u.id === uniId);
                setFormData({ ...formData, university: uniId, campus: uni?.campuses[0] || '' });
              }}
              options={NIGERIAN_UNIVERSITIES.map(u => ({ value: u.id, label: u.name }))}
              placeholder="Select institution"
              ariaLabel="Select institution"
            />

            <Dropdown
              value={formData.campus}
              onChange={(campus) => setFormData({ ...formData, campus })}
              options={(NIGERIAN_UNIVERSITIES.find(u => u.id === formData.university)?.campuses || [])}
              placeholder="Select campus"
              ariaLabel="Select campus"
            />

            <Button onClick={handleNext} className="w-full !rounded-2xl !py-4 !text-lg !font-black shadow-md hover:!bg-orange-600 mt-8">
              Almost Done
            </Button>
          </div>
        )}

        {step === 3 && (
          <div className="animate-in fade-in slide-in-from-right-4 space-y-6 pt-4">
            <h1 className="text-3xl font-black text-gray-900 dark:text-white mb-2 text-center">Final Step</h1>
            <p className="text-sm font-bold text-gray-500 mb-6 text-center">Add a photo to build trust with buyers.</p>

            <div className="flex flex-col items-center mb-8">
              <button type="button" onClick={() => setShowAvatarSheet(true)} className="relative group">
                <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-orange-500/50 bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="Profile photo" className="w-full h-full object-cover" />
                  ) : (
                    <IonIcon icon={personOutline} className="text-5xl text-gray-400" />
                  )}
                </div>
                <span className="absolute bottom-1 right-1 w-9 h-9 rounded-full bg-orange-500 text-white flex items-center justify-center shadow-md">
                  <IonIcon icon={cameraOutline} className="text-lg" />
                </span>
              </button>
              <p className="text-xs font-bold text-gray-500 mt-3">Tap to add a photo</p>
            </div>

            <div className="flex items-start gap-3 bg-gray-50 dark:bg-[#171717] p-4 rounded-2xl border border-gray-200 dark:border-gray-800">
              <input 
                type="checkbox" 
                id="terms" 
                checked={formData.termsAccepted} 
                onChange={(e) => setFormData({...formData, termsAccepted: e.target.checked})}
                className="mt-1 w-5 h-5 rounded border-gray-300 text-orange-500 focus:ring-orange-500"
              />
              <label htmlFor="terms" className="text-xs font-bold text-gray-600 dark:text-gray-400 leading-relaxed">
                I agree to the <Link href="/terms" className="text-orange-500">Terms of Service</Link> and acknowledge that my information will be verified to prevent fraud on the marketplace.
              </label>
            </div>

            <Button onClick={handleSignup} disabled={isLoading} className="w-full !rounded-2xl !py-4 !text-lg !font-black shadow-md hover:!bg-orange-600 mt-4">
              {isLoading ? 'Creating Account...' : 'Create Account'}
            </Button>
          </div>
        )}

        <p className="text-center text-sm font-bold text-gray-500 mt-auto">
          Already have an account? <Link href={loginHref} className="text-orange-500 hover:underline">Log In</Link>
        </p>
        </>)}

      </div>

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
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}
