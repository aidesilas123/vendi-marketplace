import React from 'react';

interface SkeletonProps {
  className?: string;
}

export const Skeleton = ({ className = "" }: SkeletonProps) => {
  // Check if a specific background color is being passed via className
  const hasCustomBg = className.includes('bg-');
  
  // Use the high-contrast default ONLY if no custom background is provided
  const defaultBg = hasCustomBg ? '' : 'bg-gray-300 dark:bg-gray-700';

  return (
    <div 
      className={`${defaultBg} animate-pulse ${className}`} 
    />
  );
};