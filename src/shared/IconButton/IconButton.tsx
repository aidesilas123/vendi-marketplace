"use client";

import React from 'react';
import { IonIcon } from '@ionic/react';

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
}

export const IconButton: React.FC<IconButtonProps> = ({ 
  icon, 
  variant = 'ghost', 
  size = 'md', 
  className = '', 
  ...props 
}) => {
  // We bake the ! overrides here ONCE, so you never type them again in your pages.
  const baseStyles = "!flex !items-center !justify-center !rounded-full transition-all active:scale-95 flex-shrink-0";
  
  const sizes = {
    sm: "!w-8 !h-8 !min-w-[32px] !min-h-[32px] text-lg",
    md: "!w-10 !h-10 !min-w-[40px] !min-h-[40px] text-2xl",
    lg: "!w-12 !h-12 !min-w-[48px] !min-h-[48px] text-2xl", // Fixed for Android keyboards
  };

  const variants = {
    primary: "!bg-orange-500 text-white shadow-lg",
    secondary: "!bg-gray-100 dark:!bg-gray-800 text-gray-600 dark:text-gray-300",
    ghost: "bg-transparent text-gray-500 dark:text-gray-400 hover:!bg-black/5 dark:hover:!bg-white/10",
    danger: "!bg-red-50 text-red-500 dark:!bg-red-900/20",
  };

  return (
    <button 
      className={`${baseStyles} ${sizes[size]} ${variants[variant]} ${className}`}
      {...props}
    >
      <IonIcon icon={icon} />
    </button>
  );
};