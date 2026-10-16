"use client";

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { supabase } from '@/lib/supabase';
import { Button } from '@/shared/Button';
import { Modal } from '@/shared/Modal/Modal';
import { Badge } from '@/shared/Badge';
import { Avatar } from '@/shared/Avatar';
import { IonIcon } from '@ionic/react';
import { PullSpinner } from '@/shared/Loaders/PullSpinner';
import { ImageViewer } from '@/shared/ImageViewer/ImageViewer';
import { GalleryPicker } from '@/app/chats/components/GalleryPicker';
import { Skeleton } from '@/shared/Skeleton/Skeleton';
import { registerBackHandler } from '@/shared/HardwareBackButton';
import {
  chevronBackOutline,
  shieldCheckmarkOutline,
  documentTextOutline,
  cameraOutline,
  timeOutline,
  closeCircleOutline,
  cloudUploadOutline,
  arrowForwardOutline,
  checkmarkCircleOutline,
  checkmarkCircle,
  hourglassOutline,
  closeOutline
} from 'ionicons/icons';

type VerificationStatus = 'none' | 'pending' | 'approved' | 'stopped';
type UploadTarget = 'doc' | 'selfie' | null;
type RejectionCode = 'blurry' | 'expired' | 'mismatched_name' | 'other';

const REJECTION_REASONS: Record<RejectionCode, { title: string; fix: string }> = {
  blurry: {
    title: 'Photo was blurry',
    fix: 'Retake both photos in bright, even lighting. Hold your phone steady and make sure every word on the document is sharp and readable.',
  },
  expired: {
    title: 'Document expired',
    fix: 'The ID or admission letter you uploaded looks expired. Please submit a current, valid document.',
  },
  mismatched_name: {
    title: 'Name doesn\u2019t match',
    fix: 'The name on your document doesn\u2019t match your Vendi profile name. Update your profile or upload a document showing the same name.',
  },
  other: {
    title: 'Didn\u2019t meet guidelines',
    fix: 'Please check the requirements and try again with clear, well-lit photos.',
  },
};

/** Extract a rejection code from the verification row.
 *  Prefers a dedicated `rejection_code` column; falls back to a `[code]`
 *  prefix in `admin_notes` (e.g. "[blurry] text is unreadable"). */
const parseRejectionCode = (v: any): RejectionCode => {
  if (v?.rejection_code && REJECTION_REASONS[v.rejection_code as RejectionCode]) {
    return v.rejection_code as RejectionCode;
  }
  const notes: string = v?.admin_notes || '';
  const match = notes.match(/^\[(blurry|expired|mismatched_name)\]/i);
  if (match) return match[1].toLowerCase() as RejectionCode;
  return 'other';
};

const stripCodePrefix = (notes: string) => notes.replace(/^\[(blurry|expired|mismatched_name)\]\s*/i, '');

/* ------------------------------------------------------------------ */
/*  Animated selfie illustration: person holding a phone to their face */
/* ------------------------------------------------------------------ */
const SelfieAnimation = () => (
  <div className="relative w-52 h-52 mx-auto select-none" aria-hidden>
    <style>{`
      @keyframes selfie-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-7px); } }
      @keyframes selfie-scan { 0% { top: 18%; opacity: 0; } 12% { opacity: 1; } 88% { opacity: 1; } 100% { top: 82%; opacity: 0; } }
      @keyframes selfie-corner { 0%,100% { opacity: .35; transform: scale(.96); } 50% { opacity: 1; transform: scale(1.04); } }
      @keyframes selfie-shutter { 0%, 92%, 100% { opacity: 0; } 94%, 96% { opacity: .55; } }
      .selfie-float { animation: selfie-float 3.2s ease-in-out infinite; }
      .selfie-scan { animation: selfie-scan 2.6s ease-in-out infinite; }
      .selfie-corner { animation: selfie-corner 2s ease-in-out infinite; transform-origin: center; transform-box: fill-box; }
      .selfie-shutter { animation: selfie-shutter 2.6s ease-in-out infinite; }
    `}</style>
    <svg viewBox="0 0 200 200" className="w-full h-full">
      {/* soft backdrop */}
      <circle cx="100" cy="100" r="92" className="fill-orange-500/10" />
      {/* shoulders */}
      <path d="M52 200 Q54 148 100 148 Q146 148 148 200 Z" className="fill-muted" />
      {/* neck */}
      <rect x="90" y="118" width="20" height="26" rx="8" className="fill-muted" />
      {/* head */}
      <circle cx="100" cy="96" r="30" className="fill-muted" />
      {/* hair */}
      <path d="M70 92 Q72 64 100 64 Q128 64 130 92 Q118 78 100 80 Q82 78 70 92 Z" className="fill-foreground/70" />
      {/* phone held up to face */}
      <g className="selfie-float">
        <rect x="118" y="58" width="44" height="78" rx="10" className="fill-foreground" />
        <rect x="123" y="66" width="34" height="52" rx="5" className="fill-background" />
        {/* mini face on phone screen */}
        <circle cx="140" cy="86" r="9" className="fill-orange-500/70" />
        <path d="M128 118 Q140 112 152 118 L152 124 L128 124 Z" className="fill-orange-500/40" />
        {/* camera dot */}
        <circle cx="140" cy="62" r="2.5" className="fill-background" />
        {/* hand */}
        <circle cx="122" cy="128" r="11" className="fill-muted" />
      </g>
      {/* face-detection corners */}
      <g className="selfie-corner stroke-orange-500" strokeWidth="4" fill="none" strokeLinecap="round">
        <path d="M58 66 V52 H72" />
        <path d="M128 52 H142 V66" />
        <path d="M58 126 V140 H72" />
        <path d="M128 140 V126 H142" />
      </g>
      {/* scanning line */}
      <rect x="56" y="0" width="88" height="3" rx="1.5" className="fill-orange-500 selfie-scan" />
      {/* shutter flash */}
      <rect x="0" y="0" width="200" height="200" className="fill-white selfie-shutter" />
    </svg>
  </div>
);

