// src/app/how-it-works/page.tsx
"use client";

import React, { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { safeBack } from '@/shared/safeBack';
import { Button } from '@/shared/Button';
import { IonIcon } from '@ionic/react';
import {
  chevronBackOutline,
  searchOutline,
  shieldCheckmarkOutline,
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

  const bounceRef = useRef<HTMLDivElement>(null);

  const sectionHeaderClass =
    'text-[12px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-widest px-2 mb-4 mt-10';
  const stepTitle = 'text-[16px] font-black text-gray-900 dark:text-white mb-1.5';
  const stepBody = 'text-[14px] text-gray-600 dark:text-gray-300 leading-relaxed';
  const nodeClass =
    'absolute -left-[60px] top-0 w-11 h-11 rounded-full flex items-center justify-center border-4 border-background';

  const buySteps = [
    {
      icon: searchOutline,
      tint: 'bg-orange-500/10 text-orange-500',
      title: 'Browse & Compare',
      body: 'Search the campus feed and compare prices, conditions, and sellers. Ask the seller anything publicly on the listing — every answer is visible to everyone.',
    },
    {
      icon: lockClosedOutline,
      tint: 'bg-orange-500/10 text-orange-500',
      title: 'Pay Securely',
      body: 'Pay through the app. Your money goes into Vendi escrow — the seller doesn\u2019t receive a dime until you confirm receipt.',
    },
    {
      icon: chatbubblesOutline,
      tint: 'bg-orange-500/10 text-orange-500',
      title: 'Chat Unlocked',
      body: 'Payment unlocks direct contact — Vendi Chat, WhatsApp, and the seller\u2019s number — so you can arrange a safe meetup.',
    },
    {
      icon: peopleOutline,
      tint: 'bg-orange-500/10 text-orange-500',
      title: 'Meet & Inspect',
      body: 'Meet at a safe, public spot like the library or quad. Inspect the item and make sure it matches the listing.',
    },
    {
      icon: checkmarkCircleOutline,
      tint: 'bg-green-500/10 text-green-500',
      title: 'Confirm & Release',
      body: 'Happy with it? Tap \u201CConfirm Receipt\u201D and the funds are released to the seller instantly. Something wrong? Raise a dispute instead — the money stays frozen.',
    },
  ];

  const sellSteps = [
    {
      icon: cameraOutline,
      tint: 'bg-orange-500/10 text-orange-500',
      title: 'Snap & List',
      body: 'Take clear photos, write a quick description, set your price, and post to the campus feed in under 60 seconds.',
    },
    {
      icon: idCardOutline,
      tint: 'bg-orange-500/10 text-orange-500',
      title: 'Get Verified',
      body: 'Upload your student ID for the verified badge. Buyers trust verified sellers more — and your listings sell faster.',
    },
    {
      icon: shieldCheckmarkOutline,
      tint: 'bg-orange-500/10 text-orange-500',
      title: 'Money Secured First',
      body: 'The buyer\u2019s payment is already held in Vendi escrow before you meet. No stories, no \u201CI\u2019ll pay later\u201D — hand over with confidence.',
    },
    {
      icon: cashOutline,
      tint: 'bg-green-500/10 text-green-500',
      title: 'Deliver & Get Paid',
      body: 'Meet the buyer, hand over the item. The moment they confirm receipt, the funds hit your Vendi wallet instantly.',
    },
  ];

  const trustRows = [
    {
      icon: shieldCheckmarkOutline,
      tint: 'bg-blue-500/10 text-blue-500',
      title: 'Escrow Protection',
      body: 'Every payment is held securely by Vendi. Sellers can\u2019t take your money without handing over the item, and buyers can\u2019t take the item without paying.',
    },
    {
      icon: idCardOutline,
      tint: 'bg-purple-500/10 text-purple-500',
      title: 'Verified Campus Community',
      body: 'Sellers verify with a valid student ID or admission letter, keeping outside scammers out of your marketplace.',
    },
    {
      icon: alertCircleOutline,
      tint: 'bg-red-500/10 text-red-500',
      title: 'Dispute Protection',
      body: 'If an item is fake, broken, or not as described, raise a dispute. The funds stay frozen until it\u2019s resolved.',
    },
  ];

  const steps = activeTab === 'buy' ? buySteps : sellSteps;

  return (
    <div className="min-h-screen bg-background text-gray-900 dark:text-white selection:bg-orange-500/30">

      {/* HEADER — solid, pinned */}
      <div className="w-full bg-background sticky top-0 z-50">
        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={() => safeBack(router)} aria-label="Go back" className="!p-2 -ml-2 text-gray-900 dark:text-white active:bg-black/5 dark:active:bg-white/10 transition-colors !rounded-full">
            <span suppressHydrationWarning className="flex items-center justify-center">
              <IonIcon icon={chevronBackOutline} className="text-3xl" />
            </span>
          </button>
          <div className="flex flex-col">
            <h1 className="text-xl font-bold leading-tight">How Vendi Works</h1>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 font-medium uppercase tracking-widest mt-0.5">Campus trade, secured.</p>
          </div>
        </div>
      </div>

      <div ref={bounceRef} className="max-w-2xl mx-auto px-4 py-6 pb-24">

        {/* INTRO HERO */}
        <div className="mb-8 px-2">
          <h2 className="text-2xl font-black text-gray-900 dark:text-white mb-3 leading-tight">
            The safest way to buy and sell on campus.
          </h2>
          <p className="text-[15px] text-gray-600 dark:text-gray-300 leading-relaxed">
            No more getting scammed on group chats. Vendi holds every payment in escrow — buyers get what they paid for, and sellers always get their money.
          </p>
        </div>

        {/* TAB SWITCHER */}
        <div className="bg-gray-100 dark:bg-[#171717] p-1.5 rounded-full flex items-center mb-10">
          {(['buy', 'sell'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-3 text-[14px] font-black rounded-full transition-all duration-300 ${
                activeTab === tab
                  ? 'bg-white dark:bg-black text-orange-500 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              {tab === 'buy' ? 'I want to Buy' : 'I want to Sell'}
            </button>
          ))}
        </div>

        {/* TIMELINE */}
        <div className="px-2 mb-12">
          <div className="relative pl-12 border-l-2 border-gray-200 dark:border-gray-800 py-2 space-y-10">
            {steps.map((step) => (
              <div key={step.title} className="relative">
                <div className={`${nodeClass} ${step.tint}`}>
                  <span suppressHydrationWarning className="flex items-center justify-center">
                    <IonIcon icon={step.icon} className="text-xl" />
                  </span>
                </div>
                <h3 className={stepTitle}>{step.title}</h3>
                <p className={stepBody}>{step.body}</p>
              </div>
            ))}
          </div>
        </div>

        {/* TRUST */}
        <h2 className={sectionHeaderClass}>Why Vendi is Safer</h2>
        <div className="flex flex-col gap-6 px-2">
          {trustRows.map((row) => (
            <div key={row.title} className="flex items-start gap-4">
              <div className={`w-12 h-12 rounded-full ${row.tint.split(' ')[0]} flex items-center justify-center flex-shrink-0`}>
                <span suppressHydrationWarning className="flex items-center justify-center">
                  <IonIcon icon={row.icon} className={`text-2xl ${row.tint.split(' ')[1]}`} />
                </span>
              </div>
              <div className="flex flex-col pt-1">
                <h3 className="text-[15px] font-black text-gray-900 dark:text-white mb-1">{row.title}</h3>
                <p className="text-[13px] text-gray-600 dark:text-gray-300 leading-relaxed">{row.body}</p>
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="mt-12">
          <Button
            onClick={() => router.push('/')}
            className="w-full !rounded-full !py-4 !bg-orange-500 text-white font-black text-lg active:scale-[0.98]"
          >
            Start Exploring Vendi
          </Button>
        </div>

      </div>
    </div>
  );
}
