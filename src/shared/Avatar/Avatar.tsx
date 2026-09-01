import React from 'react';

interface AvatarProps {
  src?: string | null;
  name: string; // Used to generate initials if src is missing
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export const Avatar = ({ src, name, size = 'md' }: AvatarProps) => {
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

  if (src) {
    return (
      <img 
        src={src} 
        alt={name} 
        className={`${sizeClasses[size]} rounded-full object-cover shadow-sm border border-gray-100 dark:border-gray-800`} 
      />
    );
  }

  // Fallback if no image is provided
  return (
    <div className={`${sizeClasses[size]} rounded-full bg-orange-100 dark:bg-orange-500/20 text-orange-600 dark:text-orange-400 font-black flex items-center justify-center shadow-sm border border-orange-200 dark:border-orange-500/30`}>
      {getInitials(name)}
    </div>
  );
};