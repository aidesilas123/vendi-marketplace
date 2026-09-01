import React from 'react';
import { IonIcon } from '@ionic/react';
import { checkmarkCircle } from 'ionicons/icons';

interface BadgeProps {
  isVerified: boolean;
  className?: string;
}

export const Badge = ({ isVerified, className = "" }: BadgeProps) => {
  if (!isVerified) return null; // Don't render anything if not verified

  return (
    <span className={`text-[#1DA1F2] flex items-center justify-center bg-white dark:bg-[#0f172a] rounded-full ${className}`}>
      <IonIcon icon={checkmarkCircle} className="text-2xl" />
    </span>
  );
};