import React from 'react';
import IonIcon from '@/shared/Icon/Icon';
import { searchOutline, closeCircle } from 'ionicons/icons';

interface SearchbarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onClear?: () => void;
}

export const Searchbar = ({ value, onChange, placeholder = "Search for items...", onClear }: SearchbarProps) => {
  return (
    <div className="relative flex items-center w-full">
      <span suppressHydrationWarning className="absolute left-4 text-xl text-muted-foreground pointer-events-none flex items-center justify-center">
        <IonIcon icon={searchOutline} />
      </span>
      
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-card text-foreground placeholder:text-muted-foreground border border-border rounded-full py-3.5 pl-12 pr-12 text-sm font-medium shadow-sm transition-all focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
      />

      {value && (
        <button 
          onClick={() => {
            onChange('');
            if (onClear) onClear();
          }}
          className="absolute right-4 text-muted-foreground/60 hover:text-foreground transition-colors flex items-center justify-center"
        >
          <span suppressHydrationWarning className="flex items-center justify-center">
            <IonIcon icon={closeCircle} className="text-xl" />
          </span>
        </button>
      )}
    </div>
  );
};