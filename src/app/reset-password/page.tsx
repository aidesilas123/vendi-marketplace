"use client";
// src/app/reset-password/page.tsx

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { Button } from '@/shared/Button';
import { showGlobalToast } from '@/shared/Toast/Toast';
import IonIcon from '@/shared/Icon/Icon';
import {
  lockClosedOutline,
  eyeOutline,
  eyeOffOutline,
  alertCircleOutline,
  chevronBackOutline
} from 'ionicons/icons';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // The recovery link reaches this page three ways, and all three must work:
  // - Web PKCE: ?code=... -> exchange it for a session.
  // - Web hash flow: the client reads the session straight from the URL hash.
  // - Native deep link: AppShell forwards the link's query/fragment as query
  //   params (?access_token=...&refresh_token=...) -> set the session from them.
  const checkSession = useCallback(async () => {
    setChecking(true);
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        // Tolerate an already-exchanged code: a session may exist anyway.
        const { data: { session: existing } } = await supabase.auth.getSession();
        setHasSession(!!existing);
        setChecking(false);
        return;
      }
    } else {
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (!error) {
          setHasSession(true);
          setChecking(false);
          return;
        }
        // If setSession failed, fall through to the plain session check below.
      }
    }
    const { data: { session } } = await supabase.auth.getSession();
    setHasSession(!!session);
    setChecking(false);
  }, []);

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      showGlobalToast('Password must be at least 6 characters.', 'error');
      return;
    }
    if (password !== confirm) {
      showGlobalToast('Passwords do not match.', 'error');
      return;
    }
    setIsLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        showGlobalToast(updateError.message, 'error');
        setIsLoading(false);
      } else {
        window.dispatchEvent(new Event('refresh-profile'));
        router.replace('/');
      }
    } catch {
      showGlobalToast('Could not reach the server. Check your connection and try again.', 'error');
      setIsLoading(false);
    }
  };

  const inputClasses = "w-full bg-transparent border border-orange-500/50 text-gray-900 dark:text-white px-12 py-4 rounded-2xl outline-none focus:border-orange-400 transition-colors";

  return (
    <div className="h-dvh overflow-y-auto bg-white dark:bg-background flex flex-col px-6 md:px-8 pt-safe pb-safe">


      <div className="pt-8">
        <button onClick={() => router.push('/login')} className="w-10 h-10 rounded-full bg-transparent flex items-center justify-center mb-4 text-gray-900 dark:text-white transition-colors hover:bg-black/5 dark:hover:bg-white/10">
          <IonIcon icon={chevronBackOutline} className="text-2xl" />
        </button>
      </div>

      <div className="max-w-md w-full m-auto flex flex-col pb-20">
        {checking ? (
          <p className="text-center text-sm font-bold text-gray-500 py-20">Checking your reset link...</p>
        ) : !hasSession ? (
          <div className="text-center">
            <IonIcon icon={alertCircleOutline} className="text-6xl text-red-500 mb-6 mx-auto" />
            <h1 className="text-3xl font-black text-gray-900 dark:text-white mb-2">Link invalid or expired</h1>
            <p className="text-sm font-bold text-gray-500 leading-relaxed mb-8">
              This link may have expired or already been used. Request a fresh one and try again.
            </p>
            <Button onClick={() => router.push('/forgot-password')} className="w-full !rounded-2xl !py-4 !text-lg !font-black shadow-md hover:!bg-orange-600">
              Request a New Link
            </Button>
            <button onClick={() => void checkSession()} className="text-sm font-bold text-orange-500 hover:underline mt-6">
              I just opened the link — check again
            </button>
            <p className="text-center text-sm font-bold text-gray-500 mt-4">
              <Link href="/login" className="text-orange-500 hover:underline">Back to Log In</Link>
            </p>
          </div>
        ) : (
          <>
            <div className="flex justify-center mb-8">
              <img src="/logo.png" alt="Vendi Logo" className="w-20 h-20 object-contain drop-shadow-md" />
            </div>

            <h1 className="text-3xl font-black text-gray-900 dark:text-white mb-2 text-center">Set a New Password</h1>
            <p className="text-sm font-bold text-gray-500 mb-8 text-center">Choose something you will remember.</p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="relative">
                <IonIcon icon={lockClosedOutline} className="absolute left-4 top-1/2 -translate-y-1/2 text-xl text-gray-400" />
                <input type={showPassword ? "text" : "password"} placeholder="New Password (Min 6 chars)" required value={password} onChange={(e) => setPassword(e.target.value)} className={inputClasses} />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
                  <IonIcon icon={showPassword ? eyeOffOutline : eyeOutline} className="text-xl" />
                </button>
              </div>

              <div className="relative">
                <IonIcon icon={lockClosedOutline} className="absolute left-4 top-1/2 -translate-y-1/2 text-xl text-gray-400" />
                <input type={showPassword ? "text" : "password"} placeholder="Confirm New Password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClasses} />
              </div>

              <Button type="submit" disabled={isLoading} className="w-full !rounded-2xl !py-4 !text-lg !font-black shadow-md hover:!bg-orange-600">
                {isLoading ? 'Saving...' : 'Set New Password'}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
