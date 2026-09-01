"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { Button } from '@/shared/Button';
import { Modal } from '@/shared/Modal/Modal';
import { ImageUploader } from '@/shared/ImageUploader/ImageUploader';
import { NIGERIAN_UNIVERSITIES } from '@/constants/universities';
import { IonIcon } from '@ionic/react';
import { 
  personOutline, mailOutline, lockClosedOutline, 
  eyeOutline, eyeOffOutline, callOutline, schoolOutline,
  checkmarkCircleOutline, closeCircleOutline, syncOutline,
  alertCircleOutline, chevronBackOutline, cameraOutline, cropOutline
} from 'ionicons/icons';

export default function SignupPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

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
    images: [] as string[],
    termsAccepted: false
  });

  const [showPassword, setShowPassword] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');

  // Auto-redirect if already logged in
  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) router.replace('/');
    };
    checkSession();
  }, [router]);

  // Debounced Username Check (Now works because of SQL fix)
  useEffect(() => {
    if (formData.username.length < 3) {
      setUsernameStatus('idle');
      return;
    }

    setUsernameStatus('checking');
    const delayDebounceFn = setTimeout(async () => {
      try {
        const { data } = await supabase
          .from('users')
          .select('username')
          .ilike('username', formData.username)
          .single();

        if (data) setUsernameStatus('taken');
        else setUsernameStatus('available');
      } catch (err) {
        setUsernameStatus('available'); // Fallback if RLS blocks it
      }
    }, 500);

    return () => clearTimeout(delayDebounceFn);
  }, [formData.username]);

  const handleNext = () => {
    if (step === 1 && (!formData.firstName || !formData.lastName || !formData.email || formData.password.length < 6)) {
      setError("Please fill all fields. Password must be at least 6 characters.");
      return;
    }
    if (step === 2 && (usernameStatus !== 'available' || !formData.whatsapp || formData.whatsapp.length < 10)) {
      setError("Please provide a valid WhatsApp number and ensure your username is available.");
      return;
    }
    setError('');
    setStep(step + 1);
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.termsAccepted) {
      setError("You must agree to the Terms & Conditions.");
      return;
    }

    setIsLoading(true);
    setError('');

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: formData.email,
      password: formData.password,
      options: {
        data: {
          full_name: `${formData.firstName} ${formData.lastName}`,
          username: formData.username,
          whatsapp: formData.whatsapp,
          university_id: formData.university,
          campus: formData.campus,
          avatar_url: formData.images.length > 0 ? formData.images[0] : null,
        }
      }
    });

    if (signUpError) {
      setError(signUpError.message);
      setIsLoading(false);
    } else {
      window.location.href = '/';
    }
  };

  const inputClasses = "w-full bg-gray-50 dark:bg-[#0f172a] border border-gray-200 dark:border-gray-800 text-gray-900 dark:text-white px-12 py-4 rounded-2xl outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition-colors shadow-sm";

  return (
    <div className="min-h-screen bg-white dark:bg-[#0a1120] flex flex-col px-6 md:px-8 pt-safe pb-safe">
      
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
        
        {step === 1 && (
          <div className="animate-in fade-in slide-in-from-right-4 space-y-4">
            
            <div className="flex justify-center mb-6">
              <img src="/logo.png" alt="Campus Market Logo" className="w-16 h-16 object-contain drop-shadow-md" />
            </div>

            <h1 className="text-3xl font-black text-gray-900 dark:text-white mb-2 text-center">Create Account</h1>
            <p className="text-sm font-bold text-gray-500 mb-8 text-center">Let's start with the basics.</p>

            <div className="grid grid-cols-2 gap-4">
              <div className="relative">
                <IonIcon icon={personOutline} className="absolute left-4 top-1/2 -translate-y-1/2 text-xl text-gray-400" />
                <input type="text" placeholder="First Name" value={formData.firstName} onChange={(e) => setFormData({...formData, firstName: e.target.value})} className={inputClasses} />
              </div>
              <input type="text" placeholder="Last Name" value={formData.lastName} onChange={(e) => setFormData({...formData, lastName: e.target.value})} className={`${inputClasses} !px-5`} />
            </div>

            <div className="relative">
              <IonIcon icon={mailOutline} className="absolute left-4 top-1/2 -translate-y-1/2 text-xl text-gray-400" />
              <input type="email" placeholder="Email Address" value={formData.email} onChange={(e) => setFormData({...formData, email: e.target.value})} className={inputClasses} />
            </div>

            <div className="relative">
              <IonIcon icon={lockClosedOutline} className="absolute left-4 top-1/2 -translate-y-1/2 text-xl text-gray-400" />
              <input type={showPassword ? "text" : "password"} placeholder="Password (Min 6 chars)" value={formData.password} onChange={(e) => setFormData({...formData, password: e.target.value})} className={inputClasses} />
              <button onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400">
                <IonIcon icon={showPassword ? eyeOffOutline : eyeOutline} className="text-xl" />
              </button>
            </div>
            
            <Button onClick={handleNext} className="w-full !rounded-2xl !py-4 !text-lg !font-black shadow-md hover:!bg-orange-600 mt-8">
              Continue
            </Button>
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

            <div className="relative">
              <IonIcon icon={schoolOutline} className="absolute left-4 top-1/2 -translate-y-1/2 text-xl text-gray-400" />
              <select value={formData.university} onChange={(e) => {
                const uniId = e.target.value;
                const uni = NIGERIAN_UNIVERSITIES.find(u => u.id === uniId);
                setFormData({ ...formData, university: uniId, campus: uni?.campuses[0] || '' });
              }} className={inputClasses}>
                {NIGERIAN_UNIVERSITIES.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>

            <select value={formData.campus} onChange={(e) => setFormData({...formData, campus: e.target.value})} className={`${inputClasses} !pl-5`}>
              {(NIGERIAN_UNIVERSITIES.find(u => u.id === formData.university)?.campuses || []).map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>

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
              <div className="relative group">
                <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-gray-100 dark:border-gray-800 shadow-lg bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
                  <ImageUploader 
                    images={formData.images} 
                    onChange={(newImages) => setFormData({ ...formData, images: newImages })}
                    onError={(err) => setError(err)}
                    maxImages={1}
                  />
                </div>
              </div>
              
              <div className="flex gap-3 mt-4">
                <button className="flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-orange-500 transition-colors bg-gray-100 dark:bg-gray-800 px-3 py-1.5 rounded-full">
                  <IonIcon icon={cameraOutline} /> Change Photo
                </button>
                <button className="flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-orange-500 transition-colors bg-gray-100 dark:bg-gray-800 px-3 py-1.5 rounded-full">
                  <IonIcon icon={cropOutline} /> Edit / Crop
                </button>
              </div>
            </div>

            <div className="flex items-start gap-3 bg-gray-50 dark:bg-[#0f172a] p-4 rounded-2xl border border-gray-200 dark:border-gray-800">
              <input 
                type="checkbox" 
                id="terms" 
                checked={formData.termsAccepted} 
                onChange={(e) => setFormData({...formData, termsAccepted: e.target.checked})}
                className="mt-1 w-5 h-5 rounded border-gray-300 text-orange-500 focus:ring-orange-500"
              />
              <label htmlFor="terms" className="text-xs font-bold text-gray-600 dark:text-gray-400 leading-relaxed">
                I agree to the <span className="text-orange-500">Terms of Service</span> and acknowledge that my information will be verified to prevent fraud on the marketplace.
              </label>
            </div>

            <Button onClick={handleSignup} disabled={isLoading} className="w-full !rounded-2xl !py-4 !text-lg !font-black shadow-md hover:!bg-orange-600 mt-4">
              {isLoading ? 'Creating Account...' : 'Create Account'}
            </Button>
          </div>
        )}

        <p className="text-center text-sm font-bold text-gray-500 mt-auto">
          Already have an account? <Link href="/login" className="text-orange-500 hover:underline">Log In</Link>
        </p>

      </div>
    </div>
  );
}