// src/app/support/page.tsx
"use client";

import React, { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { safeBack } from '@/shared/safeBack';
import { IonIcon } from '@/shared/Icon/Icon';
import {
  chevronBackOutline,
  logoWhatsapp,
  mailOutline,
  chevronDownOutline,
  shieldCheckmarkOutline,
  bookOutline,
  flagOutline,
  chevronForwardOutline
} from 'ionicons/icons';

const FAQS = [
  {
    category: "Payments & Escrow",
    questions: [
      {
        q: "How does the Vendi Escrow system work?",
        a: "When you pay for an item, Vendi holds the funds securely. The seller does not receive the money until you meet on campus, inspect the item, and tap 'Confirm Receipt' in the app."
      },
      {
        q: "What if the seller doesn't show up or the item is fake?",
        a: "Open a dispute from the transaction — the funds are frozen immediately and stay frozen until the issue is resolved."
      },
      {
        q: "How do I withdraw my earnings from my wallet?",
        a: "Go to your Wallet page, tap 'Withdraw', and enter your bank account details. Withdrawals are processed quickly to your local bank account."
      }
    ]
  },
  {
    category: "Account & Verification",
    questions: [
      {
        q: "Why should I verify my student ID?",
        a: "Verification gives you a verified badge on your profile. This builds trust with other students, making it much easier and faster to sell your items."
      },
      {
        q: "How do I change my password?",
        a: "You can update your security credentials by going to your Profile -> Edit Profile, or via Settings -> Change Password."
      }
    ]
  },
  {
    category: "Buying & Selling",
    questions: [
      {
        q: "Is there a fee for listing items?",
        a: "Listing items on Vendi is completely free for students. We only apply a small, transparent service fee when a transaction is successfully completed through escrow."
      },
      {
        q: "Can I edit or delete my listing?",
        a: "Yes! Go to your Seller Dashboard or My Profile to manage, edit, or mark your active listings as sold at any time."
      }
    ]
  }
];

export default function SupportPage() {
  const router = useRouter();
  const [openSection, setOpenSection] = useState<string | null>("How does the Vendi Escrow system work?");

  const bounceRef = useRef<HTMLDivElement>(null);

  const toggleAccordion = (question: string) => {
    setOpenSection(openSection === question ? null : question);
  };

  const sectionHeaderClass =
    'text-[12px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-widest px-2 mb-4 mt-10';
  const iconCircle =
    'w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0';

  const resources = [
    { icon: bookOutline, tint: 'text-gray-500 dark:text-gray-400', label: 'How Vendi Works', path: '/how-it-works', danger: false },
    { icon: shieldCheckmarkOutline, tint: 'text-gray-500 dark:text-gray-400', label: 'Safety Center', path: '/safety', danger: false },
    { icon: flagOutline, tint: 'text-red-500', label: 'Report a User or Scam', path: '/report', danger: true },
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
            <h1 className="text-xl font-bold leading-tight">Help & Support</h1>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 font-medium uppercase tracking-widest mt-0.5">We are here to help</p>
          </div>
        </div>
      </div>

      <div ref={bounceRef} className="max-w-2xl mx-auto px-4 py-6 pb-24">

        {/* CONTACT ROWS */}
        <div className="px-2">
          <a
            href="https://wa.me/2347081567555?text=Hello%20Vendi%20Support,%20I%20need%20help%20with..."
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center gap-4 py-4 active:bg-black/5 dark:active:bg-white/5 transition-colors"
          >
            <div className={`${iconCircle} bg-green-500/10`}>
              <IonIcon icon={logoWhatsapp} className="text-2xl text-green-500" />
            </div>
            <div className="flex flex-col">
              <span className="text-[12px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Instant Chat</span>
              <span className="text-[16px] font-black text-gray-900 dark:text-white">WhatsApp Support</span>
            </div>
          </a>

          <a
            href="mailto:abuscholarsprep@gmail.com?subject=Vendi%20Support%20Inquiry"
            className="w-full flex items-center gap-4 py-4 active:bg-black/5 dark:active:bg-white/5 transition-colors"
          >
            <div className={`${iconCircle} bg-orange-500/10`}>
              <IonIcon icon={mailOutline} className="text-2xl text-orange-500" />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-[12px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Email Us</span>
              <span className="text-[14px] font-black text-gray-900 dark:text-white truncate">abuscholarsprep@gmail.com</span>
            </div>
          </a>
        </div>

        {/* FAQ */}
        <h2 className={sectionHeaderClass}>Frequently Asked Questions</h2>

        <div className="space-y-8 px-2">
          {FAQS.map((categoryGroup, index) => (
            <div key={index}>
              <h3 className="text-[13px] font-black text-orange-500 uppercase tracking-wider mb-2">{categoryGroup.category}</h3>

              {categoryGroup.questions.map((faq) => {
                const isOpen = openSection === faq.q;
                return (
                  <div key={faq.q} className="py-3">
                    <button
                      onClick={() => toggleAccordion(faq.q)}
                      className="w-full flex items-center justify-between text-left gap-4 py-1"
                    >
                      <span className={`text-[15px] font-bold transition-colors ${isOpen ? 'text-orange-500' : 'text-gray-900 dark:text-white'}`}>
                        {faq.q}
                      </span>
                      <IonIcon icon={chevronDownOutline} className={`text-lg transition-transform duration-200 ${isOpen ? 'rotate-180 text-orange-500' : 'text-gray-400 dark:text-gray-500'}`} />
                    </button>

                    {isOpen && (
                      <p className="text-[14px] text-gray-600 dark:text-gray-300 mt-2 leading-relaxed pr-4">
                        {faq.a}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* OTHER RESOURCES */}
        <h2 className={sectionHeaderClass}>Other Resources</h2>
        <div className="px-2">
          {resources.map((r) => (
            <button
              key={r.path}
              onClick={() => router.push(r.path)}
              className="w-full flex items-center justify-between py-4 text-left active:bg-black/5 dark:active:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-3">
                <IonIcon icon={r.icon} className={`text-xl ${r.tint}`} />
                <span className={`text-[15px] font-bold ${r.danger ? 'text-red-500' : 'text-gray-900 dark:text-white'}`}>{r.label}</span>
              </div>
              <IonIcon icon={chevronForwardOutline} className="text-base text-gray-400 dark:text-gray-500" />
            </button>
          ))}
        </div>

      </div>
    </div>
  );
}
