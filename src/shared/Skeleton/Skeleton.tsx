import React from 'react';

interface SkeletonProps {
  className?: string; // Allows you to pass specific widths, heights, and border-radius
}

export const Skeleton = ({ className = "" }: SkeletonProps) => {
  return (
    <div 
      className={`bg-gray-200 dark:bg-gray-800 animate-pulse ${className}`} 
    />
  );
};