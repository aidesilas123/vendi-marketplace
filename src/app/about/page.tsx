// src/app/about/page.tsx
"use client";

import React, { useRef } from 'react';
import { useRouter } from 'next/navigation';
import { safeBack } from '@/shared/safeBack';
import { useRubberBand } from '@/shared/hooks/useRubberBand';
import IonIcon from '@/shared/Icon/Icon';
import {
  chevronBackOutline,
  informationCircleOutline,
  schoolOutline,
  codeWorkingOutline,
  rocketOutline
} from 'ionicons/icons';
import packageJson from '../../../package.json';

export default function AboutPage() {
  const router = useRouter();

  const bounceRef = useRef<HTMLDivElement>(null);
  useRubberBand(bounceRef, { ready: true });

  const sectionHeaderClass =
    'text-[12px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-widest px-2 mb-4 mt-10 first:mt-2';
  const iconAccent = 'text-orange-500 text-2xl flex-shrink-0 mt-0.5';
  const bodyText = 'text-[14px] text-gray-600 dark:text-gray-300 leading-relaxed';

  return (
    <div className="min-h-screen bg-background text-gray-900 dark:text-white selection:bg-orange-500/30">

      {/* HEADER — solid, pinned to the top */}
      <div className="w-full bg-background sticky top-0 z-50">
        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={() => safeBack(router)} aria-label="Go back" className="!p-2 -ml-2 text-gray-900 dark:text-white active:bg-black/5 dark:active:bg-white/10 transition-colors !rounded-full">
            <IonIcon icon={chevronBackOutline} className="text-3xl" />
          </button>
          <div className="flex flex-col">
            <h1 className="text-xl font-bold leading-tight">About Vendi</h1>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 font-medium uppercase tracking-widest mt-0.5">Version {packageJson.version}</p>
          </div>
        </div>
      </div>

      <div ref={bounceRef} className="max-w-2xl mx-auto px-4 py-6 pb-24">

        {/* HERO */}
        <div className="flex flex-col items-center text-center mb-10 mt-4 px-2">
          <img src="/logo.png" alt="Vendi logo" className="w-24 h-24 mb-5 object-contain" />
          <h2 className="text-2xl font-black text-gray-900 dark:text-white mb-2 leading-tight">
            Vendi Marketplace
          </h2>
          <p className="text-[15px] text-gray-500 dark:text-gray-400 leading-relaxed max-w-[280px]">
            The secure, student-first marketplace for campus trade.
          </p>
        </div>

        {/* OUR STORY */}
        <h3 className={sectionHeaderClass}>Our Story</h3>
        <div className="flex items-start gap-4 px-2">
          <span className={iconAccent}>
            <IonIcon icon={schoolOutline} />
          </span>
          <div className="flex flex-col">
            <h4 className="text-[16px] font-black text-gray-900 dark:text-white mb-2">Built by Aide Tech</h4>
            <p className={bodyText}>
              Vendi is built by <strong className="text-gray-900 dark:text-white">Aide Tech</strong>, the team behind Scholars Prep — the CBT platform helping Ahmadu Bello University students prepare for academic excellence. We saw students facing another daily challenge: campus commerce riddled with scams in WhatsApp groups and unreliable buyers.
            </p>
            <p className={`${bodyText} mt-3`}>
              Vendi brings that same reliability to the way students buy and sell — every trade protected, every seller accountable.
            </p>
          </div>
        </div>

        {/* MISSION */}
        <h3 className={sectionHeaderClass}>Our Mission</h3>
        <div className="flex items-start gap-4 px-2">
          <span className="text-blue-500 text-2xl flex-shrink-0 mt-0.5">
            <IonIcon icon={rocketOutline} />
          </span>
          <p className={bodyText}>
            We build software that solves real, everyday problems for students — from acing exams through smart preparation to buying a textbook without fear of fraud. Vendi exists to make campus trade safe, simple, and fair for everyone.
          </p>
        </div>

        {/* SYSTEM INFORMATION */}
        <h3 className={sectionHeaderClass}>System Information</h3>
        <div className="px-2">
          <div className="flex items-center justify-between py-4">
            <div className="flex items-center gap-3">
              <span className="text-gray-500 dark:text-gray-400">
                <IonIcon icon={codeWorkingOutline} className="text-xl" />
              </span>
              <span className="text-[15px] font-bold text-gray-900 dark:text-white">Developed By</span>
            </div>
            <span className="text-[14px] font-medium text-gray-500 dark:text-gray-400">Aide Tech</span>
          </div>

          <div className="flex items-center justify-between py-4">
            <div className="flex items-center gap-3">
              <span className="text-gray-500 dark:text-gray-400">
                <IonIcon icon={informationCircleOutline} className="text-xl" />
              </span>
              <span className="text-[15px] font-bold text-gray-900 dark:text-white">App Version</span>
            </div>
            <span className="text-[14px] font-medium text-gray-500 dark:text-gray-400">{packageJson.version}</span>
          </div>
        </div>

      </div>
    </div>
  );
}
