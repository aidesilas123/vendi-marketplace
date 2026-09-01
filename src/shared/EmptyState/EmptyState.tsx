import React from 'react';
import { IonIcon } from '@ionic/react';

interface EmptyStateProps {
  icon: string; // Ionic icon name
  title: string;
  description: string;
  actionText?: string;
  onAction?: () => void;
}

export const EmptyState = ({ icon, title, description, actionText, onAction }: EmptyStateProps) => {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center animate-in fade-in zoom-in-95 duration-300">
      <div className="w-20 h-20 bg-gray-50 dark:bg-[#1e293b] rounded-full flex items-center justify-center mb-6 shadow-inner">
        <IonIcon icon={icon} className="text-4xl text-gray-400 dark:text-gray-500" />
      </div>
      <h3 className="text-xl font-black text-gray-900 dark:text-white mb-2">{title}</h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 max-w-xs mb-6 leading-relaxed">
        {description}
      </p>
      
      {actionText && onAction && (
        <button 
          onClick={onAction}
          className="bg-orange-500 text-white px-6 py-3 rounded-full font-bold shadow-md hover:bg-orange-600 transition-colors"
        >
          {actionText}
        </button>
      )}
    </div>
  );
};