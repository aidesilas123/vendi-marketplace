"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Cropper from 'react-easy-crop';
import 'react-easy-crop/react-easy-crop.css';
import IonIcon from '@/shared/Icon/Icon';
import { PullSpinner } from '@/shared/Loaders/PullSpinner';
import { closeOutline, cropOutline, sendOutline, imageOutline } from 'ionicons/icons';
import { hapticImpact, ImpactStyle } from '@/shared/haptics';

type Props = {
  /** Data URL (camera capture) or displayable URL (gallery pick). */
  src: string;
  onClose: () => void;
  /** Always called with a JPEG data URL (cropped or as-is) and optional caption. */
  onSave: (jpegDataUrl: string, caption?: string) => void;
  partnerName?: string;
};

const loadImage = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });

/** Remote/blob/file URLs → data URL (also de-taints canvas for crop). */
async function urlToDataUrl(url: string): Promise<string> {
  if (url.startsWith('data:')) return url;
  const blob = await (await fetch(url)).blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function getCroppedImg(
  imageSrc: string,
  pixelCrop: { x: number; y: number; width: number; height: number }
): Promise<string> {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(pixelCrop.width);
  canvas.height = Math.round(pixelCrop.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');
  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    canvas.width,
    canvas.height
  );
  return canvas.toDataURL('image/jpeg', 0.92);
}

/**
 * Photo preview after capture or gallery pick with WhatsApp/Telegram style
 * expandable caption box and orange send button.
 */
export function PhotoPreview({ src, onClose, onSave, partnerName }: Props) {
  const [imgSrc, setImgSrc] = useState<string>(src);
  const [preparing, setPreparing] = useState(!src.startsWith('data:'));
  const [cropping, setCropping] = useState(false);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedPixels, setCroppedPixels] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [caption, setCaption] = useState('');
  const captionRef = useRef<HTMLTextAreaElement>(null);

  // Non-data URLs need pre-conversion so the crop canvas isn't tainted
  useEffect(() => {
    let live = true;
    if (src.startsWith('data:')) {
      setImgSrc(src);
      setPreparing(false);
      return;
    }
    setPreparing(true);
    urlToDataUrl(src)
      .then((dataUrl) => {
        if (live) {
          setImgSrc(dataUrl);
          setPreparing(false);
        }
      })
      .catch(() => {
        if (live) setPreparing(false);
      });
    return () => {
      live = false;
    };
  }, [src]);

  const onCropComplete = useCallback((_: any, pixels: any) => {
    setCroppedPixels(pixels);
  }, []);

  const handleSave = async () => {
    if (saving || preparing) return;
    setSaving(true);
    hapticImpact(ImpactStyle.Light);
    try {
      const out =
        cropping && croppedPixels ? await getCroppedImg(imgSrc, croppedPixels) : imgSrc;
      onSave(out, caption.trim());
    } catch {
      onSave(imgSrc, caption.trim());
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1002] bg-black flex flex-col">
      {/* top bar: close | crop toggle */}
      <div
        className="flex items-center justify-between px-4 pb-2 z-10"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
      >
        <button
          onClick={onClose}
          type="button"
          aria-label="Close preview"
          className="!w-10 !h-10 !min-w-[40px] !min-h-[40px] !aspect-square !rounded-full bg-black/50 text-white flex items-center justify-center shrink-0 active:scale-95 transition-transform"
        >
          <IonIcon icon={closeOutline} className="text-2xl pointer-events-none" />
        </button>
        <button
          onClick={() => setCropping((c) => !c)}
          type="button"
          className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-bold active:scale-95 transition-all ${
            cropping
              ? 'bg-orange-500 text-white shadow-md shadow-orange-500/30'
              : 'bg-white/20 text-white backdrop-blur-md'
          }`}
        >
          <IonIcon icon={cropOutline} className="text-lg" />
          {cropping ? 'Done' : 'Crop'}
        </button>
      </div>

      {/* image / cropper */}
      <div className="flex-1 relative overflow-hidden bg-black">
        {preparing ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <PullSpinner spinning size={32} />
            <p className="text-sm font-medium text-white/70">Preparing photo…</p>
          </div>
        ) : cropping ? (
          <Cropper
            image={imgSrc}
            crop={crop}
            zoom={zoom}
            aspect={4 / 3}
            onCropChange={setCrop}
            onCropComplete={onCropComplete}
            onZoomChange={setZoom}
            objectFit="contain"
          />
        ) : (
          <img src={imgSrc} alt="Preview" className="w-full h-full object-contain" />
        )}
      </div>

      {/* bottom: expandable caption input + orange send button */}
      <div
        className="px-3 pt-2 bg-black/80 backdrop-blur-md z-10 flex flex-col gap-1.5"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      >
        {partnerName && (
          <div className="px-2">
            <span className="text-[11px] font-semibold text-white/60 bg-white/10 px-2.5 py-0.5 rounded-full">
              @{partnerName}
            </span>
          </div>
        )}
        <div className="flex items-end gap-2">
          <div className="flex-1 bg-white/15 border border-white/20 rounded-[22px] min-h-[44px] flex items-center px-3 py-1.5 focus-within:border-orange-500 transition-colors">
            <IonIcon icon={imageOutline} className="text-xl text-white/70 mr-2 shrink-0 pointer-events-none" />
            <textarea
              ref={captionRef}
              value={caption}
              onChange={(e) => {
                setCaption(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = `${Math.min(e.target.scrollHeight, 100)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSave();
                }
              }}
              placeholder="Add a caption…"
              rows={1}
              className="flex-1 bg-transparent border-none outline-none text-white placeholder-white/50 text-[15px] resize-none max-h-24 leading-snug py-0.5 scrollbar-hide"
            />
          </div>
          <button
            onClick={handleSave}
            disabled={saving || preparing}
            type="button"
            aria-label="Send photo"
            className="!w-12 !h-12 !min-w-[48px] !min-h-[48px] !aspect-square !rounded-full !bg-orange-500 text-white flex items-center justify-center shrink-0 shadow-lg shadow-orange-500/30 active:scale-90 transition-transform disabled:opacity-50"
          >
            {saving ? (
              <PullSpinner spinning size={20} />
            ) : (
              <IonIcon icon={sendOutline} className="text-xl ml-0.5 pointer-events-none" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default PhotoPreview;
