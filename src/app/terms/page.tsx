// src/app/terms/page.tsx
"use client";

import React, { useRef } from 'react';
import { useRouter } from 'next/navigation';
import { safeBack } from '@/shared/safeBack';
import { IonIcon } from '@/shared/Icon/Icon';
import {
  chevronBackOutline,
  documentTextOutline,
  shieldCheckmarkOutline,
  walletOutline,
  alertCircleOutline
} from 'ionicons/icons';

export default function TermsAndPoliciesPage() {
  const router = useRouter();

  const bounceRef = useRef<HTMLDivElement>(null);

  const sectionHeaderClass =
    'text-[12px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-widest px-2 mb-4 mt-10';
  const bodyText = 'text-[14px] text-gray-600 dark:text-gray-300 leading-relaxed';

  return (
    <div className="min-h-screen bg-background text-gray-900 dark:text-white selection:bg-orange-500/30">

      {/* HEADER — solid, pinned */}
      <div className="w-full bg-background sticky top-0 z-50">
        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={() => safeBack(router)} aria-label="Go back" className="!p-2 -ml-2 text-gray-900 dark:text-white active:bg-black/5 dark:active:bg-white/10 transition-colors !rounded-full">
            <IonIcon icon={chevronBackOutline} className="text-3xl" />
          </button>
          <div className="flex flex-col">
            <h1 className="text-xl font-bold leading-tight">Terms & Policies</h1>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 font-medium uppercase tracking-widest mt-0.5">Last updated: August 2026</p>
          </div>
        </div>
      </div>

      <div ref={bounceRef} className="max-w-2xl mx-auto px-4 py-6 pb-24">

        {/* INTRO */}
        <div className="mb-6 px-2">
          <div className="w-12 h-12 rounded-full bg-orange-500/10 flex items-center justify-center mb-4">
            <IonIcon icon={documentTextOutline} className="text-2xl text-orange-500" />
          </div>
          <h2 className="text-2xl font-black text-gray-900 dark:text-white mb-2 leading-tight">
            User Agreement & Guidelines
          </h2>
          <p className="text-[14px] text-gray-600 dark:text-gray-300 leading-relaxed">
            By accessing or using Vendi, you agree to be bound by these terms. Please read them carefully to ensure a safe and transparent campus trading experience.
          </p>
        </div>

        {/* 1 */}
        <h3 className={sectionHeaderClass}>1. Account & Student Eligibility</h3>
        <div className={`px-2 space-y-4 ${bodyText}`}>
          <p>
            Vendi is designed exclusively for verified tertiary institution students and community members. You must provide accurate registration details and maintain the security of your account credentials.
          </p>
          <p>
            Accounts found impersonating other individuals or utilizing fraudulent student identification will be permanently banned and reported to the relevant university authorities.
          </p>
        </div>

        {/* 2 */}
        <h3 className={sectionHeaderClass}>2. Escrow & Wallet Transactions</h3>
        <div className="px-2 space-y-5">
          <div className="flex items-start gap-3">
            <span className="text-orange-500 text-xl flex-shrink-0 mt-0.5">
              <IonIcon icon={walletOutline} />
            </span>
            <p className={`m-0 ${bodyText}`}>
              <strong className="text-gray-900 dark:text-white">Secure Holding:</strong> All payments made through the Vendi platform are held in secure escrow. Sellers do not gain access to funds until the buyer physically inspects the item and confirms receipt via the app.
            </p>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-orange-500 text-xl flex-shrink-0 mt-0.5">
              <IonIcon icon={shieldCheckmarkOutline} />
            </span>
            <p className={`m-0 ${bodyText}`}>
              <strong className="text-gray-900 dark:text-white">Disputes & Refunds:</strong> If an item is substantially misrepresented or defective, buyers must open a formal dispute from the transaction to freeze the payout and initiate a review.
            </p>
          </div>
        </div>

        {/* 3 */}
        <h3 className={sectionHeaderClass}>3. Prohibited Items & Conduct</h3>
        <div className={`px-2 space-y-4 ${bodyText}`}>
          <p>
            To maintain a secure campus environment, listing illegal substances, weapons, counterfeit goods, hazardous materials, or academic examination materials intended for malpractice is strictly prohibited.
          </p>
          <p>
            Harassment, scam attempts, or moving transactions outside the platform to bypass safety protocols will result in immediate termination of trading privileges.
          </p>
        </div>

        {/* 4 */}
        <h3 className={sectionHeaderClass}>4. Limitation of Liability</h3>
        <div className="px-2">
          <div className="flex items-start gap-3">
            <span className="text-gray-500 dark:text-gray-400 text-xl flex-shrink-0 mt-0.5">
              <IonIcon icon={alertCircleOutline} />
            </span>
            <p className={`m-0 ${bodyText}`}>
              While Vendi provides a secure escrow framework and ID verification protocols, users remain responsible for exercising personal caution during physical meetups on campus. Vendi acts as a technology facilitator and marketplace mediator.
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}
