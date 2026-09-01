import React from 'react';
import { IonIcon } from '@ionic/react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: string; // Optional Ionic icon for the left side
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, icon, className = "", ...props }, ref) => {
    return (
      <div className="flex flex-col w-full">
        {label && (
          <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 ml-1">
            {label}
          </label>
        )}
        <div className="relative flex items-center">
          {icon && (
            <div className="absolute left-4 text-gray-400 dark:text-gray-500">
              <IonIcon icon={icon} className="text-xl" />
            </div>
          )}
          <input
            ref={ref}
            className={`
              w-full bg-gray-50 dark:bg-[#0f172a] text-gray-900 dark:text-white
              border ${error ? 'border-red-500 focus:ring-red-500/50' : 'border-gray-200 dark:border-gray-800 focus:border-orange-500 focus:ring-orange-500/30'}
              rounded-2xl px-4 py-3.5 text-sm transition-all focus:outline-none focus:ring-4
              ${icon ? 'pl-11' : ''}
              ${className}
            `}
            {...props}
          />
        </div>
        {error && (
          <span className="text-xs text-red-500 font-bold mt-1.5 ml-1 animate-in fade-in">
            {error}
          </span>
        )}
      </div>
    );
  }
);
Input.displayName = 'Input';