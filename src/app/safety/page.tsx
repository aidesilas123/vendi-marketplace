// src/app/safety/page.tsx
"use client";

import React, { useRef } from 'react';
import { useRouter } from 'next/navigation';
import { safeBack } from '@/shared/safeBack';
import { Button } from '@/shared/Button';
import { IonIcon } from '@/shared/Icon/Icon';
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

  const bounceRef = useRef<HTMLDivElement>(null);

  const sectionHeaderClass =
    'text-[12px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-widest px-2 mb-4 mt-10 first:mt-4';
  const ruleTitle = 'text-[15px] font-bold text-gray-900 dark:text-white mb-1';
  const ruleBody = 'text-[13px] text-gray-600 dark:text-gray-300 leading-relaxed';

  const goldenRules = [
    {
      icon: checkmarkCircleOutline,
      tint: 'text-green-500',
      title: 'Keep payments on Vendi',
      body: 'Our escrow system is your only protection. Never transfer money directly to a seller\u2019s personal bank account.',
    },
    {
      icon: locationOutline,
      tint: 'text-green-500',
      title: 'Meet in public spaces',
      body: 'Always arrange meetups in busy, well-lit campus areas like the library, student union, or cafeterias.',
    },
    {
      icon: closeCircleOutline,
      tint: 'text-red-500',
      title: 'Never share passwords or OTPs',
      body: 'Vendi support will NEVER ask for your password, PIN, or login codes. Keep your personal data strictly private.',
    },
  ];

  const scamSigns = [
    {
      icon: alertCircleOutline,
      title: '\u201CToo good to be true\u201D prices',
      body: 'If a brand new iPhone is listed for \u20A650,000, it is almost certainly a scam. Scammers use unbelievably low prices to bait buyers.',
    },
    {
      icon: eyeOutline,
      title: 'High-pressure tactics',
      body: 'Beware of sellers who try to rush you into paying quickly or claim someone else is about to buy it immediately.',
    },
  ];

  const protections = [
    {
      icon: lockClosedOutline,
      tint: 'text-orange-500',
      title: 'Escrow Wallet',
      body: 'We hold the buyer\u2019s funds. The seller only receives the money after you meet and confirm the item is as described.',
    },
    {
      icon: shieldHalfOutline,
      tint: 'text-blue-500',
      title: 'ID Verification',
      body: 'Users with a blue badge submitted an official university ID or admission letter, verified by our team.',
    },
  ];

  return (
    <div className="min-h-screen bg-background text-gray-900 dark:text-white selection:bg-orange-500/30">

      {/* HEADER — solid, pinned */}
      <div className="w-full bg-background sticky top-0 z-50">
        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={() => safeBack(router)} aria-label="Go back" className="!p-2 -ml-2 text-gray-900 dark:text-white active:bg-black/5 dark:active:bg-white/10 transition-colors !rounded-full">
            <IonIcon icon={chevronBackOutline} className="text-3xl" />
          </button>
          <div className="flex flex-col">
            <h1 className="text-xl font-bold leading-tight">Safety Center</h1>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 font-medium uppercase tracking-widest mt-0.5">Protecting the community</p>
          </div>
        </div>
      </div>

      <div ref={bounceRef} className="max-w-2xl mx-auto px-4 py-6 pb-24">

        {/* HERO */}
        <div className="flex flex-col items-center text-center mb-10 mt-4 px-2">
          <div className="w-20 h-20 rounded-full bg-orange-500/10 flex items-center justify-center mb-5">
            <IonIcon icon={shieldHalfOutline} className="text-4xl text-orange-500" />
          </div>
          <h2 className="text-2xl font-black text-gray-900 dark:text-white mb-3 leading-tight">
            Your safety is our top priority.
          </h2>
          <p className="text-[15px] text-gray-600 dark:text-gray-300 leading-relaxed max-w-[280px]">
            Vendi is built to keep campus trade secure. Follow these guidelines for a smooth, scam-free experience.
          </p>
        </div>

        {/* GOLDEN RULES */}
        <h2 className={sectionHeaderClass}>The Golden Rules</h2>
        <div className="flex flex-col gap-5 px-2">
          {goldenRules.map((rule) => (
            <div key={rule.title} className="flex items-start gap-3">
              <span className="mt-0.5 flex-shrink-0">
                <IonIcon icon={rule.icon} className={`text-xl ${rule.tint}`} />
              </span>
              <div>
                <h3 className={ruleTitle}>{rule.title}</h3>
                <p className={ruleBody}>{rule.body}</p>
              </div>
            </div>
          ))}
        </div>

        {/* SPOTTING SCAMS */}
        <h2 className={sectionHeaderClass}>How to Spot a Scam</h2>
        <div className="flex flex-col gap-5 px-2">
          {scamSigns.map((sign) => (
            <div key={sign.title} className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-full bg-red-500/10 flex items-center justify-center flex-shrink-0">
                <IonIcon icon={sign.icon} className="text-lg text-red-500" />
              </div>
              <div className="flex flex-col pt-1">
                <h3 className={ruleTitle}>{sign.title}</h3>
                <p className={ruleBody}>{sign.body}</p>
              </div>
            </div>
          ))}
        </div>

        {/* VENDI PROTECTIONS */}
        <h2 className={sectionHeaderClass}>How Vendi Protects You</h2>
        <div className="flex flex-col gap-5 px-2">
          {protections.map((p) => (
            <div key={p.title} className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-full bg-gray-100 dark:bg-[#171717] flex items-center justify-center flex-shrink-0">
                <IonIcon icon={p.icon} className={`text-lg ${p.tint}`} />
              </div>
              <div className="flex flex-col pt-1">
                <h3 className={ruleTitle}>{p.title}</h3>
                <p className={ruleBody}>{p.body}</p>
              </div>
            </div>
          ))}
        </div>

        {/* REPORT CTA */}
        <div className="mt-12 px-2 text-center">
          <IonIcon icon={flagOutline} className="text-4xl text-red-500 mb-3" />
          <h3 className="text-lg font-black text-gray-900 dark:text-white mb-2">See something suspicious?</h3>
          <p className="text-[14px] text-gray-600 dark:text-gray-300 leading-relaxed mb-6">
            Help us keep the campus safe. If a user is acting suspiciously or breaking the rules, report them immediately.
          </p>
          <Button
            onClick={() => router.push('/report')}
            className="w-full !rounded-full !py-3.5 !bg-red-500 hover:!bg-red-600 text-white font-black active:scale-[0.98] transition-all"
          >
            Report a User
          </Button>
        </div>

      </div>
    </div>
  );
}
