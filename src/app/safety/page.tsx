"use client";

import React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/shared/Button';
import { IonIcon } from '@ionic/react';
import { 
  chevronBackOutline, 
  shieldHalfOutline,
  checkmarkCircleOutline,
  closeCircleOutline,
  alertCircleOutline,
  lockClosedOutline,
  flagOutline,
  eyeOutline,
  locationOutline
} from 'ionicons/icons';

export default function SafetyCenterPage() {
  const router = useRouter();

  const sectionHeaderClass = "text-[12px] font-black text-muted-foreground uppercase tracking-widest px-2 mb-3 mt-10 first:mt-4";
  const cardClass = "bg-card rounded-[1.5rem] shadow-sm p-5 border border-border/40 flex flex-col gap-4";

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
            <h1 className="text-xl font-bold leading-tight">Safety Center</h1>
            <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-widest mt-0.5">Protecting the Community</p>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 pb-24">
        
        {/* HERO SECTION */}
        <div className="flex flex-col items-center text-center mb-10 mt-4 px-2">
          <div className="w-20 h-20 rounded-full bg-orange-500/10 flex items-center justify-center mb-5 border-4 border-background shadow-sm">
            <span suppressHydrationWarning className="flex items-center justify-center">
              <IonIcon icon={shieldHalfOutline} className="text-4xl text-orange-500" />
            </span>
          </div>
          <h2 className="text-2xl font-black text-foreground mb-3 leading-tight">
            Your safety is our top priority.
          </h2>
          <p className="text-[15px] text-muted-foreground leading-relaxed max-w-[280px]">
            Vendi is built to keep campus trading secure. Follow these guidelines to ensure a smooth, scam-free experience.
          </p>
        </div>

        {/* THE GOLDEN RULES */}
        <h2 className={sectionHeaderClass}>The Golden Rules</h2>
        <div className={cardClass}>
          
          <div className="flex items-start gap-3">
            <span suppressHydrationWarning className="mt-0.5 flex-shrink-0">
              <IonIcon icon={checkmarkCircleOutline} className="text-xl text-green-500" />
            </span>
            <div>
              <h3 className="text-[15px] font-bold text-foreground mb-1">Keep payments on Vendi</h3>
              <p className="text-[13px] text-muted-foreground leading-relaxed">Our Escrow system is your only protection. Never transfer money directly to a seller's personal bank account.</p>
            </div>
          </div>

          <div className="w-full h-px bg-border/50"></div>

          <div className="flex items-start gap-3">
            <span suppressHydrationWarning className="mt-0.5 flex-shrink-0">
              <IonIcon icon={locationOutline} className="text-xl text-green-500" />
            </span>
            <div>
              <h3 className="text-[15px] font-bold text-foreground mb-1">Meet in public spaces</h3>
              <p className="text-[13px] text-muted-foreground leading-relaxed">Always arrange meetups in busy, well-lit campus areas like the library, student union, or cafeterias.</p>
            </div>
          </div>

          <div className="w-full h-px bg-border/50"></div>

          <div className="flex items-start gap-3">
            <span suppressHydrationWarning className="mt-0.5 flex-shrink-0">
              <IonIcon icon={closeCircleOutline} className="text-xl text-red-500" />
            </span>
            <div>
              <h3 className="text-[15px] font-bold text-foreground mb-1">Never share passwords or OTPs</h3>
              <p className="text-[13px] text-muted-foreground leading-relaxed">Vendi support will NEVER ask for your password, PIN, or login codes. Keep your personal data strictly private.</p>
            </div>
          </div>

        </div>

        {/* SPOTTING SCAMS */}
        <h2 className={sectionHeaderClass}>How to Spot a Scam</h2>
        <div className={cardClass}>
          
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-full bg-red-500/10 flex items-center justify-center flex-shrink-0">
              <span suppressHydrationWarning className="flex items-center justify-center">
                <IonIcon icon={alertCircleOutline} className="text-lg text-red-500" />
              </span>
            </div>
            <div className="flex flex-col pt-1">
              <h3 className="text-[15px] font-bold text-foreground mb-1">"Too good to be true" prices</h3>
              <p className="text-[13px] text-muted-foreground leading-relaxed">If a brand new iPhone is listed for ₦50,000, it is almost certainly a scam. Scammers use unbelievably low prices to bait buyers.</p>
            </div>
          </div>

          <div className="flex items-start gap-3 mt-2">
            <div className="w-9 h-9 rounded-full bg-red-500/10 flex items-center justify-center flex-shrink-0">
              <span suppressHydrationWarning className="flex items-center justify-center">
                <IonIcon icon={eyeOutline} className="text-lg text-red-500" />
              </span>
            </div>
            <div className="flex flex-col pt-1">
              <h3 className="text-[15px] font-bold text-foreground mb-1">High-pressure tactics</h3>
              <p className="text-[13px] text-muted-foreground leading-relaxed">Beware of sellers who try to rush you into making a payment quickly or claim someone else is about to buy it immediately.</p>
            </div>
          </div>

        </div>

        {/* VENDI PROTECTIONS */}
        <h2 className={sectionHeaderClass}>How Vendi Protects You</h2>
        <div className="flex gap-3 overflow-x-auto scrollbar-hide snap-x pb-2">
          
          <div className="min-w-[240px] bg-card rounded-[1.5rem] p-5 shadow-sm border border-border/40 snap-start">
            <span suppressHydrationWarning className="mb-3 block">
              <IonIcon icon={lockClosedOutline} className="text-3xl text-orange-500" />
            </span>
            <h3 className="text-[15px] font-black text-foreground mb-2">Escrow Wallet</h3>
            <p className="text-[13px] text-muted-foreground leading-relaxed">We freeze the buyer's funds. The seller only receives the money when both parties meet and the buyer confirms the item is perfect.</p>
          </div>

          <div className="min-w-[240px] bg-card rounded-[1.5rem] p-5 shadow-sm border border-border/40 snap-start">
            <span suppressHydrationWarning className="mb-3 block">
              <IonIcon icon={shieldHalfOutline} className="text-3xl text-blue-500" />
            </span>
            <h3 className="text-[15px] font-black text-foreground mb-2">ID Verification</h3>
            <p className="text-[13px] text-muted-foreground leading-relaxed">Users with a blue badge have submitted official University ID cards and Admission letters, which our team manually verifies.</p>
          </div>

        </div>

        {/* REPORTING SECTION */}
        <div className="mt-12 bg-red-500/5 rounded-[1.5rem] p-6 border border-red-500/20 text-center">
          <span suppressHydrationWarning className="flex items-center justify-center mb-3">
            <IonIcon icon={flagOutline} className="text-4xl text-red-500" />
          </span>
          <h3 className="text-lg font-black text-foreground mb-2">See something suspicious?</h3>
          <p className="text-[14px] text-muted-foreground leading-relaxed mb-6">
            Help us keep the campus safe. If a user is acting suspiciously or breaking the rules, report them immediately.
          </p>
          <Button 
            onClick={() => router.push('/report')}
            className="w-full !rounded-full !py-3.5 !bg-red-500 hover:!bg-red-600 text-white font-black shadow-lg shadow-red-500/20 active:scale-[0.98] transition-all"
          >
            Report a User
          </Button>
        </div>

      </div>
    </div>
  );
}