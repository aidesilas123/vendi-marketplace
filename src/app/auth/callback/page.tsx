"use client";
// src/app/auth/callback/page.tsx

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { VendiLoader } from '@/shared/VendiLoader';

function CallbackForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [message, setMessage] = useState('Signing you in...');

  useEffect(() => {
    const finish = async () => {
      // OAuth errors come back as query params (e.g. the user denied access).
      const oauthError = searchParams.get('error_description') || searchParams.get('error');
      if (oauthError) {
        setMessage('Sign-in was cancelled or failed. Redirecting to login...');
        setTimeout(() => router.replace('/login'), 2000);
        return;
      }

      // PKCE flow: exchange the code. If the code was already exchanged
      // (e.g. a double mount), a session still exists — carry on instead
      // of failing a sign-in that actually worked.
      const code = searchParams.get('code');
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          const { data: { session: existing } } = await supabase.auth.getSession();
          if (!existing) {
            setMessage('That sign-in link did not work. Redirecting to login...');
            setTimeout(() => router.replace('/login'), 2000);
            return;
          }
        }
      }

      // Hash flow (implicit) needs no exchange: the client reads the session
      // straight from the URL.
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setMessage('No sign-in found. Redirecting to login...');
        setTimeout(() => router.replace('/login'), 2000);
        return;
      }

      window.dispatchEvent(new Event('refresh-profile'));

      // Where the user was headed before Google (saved by the login/signup button).
      const raw = localStorage.getItem('vendi_post_auth_redirect');
      localStorage.removeItem('vendi_post_auth_redirect');
      const target =
        raw && raw.startsWith('/') && !raw.startsWith('//') && raw !== '/login' && raw !== '/signup'
          ? raw
          : '/';

      // First-time Google users have no campus identity yet: send them to
      // complete it before they land anywhere else.
      const { data: profile } = await supabase
        .from('users')
        .select('username')
        .eq('id', session.user.id)
        .maybeSingle();
      if (!profile?.username) {
        router.replace('/complete-profile');
        return;
      }
      router.replace(target);
    };
    void finish();
  }, [router, searchParams]);

  return (
    <div className="min-h-screen bg-white dark:bg-background flex flex-col items-center justify-center gap-4 px-6">
      <VendiLoader label={message} />
      <p className="text-sm font-bold text-gray-500 text-center">{message}</p>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense>
      <CallbackForm />
    </Suspense>
  );
}
