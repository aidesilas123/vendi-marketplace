"use client";
// src/app/forgot-password/page.tsx

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { Capacitor } from '@capacitor/core';
import { Button } from '@/shared/Button';
import { Modal } from '@/shared/Modal/Modal';
import IonIcon from '@/shared/Icon/Icon';
import {
  mailOutline,
  alertCircleOutline,
  chevronBackOutline,
  checkmarkCircleOutline
} from 'ionicons/icons';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const inputClasses = "w-full bg-gray-50 dark:bg-[#171717] border border-gray-200 dark:border-gray-800 text-gray-900 dark:text-white px-12 py-4 rounded-2xl outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition-colors shadow-sm";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError('Please enter a valid email address.');
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(trimmed, {
        // Native: the email link must come back to the app, not to a browser
        // localhost address that resolves to nothing. Web: the hosted page.
        redirectTo: Capacitor.isNativePlatform()
          ? 'com.vendi.app://reset-password'
          : `${window.location.origin}/reset-password`,
      });
      if (resetError) {
        setError(resetError.message);
        setIsLoading(false);
      } else {
        setSent(true);
        setIsLoading(false);
      }
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setIsLoading(false);
    }
  };

  return (
    <div className="h-dvh overflow-y-auto bg-white dark:bg-background flex flex-col px-6 md:px-8 pt-safe pb-safe">

      {error && (
        <Modal isOpen={!!error} onClose={() => setError('')}>
          <div className="p-6 text-center">
            <IonIcon icon={alertCircleOutline} className="text-5xl text-red-500 mb-4" />
            <h2 className="text-xl font-black mb-2 text-gray-900 dark:text-white">Something went wrong</h2>
            <p className="text-gray-600 dark:text-gray-300 mb-6">{error}</p>
            <Button onClick={() => setError('')} className="w-full !py-3">Try Again</Button>
          </div>
        </Modal>
      )}

      <div className="pt-8">
        <button onClick={() => router.push('/login')} className="w-10 h-10 rounded-full bg-transparent flex items-center justify-center mb-4 text-gray-900 dark:text-white transition-colors hover:bg-black/5 dark:hover:bg-white/10">
          <IonIcon icon={chevronBackOutline} className="text-2xl" />
        </button>
      </div>

      <div className="max-w-md w-full m-auto flex flex-col pb-20">
        {sent ? (
          <div className="text-center">
            <IonIcon icon={checkmarkCircleOutline} className="text-6xl text-green-500 mb-6 mx-auto" />
            <h1 className="text-3xl font-black text-gray-900 dark:text-white mb-2">Check your email</h1>
            <p className="text-sm font-bold text-gray-500 leading-relaxed mb-8">
              If an account exists for {email.trim()}, a password reset link is on its way. The link expires, so open it soon.
            </p>
            <Button onClick={() => router.push('/login')} className="w-full !rounded-2xl !py-4 !text-lg !font-black shadow-md hover:!bg-orange-600">
              Back to Log In
            </Button>
          </div>
        ) : (
          <>
            <div className="flex justify-center mb-8">
              <img src="/logo.png" alt="Vendi Logo" className="w-20 h-20 object-contain drop-shadow-md" />
            </div>

            <h1 className="text-3xl font-black text-gray-900 dark:text-white mb-2 text-center">Forgot Password?</h1>
            <p className="text-sm font-bold text-gray-500 mb-8 text-center">Enter your email and we will send you a link to reset it.</p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="relative">
                <IonIcon icon={mailOutline} className="absolute left-4 top-1/2 -translate-y-1/2 text-xl text-gray-400" />
                <input type="email" placeholder="Email Address" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClasses} />
              </div>

              <Button type="submit" disabled={isLoading} className="w-full !rounded-2xl !py-4 !text-lg !font-black shadow-md hover:!bg-orange-600">
                {isLoading ? 'Sending...' : 'Send Reset Link'}
              </Button>
            </form>

            <p className="text-center text-sm font-bold text-gray-500 mt-8">
              Remembered it? <Link href="/login" className="text-orange-500 hover:underline">Log In</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
