"use client";

import React, { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IonIcon } from '@ionic/react';
import {
  chevronBackOutline,
  checkmarkCircle,
  hourglassOutline,
  lockClosedOutline
} from 'ionicons/icons';
import { Button } from '@/shared/Button';
import { Modal } from '@/shared/Modal/Modal';
import { useRubberBand } from '@/shared/hooks/useRubberBand';
import { ImageViewer } from '@/shared/ImageViewer/ImageViewer';
import { showGlobalToast } from '@/shared/Toast/Toast';
import { supabase } from '@/lib/supabase';

interface DisputeStatusProps {
  transaction: any;
  product: { title?: string } | null;
  dispute?: {
    reason?: string | null;
    description?: string | null;
    images?: string | null;
    status?: string | null;
    admin_notes?: string | null;
    created_at?: string;
    buyer_id?: string | null;
  } | null;
  canCancel?: boolean;
  onBack: () => void;
}

type StepState = 'done' | 'current' | 'next';

// Timeline states derived from the dispute status:
// open → raised done, review current, decision next
// under_review → raised + review done, decision current
// resolved → all done
function stepsFor(status: string): { title: string; note: string; state: StepState }[] {
  const s = status.toLowerCase();
  return [
    { title: 'Dispute raised', note: 'The report has been received.', state: 'done' },
    {
      title: 'Admin review',
      note: 'Our admins are investigating.',
      state: s === 'open' ? 'current' : 'done',
    },
    {
      title: 'Final decision',
      note: 'An admin decides where the funds go.',
      state: s === 'resolved' ? 'done' : s === 'under_review' ? 'current' : 'next',
    },
  ];
}

