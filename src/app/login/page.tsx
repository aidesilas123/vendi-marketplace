"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { Button } from '@/shared/Button';
import { Modal } from '@/shared/Modal/Modal';
   import IonIcon from '@/shared/Icon/Icon';
import { 
  mailOutline, 
  lockClosedOutline, 
  eyeOutline, 
  eyeOffOutline,
  alertCircleOutline,
  chevronBackOutline
} from 'ionicons/icons';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // Auto-redirect if already logged in
  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) router.replace('/');
    };
    checkSession();
  }, [router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    if (signInError) {
      setError(signInError.message);
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
            <h2 className="text-xl font-black mb-2 text-gray-900 dark:text-white">Login Failed</h2>
            <p className="text-gray-600 dark:text-gray-300 mb-6">{error}</p>
            <Button onClick={() => setError('')} className="w-full !py-3">Try Again</Button>
          </div>
        </Modal>
      )}

      {/* Transparent Back Button */}
      <div className="pt-8">
        <button onClick={() => router.push('/')} className="w-10 h-10 rounded-full bg-transparent flex items-center justify-center mb-4 text-gray-900 dark:text-white transition-colors hover:bg-black/5 dark:hover:bg-white/10">
          <IonIcon icon={chevronBackOutline} className="text-2xl" />
        </button>
      </div>

      <div className="max-w-md w-full mx-auto flex-1 flex flex-col justify-center pb-20">
        
        {/* App Logo */}
        <div className="flex justify-center mb-8">
          <img src="/logo.png" alt="Campus Market Logo" className="w-20 h-20 object-contain drop-shadow-md" />
        </div>

        <h1 className="text-3xl font-black text-gray-900 dark:text-white mb-2 text-center">Welcome Back</h1>
        <p className="text-sm font-bold text-gray-500 mb-8 text-center">Log in to your Campus Marketplace account.</p>

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

        <p className="text-center text-sm font-bold text-gray-500 mt-8">
          Don't have an account? <Link href="/signup" className="text-orange-500 hover:underline">Sign Up</Link>
        </p>
      </div>
    </div>
  );
}