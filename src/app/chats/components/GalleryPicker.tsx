"use client";

import React, { useEffect, useState } from 'react';
import IonIcon from '@/shared/Icon/Icon';
import { PullSpinner } from '@/shared/Loaders/PullSpinner';
import { closeOutline, imageOutline } from 'ionicons/icons';

type Asset = { id: string; thumb: string };

type Props = {
  /** Called with a displayable URL of the full-size photo. */
  onSelect: (fullUrl: string) => void;
  onClose: () => void;
};

/**
 * In-app gallery grid — pictures only, no videos or files. On native it
 * reads the photo library (@capgo/capacitor-photo-library); on web (or if
 * the plugin is missing) it falls back to the system file picker.
 */
export function GalleryPicker({ onSelect, onClose }: Props) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { PhotoLibrary } = await import('@capgo/capacitor-photo-library');
        const { state } = await PhotoLibrary.requestAuthorization();
        if (cancelled) return;
        if (state !== 'authorized' && state !== 'limited') {
          setDenied(true);
          setLoading(false);
          return;
        }
        const { assets: lib } = await PhotoLibrary.getLibrary({
          limit: 120,
          offset: 0,
          includeImages: true,
          includeVideos: false,
          thumbnailWidth: 300,
          thumbnailHeight: 300,
        });
        if (cancelled) return;
        setAssets(
          lib
            .filter((a) => a.type === 'image' && a.thumbnail?.webPath)
            .map((a) => ({ id: a.id, thumb: a.thumbnail!.webPath }))
        );
        setLoading(false);
      } catch {
        // Web / no plugin: fall back to the system picker (pictures only).
        if (!cancelled) openSystemPicker();
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openSystemPicker = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.position = 'fixed';
    input.style.top = '-9999px';
    input.style.left = '-9999px';
    document.body.appendChild(input);
    const cleanup = () => {
      if (input.parentNode) input.parentNode.removeChild(input);
    };
    input.onchange = () => {
      const file = input.files?.[0];
      cleanup();
      if (file) onSelect(URL.createObjectURL(file));
      else onClose();
    };
    window.addEventListener('focus', cleanup, { once: true });
    setLoading(false);
    input.click();
  };

  const selectAsset = async (id: string) => {
    try {
      const { PhotoLibrary } = await import('@capgo/capacitor-photo-library');
      const file = await PhotoLibrary.getPhotoUrl({ id });
      onSelect(file.webPath);
    } catch {
      onClose();
    }
  };

  // System picker is open (web fallback) — nothing to render.
  if (!loading && assets.length === 0 && !denied) return null;

  return (
    <div className="fixed inset-0 z-[1002] bg-white dark:bg-[#0b1120] flex flex-col shadow-2xl overflow-hidden">
      <div className="sticky top-0 z-20 flex items-center gap-3 px-4 pb-3 pt-safe bg-white dark:bg-[#0b1120] border-b border-gray-100 dark:border-gray-800 shadow-sm">
        <button
          onClick={onClose}
          type="button"
          aria-label="Close gallery"
          className="!w-10 !h-10 !min-w-[40px] !min-h-[40px] !aspect-square !rounded-full bg-gray-100 dark:bg-white/10 flex items-center justify-center shrink-0 active:scale-95 transition-transform"
        >
          <IonIcon icon={closeOutline} className="text-2xl pointer-events-none" />
        </button>
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">Recents</h2>
      </div>

      {loading ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <PullSpinner spinning size={32} />
          <p className="text-sm font-medium text-gray-400">Loading photos…</p>
        </div>
      ) : denied ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-8 text-center">
          <IonIcon icon={imageOutline} className="text-4xl text-gray-300" />
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
            Photo access is needed to show your gallery.
          </p>
          <button
            onClick={onClose}
            className="px-6 py-2.5 rounded-full bg-orange-500 text-white text-sm font-bold active:scale-95 transition-transform"
          >
            Close
          </button>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-4 gap-[2px] p-[2px]">
            {assets.map((a) => (
              <button
                key={a.id}
                onClick={() => selectAsset(a.id)}
                className="aspect-square overflow-hidden bg-gray-100 dark:bg-white/5 active:opacity-80 transition-opacity"
              >
                <img src={a.thumb} alt="" loading="lazy" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
          {assets.length === 0 && (
            <p className="text-center text-sm text-gray-400 mt-10">No photos found.</p>
          )}
        </div>
      )}
    </div>
  );
}

export default GalleryPicker;
