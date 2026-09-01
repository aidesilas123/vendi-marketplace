"use client";

import React, { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Button } from '@/shared/Button';
import { Modal } from '@/shared/Modal/Modal';
import { IonIcon } from '@ionic/react';
import { 
  chevronBackOutline, 
  shieldHalfOutline, 
  alertCircleOutline, 
  checkmarkCircleOutline,
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
  
  // URL Params (Will be null if accessed from Safety Center)
  const txRef = searchParams.get('ref');
  const reportedUserId = searchParams.get('seller');

  const [currentUser, setCurrentUser] = useState<any>(null);
  const [snapshotMessages, setSnapshotMessages] = useState<any[]>([]);
  const [selectedReason, setSelectedReason] = useState<string>('scam');
  const [additionalComments, setAdditionalComments] = useState('');
  const [manualUsername, setManualUsername] = useState('');
  
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [modalConfig, setModalConfig] = useState({ isOpen: false, title: '', message: '', type: 'info', onConfirm: () => {} });

  useEffect(() => {
    const initializeReport = async () => {
      // 1. Verify User
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }
      setCurrentUser(user);

      // 2. Fetch Chat Snapshot ONLY if a transaction ref exists
      if (txRef) {
        const cachedContext = sessionStorage.getItem('vendi_report_context');
        if (cachedContext) {
          try {
            const parsed = JSON.parse(cachedContext);
            if (parsed && Array.isArray(parsed.messages)) {
              setSnapshotMessages(parsed.messages.filter((m: any) => !m.is_deleted));
            } else if (Array.isArray(parsed)) {
              setSnapshotMessages(parsed.filter((m: any) => !m.is_deleted));
            }
          } catch (e) {
            console.error("Failed to parse cached report context", e);
          }
        } else {
          // Fallback fetch
          const { data: fallbackMsgs } = await supabase
            .from('messages')
            .select('*')
            .eq('transaction_ref', txRef)
            .eq('is_deleted', false)
            .order('created_at', { ascending: false })
            .limit(10);
            
          if (fallbackMsgs) {
            setSnapshotMessages(fallbackMsgs.reverse());
          }
        }
      }

      // FIX: Ensure the skeleton always disappears!
      setIsLoading(false);
    };

    initializeReport();
  }, [txRef, router]);

  const handleSubmitReport = async () => {
    if (!currentUser) return;
    
    // Require either a chat reference OR a manually typed username
    if (!reportedUserId && !manualUsername.trim()) {
      setModalConfig({
        isOpen: true,
        title: 'Missing Information',
        message: 'Please provide the username or email of the person you are reporting.',
        type: 'error',
        onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false }))
      });
      return;
    }

    setIsSubmitting(true);

    try {
      // If there's a manual username, prepend it to the details so Trust & Safety sees it
      const finalDetails = manualUsername.trim() 
        ? `Reported User Identity: ${manualUsername.trim()}\n\n${additionalComments.trim()}`
        : additionalComments.trim();

      const { error } = await supabase.from('chat_reports').insert({
        transaction_ref: txRef || null,
        reporter_id: currentUser.id,
        reported_user_id: reportedUserId || null,
        reason: selectedReason,
        details: finalDetails,
        message_snapshot: snapshotMessages.length > 0 ? snapshotMessages : null,
        status: 'pending'
      });

      if (error) throw error;

      sessionStorage.removeItem('vendi_report_context');

      setModalConfig({
        isOpen: true,
        title: 'Report Submitted',
        message: 'Thank you for keeping Vendi safe. Our Trust & Safety team will review this immediately.',
        type: 'success',
        onConfirm: () => router.push(txRef ? '/messages' : '/safety')
      });

    } catch (err: any) {
      console.error(err);
      setModalConfig({
        isOpen: true,
        title: 'Submission Failed',
        message: err.message || 'We could not submit your report. Please try again.',
        type: 'error',
        onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false }))
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex flex-col pt-safe">
        <div className="h-14 flex items-center px-4 border-b border-border animate-pulse">
           <div className="w-8 h-8 bg-muted rounded-full" />
           <div className="w-32 h-5 bg-muted rounded-md ml-4" />
        </div>
        <div className="p-6 space-y-4 animate-pulse">
           <div className="w-full h-24 bg-muted rounded-2xl" />
           <div className="w-full h-40 bg-muted rounded-2xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground pt-safe pb-safe selection:bg-orange-500/30">
      
      <Modal isOpen={modalConfig.isOpen} onClose={modalConfig.onConfirm}>
        <div className="p-6 text-center">
          <IonIcon 
            suppressHydrationWarning
            icon={modalConfig.type === 'success' ? checkmarkCircleOutline : alertCircleOutline} 
            className={`text-6xl mb-4 ${modalConfig.type === 'success' ? 'text-green-500' : 'text-red-500'}`} 
          />
          <h2 className="text-xl font-black mb-2 text-foreground tracking-tight">{modalConfig.title}</h2>
          <p className="text-muted-foreground mb-8 font-medium leading-relaxed">{modalConfig.message}</p>
          <Button onClick={modalConfig.onConfirm} className={`w-full !rounded-full !py-3.5 ${modalConfig.type === 'success' ? '!bg-green-500 hover:!bg-green-600 text-white' : '!bg-muted !text-foreground'}`}>
            {modalConfig.type === 'success' ? 'Done' : 'Close'}
          </Button>
        </div>
      </Modal>

      {/* HEADER */}
      <div className="flex-shrink-0 w-full bg-background/95 backdrop-blur-sm border-b border-border shadow-sm sticky top-0 z-50">
        <div className="flex items-center gap-2 px-4 py-3 w-full">
          <button onClick={() => router.back()} className="!p-2 -ml-2 text-foreground active:scale-95 transition-transform !rounded-full">
            <span suppressHydrationWarning className="flex items-center justify-center">
              <IonIcon icon={chevronBackOutline} className="text-3xl" />
            </span>
          </button>
          <div className="flex flex-col">
            <h1 className="text-lg font-bold leading-tight">Report User</h1>
            <p className="text-[11px] text-muted-foreground font-medium">Secure & Confidential</p>
          </div>
        </div>
      </div>

      <div className="max-w-xl mx-auto px-4 py-6 space-y-8">
        
        {/* INFO ALERT - Adapts based on context */}
        <div className="bg-orange-500/10 border border-orange-500/20 p-4 !rounded-[1.5rem] flex gap-3 items-start">
          <span suppressHydrationWarning className="flex-shrink-0 mt-0.5">
            <IonIcon icon={shieldHalfOutline} className="text-orange-500 text-2xl" />
          </span>
          <p className="text-[13px] font-medium text-orange-600 dark:text-orange-200/90 leading-relaxed">
            {txRef 
              ? 'To help our Trust & Safety team investigate, the last 10 messages from this chat will be securely attached to this report. The user will not be notified.'
              : 'Our Trust & Safety team reviews all reports. False reporting may result in account suspension. The user will not be notified.'}
          </p>
        </div>

        {/* MANUAL TARGET INPUT (Only shows if accessed from Safety Center) */}
        {!reportedUserId && (
          <div className="flex flex-col">
            <h2 className="text-[13px] font-black uppercase tracking-widest text-muted-foreground mb-4 px-2 flex items-center gap-2">
              <span suppressHydrationWarning><IonIcon icon={personOutline} className="text-lg" /></span>
              Who are you reporting?
            </h2>
            <input
              type="text"
              value={manualUsername}
              onChange={(e) => setManualUsername(e.target.value)}
              placeholder="Username, email, or Vendi Tag"
              className="w-full bg-card border border-border !rounded-2xl p-4 text-[15px] text-foreground placeholder-muted-foreground outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition-all shadow-sm"
            />
          </div>
        )}

        {/* REPORT REASON LIST */}
        <div className="flex flex-col">
          <h2 className="text-[13px] font-black uppercase tracking-widest text-muted-foreground mb-4 px-2 flex items-center gap-2">
            <span suppressHydrationWarning><IonIcon icon={warningOutline} className="text-lg" /></span>
            Reason for report
          </h2>
          <div className="flex flex-col gap-2">
            {REPORT_REASONS.map((reason) => (
              <label 
                key={reason.id} 
                className={`flex items-start gap-4 p-4 cursor-pointer !rounded-2xl transition-colors ${selectedReason === reason.id ? 'bg-muted shadow-sm border border-border/50' : 'hover:bg-muted/50 border border-transparent'}`}
              >
                <div className="relative flex items-center justify-center mt-0.5 flex-shrink-0">
                  <input 
                    type="radio" 
                    name="report_reason" 
                    value={reason.id}
                    checked={selectedReason === reason.id}
                    onChange={() => setSelectedReason(reason.id)}
                    className="w-[22px] h-[22px] appearance-none border-2 border-muted-foreground/30 rounded-full checked:border-orange-500 transition-colors"
                  />
                  {selectedReason === reason.id && (
                    <div className="absolute w-3 h-3 bg-orange-500 rounded-full pointer-events-none animate-in zoom-in duration-150" />
                  )}
                </div>
                <div className="flex flex-col flex-1">
                  <span className="text-[16px] font-bold text-foreground leading-tight">{reason.label}</span>
                  <span className="text-[13px] text-muted-foreground mt-1 leading-snug">{reason.description}</span>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* ADDITIONAL COMMENTS */}
        <div className="flex flex-col">
          <h2 className="text-[13px] font-black uppercase tracking-widest text-muted-foreground mb-4 px-2 flex items-center gap-2">
            <span suppressHydrationWarning><IonIcon icon={documentTextOutline} className="text-lg" /></span>
            Additional Details (Optional)
          </h2>
          <textarea
            value={additionalComments}
            onChange={(e) => setAdditionalComments(e.target.value)}
            placeholder="Please provide any extra context that will help us investigate this issue..."
            className="w-full bg-card border border-border !rounded-2xl p-5 text-[15px] text-foreground placeholder-muted-foreground outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition-all min-h-[140px] resize-none shadow-sm"
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
  );
}