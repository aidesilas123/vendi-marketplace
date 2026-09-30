"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';

// Plain inline SVGs on purpose: Ionic's <ion-icon> web component adds attributes in the
// browser before React hydrates, which causes a hydration mismatch when it renders on load.
const ChevronIcon = ({ className = '' }: { className?: string }) => (
  <svg
    className={className}
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const CheckIcon = ({ className = '' }: { className?: string }) => (
  <svg
    className={className}
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export type DropdownOption = string | { value: string; label: string };

interface DropdownProps {
  value: string;
  onChange: (value: string) => void;
  options: DropdownOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}

const MENU_MAX_HEIGHT = 224; // px, matches max-h-56
const ITEM_HEIGHT = 36;      // px, used only to decide whether to open upward

/**
 * Shared dropdown. Transparent trigger with a faded orange border that turns
 * bright orange when open/focused, and a compact popover list. Opens upward
 * automatically when there isn't enough room below.
 */
export const Dropdown = ({
  value,
  onChange,
  options,
  placeholder = 'Select',
  disabled = false,
  className = '',
  ariaLabel
}: DropdownProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const items = useMemo(
    () => options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o)),
    [options]
  );
  const selectedIndex = items.findIndex((i) => i.value === value);
  const selected = selectedIndex >= 0 ? items[selectedIndex] : null;

  const close = () => setIsOpen(false);

  const open = () => {
    if (disabled) return;
    if (rootRef.current) {
      const rect = rootRef.current.getBoundingClientRect();
      const needed = Math.min(MENU_MAX_HEIGHT, items.length * ITEM_HEIGHT + 8);
      const spaceBelow = window.innerHeight - rect.bottom - 12;
      setOpenUp(spaceBelow < needed && rect.top > spaceBelow);
    }
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setIsOpen(true);
  };

  const select = (v: string) => {
    onChange(v);
    close();
  };

  // Close on outside tap/click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [isOpen]);

  // Keep the highlighted row visible inside the list (without moving the page)
  useEffect(() => {
    if (!isOpen || activeIndex < 0) return;
    const list = listRef.current;
    const el = list?.children[activeIndex] as HTMLElement | undefined;
    if (!list || !el) return;
    const top = el.offsetTop;
    const bottom = top + el.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }, [isOpen, activeIndex]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        open();
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0) select(items[activeIndex].value);
    } else if (e.key === 'Tab') {
      close();
    }
  };

  return (
    // data-no-swipe: tells the dashboard's swipe-to-change-tab handler to ignore gestures here
    <div ref={rootRef} className={`relative ${className}`} data-no-swipe onKeyDown={onKeyDown}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (isOpen ? close() : open())}
        className={`w-full flex items-center justify-between gap-2 text-left !bg-transparent !border ${
          isOpen ? '!border-orange-500' : '!border-orange-500/30'
        } focus:!border-orange-500 !px-4 !py-3 !text-sm !font-normal !rounded-2xl outline-none transition-colors disabled:opacity-60 ${
          selected
            ? '!text-gray-900 dark:!text-white'
            : '!text-gray-400 dark:!text-gray-500'
        }`}
      >
        <span className="truncate">{selected ? selected.label : placeholder}</span>
        <ChevronIcon
          className={`flex-shrink-0 text-orange-500 transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {isOpen && (
        <ul
          ref={listRef}
          role="listbox"
          className={`absolute left-0 right-0 z-50 max-h-56 overflow-y-auto p-1 rounded-2xl border border-orange-500/40 bg-gray-50 dark:bg-[#0a1120] animate-in fade-in zoom-in-95 duration-150 ${
            openUp ? 'bottom-full mb-1.5 origin-bottom' : 'top-full mt-1.5 origin-top'
          }`}
        >
          {items.map((item, i) => {
            const isSelected = item.value === value;
            const isActive = i === activeIndex;
            return (
              <li
                key={item.value}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => select(item.value)}
                className={`flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-xl cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-orange-500/15 text-orange-600 dark:text-orange-400 font-bold'
                    : isActive
                    ? 'bg-orange-500/10 text-gray-900 dark:text-white'
                    : 'text-gray-700 dark:text-gray-200'
                }`}
              >
                <span className="truncate">{item.label}</span>
                {isSelected && <CheckIcon className="flex-shrink-0" />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};