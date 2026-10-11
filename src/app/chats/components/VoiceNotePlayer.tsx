"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import IonIcon from '@/shared/Icon/Icon';
import { playOutline, pauseOutline, downloadOutline } from 'ionicons/icons';
import { hapticImpact, ImpactStyle } from '@/shared/haptics';

interface VoiceNotePlayerProps {
  id: string;
  url: string;
  duration?: number;
  waveform?: number[];
  isMe: boolean;
  activePlayingId: string | null;
  onPlayRequest: (id: string, url: string) => void;
  onPauseRequest: (id: string) => void;
  onSeekRequest: (id: string, percent: number) => void;
  currentTime: number;
  isPlaying: boolean;
  isUploading?: boolean;
  uploadProgress?: number;
}

const formatDuration = (sec: number) => {
  if (!isFinite(sec) || isNaN(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
};

export const VoiceNotePlayer: React.FC<VoiceNotePlayerProps> = ({
  id,
  url,
  duration = 0,
  waveform,
  isMe,
  activePlayingId,
  onPlayRequest,
  onPauseRequest,
  onSeekRequest,
  currentTime,
  isPlaying,
  isUploading,
  uploadProgress = 0,
}) => {
  const isThisPlaying = activePlayingId === id && isPlaying;
  const [downloaded, setDownloaded] = useState<boolean>(() => {
    // Blob/data URIs or local uploads are already downloaded
    return url.startsWith('data:') || url.startsWith('blob:') || isMe;
  });
  const [isBuffering, setIsBuffering] = useState(false);
  const waveformRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  // Generate a consistent pseudo-random waveform if none is provided
  const bars = waveform && waveform.length > 0 ? waveform : React.useMemo(() => {
    const list: number[] = [];
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = (hash << 5) - hash + id.charCodeAt(i);
    for (let i = 0; i < 28; i++) {
      const v = Math.abs(Math.sin(hash + i * 1.6)) * 80 + 20;
      list.push(Math.round(v));
    }
    return list;
  }, [id]);

  const effectiveDuration = duration > 0 ? duration : 1;
  const progress = isThisPlaying && effectiveDuration > 0
    ? Math.min(1, Math.max(0, currentTime / effectiveDuration))
    : 0;

  const displayTime = isThisPlaying ? currentTime : duration;

  const handleToggle = () => {
    hapticImpact(ImpactStyle.Light);
    if (!downloaded) {
      setIsBuffering(true);
      // Simulate/trigger caching then start playback
      setTimeout(() => {
        setDownloaded(true);
        setIsBuffering(false);
        onPlayRequest(id, url);
      }, 350);
      return;
    }

    if (isThisPlaying) {
      onPauseRequest(id);
    } else {
      onPlayRequest(id, url);
    }
  };

  const handleSeekFromEvent = (e: React.PointerEvent<HTMLDivElement> | PointerEvent) => {
    if (!waveformRef.current) return;
    const rect = waveformRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = Math.min(1, Math.max(0, x / rect.width));
    onSeekRequest(id, percent);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    isDraggingRef.current = true;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    handleSeekFromEvent(e);
    hapticImpact(ImpactStyle.Light);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    e.stopPropagation();
    handleSeekFromEvent(e);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    e.stopPropagation();
    isDraggingRef.current = false;
  };

  return (
    <div className="flex items-center gap-2.5 py-1 min-w-[210px] max-w-[280px]">
      {/* Play / Pause / Download / Loading button */}
      <div className="relative shrink-0 flex items-center justify-center">
        {isUploading ? (
          <div className="relative w-10 h-10 flex items-center justify-center">
            <svg className="w-10 h-10 -rotate-90" viewBox="0 0 36 36">
              <circle
                cx="18"
                cy="18"
                r="15"
                fill="none"
                className="stroke-gray-300 dark:stroke-gray-700"
                strokeWidth="2.5"
              />
              <circle
                cx="18"
                cy="18"
                r="15"
                fill="none"
                className="stroke-orange-500"
                strokeWidth="2.5"
                strokeDasharray="94.2"
                strokeDashoffset={94.2 - (94.2 * uploadProgress) / 100}
                strokeLinecap="round"
              />
            </svg>
            <span className="absolute text-[9px] font-bold text-orange-500">
              {uploadProgress}%
            </span>
          </div>
        ) : isBuffering ? (
          <div className="w-10 h-10 rounded-full bg-orange-500/10 flex items-center justify-center">
            <div className="w-5 h-5 rounded-full border-2 border-orange-500/30 border-t-orange-500 animate-spin" />
          </div>
        ) : !downloaded ? (
          <button
            onClick={handleToggle}
            type="button"
            aria-label="Download voice note"
            className="w-10 h-10 rounded-full bg-orange-500/10 text-orange-500 flex items-center justify-center active:scale-95 transition-transform"
          >
            <IonIcon icon={downloadOutline} className="text-xl" />
          </button>
        ) : (
          <button
            onClick={handleToggle}
            type="button"
            aria-label={isThisPlaying ? 'Pause voice note' : 'Play voice note'}
            className="w-10 h-10 rounded-full bg-orange-500 text-white flex items-center justify-center shadow-md active:scale-95 transition-transform"
          >
            <IonIcon
              icon={isThisPlaying ? pauseOutline : playOutline}
              className={`text-xl ${!isThisPlaying ? 'ml-0.5' : ''}`}
            />
          </button>
        )}
      </div>

      {/* Waveform track + duration */}
      <div className="flex-1 flex flex-col justify-center min-w-0">
        <div
          ref={waveformRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="h-8 flex items-center gap-[2.5px] cursor-pointer touch-none select-none py-1"
        >
          {bars.map((lvl, idx) => {
            const barFraction = idx / bars.length;
            const isFilled = isThisPlaying && barFraction <= progress;
            return (
              <div
                key={idx}
                style={{ height: `${Math.max(14, (lvl / 100) * 28)}px` }}
                className={`w-[2.5px] rounded-full transition-colors duration-75 ${
                  isFilled
                    ? '!bg-orange-500'
                    : isMe
                    ? 'bg-orange-950/30 dark:bg-orange-200/30'
                    : 'bg-gray-300 dark:bg-gray-600'
                }`}
              />
            );
          })}
        </div>

        <div className="flex items-center justify-between text-[11px] font-mono text-gray-500 dark:text-gray-400 -mt-0.5">
          <span>{formatDuration(displayTime)}</span>
        </div>
      </div>
    </div>
  );
};

export default VoiceNotePlayer;
