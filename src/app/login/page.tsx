"use client";

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { signInWithGoogleNative } from '@/lib/googleSignIn';
import { Capacitor } from '@capacitor/core';
import { Button } from '@/shared/Button';
import { showGlobalToast } from '@/shared/Toast/Toast';
import IonIcon from '@/shared/Icon/Icon';
import { 
  mailOutline, 
  lockClosedOutline, 
  eyeOutline, 
  eyeOffOutline,
  chevronBackOutline,
  logoGoogle
} from 'ionicons/icons';

function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

  const searchParams = useSearchParams();

  // Where to go after login. Only same-app paths are allowed (no open redirects),
  // and never back to an auth page (that would loop for an already-logged-in user).
  const getSafeRedirectParam = () => {
    const redirect = searchParams.get('redirect');
    if (!redirect || !redirect.startsWith('/') || redirect.startsWith('//')) return null;
    if (redirect === '/login' || redirect === '/signup') return null;
    return redirect;
  };
  const getSafeRedirect = () => getSafeRedirectParam() ?? '/';
  // Keep the redirect alive if the user taps through to Sign Up mid-flow
  // (e.g. Wallet -> /login?redirect=/wallet -> Sign Up -> back here).
  const signupHref = (() => {
    const param = getSafeRedirectParam();
    return param ? `/signup?redirect=${encodeURIComponent(param)}` : '/signup';
  })();

  // Auto-redirect if already logged in
  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        window.dispatchEvent(new Event('refresh-profile'));
        router.replace(getSafeRedirect());
      }
    };
    checkSession();
  }, [router, searchParams]);

  const handleGoogleSignIn = async () => {
    setIsGoogleLoading(true);
    try {
      // Remember where to land after sign-in; the callback page reads it back.
      localStorage.setItem('vendi_post_auth_redirect', getSafeRedirect());
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

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      // Mobile keyboards/autofill often add a stray space; Supabase treats it as a
      // different email, so trim. Passwords are never trimmed (they are exact).
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });

      if (signInError) {
        showGlobalToast(signInError.message, 'error');
        setIsLoading(false);
      } else {
        window.dispatchEvent(new Event('refresh-profile'));
        router.replace(getSafeRedirect());
      }
    } catch {
      showGlobalToast('Could not reach the server. Check your connection and try again.', 'error');
      setIsLoading(false);
    }
  };

  const inputClasses = "w-full bg-transparent border border-orange-500/50 text-gray-900 dark:text-white px-12 py-4 rounded-2xl outline-none focus:border-orange-400 transition-colors";

  return (
    <div className="h-dvh overflow-y-auto bg-white dark:bg-background flex flex-col px-6 md:px-8 pt-safe pb-safe">
      

      {/* Transparent Back Button */}
      <div className="pt-8">
        <button onClick={() => router.push('/')} className="w-10 h-10 rounded-full bg-transparent flex items-center justify-center mb-4 text-gray-900 dark:text-white transition-colors hover:bg-black/5 dark:hover:bg-white/10">
          <IonIcon icon={chevronBackOutline} className="text-2xl" />
        </button>
      </div>

      <div className="max-w-md w-full m-auto flex flex-col pb-20">
        
        {/* App Logo */}
        <div className="flex justify-center mb-8">
          <img src="/logo.png" alt="Vendi Logo" className="w-20 h-20 object-contain drop-shadow-md" />
        </div>

        <h1 className="text-3xl font-black text-gray-900 dark:text-white mb-2 text-center">Welcome Back</h1>
        <p className="text-sm font-bold text-gray-500 mb-8 text-center">Log in to your Vendi account.</p>

        <form onSubmit={handleLogin} className="space-y-4">
          <div className="relative">
            <IonIcon icon={mailOutline} className="absolute left-4 top-1/2 -translate-y-1/2 text-xl text-gray-400" />
            <input type="email" placeholder="Email Address" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClasses} />
          </div>

          <div className="relative">
            <IonIcon icon={lockClosedOutline} className="absolute left-4 top-1/2 -translate-y-1/2 text-xl text-gray-400" />
            <input type={showPassword ? "text" : "password"} placeholder="Password" required value={password} onChange={(e) => setPassword(e.target.value)} className={inputClasses} />
            <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
              <IonIcon icon={showPassword ? eyeOffOutline : eyeOutline} className="text-xl" />
            </button>
          </div>

          <div className="flex justify-end pt-1 mb-6">
            <Link href="/forgot-password" className="text-sm font-bold text-orange-500 hover:underline">
              Forgot Password?
            </Link>
          </div>

          <Button type="submit" disabled={isLoading} className="w-full !rounded-2xl !py-4 !text-lg !font-black shadow-md hover:!bg-orange-600">
            {isLoading ? 'Logging in...' : 'Log In'}
          </Button>
        </form>

        <div className="flex items-center gap-3 mt-6">
          <div className="h-px flex-1 bg-gray-200 dark:bg-gray-800" />
          <span className="text-xs font-bold text-gray-400">or continue with</span>
          <div className="h-px flex-1 bg-gray-200 dark:bg-gray-800" />
        </div>

<button type="button" onClick={handleGoogleSignIn} disabled={isLoading || isGoogleLoading} className="w-full flex items-center justify-center gap-3 !rounded-2xl py-4 text-lg font-black bg-transparent text-gray-900 dark:text-white border border-orange-500/50 hover:border-orange-400 transition-colors active:scale-[0.98] disabled:opacity-60 mt-6">
          <IonIcon icon={logoGoogle} className="text-xl" />
          {isGoogleLoading ? 'Connecting...' : 'Continue with Google'}
        </button>

        <p className="text-center text-sm font-bold text-gray-500 mt-8">
          Don't have an account? <Link href={signupHref} className="text-orange-500 hover:underline">Sign Up</Link>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}