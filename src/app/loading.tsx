"use client";
import React from 'react';
import { IonIcon } from '@ionic/react';
import { syncOutline } from 'ionicons/icons';

export default function GlobalLoading() {
  return (
    // We use a high z-index and fixed position to intercept the screen completely
    <div className="fixed inset-0 z-[999] flex flex-col items-center justify-center bg-gray-50/80 dark:bg-[#0a1120]/80 backdrop-blur-md transition-opacity">
      <div className="bg-white dark:bg-[#0f172a] p-6 rounded-3xl shadow-xl flex flex-col items-center justify-center border border-gray-100 dark:border-gray-800">
        <IonIcon icon={syncOutline} className="text-4xl text-orange-500 animate-spin mb-3" />
        <p className="text-xs font-black text-gray-500 uppercase tracking-widest animate-pulse">Loading</p>
      </div>
    </div>
  );
}