/* ------------------------------------------------------------------ */
/*  Hydration-safe IonIcon: the ion-icon web component adds            */
/*  role="img" + class="md hydrated" at runtime in the browser, which  */
/*  never matches the server HTML. Gate it behind mount (Sidebar      */
/*  uses the same pattern).                                           */
/* ------------------------------------------------------------------ */
const VIcon = ({ icon, className, mounted }: { icon: string; className?: string; mounted: boolean }) =>
  mounted ? <IonIcon icon={icon} className={className} /> : <span className={className} aria-hidden />;

/* ------------------------------------------------------------------ */
/*  Staged upload status text: Processing -> Almost done               */
/* ------------------------------------------------------------------ */
const UploadStatusText = ({ progress }: { progress: number }) => (
  <p className="text-sm font-bold text-foreground">
    {progress < 55 ? 'Processing…' : progress < 100 ? 'Almost done…' : 'Finishing…'}
  </p>
);

export default function VerificationPage() {
  const router = useRouter();

  /* Gate Ionic web components behind client mount (hydration fix) */
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => { setIsMounted(true); }, []);

  /* ---------------- SWR: auth, profile, verification ---------------- */
  const { data: sessionUser } = useSWR('verification-auth-user', async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) router.push('/login');
    return user ?? null;
  });

  const { data: profile, isLoading: profileLoading } = useSWR(
    sessionUser ? ['verification-profile', sessionUser.id] : null,
    async ([, id]: [string, string]) => {
      const { data } = await supabase
        .from('users')
        .select('id, full_name, avatar_url, is_verified')
        .eq('id', id)
        .single();
      return data;
    }
  );

  const { data: latestVerification, isLoading: verificationLoading, mutate: refetchVerification } = useSWR(
    sessionUser ? ['verification-latest', sessionUser.id] : null,
    async ([, id]: [string, string]) => {
      const { data } = await supabase
        .from('verifications')
        .select('*')
        .eq('user_id', id)
        .order('created_at', { ascending: false })
        .limit(1);
      return data?.[0] ?? null;
    }
  );

  const isLoading = profileLoading || verificationLoading;
  const status: VerificationStatus = profile?.is_verified
    ? 'approved'
    : (latestVerification?.status as VerificationStatus) || 'none';
  /* retrying: user tapped "Fix & Try Again" on the rejected screen — show the
     wizard even though the DB status is still 'stopped'. Declared up here so
     inWizard/showRejected can use it (used-before-declaration breaks). */
  const [retrying, setRetrying] = useState(false);
  const inWizard = status === 'none' || retrying;
  const showRejected = status === 'stopped' && !retrying;

  /* Average review time from approved verifications (for the pending screen) */
  const { data: avgWaitHours } = useSWR(
    status === 'pending' ? 'verification-avg-wait' : null,
    async () => {
      const { data } = await supabase
        .from('verifications')
        .select('created_at, updated_at')
        .eq('status', 'approved')
        .order('updated_at', { ascending: false })
        .limit(100);
      if (!data || data.length === 0) return null;
      const hours = data
        .map(v => (new Date(v.updated_at).getTime() - new Date(v.created_at).getTime()) / 3600000)
        .filter(h => h > 0 && h < 720);
      if (hours.length === 0) return null;
      return Math.max(1, Math.round(hours.reduce((a, b) => a + b, 0) / hours.length));
    }
  );

  const rejectionCode = status === 'stopped' ? parseRejectionCode(latestVerification) : 'other';
  const rejectionDetail = status === 'stopped' ? stripCodePrefix(latestVerification?.admin_notes || '') : '';

  /* ---------------- Wizard state ---------------- */
  const [step, setStep] = useState(1);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [docType, setDocType] = useState<'id_card' | 'admission_letter'>('id_card');
  const [docUrl, setDocUrl] = useState('');
  const [selfieUrl, setSelfieUrl] = useState('');

  const goToStep = (next: number) => {
    setDirection(next > step ? 1 : -1);
    setStep(next);
  };

  /* ---------------- Upload state ---------------- */
  const [showGallery, setShowGallery] = useState<UploadTarget>(null);
  const [uploading, setUploading] = useState<{ target: UploadTarget; progress: number; preview: string } | null>(null);
  const [viewerImages, setViewerImages] = useState<string[] | null>(null);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [reviewLoaded, setReviewLoaded] = useState<{ doc: boolean; selfie: boolean }>({ doc: false, selfie: false });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [modalConfig, setModalConfig] = useState({ isOpen: false, title: '', message: '', type: 'info', onConfirm: () => {} });
  const showError = (title: string, message: string) =>
    setModalConfig({ isOpen: true, title, message, type: 'error', onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false })) });

  /* System back button: walk back through wizard steps instead of leaving.
     The ImageViewer handles its own back press — don't double-handle it here. */
  useEffect(() => {
    if (!inWizard) return;
    return registerBackHandler(() => {
      if (showGallery) { setShowGallery(null); return true; }
      if (step > 1) { goToStep(step - 1); return true; }
      return false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inWizard, step, showGallery]);

  /* ---------------- Cloudinary upload (compressed, with progress) ---------------- */
  const compressImage = (file: File): Promise<File> =>
    new Promise((resolve) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 1200;
          const scale = MAX_WIDTH / img.width;
          canvas.width = img.width > MAX_WIDTH ? MAX_WIDTH : img.width;
          canvas.height = img.width > MAX_WIDTH ? img.height * scale : img.height;
          canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((blob) => {
            resolve(blob ? new File([blob], file.name, { type: 'image/jpeg' }) : file);
          }, 'image/jpeg', 0.85);
        };
        img.onerror = () => resolve(file);
      };
      reader.onerror = () => resolve(file);
    });

  const uploadToCloudinary = (file: File, target: Exclude<UploadTarget, null>): Promise<string> =>
    new Promise((resolve, reject) => {
      const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
      const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;
      if (!cloudName || !uploadPreset) {
        reject(new Error('Upload is not configured. Please try again later.'));
        return;
      }
      const xhr = new XMLHttpRequest();
      const form = new FormData();
      form.append('file', file);
      form.append('upload_preset', uploadPreset);
      form.append('folder', 'verifications');
      xhr.open('POST', `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          setUploading(prev => prev ? { ...prev, progress: Math.round((e.loaded / e.total) * 100) } : prev);
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText).secure_url);
        else reject(new Error('Upload failed. Please try again.'));
      };
      xhr.onerror = () => reject(new Error('Network error. Please check your connection.'));
      xhr.send(form);
    });

  const handleFileUpload = async (file: File, target: Exclude<UploadTarget, null>) => {
    const preview = URL.createObjectURL(file);
    setUploading({ target, progress: 0, preview });
    try {
      const compressed = await compressImage(file);
      const url = await uploadToCloudinary(compressed, target);
      if (target === 'doc') setDocUrl(url);
      else setSelfieUrl(url);
    } catch (err: any) {
      showError('Upload Failed', err.message || 'Could not upload your photo.');
    } finally {
      setUploading(null);
    }
  };

  /* Selfie: open the device camera directly (front) instead of the gallery.
     The `capture="user"` hint makes the WebView launch the camera app;
     on desktop browsers it falls back to the file picker. */
  const openSelfieCamera = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.setAttribute('capture', 'user');
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) void handleFileUpload(file, 'selfie');
    };
    input.click();
  };

  /* Gallery selection -> blob -> upload (works for native webPath + web blob URLs) */
  const handleGallerySelect = async (url: string) => {
    const target = showGallery;
    setShowGallery(null);
    if (!target) return;
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      await handleFileUpload(new File([blob], `verification-${target}-${Date.now()}.jpg`, { type: 'image/jpeg' }), target);
    } catch {
      showError('Upload Failed', 'Could not read the selected photo.');
    }
  };

  const removeImage = (target: Exclude<UploadTarget, null>) => {
    if (target === 'doc') setDocUrl('');
    else setSelfieUrl('');
  };

  const handleSubmit = async () => {
    if (!profile || !docUrl || !selfieUrl) return;
    setIsSubmitting(true);
    try {
      const { error } = await supabase.from('verifications').insert({
        user_id: profile.id,
        document_type: docType,
        document_url: docUrl,
        selfie_url: selfieUrl,
        status: 'pending'
      });
      if (error) throw error;
      await refetchVerification();
      setRetrying(false);
      setStep(1);
    } catch (err: any) {
      showError('Submission Error', err.message || 'Could not submit your verification. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  /* ---------------- Loading: shared spinner, no white flash ---------------- */
  if (isLoading) {
    return (
      <div className="w-full min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <PullSpinner spinning size={36} />
        <p className="text-sm font-medium text-muted-foreground">Loading verification…</p>
      </div>
    );
  }

  return (
    <div className="w-full min-h-screen bg-background text-foreground pb-safe selection:bg-orange-500/30">

      {/* Shared image viewer — always mounted, toggled by isOpen (same pattern
          as the messages page). Conditional mounting caused open/close races. */}
      <ImageViewer
        images={viewerImages ?? []}
        isOpen={(viewerImages?.length ?? 0) > 0}
        initialIndex={viewerIndex}
        onClose={() => setViewerImages(null)}
      />

      {/* Shared gallery for file selection */}
      {showGallery && (
        <GalleryPicker onSelect={handleGallerySelect} onClose={() => setShowGallery(null)} />
      )}

      {/* Error modal */}
      <Modal isOpen={modalConfig.isOpen} onClose={modalConfig.onConfirm}>
        <div className="p-6 text-center relative z-[999]">
          <VIcon mounted={isMounted} icon={closeCircleOutline} className="text-6xl mb-4 text-red-500" />
          <h2 className="text-xl font-black mb-2 text-foreground tracking-tight">{modalConfig.title}</h2>
          <p className="text-muted-foreground mb-8 font-medium leading-relaxed">{modalConfig.message}</p>
          <Button onClick={modalConfig.onConfirm} className="w-full !rounded-full !py-3.5 !bg-muted !text-foreground font-bold hover:!bg-muted/80 transition-colors">
            Close
          </Button>
        </div>
      </Modal>

      {/* Seamless header: solid bg, no border, no shadow, no blur */}
      <div className="flex-shrink-0 w-full bg-background sticky top-0 z-50">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <button onClick={() => (inWizard && step > 1 ? goToStep(step - 1) : router.back())} className="!p-2 -ml-2 text-foreground active:bg-muted transition-colors !rounded-full" aria-label="Back">
              <VIcon mounted={isMounted} icon={chevronBackOutline} className="text-3xl" />
            </button>
            <div className="flex flex-col">
              <div className="flex items-center gap-1.5">
                <h1 className="text-lg font-bold leading-tight truncate max-w-[200px]">{profile?.full_name || 'Profile'}</h1>
                {profile?.is_verified && <Badge isVerified={true} className="text-xl" />}
              </div>
              <p className="text-[11px] text-muted-foreground font-medium tracking-wide uppercase">Get Verified</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-xl mx-auto px-4 py-8">

        {/* ============ APPROVED ============ */}
        {status === 'approved' && (
          <div className="flex flex-col items-center justify-center pt-10 text-center animate-in fade-in zoom-in duration-300">
            <div className="w-24 h-24 bg-green-500/10 rounded-full flex items-center justify-center mb-6">
              <VIcon mounted={isMounted} icon={shieldCheckmarkOutline} className="text-5xl text-green-500" />
            </div>
            <h2 className="text-2xl font-black text-foreground mb-2">You are Verified!</h2>
            <p className="text-muted-foreground px-4 leading-relaxed">
              Your identity has been confirmed. You now have the verified badge, building maximum trust with buyers on Vendi.
            </p>
          </div>
        )}

        {/* ============ PENDING (dispute-style timeline) ============ */}
        {status === 'pending' && (
          <div className="animate-in fade-in duration-300">
            {/* status card */}
            <div className="flex gap-3 rounded-2xl bg-orange-500/10 p-4">
              <VIcon mounted={isMounted} icon={hourglassOutline} className="text-2xl text-orange-500 flex-shrink-0" />
              <div>
                <p className="text-sm font-black text-orange-600 dark:text-orange-400">Verification pending</p>
                <p className="text-xs text-muted-foreground font-medium leading-relaxed mt-1">
                  Your documents have been received. Our Trust &amp; Safety team is reviewing them — this usually takes 24–48 hours. We&apos;ll notify you once a decision is made.
                </p>
                <p className="text-xs font-bold text-foreground mt-2 flex items-center gap-1.5">
                  <VIcon mounted={isMounted} icon={timeOutline} className="text-sm text-orange-500" />
                  {avgWaitHours
                    ? `Average review time: ~${avgWaitHours} hour${avgWaitHours === 1 ? '' : 's'}`
                    : 'Average review time: under 48 hours'}
                </p>
              </div>
            </div>

            {/* badge preview payoff — what buyers will see once approved */}
            <div className="mt-4 rounded-2xl p-4">
              <p className="text-[11px] font-black uppercase tracking-[0.2em] text-muted-foreground mb-3">
                What buyers will see
              </p>
              <div className="flex items-center gap-3">
                <Avatar src={profile?.avatar_url} name={profile?.full_name || 'User'} size="md" />
                <div className="flex flex-col">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-black text-foreground leading-tight">
                      {profile?.full_name || 'Your Name'}
                    </p>
                    <Badge isVerified={true} size={18} />
                  </div>
                  <p className="text-xs text-muted-foreground font-medium mt-0.5">
                    Verified seller · unlocked on approval
                  </p>
                </div>
              </div>
            </div>

            {/* timeline */}
            <ol className="mt-8 px-2">
              {[
                { title: 'Documents submitted', note: 'We received your ID and selfie.', state: 'done' as const },
                { title: 'Under review', note: 'Our team is verifying your identity.', state: 'current' as const },
                { title: 'Decision', note: 'You get the verified badge on approval.', state: 'next' as const },
              ].map((s, i, arr) => {
                const isLast = i === arr.length - 1;
                return (
                  <li key={s.title} className="flex gap-4">
                    <div className="flex flex-col items-center">
                      {s.state === 'done' ? (
                        <VIcon mounted={isMounted} icon={checkmarkCircle} className="text-2xl text-green-500" />
                      ) : s.state === 'current' ? (
                        <span className="w-6 h-6 rounded-full border-2 border-orange-500 flex items-center justify-center">
                          <span className="w-2.5 h-2.5 rounded-full bg-orange-500 animate-pulse" />
                        </span>
                      ) : (
                        <span className="w-6 h-6 rounded-full border-2 border-border" />
                      )}
                      {!isLast && (
                        <span className={`w-0.5 flex-1 min-h-[28px] my-1 ${s.state === 'done' ? 'bg-green-500' : 'bg-border'}`} />
                      )}
                    </div>
                    <div className={isLast ? '' : 'pb-5'}>
                      <p className={`text-sm font-bold ${s.state === 'next' ? 'text-muted-foreground' : 'text-foreground'}`}>{s.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{s.note}</p>
                    </div>
                  </li>
                );
              })}
            </ol>

            {latestVerification && (
              <p className="mt-8 px-2 text-[11px] font-medium text-muted-foreground break-all">
                Ref: {latestVerification.id?.slice(0, 8).toUpperCase()}
              </p>
            )}
          </div>
        )}

        {/* ============ REJECTED (result page with reason code) ============ */}
        {showRejected && (
          <div className="animate-in fade-in duration-300">
            {/* status card */}
            <div className="flex gap-3 rounded-2xl bg-red-500/10 p-4">
              <VIcon mounted={isMounted} icon={closeCircleOutline} className="text-2xl text-red-500 flex-shrink-0" />
              <div>
                <p className="text-sm font-black text-red-600 dark:text-red-400">Verification not approved</p>
                <p className="text-xs text-muted-foreground font-medium leading-relaxed mt-1">
                  Reason: <span className="font-bold text-foreground">{REJECTION_REASONS[rejectionCode].title}</span>
                </p>
              </div>
            </div>

            {/* what to fix */}
            <div className="mt-6 rounded-2xl p-4">
              <p className="text-[11px] font-black uppercase tracking-[0.2em] text-muted-foreground mb-2">What to fix</p>
              <p className="text-sm font-medium text-foreground leading-relaxed">{REJECTION_REASONS[rejectionCode].fix}</p>
              {rejectionDetail && (
                <p className="text-xs text-muted-foreground mt-3 pt-3 border-t border-border leading-relaxed">
                  Reviewer note: {rejectionDetail}
                </p>
              )}
            </div>

            {/* timeline */}
            <ol className="mt-8 px-2">
              {[
                { title: 'Documents submitted', note: 'We received your ID and selfie.', state: 'done' as const },
                { title: 'Under review', note: 'Our team checked your identity.', state: 'done' as const },
                { title: 'Not approved', note: REJECTION_REASONS[rejectionCode].title + '.', state: 'current' as const },
              ].map((s, i, arr) => {
                const isLast = i === arr.length - 1;
                const isCurrent = s.state === 'current';
                return (
                  <li key={s.title} className="flex gap-4">
                    <div className="flex flex-col items-center">
                      {s.state === 'done' ? (
                        <VIcon mounted={isMounted} icon={checkmarkCircle} className="text-2xl text-green-500" />
                      ) : (
                        <span className="w-6 h-6 rounded-full border-2 border-red-500 flex items-center justify-center">
                          <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                        </span>
                      )}
                      {!isLast && (
                        <span className={`w-0.5 flex-1 min-h-[28px] my-1 ${s.state === 'done' ? 'bg-green-500' : 'bg-border'}`} />
                      )}
                    </div>
                    <div className={isLast ? '' : 'pb-5'}>
                      <p className={`text-sm font-bold ${isCurrent ? 'text-red-600 dark:text-red-400' : 'text-foreground'}`}>{s.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{s.note}</p>
                    </div>
                  </li>
                );
              })}
            </ol>

            {latestVerification && (
              <p className="mt-8 px-2 text-[11px] font-medium text-muted-foreground break-all">
                Ref: {latestVerification.id?.slice(0, 8).toUpperCase()}
              </p>
            )}

            <Button
              onClick={() => { setDocUrl(''); setSelfieUrl(''); setRetrying(true); goToStep(2); }}
              className="w-full !rounded-full !py-4 !bg-orange-500 hover:!bg-orange-600 text-white font-black text-base mt-8 active:scale-[0.98] transition-all shadow-[0_8px_30px_rgba(249,115,22,0.3)]"
            >
              Fix &amp; Try Again
            </Button>
          </div>
        )}

        {/* ============ WIZARD ============ */}
        {inWizard && (
          <>
            {/* Step indicators */}
            <div className="flex items-center justify-center gap-2 mb-8">
              {[1, 2, 3, 4].map(s => (
                <div key={s} className={`h-1.5 rounded-full transition-all duration-500 ${s === step ? 'w-8 bg-orange-500' : s < step ? 'w-4 bg-orange-500/50' : 'w-4 bg-muted'}`} />
              ))}
            </div>

            {/* Direction-aware slide container */}
            <div
              key={step}
              className={`animate-in fade-in duration-300 ${direction === 1 ? 'slide-in-from-right-8' : 'slide-in-from-left-8'}`}
            >

              {/* STEP 1: Why get verified */}
              {step === 1 && (
                <div className="flex flex-col">
                  <div className="flex items-center gap-4 mb-10 p-4">
                    <Avatar src={profile?.avatar_url} name={profile?.full_name || 'User'} size="lg" />
                    <div className="flex flex-col">
                      <div className="flex items-center gap-1.5">
                        <h2 className="text-lg font-black text-foreground leading-tight">{profile?.full_name || 'Campus Student'}</h2>
                        <Badge isVerified={true} className="text-xl" />
                      </div>
                      <p className="text-[12px] font-bold text-orange-500 mt-0.5">Your future profile</p>
                    </div>
                  </div>

                  <h2 className="text-2xl font-black text-foreground mb-6">Why get verified?</h2>
                  <ul className="space-y-5 text-[15px] font-medium mb-10">
                    {[
                      'Get the blue verified badge on your public profile.',
                      'Buyers trust verified sellers up to 3x more.',
                      'Unlock higher selling limits and faster payouts.',
                      'Help keep the campus community safe from scams.',
                    ].map((text) => (
                      <li key={text} className="flex items-start gap-4">
                        <div className="w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center flex-shrink-0">
                          <VIcon mounted={isMounted} icon={checkmarkCircleOutline} className="text-green-500 text-xl" />
                        </div>
                        <span className="mt-1 text-foreground">{text}</span>
                      </li>
                    ))}
                  </ul>
                  <Button onClick={() => goToStep(2)} className="w-full !rounded-full !py-4 shadow-[0_8px_30px_rgba(249,115,22,0.3)] !bg-orange-500 hover:!bg-orange-600 text-white font-black text-lg flex items-center justify-center gap-2 active:scale-[0.98] transition-all">
                    Start Verification <VIcon mounted={isMounted} icon={arrowForwardOutline} className="text-xl" />
                  </Button>
                </div>
              )}

              {/* STEP 2: Document upload */}
              {step === 2 && (
                <div className="flex flex-col">
                  <h2 className="text-2xl font-black text-foreground mb-2">Upload Campus ID</h2>
                  <p className="text-muted-foreground text-[15px] mb-6 font-medium">A clear photo of your valid Student ID Card or stamped Admission Letter.</p>

                  <div className="flex gap-3 mb-6">
                    {(['id_card', 'admission_letter'] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => { setDocType(t); }}
                        className={`flex-1 p-4 rounded-3xl transition-all flex flex-col items-center gap-2 ${docType === t ? 'bg-orange-500/10 text-orange-500' : 'bg-card text-muted-foreground'}`}
                      >
                        <VIcon mounted={isMounted} icon={documentTextOutline} className="text-3xl" />
                        <span className="text-[13px] font-black tracking-wide uppercase text-center leading-tight">
                          {t === 'id_card' ? 'ID Card' : <>Admission<br />Letter</>}
                        </span>
                      </button>
                    ))}
                  </div>

                  {/* Upload area — no border, gallery-backed */}
                  <div className="w-full rounded-[2rem] overflow-hidden mb-8">
                    {uploading?.target === 'doc' ? (
                      <div className="relative h-56">
                        <img src={uploading.preview} alt="Uploading" className="absolute inset-0 w-full h-full object-cover opacity-40" />
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/30 p-6">
                          <PullSpinner spinning size={30} />
                          <UploadStatusText progress={uploading.progress} />
                          <div className="w-40 h-1.5 rounded-full bg-white/20 overflow-hidden">
                            <div className="h-full bg-orange-500 transition-all duration-150" style={{ width: `${uploading.progress}%` }} />
                          </div>
                          <p className="text-xs font-bold text-white/80">{uploading.progress}%</p>
                        </div>
                      </div>
                    ) : docUrl ? (
                      <div className="relative h-56 group">
                        <img src={docUrl} alt="Document" className="absolute inset-0 w-full h-full object-cover" />
                        <button
                          onClick={() => removeImage('doc')}
                          aria-label="Remove document"
                          className="absolute top-3 right-3 !p-2 !rounded-full bg-black/50 text-white active:scale-90 transition-transform"
                        >
                          <VIcon mounted={isMounted} icon={closeOutline} className="text-xl block" />
                        </button>
                        <button
                          onClick={() => setShowGallery('doc')}
                          className="absolute bottom-3 right-3 px-4 py-2 rounded-full bg-black/50 text-white text-xs font-bold active:scale-95 transition-transform"
                        >
                          Retake
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setShowGallery('doc')}
                        className="w-full h-56 flex flex-col items-center justify-center gap-3 active:opacity-70 transition-opacity"
                      >
                        <div className="w-14 h-14 rounded-full bg-orange-500/10 flex items-center justify-center">
                          <VIcon mounted={isMounted} icon={cloudUploadOutline} className="text-3xl text-orange-500" />
                        </div>
                        <span className="font-bold text-foreground">Tap to choose {docType === 'id_card' ? 'ID Card' : 'Admission Letter'}</span>
                        <span className="text-xs text-muted-foreground font-medium">From your gallery</span>
                      </button>
                    )}
                  </div>

                  <div className="flex gap-4">
                    <Button onClick={() => goToStep(1)} className="!rounded-full !py-4 !bg-muted !text-foreground font-bold flex-1 active:scale-[0.98]">Back</Button>
                    <Button onClick={() => goToStep(3)} disabled={!docUrl || !!uploading} className="!rounded-full !py-4 !bg-orange-500 text-white font-black flex-[2] disabled:opacity-50 active:scale-[0.98] shadow-lg">Next Step</Button>
                  </div>
                </div>
              )}

              {/* STEP 3: Selfie */}
              {step === 3 && (
                <div className="flex flex-col">
                  <h2 className="text-2xl font-black text-foreground mb-2">Take a Selfie</h2>
                  <p className="text-muted-foreground text-[15px] mb-6 font-medium">Hold your phone up and make sure your face is clearly visible, just like below.</p>

                  <div className="w-full rounded-[2rem] overflow-hidden mb-8">
                    {uploading?.target === 'selfie' ? (
                      <div className="relative h-72">
                        <img src={uploading.preview} alt="Uploading" className="absolute inset-0 w-full h-full object-cover opacity-40" />
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/30 p-6">
                          <PullSpinner spinning size={30} />
                          <UploadStatusText progress={uploading.progress} />
                          <div className="w-40 h-1.5 rounded-full bg-white/20 overflow-hidden">
                            <div className="h-full bg-orange-500 transition-all duration-150" style={{ width: `${uploading.progress}%` }} />
                          </div>
                          <p className="text-xs font-bold text-white/80">{uploading.progress}%</p>
                        </div>
                      </div>
                    ) : selfieUrl ? (
                      <div className="relative h-72">
                        <img src={selfieUrl} alt="Selfie" className="absolute inset-0 w-full h-full object-cover" />
                        <button
                          onClick={() => removeImage('selfie')}
                          aria-label="Remove selfie"
                          className="absolute top-3 right-3 !p-2 !rounded-full bg-black/50 text-white active:scale-90 transition-transform"
                        >
                          <VIcon mounted={isMounted} icon={closeOutline} className="text-xl block" />
                        </button>
                        <button
                          onClick={openSelfieCamera}
                          className="absolute bottom-3 right-3 px-4 py-2 rounded-full bg-black/50 text-white text-xs font-bold active:scale-95 transition-transform"
                        >
                          Retake
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={openSelfieCamera}
                        className="w-full py-8 px-6 flex flex-col items-center gap-4 active:opacity-70 transition-opacity"
                      >
                        <SelfieAnimation />
                        <span className="font-bold text-foreground">Tap to take a live selfie</span>
                        <span className="text-xs text-muted-foreground font-medium -mt-2">Center your face in the frame</span>
                      </button>
                    )}
                  </div>

                  <div className="flex gap-4">
                    <Button onClick={() => goToStep(2)} className="!rounded-full !py-4 !bg-muted !text-foreground font-bold flex-1 active:scale-[0.98]">Back</Button>
                    <Button onClick={() => goToStep(4)} disabled={!selfieUrl || !!uploading} className="!rounded-full !py-4 !bg-orange-500 text-white font-black flex-[2] disabled:opacity-50 active:scale-[0.98] shadow-lg">Review</Button>
                  </div>
                </div>
              )}

              {/* STEP 4: Review */}
              {step === 4 && (
                <div className="flex flex-col">
                  <h2 className="text-2xl font-black text-foreground mb-2">Review &amp; Submit</h2>
                  <p className="text-muted-foreground text-[15px] mb-8 font-medium">Tap an image to view it fullscreen. Make sure both are clear and readable.</p>

                  <div className="grid grid-cols-2 gap-5 mb-10">
                    {([
                      { label: 'Document', url: docUrl, key: 'doc' as const },
                      { label: 'Selfie', url: selfieUrl, key: 'selfie' as const },
                    ]).map((item) => (
                      <div key={item.key} className="flex flex-col gap-3">
                        <span className="text-[12px] font-black text-muted-foreground uppercase tracking-widest text-center">{item.label}</span>
                        <button
                          onClick={() => { setViewerIndex(item.key === 'doc' ? 0 : 1); setViewerImages([docUrl, selfieUrl]); }}
                          className="relative w-full h-48 rounded-[1.5rem] overflow-hidden active:scale-95 transition-transform bg-card"
                        >
                          {!reviewLoaded[item.key] && <Skeleton className="absolute inset-0 w-full h-full rounded-none" />}
                          <img
                            src={item.url}
                            alt={item.label}
                            onLoad={() => setReviewLoaded(prev => ({ ...prev, [item.key]: true }))}
                            className={`w-full h-full object-cover transition-opacity duration-300 ${reviewLoaded[item.key] ? 'opacity-100' : 'opacity-0'}`}
                          />
                          <span className="absolute inset-0 flex items-center justify-center bg-black/0 active:bg-black/20 transition-colors">
                            <VIcon mounted={isMounted} icon={cameraOutline} className="text-white text-3xl opacity-0 active:opacity-100 drop-shadow-lg" />
                          </span>
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-4">
                    <Button onClick={() => goToStep(3)} disabled={isSubmitting} className="!rounded-full !py-4 !bg-muted !text-foreground font-bold flex-1 active:scale-[0.98]">Back</Button>
                    <Button onClick={handleSubmit} disabled={isSubmitting} className="!rounded-full !py-4 !bg-orange-500 text-white font-black flex-[2] disabled:opacity-50 active:scale-[0.98] shadow-[0_8px_30px_rgba(249,115,22,0.3)]">
                      {isSubmitting ? 'Submitting…' : 'Submit Verification'}
                    </Button>
                  </div>
                </div>
              )}

            </div>
          </>
        )}
      </div>
    </div>
  );
}
