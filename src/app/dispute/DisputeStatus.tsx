"use client";

import React, { useRef } from 'react';
import { IonIcon } from '@ionic/react';
import {
  chevronBackOutline,
  checkmarkCircle,
  hourglassOutline,
  lockClosedOutline
} from 'ionicons/icons';
import { Button } from '@/shared/Button';
import { useRubberBand } from '@/shared/hooks/useRubberBand';

interface DisputeStatusProps {
  transaction: any;
  product: { title?: string } | null;
  onBack: () => void;
  onDone: () => void;
}

type StepState = 'done' | 'current' | 'next';

const STEPS: { title: string; note: string; state: StepState }[] = [
  { title: 'Dispute raised', note: 'The report has been received.', state: 'done' },
  { title: 'Admin review', note: 'Our admins are investigating.', state: 'current' },
  { title: 'Final decision', note: 'An admin decides where the funds go.', state: 'next' },
];

export const DisputeStatus: React.FC<DisputeStatusProps> = ({ transaction, product, onBack, onDone }) => {
  const bounceRef = useRef<HTMLDivElement>(null);
  useRubberBand(bounceRef, { ready: true });

  const amount = Math.abs(transaction.amount);

  return (
    <div className="w-full min-h-screen bg-gray-50 dark:bg-[#0b1120] text-gray-900 dark:text-white pb-32">
      <header className="sticky top-0 left-0 right-0 z-50 w-full bg-gray-50 dark:bg-[#0b1120] pt-safe">
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

          {/* Current status */}
          <div className="flex gap-3 rounded-2xl bg-orange-50 dark:bg-orange-900/20 p-4 mt-6">
            <IonIcon icon={hourglassOutline} className="text-2xl text-orange-500 flex-shrink-0" />
            <div>
              <p className="text-sm font-black text-orange-600 dark:text-orange-400">Pending admin review</p>
              <p className="text-xs text-gray-600 dark:text-gray-400 font-medium leading-relaxed mt-1">
                A dispute has been raised on this order. The funds stay frozen in escrow until an admin makes a final decision.
              </p>
            </div>
          </div>

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
        </div>
      </div>

      {/* BOTTOM FIXED NAV */}
      <div className="fixed bottom-0 left-0 right-0 z-[90] bg-gray-50/95 dark:bg-[#0b1120]/95 backdrop-blur-xl border-t border-gray-200/50 dark:border-gray-800/50 p-4 pt-3 pb-safe">
        <div className="max-w-2xl mx-auto">
          <Button onClick={onDone} className="w-full !bg-gray-200 dark:!bg-gray-800 !text-gray-900 dark:!text-white !py-3.5 !rounded-full text-xs font-bold active:scale-[0.98]">
            Back to Transactions
          </Button>
        </div>
      </div>
    </div>
  );
};

export default DisputeStatus;