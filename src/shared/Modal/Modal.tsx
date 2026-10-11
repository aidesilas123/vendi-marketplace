"use client";

import React, { useEffect } from 'react';
import { IonIcon } from '@ionic/react';
import { closeOutline } from 'ionicons/icons';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  maxWidth?: string;
}

export const Modal = ({ 
  isOpen, 
  onClose, 
  title, 
  children, 
  maxWidth = "max-w-md" 
}: ModalProps) => {
  // Prevent scrolling on the body and listen for Escape key when the modal is open
  useEffect(() => {
    if (!isOpen) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      {/* Blurred Backdrop */}
      <div 
        className="absolute inset-0 bg-[#0f172a]/60 dark:bg-black/80 backdrop-blur-sm transition-opacity"
        onClick={onClose} 
      />

      {/* Modal Content */}
      <div 
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'modal-title' : undefined}
        className={`relative w-full ${maxWidth} bg-white dark:bg-[#0f172a] rounded-3xl shadow-2xl border border-gray-100 dark:border-gray-800 animate-in fade-in zoom-in-95 duration-200 overflow-hidden flex flex-col max-h-[90vh]`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          {title && (
            <h3 id="modal-title" className="text-lg font-black text-[#0f172a] dark:text-white">
              {title}
            </h3>
          )}
          {/* UPDATED: Accessible Close Button with recommended touch target */}
          <button 
            type="button"
            aria-label="Close modal"
            onClick={onClose}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-transparent text-gray-500 hover:text-orange-500 hover:bg-black/5 dark:hover:bg-white/10 active:scale-95 transition-all ml-auto"
          >
            <IonIcon icon={closeOutline} className="text-2xl" />
          </button>
        </div>

        {/* Body (Scrollable if content is too long) */}
        <div className="p-6 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
};