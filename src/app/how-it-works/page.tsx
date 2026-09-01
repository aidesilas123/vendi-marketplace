"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/shared/Button';
import { IonIcon } from '@ionic/react';
import { 
  chevronBackOutline, 
  searchOutline, 
  shieldCheckmarkOutline, 
  walletOutline,
  cameraOutline,
  idCardOutline,
  cashOutline,
  chatbubblesOutline,
  lockClosedOutline,
  alertCircleOutline,
  checkmarkCircleOutline,
  peopleOutline
} from 'ionicons/icons';

export default function HowItWorksPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'buy' | 'sell'>('buy');

  const sectionHeaderClass = "text-[12px] font-black text-muted-foreground uppercase tracking-widest px-2 mb-4 mt-10";

  return (
    <div className="min-h-screen bg-background text-foreground pt-safe pb-safe selection:bg-orange-500/30">
      
      {/* HEADER */}
      <div className="flex-shrink-0 w-full bg-background/95 backdrop-blur-sm shadow-sm sticky top-0 z-50">
        <div className="flex items-center gap-3 px-4 py-4">
          <button onClick={() => router.back()} className="!p-2 -ml-2 text-foreground active:bg-muted transition-colors !rounded-full">
            <IonIcon icon={chevronBackOutline} className="text-3xl" />
          </button>
          <div className="flex flex-col">
            <h1 className="text-xl font-bold leading-tight">How Vendi Works</h1>
            <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-widest mt-0.5">Campus Trading, Secured.</p>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 pb-24">
        
        {/* INTRO HERO */}
        <div className="mb-8 px-2">
          <h2 className="text-2xl font-black text-foreground mb-3 leading-tight">
            The safest way to buy and sell on campus.
          </h2>
          <p className="text-[15px] text-muted-foreground leading-relaxed">
            No more getting scammed on group chats. Vendi uses a secure escrow system to ensure buyers get what they paid for, and sellers always get their money.
          </p>
        </div>

        {/* CUSTOM TAB SWITCHER */}
        <div className="bg-muted p-1.5 rounded-full flex items-center mb-10 shadow-inner">
          <button
            onClick={() => setActiveTab('buy')}
            className={`flex-1 py-3 text-[14px] font-black rounded-full transition-all duration-300 ${
              activeTab === 'buy' 
                ? 'bg-background text-orange-500 shadow-sm' 
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            I want to Buy
          </button>
          <button
            onClick={() => setActiveTab('sell')}
            className={`flex-1 py-3 text-[14px] font-black rounded-full transition-all duration-300 ${
              activeTab === 'sell' 
                ? 'bg-background text-orange-500 shadow-sm' 
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            I want to Sell
          </button>
        </div>

        {/* TIMELINE UI */}
        <div className="px-2 mb-12">
          <div className="relative pl-12 border-l-2 border-muted py-2 space-y-10">
            
            {activeTab === 'buy' ? (
              <>
                <div className="relative">
                  <div className="absolute -left-[60px] top-0 w-11 h-11 rounded-full bg-orange-500/10 text-orange-500 flex items-center justify-center border-4 border-background shadow-sm">
                    <IonIcon icon={searchOutline} className="text-xl" />
                  </div>
                  <h3 className="text-[16px] font-black text-foreground mb-1.5">Discover & Chat</h3>
                  <p className="text-[14px] text-muted-foreground leading-relaxed">Browse the campus feed. Found exactly what you need? Tap to open a secure chat with the seller to ask questions or negotiate.</p>
                </div>

                <div className="relative">
                  <div className="absolute -left-[60px] top-0 w-11 h-11 rounded-full bg-orange-500/10 text-orange-500 flex items-center justify-center border-4 border-background shadow-sm">
                    <IonIcon icon={lockClosedOutline} className="text-xl" />
                  </div>
                  <h3 className="text-[16px] font-black text-foreground mb-1.5">Secure Escrow Payment</h3>
                  <p className="text-[14px] text-muted-foreground leading-relaxed">Pay safely through the app. <span className="font-bold text-foreground">Your money is held by Vendi.</span> The seller does not receive a dime until you physically get the item.</p>
                </div>

                <div className="relative">
                  <div className="absolute -left-[60px] top-0 w-11 h-11 rounded-full bg-orange-500/10 text-orange-500 flex items-center justify-center border-4 border-background shadow-sm">
                    <IonIcon icon={peopleOutline} className="text-xl" />
                  </div>
                  <h3 className="text-[16px] font-black text-foreground mb-1.5">Meet on Campus</h3>
                  <p className="text-[14px] text-muted-foreground leading-relaxed">Meet up at a safe, public location (like the library or quad) to inspect your item and ensure it matches the description.</p>
                </div>

                <div className="relative">
                  <div className="absolute -left-[60px] top-0 w-11 h-11 rounded-full bg-green-500/10 text-green-500 flex items-center justify-center border-4 border-background shadow-sm">
                    <IonIcon icon={checkmarkCircleOutline} className="text-xl" />
                  </div>
                  <h3 className="text-[16px] font-black text-foreground mb-1.5">Confirm & Release</h3>
                  <p className="text-[14px] text-muted-foreground leading-relaxed">Once you are happy, tap "Confirm Receipt" in the app. The funds are instantly released to the seller's wallet!</p>
                </div>
              </>
            ) : (
              <>
                <div className="relative">
                  <div className="absolute -left-[60px] top-0 w-11 h-11 rounded-full bg-orange-500/10 text-orange-500 flex items-center justify-center border-4 border-background shadow-sm">
                    <IonIcon icon={cameraOutline} className="text-xl" />
                  </div>
                  <h3 className="text-[16px] font-black text-foreground mb-1.5">Snap & List</h3>
                  <p className="text-[14px] text-muted-foreground leading-relaxed">Take a clear photo, write a quick description, set your price, and post your item directly to the campus feed in under 60 seconds.</p>
                </div>

                <div className="relative">
                  <div className="absolute -left-[60px] top-0 w-11 h-11 rounded-full bg-orange-500/10 text-orange-500 flex items-center justify-center border-4 border-background shadow-sm">
                    <IonIcon icon={idCardOutline} className="text-xl" />
                  </div>
                  <h3 className="text-[16px] font-black text-foreground mb-1.5">Get Verified</h3>
                  <p className="text-[14px] text-muted-foreground leading-relaxed">Upload your Campus ID to get the verified blue badge. Verified student sellers get up to 3x more buyers and faster sales.</p>
                </div>

                <div className="relative">
                  <div className="absolute -left-[60px] top-0 w-11 h-11 rounded-full bg-green-500/10 text-green-500 flex items-center justify-center border-4 border-background shadow-sm">
                    <IonIcon icon={cashOutline} className="text-xl" />
                  </div>
                  <h3 className="text-[16px] font-black text-foreground mb-1.5">Deliver & Get Paid</h3>
                  <p className="text-[14px] text-muted-foreground leading-relaxed">Meet the buyer, hand over the item, and watch the funds hit your Vendi Wallet instantly the moment they confirm receipt in the app.</p>
                </div>
              </>
            )}

          </div>
        </div>

        {/* TRUST & SAFETY CARDS */}
        <h2 className={sectionHeaderClass}>Why Vendi is Safer</h2>
        <div className="flex flex-col gap-4">
          
          <div className="bg-card rounded-[1.5rem] p-5 shadow-sm flex items-start gap-4">
            <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center flex-shrink-0">
              <IonIcon icon={shieldCheckmarkOutline} className="text-2xl text-blue-500" />
            </div>
            <div className="flex flex-col pt-1">
              <h3 className="text-[15px] font-black text-foreground mb-1">100% Escrow Protection</h3>
              <p className="text-[13px] text-muted-foreground leading-relaxed">Money is held securely. Buyers can't run off without paying, and sellers can't take your money without handing over the item.</p>
            </div>
          </div>

          <div className="bg-card rounded-[1.5rem] p-5 shadow-sm flex items-start gap-4">
            <div className="w-12 h-12 rounded-full bg-purple-500/10 flex items-center justify-center flex-shrink-0">
              <IonIcon icon={idCardOutline} className="text-2xl text-purple-500" />
            </div>
            <div className="flex flex-col pt-1">
              <h3 className="text-[15px] font-black text-foreground mb-1">Verified Campus Community</h3>
              <p className="text-[13px] text-muted-foreground leading-relaxed">We require valid Student ID cards or Admission letters to verify sellers, keeping outside scammers out of your marketplace.</p>
            </div>
          </div>

          <div className="bg-card rounded-[1.5rem] p-5 shadow-sm flex items-start gap-4">
            <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center flex-shrink-0">
              <IonIcon icon={alertCircleOutline} className="text-2xl text-red-500" />
            </div>
            <div className="flex flex-col pt-1">
              <h3 className="text-[15px] font-black text-foreground mb-1">24/7 Dispute Resolution</h3>
              <p className="text-[13px] text-muted-foreground leading-relaxed">If an item is fake, broken, or not as described, simply open a dispute. We freeze the funds immediately and step in to mediate.</p>
            </div>
          </div>

        </div>

        {/* CTA BUTTON */}
        <div className="mt-12">
          <Button 
            onClick={() => router.push('/')} 
            className="w-full !rounded-full !py-4 !bg-orange-500 text-white font-black text-lg active:scale-[0.98] shadow-lg shadow-orange-500/30"
          >
            Start Exploring Vendi
          </Button>
        </div>

      </div>
    </div>
  );
}