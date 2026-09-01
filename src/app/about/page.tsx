"use client";

import React from 'react';
import { useRouter } from 'next/navigation';
import IonIcon from '@/shared/Icon/Icon';
import { 
  chevronBackOutline, 
  informationCircleOutline, 
  schoolOutline, 
  codeWorkingOutline, 
  rocketOutline,
  logoGithub
} from 'ionicons/icons';

export default function AboutPage() {
  const router = useRouter();

  const sectionHeaderClass = "text-[12px] font-black text-muted-foreground uppercase tracking-widest px-2 mb-4 mt-10";
  const cardClass = "bg-card rounded-[1.5rem] shadow-sm p-6 space-y-4";

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
            <h1 className="text-xl font-bold leading-tight">About Vendi</h1>
            <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-widest mt-0.5">Version 1.0.0</p>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 pb-24">
        
        {/* HERO / LOGO SECTION */}
        <div className="flex flex-col items-center text-center mb-10 mt-4 px-2">
          <div className="w-24 h-24 rounded-3xl bg-orange-500 flex items-center justify-center mb-5 shadow-lg shadow-orange-500/30">
            <h1 className="text-4xl font-black text-white tracking-tighter">V</h1>
          </div>
          <h2 className="text-2xl font-black text-foreground mb-2 leading-tight">
            Vendi Marketplace
          </h2>
          <p className="text-[15px] text-muted-foreground leading-relaxed max-w-[280px]">
            The secure, student-first trading platform designed for the modern campus.
          </p>
        </div>

        {/* ORIGIN STORY */}
        <h3 className={sectionHeaderClass}>Our Origin</h3>
        <div className={cardClass}>
          <div className="flex items-start gap-4">
            <span suppressHydrationWarning className="text-orange-500 text-2xl flex-shrink-0 mt-0.5">
              <IonIcon icon={schoolOutline} />
            </span>
            <div className="flex flex-col">
              <h4 className="text-[16px] font-black text-foreground mb-2">From the Developers of Scholars Prep</h4>
              <p className="text-[14px] text-muted-foreground leading-relaxed">
                Vendi is proudly built by <strong className="text-foreground">Aide Tech</strong>. After developing the Scholars Prep CBT platform to help Ahmadu Bello University students achieve academic excellence, we realized that students faced another major challenge: campus commerce.
              </p>
              <p className="text-[14px] text-muted-foreground leading-relaxed mt-3">
                Students were frequently getting scammed on WhatsApp groups or dealing with unreliable buyers. We built Vendi to bring the same level of innovation and reliability from our educational tools directly into campus trading.
              </p>
            </div>
          </div>
        </div>

        {/* AIDE TECH MISSION */}
        <h3 className={sectionHeaderClass}>The Aide Tech Mission</h3>
        <div className={cardClass}>
          <div className="flex items-start gap-4">
            <span suppressHydrationWarning className="text-blue-500 text-2xl flex-shrink-0 mt-0.5">
              <IonIcon icon={rocketOutline} />
            </span>
            <div className="flex flex-col">
              <p className="text-[14px] text-muted-foreground leading-relaxed">
                At Aide Tech, we are dedicated to building software that solves genuine, everyday problems for students. Whether it is acing examinations through intelligent preparation or buying a textbook safely without fear of fraud, our ecosystem is designed to empower the student community.
              </p>
            </div>
          </div>
        </div>

        {/* TECH STACK & SYSTEM */}
        <h3 className={sectionHeaderClass}>System Information</h3>
        <div className="bg-card rounded-[1.5rem] shadow-sm p-2 flex flex-col divide-y divide-border/40">
          
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <span suppressHydrationWarning className="text-muted-foreground flex items-center justify-center">
                <IonIcon icon={codeWorkingOutline} className="text-xl" />
              </span>
              <span className="text-[15px] font-bold text-foreground">Developed By</span>
            </div>
            <span className="text-[14px] font-medium text-muted-foreground">Aide Tech</span>
          </div>

          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <span suppressHydrationWarning className="text-muted-foreground flex items-center justify-center">
                <IonIcon icon={informationCircleOutline} className="text-xl" />
              </span>
              <span className="text-[15px] font-bold text-foreground">App Version</span>
            </div>
            <span className="text-[14px] font-medium text-muted-foreground">1.0.0 (Production)</span>
          </div>

        </div>

      </div>
    </div>
  );
}