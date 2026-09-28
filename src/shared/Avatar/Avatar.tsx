"use client";

import React, { useEffect, useRef, useState } from 'react';
import { Skeleton } from '@/shared/Skeleton/Skeleton';

interface AvatarProps {
  src?: string | null;
  name: string; // Used to generate initials if src is missing
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export const Avatar = ({ src, name, size = 'md' }: AvatarProps) => {
  const imgRef = useRef<HTMLImageElement>(null);
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');

  // Reset when the source changes, and catch images the browser already has
  // cached (their onLoad can fire before React attaches the handler).
  useEffect(() => {
    setStatus('loading');
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0) setStatus('loaded');
  }, [src]);

  // Extract initials (e.g., "Aide Silas" -> "AS")
  const getInitials = (name: string) => {
    const parts = name.split(' ');
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return name.substring(0, 2).toUpperCase();
  };

  const sizeClasses = {
    sm: "w-8 h-8 text-xs",
    md: "w-12 h-12 text-sm",
    lg: "w-16 h-16 text-xl",
    xl: "w-24 h-24 text-3xl"
  };

  if (src && status !== 'error') {
    return (
      <div className={`${sizeClasses[size]} relative rounded-full`}>
        {status === 'loading' && (
          <Skeleton className="absolute inset-0 w-full h-full rounded-full" />
        )}
        <img
          ref={imgRef}
          src={src}
          alt={name}
          decoding="async"
          onLoad={() => setStatus('loaded')}
          onError={() => setStatus('error')}
          className={`w-full h-full rounded-full object-cover shadow-sm border border-gray-100 dark:border-gray-800 transition-opacity duration-300 ${
            status === 'loaded' ? 'opacity-100' : 'opacity-0'
          }`}
        />
      </div>
    );
  }

  // Fallback if no image is provided (or it failed to load)
  return (
    <div className={`${sizeClasses[size]} rounded-full bg-orange-100 dark:bg-orange-500/20 text-orange-600 dark:text-orange-400 font-black flex items-center justify-center shadow-sm border border-orange-200 dark:border-orange-500/30`}>
      {getInitials(name)}
    </div>
  );
};