export const DisputeStatus: React.FC<DisputeStatusProps> = ({ transaction, product, dispute, canCancel, onBack }) => {
  const bounceRef = useRef<HTMLDivElement>(null);
  useRubberBand(bounceRef, { ready: true });
  const router = useRouter();

  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  // Evidence images are stored as a JSON string array
  const evidenceImages = useMemo<string[]>(() => {
    const raw = dispute?.images;
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch {
      return [];
    }
  }, [dispute?.images]);

  const amount = Math.abs(transaction.amount);

  const disputeState = (dispute?.status || 'open').toLowerCase();
  const STEPS = stepsFor(disputeState);
  const isResolved = disputeState === 'resolved';
  const isReviewing = disputeState === 'under_review';

  const handleCancelDispute = async () => {
    if (cancelling) return;
    setCancelling(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/cancel-dispute`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionRef: transaction.reference }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to cancel dispute');

      showGlobalToast('Dispute cancelled. Escrow resumed.', 'success');
      setConfirmOpen(false);
      router.push('/disputes');
    } catch (error: any) {
      showGlobalToast(error.message || 'Could not cancel dispute', 'error');
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="w-full min-h-screen bg-gray-50 dark:bg-background text-gray-900 dark:text-white pb-10">
      <header className="sticky top-0 left-0 right-0 z-50 w-full bg-gray-50 dark:bg-background">
        <div className="flex w-full items-center px-3 h-12 max-w-2xl mx-auto">
          <button onClick={onBack} aria-label="Back" className="p-1.5 -ml-1.5 text-gray-900 dark:text-white active:scale-95 transition-transform rounded-full">
            <IonIcon icon={chevronBackOutline} className="text-2xl block" />
          </button>
          <h1 className="text-[13px] font-black uppercase tracking-widest leading-tight text-gray-900 dark:text-white ml-2">
            Dispute
          </h1>
        </div>
      </header>

      <div ref={bounceRef} className="w-full h-full">
        <div className="max-w-2xl mx-auto px-4 mt-2">

          {/* Item and escrow amount */}
          <div className="px-2 pt-2">
            {product?.title && (
              <h2 className="text-lg font-black leading-snug tracking-tight text-gray-900 dark:text-white mb-1">
                {product.title}
              </h2>
            )}
            <p className="text-2xl font-black text-orange-500 tracking-tight">₦{amount.toLocaleString()}</p>
            <div className="flex items-center gap-1.5 mt-1.5 text-xs font-bold text-gray-500 dark:text-gray-400">
              <IonIcon icon={lockClosedOutline} className="text-sm" />
              <span>Held in escrow</span>
            </div>
          </div>

          {/* Current status — follows the dispute status */}
          <div className={`flex gap-3 rounded-2xl p-4 mt-6 ${
            isResolved
              ? 'bg-green-500/10 dark:bg-green-500/10'
              : isReviewing
                ? 'bg-blue-500/10 dark:bg-blue-500/10'
                : 'bg-orange-50 dark:bg-orange-900/20'
          }`}>
            <IonIcon
              icon={isResolved ? checkmarkCircle : hourglassOutline}
              className={`text-2xl flex-shrink-0 ${
                isResolved ? 'text-green-500' : isReviewing ? 'text-blue-500' : 'text-orange-500'
              }`}
            />
            <div>
              <p className={`text-sm font-black ${
                isResolved
                  ? 'text-green-600 dark:text-green-400'
                  : isReviewing
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-orange-600 dark:text-orange-400'
              }`}>
                {isResolved ? 'Dispute resolved' : isReviewing ? 'Under review' : 'Pending admin review'}
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-400 font-medium leading-relaxed mt-1">
                {isResolved
                  ? 'An admin has made a final decision on this dispute.'
                  : isReviewing
                    ? 'An admin is actively investigating your dispute. The funds stay frozen until a final decision.'
                    : 'A dispute has been raised on this order. The funds stay frozen in escrow until an admin makes a final decision.'}
              </p>
            </div>
          </div>

          {/* Dispute details — reason, description, evidence from the disputes table */}
          {dispute && (
            <div className="mt-6 px-2">
              <h3 className="text-[13px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-3">
                Dispute details
              </h3>
              <div className="space-y-4">
                {dispute.reason && (
                  <div>
                    <p className="text-xs font-bold text-gray-400 dark:text-gray-500">Reason</p>
                    <p className="text-sm font-bold text-gray-900 dark:text-white mt-0.5">
                      {dispute.reason}
                    </p>
                  </div>
                )}
                {dispute.description && (
                  <div>
                    <p className="text-xs font-bold text-gray-400 dark:text-gray-500">Description</p>
                    <p className="text-sm text-gray-700 dark:text-gray-300 mt-0.5 leading-relaxed">
                      {dispute.description}
                    </p>
                  </div>
                )}
                {evidenceImages.length > 0 && (
                  <div>
                    <p className="text-xs font-bold text-gray-400 dark:text-gray-500 mb-2">
                      Evidence ({evidenceImages.length})
                    </p>
                    <div className="flex gap-2 flex-wrap">
                      {evidenceImages.map((src, i) => (
                        <button
                          key={i}
                          onClick={() => { setViewerIndex(i); setViewerOpen(true); }}
                          className="w-20 h-20 rounded-2xl overflow-hidden bg-gray-100 dark:bg-gray-800 active:opacity-70 transition-opacity"
                          aria-label={`View evidence photo ${i + 1}`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={src} alt="" className="w-full h-full object-cover" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {dispute.admin_notes && (
                  <div className="rounded-2xl bg-gray-100 dark:bg-gray-800/60 p-4">
                    <p className="text-xs font-black text-gray-500 dark:text-gray-400 uppercase tracking-widest">
                      Admin note
                    </p>
                    <p className="text-sm text-gray-700 dark:text-gray-300 mt-1 leading-relaxed">
                      {dispute.admin_notes}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Progress */}
          <ol className="mt-8 px-2">
            {STEPS.map((step, i) => {
              const isLast = i === STEPS.length - 1;
              return (
                <li key={step.title} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    {step.state === 'done' ? (
                      <IonIcon icon={checkmarkCircle} className="text-2xl text-green-500" />
                    ) : step.state === 'current' ? (
                      <span className="w-6 h-6 rounded-full border-2 border-orange-500 flex items-center justify-center">
                        <span className="w-2.5 h-2.5 rounded-full bg-orange-500 animate-pulse" />
                      </span>
                    ) : (
                      <span className="w-6 h-6 rounded-full border-2 border-gray-300 dark:border-gray-600" />
                    )}
                    {!isLast && (
                      <span className={`w-0.5 flex-1 min-h-[28px] my-1 ${step.state === 'done' ? 'bg-green-500' : 'bg-gray-200 dark:bg-gray-700'}`} />
                    )}
                  </div>
                  <div className={isLast ? '' : 'pb-5'}>
                    <p className={`text-sm font-bold ${step.state === 'next' ? 'text-gray-400 dark:text-gray-500' : 'text-gray-900 dark:text-white'}`}>
                      {step.title}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{step.note}</p>
                  </div>
                </li>
              );
            })}
          </ol>

          <p className="mt-8 px-2 text-[11px] font-medium text-gray-400 dark:text-gray-500 break-all">
            Ref: {transaction.reference}
          </p>

          {/* Buyer can withdraw while the dispute is still open */}
          {canCancel && (
            <div className="mt-6 px-2 flex justify-center">
              <button
                onClick={() => setConfirmOpen(true)}
                className="text-sm font-bold text-red-500 active:opacity-70 transition-opacity"
              >
                Cancel dispute
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Shared image viewer for evidence photos (always mounted — avoids the open/close race) */}
      <ImageViewer
        images={evidenceImages}
        isOpen={viewerOpen}
        initialIndex={viewerIndex}
        onClose={() => setViewerOpen(false)}
      />

      {/* Cancel-dispute confirmation */}
      <Modal isOpen={confirmOpen} onClose={() => !cancelling && setConfirmOpen(false)} title="Cancel dispute?">
        <div className="px-6 py-5">
          <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
            The dispute will be closed and the escrow will resume. The seller can receive the funds once you confirm the order.
          </p>
          <div className="flex gap-3 mt-6">
            <Button
              onClick={() => setConfirmOpen(false)}
              disabled={cancelling}
              className="flex-1 !bg-gray-200 dark:!bg-gray-800 !text-gray-900 dark:!text-white !py-3.5 !rounded-full text-xs font-bold active:scale-[0.98]"
            >
              Keep dispute
            </Button>
            <Button
              onClick={handleCancelDispute}
              disabled={cancelling}
              className="flex-1 !bg-red-500 !text-white !py-3.5 !rounded-full text-xs font-bold active:scale-[0.98] disabled:opacity-60"
            >
              {cancelling ? 'Cancelling…' : 'Yes, cancel'}
            </Button>
          </div>
        </div>
      </Modal>

    </div>
  );
};

export default DisputeStatus;