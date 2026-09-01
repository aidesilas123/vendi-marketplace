"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/shared/Button';
import { IonIcon } from '@ionic/react';
import { 
  chevronBackOutline, 
  logoWhatsapp, 
  mailOutline, 
  chevronDownOutline,
  shieldCheckmarkOutline,
  bookOutline,
  flagOutline
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
        a: "If there is an issue, you can open a dispute directly from your transaction history. Our team will freeze the funds immediately and investigate to issue a refund if necessary."
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
        a: "Verification gives you a verified blue badge on your profile. This builds trust with other students, making it much easier and faster to sell your items."
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

  const toggleAccordion = (question: string) => {
    setOpenSection(openSection === question ? null : question);
  };

  const sectionHeaderClass = "text-[12px] font-black text-muted-foreground uppercase tracking-widest px-2 mb-4 mt-10";
  // Removed the border classes from the main cards
  const cardClass = "bg-card rounded-[1.5rem] shadow-sm p-5";

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
            <h1 className="text-xl font-bold leading-tight">Help & Support</h1>
            <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-widest mt-0.5">We are here to help</p>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 pb-24">
        
        {/* HERO / INSTANT CONTACT CARDS */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
          
          {/* WhatsApp Support (Borders removed) */}
          <a 
            href="https://wa.me/2347081567555?text=Hello%20Vendi%20Support,%20I%20need%20help%20with..."
            target="_blank"
            rel="noopener noreferrer"
            className="bg-card rounded-[1.5rem] p-5 shadow-sm flex items-center gap-4 transition-all active:scale-[0.98]"
          >
            <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center flex-shrink-0">
              <span suppressHydrationWarning className="flex items-center justify-center">
                <IonIcon icon={logoWhatsapp} className="text-2xl text-green-500" />
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-[12px] font-bold text-muted-foreground uppercase tracking-wider">Instant Chat</span>
              <span className="text-[16px] font-black text-foreground">WhatsApp Support</span>
            </div>
          </a>

          {/* Email Support (Borders removed) */}
          <a 
            href="mailto:abuscholarsprep@gmail.com?subject=Vendi%20Support%20Inquiry"
            className="bg-card rounded-[1.5rem] p-5 shadow-sm flex items-center gap-4 transition-all active:scale-[0.98]"
          >
            <div className="w-12 h-12 rounded-full bg-orange-500/10 flex items-center justify-center flex-shrink-0">
              <span suppressHydrationWarning className="flex items-center justify-center">
                <IonIcon icon={mailOutline} className="text-2xl text-orange-500" />
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-[12px] font-bold text-muted-foreground uppercase tracking-wider">Email Us</span>
              <span className="text-[14px] font-black text-foreground truncate max-w-[180px]">abuscholarsprep@gmail.com</span>
            </div>
          </a>

        </div>

        {/* FREQUENTLY ASKED QUESTIONS */}
        <h2 className={sectionHeaderClass}>Frequently Asked Questions</h2>
        
        <div className="space-y-6">
          {FAQS.map((categoryGroup, index) => (
            <div key={index} className="space-y-3">
              <h3 className="text-[13px] font-black text-orange-500 uppercase tracking-wider px-2">{categoryGroup.category}</h3>
              
              <div className={cardClass}>
                {categoryGroup.questions.map((faq, qIndex) => {
                  const isOpen = openSection === faq.q;
                  return (
                    <div key={qIndex} className="border-b border-border/40 last:border-b-0 pb-4 last:pb-0 pt-4 first:pt-0">
                      <button 
                        onClick={() => toggleAccordion(faq.q)}
                        className="w-full flex items-center justify-between text-left gap-4 py-1 group"
                      >
                        <span className="text-[15px] font-bold text-foreground group-hover:text-orange-500 transition-colors">
                          {faq.q}
                        </span>
                        <span suppressHydrationWarning className={`text-muted-foreground transition-transform duration-200 flex-shrink-0 ${isOpen ? 'rotate-180 text-orange-500' : ''}`}>
                          <IonIcon icon={chevronDownOutline} className="text-lg" />
                        </span>
                      </button>
                      
                      {isOpen && (
                        <p className="text-[14px] text-muted-foreground mt-3 leading-relaxed animate-in fade-in duration-200 pr-4">
                          {faq.a}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* HELPFUL LINKS FOOTER */}
        <h2 className={sectionHeaderClass}>Other Resources</h2>
        <div className={cardClass}>
          <div className="flex flex-col divide-y divide-border/40">
            
            <button 
              onClick={() => router.push('/how-it-works')}
              className="flex items-center justify-between py-3.5 first:pt-0 last:pb-0 text-left hover:text-orange-500 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span suppressHydrationWarning className="text-muted-foreground"><IonIcon icon={bookOutline} className="text-xl" /></span>
                <span className="text-[15px] font-bold">How Vendi Works</span>
              </div>
              <span suppressHydrationWarning className="text-muted-foreground rotate-180"><IonIcon icon={chevronBackOutline} className="text-base" /></span>
            </button>

            <button 
              onClick={() => router.push('/safety')}
              className="flex items-center justify-between py-3.5 first:pt-0 last:pb-0 text-left hover:text-orange-500 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span suppressHydrationWarning className="text-muted-foreground"><IonIcon icon={shieldCheckmarkOutline} className="text-xl" /></span>
                <span className="text-[15px] font-bold">Safety Center</span>
              </div>
              <span suppressHydrationWarning className="text-muted-foreground rotate-180"><IonIcon icon={chevronBackOutline} className="text-base" /></span>
            </button>

            <button 
              onClick={() => router.push('/report')}
              className="flex items-center justify-between py-3.5 first:pt-0 last:pb-0 text-left hover:text-red-500 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span suppressHydrationWarning className="text-red-500"><IonIcon icon={flagOutline} className="text-xl" /></span>
                <span className="text-[15px] font-bold text-red-500">Report a User or Scam</span>
              </div>
              <span suppressHydrationWarning className="text-muted-foreground rotate-180"><IonIcon icon={chevronBackOutline} className="text-base" /></span>
            </button>

          </div>
        </div>

      </div>
    </div>
  );
}