// src/app/chats/components/CameraCapture.tsx
"use client";

import React, { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Camera } from '@capacitor/camera';
import IonIcon from '@/shared/Icon/Icon';
import { closeOutline, cameraReverseOutline, imageOutline } from 'ionicons/icons';

type Props = {
  /** Called with a JPEG data URL of the captured frame. */
  onCapture: (dataUrl: string) => void;
  onClose: () => void;
  onOpenGallery: () => void;
};

/**
 * In-app camera: live preview, gallery shortcut, capture, switch camera.
 * No video mode, no filters — just point and shoot. Uses getUserMedia so
 * the whole UI stays in HTML (app theme), with a native-camera fallback.
 */
export function CameraCapture({ onCapture, onClose, onOpenGallery }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<'user' | 'environment'>('environment');
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const start = async () => {
      setError(null);
      setReady(false);
      try {
        if (Capacitor.isNativePlatform()) {
          try {
            const perm = await Camera.checkPermissions();
            if (perm.camera !== 'granted') {
              const req = await Camera.requestPermissions();
              if (req.camera !== 'granted') {
                if (!cancelled) setError('Camera permission is needed to take photos. Enable it in Settings.');
                return;
              }
            }
          } catch {
            /* permission API unavailable — let getUserMedia prompt */
          }
        }
        if (!navigator.mediaDevices?.getUserMedia) {
          if (!cancelled) setError('Camera is not supported on this device.');
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          try {
            await video.play();
          } catch {
            /* play() can reject if interrupted — preview still works */
          }
          if (!cancelled) setReady(true);
        }
      } catch {
        if (!cancelled) setError('Could not start the camera. Check permissions and try again.');
      }
    };

    start();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [facing]);

  const capture = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Mirror the front-camera capture so it matches the preview.
    if (facing === 'user') {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0);
    onCapture(canvas.toDataURL('image/jpeg', 0.92));
  };

  return (
    <div className="fixed inset-0 z-[1001] bg-black flex flex-col">
      {/* top bar */}
      <div className="flex items-center justify-end px-4 pb-2 relative z-10" style={{ paddingTop: 'max(0.75rem, var(--sat))' }}>
        <button
          onClick={onClose}
          type="button"
          aria-label="Close camera"
          className="!w-10 !h-10 !min-w-[40px] !min-h-[40px] !aspect-square !rounded-full bg-black/50 text-white flex items-center justify-center shrink-0 active:scale-95 transition-transform"
        >
          <IonIcon icon={closeOutline} className="text-2xl pointer-events-none" />
        </button>
      </div>

      {/* live preview */}
      <div className="flex-1 relative overflow-hidden bg-black">
        {error ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 text-center">
            <p className="text-white/80 text-sm font-medium">{error}</p>
            <button
              onClick={onClose}
              type="button"
              className="px-6 py-2.5 !rounded-full bg-orange-500 text-white text-sm font-bold active:scale-95 transition-transform"
            >
              Close
            </button>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${ready ? 'opacity-100' : 'opacity-0 pointer-events-none'} ${facing === 'user' ? '-scale-x-100' : ''}`}
            />
            {!ready && (
              <div className="absolute inset-0 z-10 bg-black flex flex-col items-center justify-center gap-3">
                <div className="w-10 h-10 rounded-full border-[3px] border-white/20 border-t-orange-500 animate-spin" />
                <span className="text-white/60 text-xs font-medium">Starting camera...</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* bottom controls: gallery | capture | switch camera */}
      <div className="flex items-center justify-around px-10 pt-4 bg-black" style={{ paddingBottom: 'max(1.5rem, var(--sab))' }}>
        <button
          onClick={onOpenGallery}
          type="button"
          aria-label="Open gallery"
          className="!w-12 !h-12 !min-w-[48px] !min-h-[48px] !aspect-square !rounded-full overflow-hidden bg-white/10 border border-white/20 flex items-center justify-center shrink-0 active:scale-95 transition-transform"
        >
          <IonIcon icon={imageOutline} className="text-2xl text-white pointer-events-none" />
        </button>
        <button
          onClick={capture}
          disabled={!ready}
          type="button"
          aria-label="Capture photo"
          className="!w-[72px] !h-[72px] !min-w-[72px] !min-h-[72px] !aspect-square !rounded-full border-4 border-white bg-white/20 flex items-center justify-center shrink-0 !p-0 active:scale-95 transition-transform disabled:opacity-40"
        >
          <span className="!w-14 !h-14 !min-w-[56px] !min-h-[56px] !aspect-square !rounded-full bg-white block shrink-0 pointer-events-none" />
        </button>
        <button
          onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))}
          type="button"
          aria-label="Switch camera"
          className="!w-12 !h-12 !min-w-[48px] !min-h-[48px] !aspect-square !rounded-full bg-white/10 border border-white/20 text-white flex items-center justify-center shrink-0 active:scale-95 transition-transform"
        >
          <IonIcon icon={cameraReverseOutline} className="text-2xl pointer-events-none" />
        </button>
      </div>
    </div>
  );
}

export default CameraCapture;
