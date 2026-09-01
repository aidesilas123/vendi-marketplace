"use client";

import React, { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Button } from '@/shared/Button';
import { Modal } from '@/shared/Modal/Modal';
import { Badge } from '@/shared/Badge';
import { Avatar } from '@/shared/Avatar';
import { IonIcon } from '@ionic/react';
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
  closeOutline
} from 'ionicons/icons';

const CLOUDINARY_CLOUD_NAME = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_UPLOAD_PRESET = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;

type VerificationStatus = 'none' | 'pending' | 'approved' | 'rejected';

export default function VerificationPage() {
  const router = useRouter();
  const docInputRef = useRef<HTMLInputElement>(null);
  const selfieInputRef = useRef<HTMLInputElement>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [status, setStatus] = useState<VerificationStatus>('none');
  const [rejectionReason, setRejectionReason] = useState('');

  // Wizard State
  const [step, setStep] = useState(1);
  const [docType, setDocType] = useState<'id_card' | 'admission_letter'>('id_card');
  const [docUrl, setDocUrl] = useState('');
  const [selfieUrl, setSelfieUrl] = useState('');
  
  // Local Previews
  const [localDocPreview, setLocalDocPreview] = useState('');
  const [localSelfiePreview, setLocalSelfiePreview] = useState('');
  
  // Lightbox State
  const [lightboxImg, setLightboxImg] = useState<string | null>(null);

  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [modalConfig, setModalConfig] = useState({ isOpen: false, title: '', message: '', type: 'info', onConfirm: () => {} });

  useEffect(() => {
    const fetchVerificationState = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return router.push('/login');

      // Fetch User Profile
      const { data: profile } = await supabase.from('users').select('id, full_name, avatar_url, is_verified').eq('id', user.id).single();
      setCurrentUser(profile);

      if (profile?.is_verified) {
        setStatus('approved');
        setIsLoading(false);
        return;
      }

      // Fetch Latest Verification Request
      const { data: verifications } = await supabase
        .from('verifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1);

      if (verifications && verifications.length > 0) {
        const latest = verifications[0];
        setStatus(latest.status);
        if (latest.status === 'rejected') {
          setRejectionReason(latest.admin_notes || 'Your document did not meet our guidelines. Please try again.');
        }
      }
      setIsLoading(false);
    };

    fetchVerificationState();
  }, [router]);

  const uploadToCloudinary = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_UPLOAD_PRESET) {
        reject(new Error('Cloudinary configuration is missing.'));
        return;
      }
      const xhr = new XMLHttpRequest();
      const form = new FormData();
      form.append('file', file);
      form.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
      form.append('folder', 'verifications');

      xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) setUploadProgress(Math.round((event.loaded / event.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText).secure_url);
        } else {
          reject(new Error('Upload failed.'));
        }
      };
      xhr.onerror = () => reject(new Error('Network error.'));
      xhr.send(form);
    });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'doc' | 'selfie') => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Instantly show local preview
    const localUrl = URL.createObjectURL(file);
    if (type === 'doc') setLocalDocPreview(localUrl);
    if (type === 'selfie') setLocalSelfiePreview(localUrl);

    setUploadProgress(0);
    try {
      const url = await uploadToCloudinary(file);
      if (type === 'doc') setDocUrl(url);
      if (type === 'selfie') setSelfieUrl(url);
    } catch (error: any) {
      if (type === 'doc') setLocalDocPreview('');
      if (type === 'selfie') setLocalSelfiePreview('');
      
      setModalConfig({
        isOpen: true,
        title: 'Upload Failed',
        message: error.message,
        type: 'error',
        onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false }))
      });
    } finally {
      setUploadProgress(null);
      if (type === 'doc' && docInputRef.current) docInputRef.current.value = '';
      if (type === 'selfie' && selfieInputRef.current) selfieInputRef.current.value = '';
    }
  };

  const handleSubmit = async () => {
    if (!currentUser || !docUrl || !selfieUrl) return;
    setIsSubmitting(true);

    try {
      const { error } = await supabase.from('verifications').insert({
        user_id: currentUser.id,
        document_type: docType,
        document_url: docUrl,
        selfie_url: selfieUrl,
        status: 'pending'
      });

      if (error) throw error;

      setStatus('pending');
      setStep(1); 
    } catch (err: any) {
      console.error(err);
      setModalConfig({
        isOpen: true,
        title: 'Submission Error',
        message: err.message || 'Could not submit your verification. Please try again.',
        type: 'error',
        onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false }))
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="w-full min-h-screen bg-background flex flex-col pt-safe">
        <div className="h-[60px] w-full bg-card border-b border-border flex items-center px-4">
           <div className="w-8 h-8 rounded-full bg-muted animate-pulse" />
           <div className="w-32 h-5 rounded-md bg-muted animate-pulse ml-4" />
        </div>
        <div className="max-w-xl mx-auto w-full px-4 py-8 space-y-6">
           <div className="w-24 h-6 rounded bg-muted animate-pulse" />
           <div className="w-full h-48 rounded-3xl bg-muted animate-pulse" />
           <div className="w-full h-14 rounded-full bg-muted animate-pulse mt-8" />
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-h-screen bg-background text-foreground pt-safe pb-safe selection:bg-orange-500/30">
      
      {/* Lightbox Overlay */}
      {lightboxImg && (
        <div className="fixed inset-0 z-[1000] bg-background/95 backdrop-blur-xl flex flex-col animate-in fade-in zoom-in-95 duration-200">
          <div className="absolute top-0 left-0 right-0 p-4 pt-safe flex justify-end z-10">
            <button onClick={() => setLightboxImg(null)} className="!p-2 text-foreground/80 hover:text-foreground active:scale-95 transition-transform !rounded-full">
              <IonIcon icon={closeOutline} className="text-4xl drop-shadow-md" />
            </button>
          </div>
          <div className="flex-1 w-full h-full flex items-center justify-center p-4">
            <img src={lightboxImg} className="w-full h-auto max-h-full object-contain !rounded-2xl shadow-2xl" alt="Fullscreen Preview" />
          </div>
        </div>
      )}

      {/* Upload Progress Overlay */}
      {uploadProgress !== null && (
        <div className="fixed inset-0 z-[110] bg-black/60 backdrop-blur-md flex flex-col items-center justify-center gap-4 animate-in fade-in duration-200">
          <div className="w-16 h-16 rounded-full border-4 border-muted border-t-orange-500 animate-spin" />
          <p className="font-black text-white tracking-wide">Uploading Securely…</p>
          <div className="w-48 h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-orange-500 transition-all duration-150" style={{ width: `${uploadProgress}%` }} />
          </div>
          <p className="text-xs font-bold text-gray-300">{uploadProgress}%</p>
        </div>
      )}

      {/* Global Error/Success Modal */}
      <Modal isOpen={modalConfig.isOpen} onClose={modalConfig.onConfirm}>
        <div className="p-6 text-center relative z-[999]">
          <IonIcon icon={modalConfig.type === 'error' ? closeCircleOutline : checkmarkCircleOutline} className={`text-6xl mb-4 ${modalConfig.type === 'error' ? 'text-red-500' : 'text-green-500'}`} />
          <h2 className="text-xl font-black mb-2 text-foreground tracking-tight">{modalConfig.title}</h2>
          <p className="text-muted-foreground mb-8 font-medium leading-relaxed">{modalConfig.message}</p>
          <Button onClick={modalConfig.onConfirm} className="w-full !rounded-full !py-3.5 !bg-muted !text-foreground font-bold hover:!bg-muted/80 transition-colors">
            Close
          </Button>
        </div>
      </Modal>

      {/* Edge-to-Edge Header seamlessly matched to the global theme */}
      <div className="flex-shrink-0 w-full bg-background/95 backdrop-blur-sm border-b border-border shadow-sm sticky top-0 z-50">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <button onClick={() => router.back()} className="!p-2 -ml-2 text-foreground active:bg-muted transition-colors !rounded-full">
              <IonIcon icon={chevronBackOutline} className="text-3xl" />
            </button>
            <div className="flex flex-col">
              <div className="flex items-center gap-1.5">
                <h1 className="text-lg font-bold leading-tight truncate max-w-[200px]">{currentUser?.full_name || "Profile"}</h1>
                {currentUser?.is_verified && <Badge isVerified={true} className="text-xl" />}
              </div>
              <p className="text-[11px] text-muted-foreground font-medium tracking-wide uppercase">Get Verified</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-xl mx-auto px-4 py-8 space-y-6">

        {/* STATUS SCREENS */}
        {status === 'approved' && (
          <div className="flex flex-col items-center justify-center pt-10 text-center animate-in fade-in zoom-in duration-300">
            <div className="w-24 h-24 bg-green-500/10 rounded-full flex items-center justify-center mb-6">
              <IonIcon icon={shieldCheckmarkOutline} className="text-5xl text-green-500" />
            </div>
            <h2 className="text-2xl font-black text-foreground mb-2">You are Verified!</h2>
            <p className="text-muted-foreground px-4 leading-relaxed">
              Your identity has been confirmed. You now have the verified badge, building maximum trust with buyers on Vendi.
            </p>
          </div>
        )}

        {status === 'pending' && (
          <div className="flex flex-col items-center justify-center pt-10 text-center animate-in fade-in zoom-in duration-300">
            <div className="w-24 h-24 bg-orange-500/10 rounded-full flex items-center justify-center mb-6">
              <IonIcon icon={timeOutline} className="text-5xl text-orange-500" />
            </div>
            <h2 className="text-2xl font-black text-foreground mb-2">Verification Pending</h2>
            <p className="text-muted-foreground px-4 leading-relaxed">
              Our Trust & Safety team is currently reviewing your documents. This usually takes 24-48 hours. We'll notify you once approved.
            </p>
          </div>
        )}

        {/* WIZARD FLOW */}
        {(status === 'none' || status === 'rejected') && (
          <>
            {status === 'rejected' && step === 1 && (
              <div className="bg-red-500/10 border border-red-500/20 p-4 !rounded-[1.5rem] flex gap-3 items-start mb-6">
                <IonIcon icon={closeCircleOutline} className="text-red-500 text-2xl flex-shrink-0 mt-0.5" />
                <div className="flex flex-col">
                  <p className="text-[13px] font-black text-red-500 uppercase tracking-widest mb-1">Previous Request Rejected</p>
                  <p className="text-sm font-medium text-foreground leading-relaxed">{rejectionReason}</p>
                </div>
              </div>
            )}

            {/* Step Indicators */}
            <div className="flex items-center justify-center gap-2 mb-8">
              {[1, 2, 3, 4].map(s => (
                <div key={s} className={`h-1.5 rounded-full transition-all duration-500 ${s === step ? 'w-8 bg-orange-500' : s < step ? 'w-4 bg-orange-500/50' : 'w-4 bg-muted'}`} />
              ))}
            </div>

            {/* SMOOTH SLIDE CONTAINER */}
            <div key={step} className="animate-in slide-in-from-right-8 fade-in duration-300">
              
              {/* STEP 1: Introduction */}
              {step === 1 && (
                <div className="flex flex-col">
                  {/* Temporary Preview */}
                  <div className="flex items-center gap-4 mb-10 bg-card p-4 !rounded-3xl border border-border shadow-sm backdrop-blur-sm">
                    <Avatar src={currentUser?.avatar_url} name={currentUser?.full_name || "User"} size="lg" />
                    <div className="flex flex-col">
                      <div className="flex items-center gap-1.5">
                        <h2 className="text-lg font-black text-foreground leading-tight">{currentUser?.full_name || "Campus Student"}</h2>
                        <Badge isVerified={true} className="text-xl" />
                      </div>
                      <p className="text-[12px] font-bold text-orange-500 mt-0.5">Your future profile</p>
                    </div>
                  </div>

                  <h2 className="text-2xl font-black text-foreground mb-6">Why get verified?</h2>
                  <ul className="space-y-6 text-[15px] text-muted-foreground font-medium mb-12">
                    <li className="flex items-start gap-4">
                      <div className="w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center flex-shrink-0">
                        <IonIcon icon={checkmarkCircleOutline} className="text-green-500 text-xl" />
                      </div>
                      <span className="mt-1 text-foreground">Get the blue verified badge on your public profile.</span>
                    </li>
                    <li className="flex items-start gap-4">
                      <div className="w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center flex-shrink-0">
                        <IonIcon icon={checkmarkCircleOutline} className="text-green-500 text-xl" />
                      </div>
                      <span className="mt-1 text-foreground">Buyers trust verified sellers up to 3x more.</span>
                    </li>
                    <li className="flex items-start gap-4">
                      <div className="w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center flex-shrink-0">
                        <IonIcon icon={checkmarkCircleOutline} className="text-green-500 text-xl" />
                      </div>
                      <span className="mt-1 text-foreground">Help keep the campus community safe from scams.</span>
                    </li>
                  </ul>
                  <Button onClick={() => setStep(2)} className="w-full !rounded-full !py-4 shadow-[0_8px_30px_rgba(249,115,22,0.3)] !bg-orange-500 hover:!bg-orange-600 text-white font-black text-lg flex items-center justify-center gap-2 active:scale-[0.98] transition-all">
                    Start Verification <IonIcon icon={arrowForwardOutline} className="text-xl" />
                  </Button>
                </div>
              )}

              {/* STEP 2: Document Upload */}
              {step === 2 && (
                <div className="flex flex-col">
                  <h2 className="text-2xl font-black text-foreground mb-2">Upload Campus ID</h2>
                  <p className="text-muted-foreground text-[15px] mb-8 font-medium">Please provide a clear picture of your valid Campus Student ID Card or stamped Admission Letter.</p>
                  
                  <div className="flex gap-4 mb-6">
                    <button 
                      onClick={() => setDocType('id_card')}
                      className={`flex-1 p-5 rounded-3xl border-2 transition-all flex flex-col items-center gap-2 shadow-sm ${docType === 'id_card' ? 'border-orange-500 bg-orange-500/10 text-orange-500' : 'border-border bg-card text-muted-foreground'}`}
                    >
                      <IonIcon icon={documentTextOutline} className="text-3xl" />
                      <span className="text-[14px] font-black tracking-wide uppercase">ID Card</span>
                    </button>
                    <button 
                      onClick={() => setDocType('admission_letter')}
                      className={`flex-1 p-5 rounded-3xl border-2 transition-all flex flex-col items-center gap-2 shadow-sm ${docType === 'admission_letter' ? 'border-orange-500 bg-orange-500/10 text-orange-500' : 'border-border bg-card text-muted-foreground'}`}
                    >
                      <IonIcon icon={documentTextOutline} className="text-3xl" />
                      <span className="text-[14px] font-black tracking-wide uppercase text-center leading-tight">Admission<br/>Letter</span>
                    </button>
                  </div>

                  <div 
                    onClick={() => docInputRef.current?.click()}
                    className="w-full h-56 border-2 border-dashed border-border rounded-[2rem] flex flex-col items-center justify-center gap-3 bg-card cursor-pointer hover:border-orange-500 transition-colors mb-10 relative overflow-hidden"
                  >
                    {localDocPreview || docUrl ? (
                      <img src={localDocPreview || docUrl} className="absolute inset-0 w-full h-full object-cover" alt="Document Preview" />
                    ) : (
                      <>
                        <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center">
                          <IonIcon icon={cloudUploadOutline} className="text-3xl text-muted-foreground" />
                        </div>
                        <span className="font-bold text-muted-foreground">Tap to upload {docType === 'id_card' ? 'ID Card' : 'Letter'}</span>
                      </>
                    )}
                    <input type="file" ref={docInputRef} onChange={(e) => handleFileUpload(e, 'doc')} accept="image/*" className="hidden" />
                  </div>

                  <div className="flex gap-4">
                    <Button onClick={() => setStep(1)} className="!rounded-full !py-4 !bg-muted !text-foreground font-bold flex-1 active:scale-[0.98]">Back</Button>
                    <Button onClick={() => setStep(3)} disabled={!docUrl} className="!rounded-full !py-4 !bg-orange-500 text-white font-black flex-[2] disabled:opacity-50 active:scale-[0.98] shadow-lg">Next Step</Button>
                  </div>
                </div>
              )}

              {/* STEP 3: Selfie Capture */}
              {step === 3 && (
                <div className="flex flex-col">
                  <h2 className="text-2xl font-black text-foreground mb-2">Take a Selfie</h2>
                  <p className="text-muted-foreground text-[15px] mb-8 font-medium">We need to make sure the person holding the phone matches the document provided.</p>
                  
                  <div 
                    onClick={() => selfieInputRef.current?.click()}
                    className="w-full h-72 border-2 border-dashed border-border rounded-[2rem] flex flex-col items-center justify-center gap-3 bg-card cursor-pointer hover:border-orange-500 transition-colors mb-10 relative overflow-hidden"
                  >
                    {localSelfiePreview || selfieUrl ? (
                      <img src={localSelfiePreview || selfieUrl} className="absolute inset-0 w-full h-full object-cover" alt="Selfie Preview" />
                    ) : (
                      <>
                        <div className="w-16 h-16 rounded-full bg-orange-500/10 flex items-center justify-center shadow-sm">
                          <IonIcon icon={cameraOutline} className="text-4xl text-orange-500" />
                        </div>
                        <span className="font-bold text-muted-foreground mt-2">Tap to take live selfie</span>
                      </>
                    )}
                    <input type="file" ref={selfieInputRef} onChange={(e) => handleFileUpload(e, 'selfie')} accept="image/*" capture="user" className="hidden" />
                  </div>

                  <div className="flex gap-4">
                    <Button onClick={() => setStep(2)} className="!rounded-full !py-4 !bg-muted !text-foreground font-bold flex-1 active:scale-[0.98]">Back</Button>
                    <Button onClick={() => setStep(4)} disabled={!selfieUrl} className="!rounded-full !py-4 !bg-orange-500 text-white font-black flex-[2] disabled:opacity-50 active:scale-[0.98] shadow-lg">Review</Button>
                  </div>
                </div>
              )}

              {/* STEP 4: Review and Submit */}
              {step === 4 && (
                <div className="flex flex-col">
                  <h2 className="text-2xl font-black text-foreground mb-2">Review & Submit</h2>
                  <p className="text-muted-foreground text-[15px] mb-8 font-medium">Please tap on your images to ensure they are clear and readable before submitting.</p>
                  
                  <div className="grid grid-cols-2 gap-5 mb-10">
                    <div className="flex flex-col gap-3">
                      <span className="text-[12px] font-black text-muted-foreground uppercase tracking-widest text-center">Document</span>
                      <div 
                        onClick={() => setLightboxImg(docUrl)}
                        className="w-full h-48 rounded-[1.5rem] overflow-hidden border border-border shadow-sm cursor-pointer active:scale-95 transition-transform relative group"
                      >
                        <img src={docUrl} className="w-full h-full object-cover" alt="Document Preview" />
                        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <IonIcon icon={cameraOutline} className="text-white text-3xl" />
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col gap-3">
                      <span className="text-[12px] font-black text-muted-foreground uppercase tracking-widest text-center">Selfie</span>
                      <div 
                        onClick={() => setLightboxImg(selfieUrl)}
                        className="w-full h-48 rounded-[1.5rem] overflow-hidden border border-border shadow-sm cursor-pointer active:scale-95 transition-transform relative group"
                      >
                        <img src={selfieUrl} className="w-full h-full object-cover" alt="Selfie Preview" />
                        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <IonIcon icon={cameraOutline} className="text-white text-3xl" />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <Button onClick={() => setStep(3)} disabled={isSubmitting} className="!rounded-full !py-4 !bg-muted !text-foreground font-bold flex-1 active:scale-[0.98]">Back</Button>
                    <Button onClick={handleSubmit} disabled={isSubmitting} className="!rounded-full !py-4 !bg-orange-500 text-white font-black flex-[2] disabled:opacity-50 active:scale-[0.98] shadow-[0_8px_30px_rgba(249,115,22,0.3)]">
                      {isSubmitting ? 'Submitting...' : 'Submit Verification'}
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