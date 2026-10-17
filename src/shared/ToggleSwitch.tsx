"use client";

import React from 'react';

interface ToggleSwitchProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  /** Accessible label describing what the toggle controls (e.g. "Dark mode") */
  ariaLabel?: string;
}

export const ToggleSwitch = ({ enabled, onChange, ariaLabel }: ToggleSwitchProps) => {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={ariaLabel}
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex h-7 w-12 flex-shrink-0 cursor-pointer !rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 p-0.5 ${
        enabled ? 'bg-orange-500' : 'bg-gray-300 dark:bg-gray-700'
      }`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block h-5 w-5 transform !rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
          enabled ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
};