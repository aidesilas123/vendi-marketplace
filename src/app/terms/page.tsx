"use client";

import React from 'react';
import { useRouter } from 'next/navigation';
import { IonIcon } from '@ionic/react';
import { 
  chevronBackOutline, 
  documentTextOutline, 
  shieldCheckmarkOutline, 
  walletOutline, 
  alertCircleOutline 
} from 'ionicons/icons';

export default function TermsAndPoliciesPage() {
  const router = useRouter();

  const sectionHeaderClass = "text-[12px] font-black text-muted-foreground uppercase tracking-widest px-2 mb-4 mt-10";
  const cardClass = "bg-card rounded-[1.5rem] shadow-sm p-6 text-[14px] text-muted-foreground leading-relaxed space-y-4";

  return (
    <div className="min-h-screen bg-background text-foreground pt-safe pb-safe selection:bg-orange-500/30">
      
      {/* HEADER */}
      <div className="flex-shrink-0 w-full bg-background/95 backdrop-blur-sm shadow-sm sticky top-0 z-50">
        <div className="flex items-center gap-3 px-4 py-4">
          <button onClick={() => router.back()} className="!p-2 -ml-2 text-foreground active:bg-muted transition-colors !rounded-full">
            <span suppressHydrationWarning className="flex items-center justify-center">
              <IonIcon icon={chevronBackOutline} className="text-3xl" />
            </span>
          </button>
          <div className="flex flex-col">
            <h1 className="text-xl font-bold leading-tight">Terms & Policies</h1>
            <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-widest mt-0.5">Last updated: August 2026</p>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 pb-24">
        
        {/* INTRO HERO */}
        <div className="mb-6 px-2">
          <h2 className="text-2xl font-black text-foreground mb-2 leading-tight">
            User Agreement & Guidelines
          </h2>
          <p className="text-[14px] text-muted-foreground leading-relaxed">
            By accessing or using Vendi, you agree to be bound by these terms. Please read them carefully to ensure a safe and transparent campus trading experience.
          </p>
        </div>

        {/* SECTION 1 */}
        <h3 className={sectionHeaderClass}>1. Account & Student Eligibility</h3>
        <div className={cardClass}>
          <p>
            Vendi is designed exclusively for verified tertiary institution students and community members. You must provide accurate registration details and maintain the security of your account credentials.
          </p>
          <p>
            Accounts found impersonating other individuals or utilizing fraudulent student identification will be permanently banned and reported to the relevant university authorities.
          </p>
        </div>

        {/* SECTION 2 */}
        <h3 className={sectionHeaderClass}>2. Escrow & Wallet Transactions</h3>
        <div className={cardClass}>
          <div className="flex items-start gap-3">
            <span suppressHydrationWarning className="text-orange-500 text-xl flex-shrink-0 mt-0.5">
              <IonIcon icon={walletOutline} />
            </span>
            <p className="m-0">
              <strong className="text-foreground">Secure Holding:</strong> All payments made through the Vendi platform are held in secure escrow. Sellers do not gain full access to funds until the buyer physically inspects the item and confirms receipt via the app.
            </p>
          </div>
          <div className="flex items-start gap-3 pt-2">
            <span suppressHydrationWarning className="text-orange-500 text-xl flex-shrink-0 mt-0.5">
              <IonIcon icon={shieldCheckmarkOutline} />
            </span>
            <p className="m-0">
              <strong className="text-foreground">Disputes & Refunds:</strong> If an item is substantially misrepresented or defective, buyers must open a formal dispute within the transaction window to freeze payouts and initiate a review.
            </p>
          </div>
        </div>

        {/* SECTION 3 */}
        <h3 className={sectionHeaderClass}>3. Prohibited Items & Conduct</h3>
        <div className={cardClass}>
          <p>
            To maintain a secure campus environment, listing illegal substances, weapons, counterfeit goods, hazardous materials, or academic examination materials intended for malpractice is strictly prohibited.
          </p>
          <p>
            Harassment, scam attempts, or moving transactions outside the platform to bypass safety protocols will result in immediate termination of trading privileges.
          </p>
        </div>

        {/* SECTION 4 */}
        <h3 className={sectionHeaderClass}>4. Limitation of Liability</h3>
        <div className={cardClass}>
          <div className="flex items-start gap-3">
            <span suppressHydrationWarning className="text-muted-foreground text-xl flex-shrink-0 mt-0.5">
              <IonIcon icon={alertCircleOutline} />
            </span>
            <p className="m-0">
              While Vendi provides a secure escrow framework and ID verification protocols, users remain responsible for exercising personal caution during physical meetups on campus. Vendi acts as a technology facilitator and marketplace mediator.
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}