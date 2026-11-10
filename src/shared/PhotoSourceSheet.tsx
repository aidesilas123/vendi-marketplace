// src/shared/PhotoSourceSheet.tsx
//
// Bottom sheet that asks where a photo should come from: the camera, or the
// gallery. Same sheet the profile edit page uses for the avatar, reused here
// (feed visual search) so the choice looks and behaves the same everywhere.
//
// Portaled to document.body (backdrop z-200, panel z-210) so it always sits
// above the bottom nav and any bar. The parent owns the open state and the
// two actions; the sheet only renders the choice and closes itself.

"use client";

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { IonIcon } from '@/shared/Icon/Icon';
import { cameraOutline, imageOutline } from 'ionicons/icons';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  /** User picked "Take Photo" — parent opens its camera input. */
  onTakePhoto: () => void;
  /** User picked "Choose from Gallery" — parent opens its gallery input. */
  onChooseGallery: () => void;
};

export function PhotoSourceSheet({ isOpen, onClose, onTakePhoto, onChooseGallery }: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!isOpen || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[200]">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="absolute bottom-0 left-0 right-0 z-[210] bg-background rounded-t-3xl p-4 pb-[max(1rem,var(--sab))]">
        <div className="max-w-xl mx-auto">
          <div className="w-12 h-1.5 bg-muted rounded-full mx-auto mb-4" />
          <button
            type="button"
            onClick={() => { onTakePhoto(); onClose(); }}
            className="w-full flex items-center gap-4 p-4 rounded-2xl active:bg-muted transition-colors text-left"
          >
            <span className="w-11 h-11 rounded-full bg-orange-500/10 flex items-center justify-center shrink-0">
              <IonIcon icon={cameraOutline} className="text-orange-500 text-xl" />
            </span>
            <span>
              <span className="block font-bold text-foreground">Take Photo</span>
              <span className="block text-xs text-muted-foreground">Use your camera</span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => { onChooseGallery(); onClose(); }}
            className="w-full flex items-center gap-4 p-4 rounded-2xl active:bg-muted transition-colors text-left"
          >
            <span className="w-11 h-11 rounded-full bg-orange-500/10 flex items-center justify-center shrink-0">
              <IonIcon icon={imageOutline} className="text-orange-500 text-xl" />
            </span>
            <span>
              <span className="block font-bold text-foreground">Choose from Gallery</span>
              <span className="block text-xs text-muted-foreground">Pick an existing photo</span>
            </span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full mt-2 py-3.5 rounded-full font-bold text-muted-foreground active:bg-muted transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
