"use client";

import React, { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { supabase } from '@/lib/supabase';
import { Button } from '@/shared/Button';
import { Skeleton } from '@/shared/Skeleton/Skeleton';
import { Toast, useToast } from '@/shared/Toast/Toast';
import { safeBack } from '@/shared/safeBack';
import { IonIcon } from '@/shared/Icon/Icon';
import {
  chevronBackOutline,
  shieldHalfOutline,
  warningOutline,
  documentTextOutline,
  personOutline
} from 'ionicons/icons';

const REPORT_REASONS = [
  { id: 'scam', label: 'Fraud or Scam', description: 'Asking for money outside Escrow, suspicious links, etc.' },
  { id: 'harassment', label: 'Harassment or Abuse', description: 'Insults, threats, or inappropriate behavior.' },
  { id: 'spam', label: 'Spam', description: 'Repeated unwanted messages or advertising.' },
  { id: 'other', label: 'Other', description: 'Something else that violates Vendi policies.' }
];

export default function ReportPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Two modes, one page:
  //   ?ref=<tx>    -> chat report  (from /chats, goes to chat_reports with message snapshot)
  //   ?seller=<id> -> user report  (from a profile, goes to user_reports, no transaction)
  const txRef = searchParams.get('ref');
  const reportedUserId = searchParams.get('seller');
  const isChatMode = !!txRef;

  const { toast, showToast, hideToast } = useToast();
  const [selectedReason, setSelectedReason] = useState<string>('scam');
  const [additionalComments, setAdditionalComments] = useState('');
  const [manualUsername, setManualUsername] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const bounceRef = useRef<HTMLDivElement>(null);

  /* Session user via SWR */
  const { data: sessionUser } = useSWR('session-user', async () => {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
  });
  const authChecked = sessionUser !== undefined;

  useEffect(() => {
    if (authChecked && !sessionUser) router.push('/login');
  }, [authChecked, sessionUser, router]);

  /* Chat snapshot — chat mode only (session cache first, DB fallback) */
  const { data: snapshotMessages } = useSWR(
    isChatMode && authChecked ? ['report-snapshot', txRef] : null,
    async ([, ref]: [string, string | null]) => {
      const cachedContext = sessionStorage.getItem('vendi_report_context');
      if (cachedContext) {
        try {
          const parsed = JSON.parse(cachedContext);
          const msgs = Array.isArray(parsed) ? parsed : parsed?.messages;
          if (Array.isArray(msgs)) return msgs.filter((m: any) => !m.is_deleted);
        } catch {
          /* fall through to the DB fallback */
        }
      }
      const { data: fallbackMsgs } = await supabase
        .from('messages')
        .select('*')
        .eq('transaction_ref', ref)
        .eq('is_deleted', false)
        .order('created_at', { ascending: false })
        .limit(10);
      return (fallbackMsgs ?? []).reverse();
    }
  );


  const handleSubmitReport = async () => {
    if (!sessionUser || isSubmitting) return;

    // User mode with no target: require the manually typed identity
    if (!isChatMode && !reportedUserId && !manualUsername.trim()) {
      showToast('Please provide the username or email of the person you are reporting.', 'error');
      return;
    }

    setIsSubmitting(true);

    try {
      // If there's a manual username, prepend it to the details so Trust & Safety sees it
      const finalDetails = manualUsername.trim()
        ? `Reported User Identity: ${manualUsername.trim()}\n\n${additionalComments.trim()}`
        : additionalComments.trim();

      if (isChatMode) {
        const { error } = await supabase.from('chat_reports').insert({
          transaction_ref: txRef,
          reporter_id: sessionUser.id,
          reported_user_id: reportedUserId || null,
          reason: selectedReason,
          details: finalDetails,
          message_snapshot: snapshotMessages && snapshotMessages.length > 0 ? snapshotMessages : null,
          status: 'pending'
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.from('user_reports').insert({
          reporter_id: sessionUser.id,
          reported_user_id: reportedUserId || null,
          reason: selectedReason,
          details: finalDetails,
          status: 'pending'
        });
        if (error) throw error;
      }

      sessionStorage.removeItem('vendi_report_context');
      showToast('Report submitted. Our Trust & Safety team will review it.');
      setTimeout(() => router.push(isChatMode ? '/messages' : '/safety'), 1400);
    } catch (err: any) {
      showToast(err.message || 'We could not submit your report. Please try again.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  /* --- Vivid granular skeleton --- */
  if (!authChecked) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <div className="sticky top-0 z-50 w-full bg-background">
          <div className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="w-10 h-10 rounded-full" />
            <div className="space-y-1.5">
              <Skeleton className="w-28 h-5 rounded-full" />
              <Skeleton className="w-20 h-3 rounded-full" />
            </div>
          </div>
        </div>
        <div className="max-w-xl mx-auto px-4 py-6 space-y-6 w-full">
          <Skeleton className="w-full h-20 rounded-3xl" />
          <div className="space-y-2">
            <Skeleton className="w-36 h-4 rounded-full mb-3 ml-2" />
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="flex items-start gap-4 p-4">
                <Skeleton className="w-[22px] h-[22px] rounded-full shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="w-2/5 h-5 rounded-full" />
                  <Skeleton className="w-4/5 h-4 rounded-full" />
                </div>
              </div>
            ))}
          </div>
          <Skeleton className="w-44 h-4 rounded-full ml-2" />
          <Skeleton className="w-full h-36 rounded-3xl" />
          <Skeleton className="w-full h-14 rounded-full" />
        </div>
      </div>
    );
  }

  return (
    <>
      <Toast {...toast} onClose={hideToast} />

      {/* Rubber-band wrapper: content only — the toast stays outside */}
      <div ref={bounceRef} className="w-full min-h-full bg-background text-gray-900 dark:text-white pb-safe relative">

        {/* Solid header — no blur, no border, full-bleed */}
        <div className="sticky top-0 z-50 w-full bg-background">
          <div className="flex items-center gap-2 px-4 py-3 w-full">
            <button onClick={() => safeBack(router)} aria-label="Back" className="!p-2 -ml-2 text-gray-900 dark:text-white active:scale-95 transition-transform !rounded-full">
              <span className="flex items-center justify-center">
                <IonIcon icon={chevronBackOutline} className="text-3xl" />
              </span>
            </button>
            <div className="flex flex-col">
              <h1 className="text-lg font-bold leading-tight">Report User</h1>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 font-medium">Secure & Confidential</p>
            </div>
          </div>
        </div>

        <div className="max-w-xl mx-auto px-4 py-6 space-y-8">

          {/* INFO ALERT - adapts to the mode */}
          <div className="bg-orange-500/10 p-4 !rounded-[1.5rem] flex gap-3 items-start">
            <span className="flex-shrink-0 mt-0.5">
              <IonIcon icon={shieldHalfOutline} className="text-orange-500 text-2xl" />
            </span>
            <p className="text-[13px] font-medium text-orange-600 dark:text-orange-200/90 leading-relaxed">
              {isChatMode
                ? 'To help our Trust & Safety team investigate, the last 10 messages from this chat will be securely attached to this report. The user will not be notified.'
                : 'Our Trust & Safety team reviews all reports. False reporting may result in account suspension. The user will not be notified.'}
            </p>
          </div>

          {/* MANUAL TARGET INPUT (only when no user id came in — Safety Center) */}
          {!reportedUserId && (
            <div className="flex flex-col">
              <h2 className="text-[13px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400 mb-4 px-2 flex items-center gap-2">
                <IonIcon icon={personOutline} className="text-lg" />
                Who are you reporting?
              </h2>
              <input
                type="text"
                value={manualUsername}
                onChange={(e) => setManualUsername(e.target.value)}
                placeholder="Username, email, or Vendi Tag"
                className="w-full bg-background border border-orange-500/30 !rounded-2xl p-4 text-[15px] text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition-all"
              />
            </div>
          )}

          {/* REPORT REASON LIST */}
          <div className="flex flex-col">
            <h2 className="text-[13px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400 mb-4 px-2 flex items-center gap-2">
              <IonIcon icon={warningOutline} className="text-lg" />
              Reason for report
            </h2>
            <div className="flex flex-col gap-2">
              {REPORT_REASONS.map((reason) => (
                <label
                  key={reason.id}
                  className={`flex items-start gap-4 p-4 cursor-pointer !rounded-2xl transition-colors ${selectedReason === reason.id ? 'bg-orange-500/10' : 'active:bg-black/5 dark:active:bg-white/5'}`}
                >
                  <div className="relative flex items-center justify-center mt-0.5 flex-shrink-0">
                    <input
                      type="radio"
                      name="report_reason"
                      value={reason.id}
                      checked={selectedReason === reason.id}
                      onChange={() => setSelectedReason(reason.id)}
                      className="w-[22px] h-[22px] appearance-none border-2 border-gray-300 dark:border-gray-600 rounded-full checked:border-orange-500 transition-colors"
                    />
                    {selectedReason === reason.id && (
                      <div className="absolute w-3 h-3 bg-orange-500 rounded-full pointer-events-none" />
                    )}
                  </div>
                  <div className="flex flex-col flex-1">
                    <span className="text-[16px] font-bold text-gray-900 dark:text-white leading-tight">{reason.label}</span>
                    <span className="text-[13px] text-gray-500 dark:text-gray-400 mt-1 leading-snug">{reason.description}</span>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* ADDITIONAL COMMENTS */}
          <div className="flex flex-col">
            <h2 className="text-[13px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400 mb-4 px-2 flex items-center gap-2">
              <IonIcon icon={documentTextOutline} className="text-lg" />
              Additional Details (Optional)
            </h2>
            <textarea
              value={additionalComments}
              onChange={(e) => setAdditionalComments(e.target.value)}
              placeholder="Please provide any extra context that will help us investigate this issue..."
              className="w-full bg-background border border-orange-500/30 !rounded-2xl p-5 text-[15px] text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition-all min-h-[140px] resize-none"
            />
          </div>

          {/* SUBMIT BUTTON */}
          <div className="pt-2 pb-12">
            <Button
              onClick={handleSubmitReport}
              disabled={isSubmitting}
              className={`w-full !rounded-full !py-4 shadow-lg active:scale-[0.98] transition-all text-base font-black ${isSubmitting ? 'opacity-70 cursor-not-allowed' : '!bg-red-500 hover:!bg-red-600 shadow-red-500/30 text-white'}`}
            >
              {isSubmitting ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Submitting Report...
                </span>
              ) : (
                'Submit Report securely'
              )}
            </Button>
          </div>

        </div>
      </div>
    </>
  );
}
