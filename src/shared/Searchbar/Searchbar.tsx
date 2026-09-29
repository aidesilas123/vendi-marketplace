import React from 'react';
import IonIcon from '@/shared/Icon/Icon';
import { searchOutline, closeCircle } from 'ionicons/icons';

interface SearchbarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onClear?: () => void;
  size?: 'md' | 'sm'; // 'md' = original look, 'sm' = compact
}

export const Searchbar = ({ value, onChange, placeholder = "Search for items...", onClear, size = 'md' }: SearchbarProps) => {
  const isSm = size === 'sm';

  return (
    <div className="relative flex items-center w-full">
      <span
        suppressHydrationWarning
        className={`absolute text-muted-foreground pointer-events-none flex items-center justify-center ${
          isSm ? 'left-3.5 text-base' : 'left-4 text-xl'
        }`}
      >
        <IonIcon icon={searchOutline} />
      </span>

      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full bg-card text-foreground placeholder:text-muted-foreground border border-border rounded-full text-sm font-medium shadow-sm transition-all focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 ${
isSm
            ? 'h-9 py-0 pl-10 pr-10 !bg-white dark:!bg-[#1e293b] !text-gray-900 dark:!text-white placeholder:!text-gray-400 !border-gray-200 dark:!border-gray-700'
            : 'py-3.5 pl-12 pr-12'        }`}
      />

      {value && (
        <button
          onClick={() => {
            onChange('');
            if (onClear) onClear();
          }}
          className={`absolute text-muted-foreground/60 hover:text-foreground transition-colors flex items-center justify-center ${
            isSm ? 'right-3' : 'right-4'
          }`}
        >
          <span suppressHydrationWarning className="flex items-center justify-center">
            <IonIcon icon={closeCircle} className={isSm ? 'text-lg' : 'text-xl'} />
          </span>
        </button>
      )}
    </div>
  );
};