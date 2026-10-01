import React, { useState, useRef, useEffect } from 'react';
import { IonIcon } from '@ionic/react';
import { closeOutline } from 'ionicons/icons';

interface ImageViewerProps {
  images: string[];
  isOpen: boolean;
  onClose: () => void;
}

export const ImageViewer = ({ images, isOpen, onClose }: ImageViewerProps) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [dragY, setDragY] = useState(0);
  
  const startY = useRef<number | null>(null);
  const startX = useRef<number | null>(null);
  const isDraggingY = useRef<boolean>(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Reset state when opened
  useEffect(() => {
    if (isOpen) {
      setCurrentIndex(0);
      setDragY(0);
      isDraggingY.current = false;
      if (scrollRef.current) scrollRef.current.scrollLeft = 0;
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const scrollLeft = e.currentTarget.scrollLeft;
    const width = e.currentTarget.offsetWidth;
    setCurrentIndex(Math.round(scrollLeft / width));
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    // Only track single-finger touches (ignore pinches)
    if (e.touches.length === 1) {
      startY.current = e.touches[0].clientY;
      startX.current = e.touches[0].clientX;
      isDraggingY.current = false;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (startY.current !== null && startX.current !== null && e.touches.length === 1) {
      const deltaY = e.touches[0].clientY - startY.current;
      const deltaX = e.touches[0].clientX - startX.current;
      
      // Determine if the user is swiping horizontally or vertically
      if (!isDraggingY.current) {
        if (Math.abs(deltaX) > Math.abs(deltaY)) {
          // Horizontal swipe: let native CSS snap scrolling handle it
          startY.current = null;
          startX.current = null;
          return;
        } else if (Math.abs(deltaY) > 8) {
          // Vertical swipe: lock into drag-to-close mode
          isDraggingY.current = true;
        }
      }

      if (isDraggingY.current) {
        setDragY(deltaY);
      }
    }
  };

  const handleTouchEnd = () => {
    // If swiped up or down by more than 100px, close the viewer
    if (Math.abs(dragY) > 100) {
      onClose();
    } else {
      // Snap back to center
      setDragY(0);
    }
    startY.current = null;
    startX.current = null;
    isDraggingY.current = false;
  };

  return (
    <div 
      className="fixed inset-0 z-[200] flex flex-col bg-gray-50 dark:bg-[#0a1120] animate-in fade-in zoom-in-95 duration-200"
      style={{
        // Fade out the background as the user drags up or down
        opacity: Math.max(1 - Math.abs(dragY) / 300, 0)
      }}
    >
      {/* Top Header (Close Button without background shadow) */}
      <div className="absolute top-0 left-0 right-0 p-4 pt-safe flex justify-end z-20 pointer-events-none">
        <button 
          onClick={onClose} 
          className="p-2 text-gray-900 dark:text-white transition-colors bg-transparent border-none outline-none pointer-events-auto"
        >
          <IonIcon icon={closeOutline} className="text-4xl drop-shadow-sm" />
        </button>
      </div>
      
      {/* Interactive Gallery Container */}
      <div 
        ref={scrollRef}
        className="flex-1 w-full h-full overflow-x-auto overflow-y-hidden snap-x snap-mandatory flex scrollbar-hide"
        onScroll={handleScroll}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          transform: `translateY(${dragY}px)`,
          transition: dragY === 0 ? 'transform 0.3s ease-out' : 'none',
          touchAction: 'pan-x pan-y pinch-zoom' // Allows native browser zooming
        }}
      >
        {images.map((img, i) => (
          <div key={i} className="min-w-full h-full snap-center flex items-center justify-center relative p-2 overflow-auto">
            <img 
              src={img} 
              className="w-full h-auto max-h-full object-contain" 
              alt={`Fullscreen View ${i + 1}`} 
            />
          </div>
        ))}
      </div>

      {/* Dots Indicator */}
      {images.length > 1 && (
        <div className="absolute bottom-8 left-0 right-0 flex justify-center gap-2 z-20 pointer-events-none transition-opacity duration-300"
             style={{ opacity: dragY !== 0 ? 0 : 1 }}>
          {images.map((_, idx) => (
            <div 
              key={idx} 
              className={`h-1.5 rounded-full transition-all duration-300 ${
                currentIndex === idx ? 'w-6 bg-orange-500' : 'w-2 bg-gray-300 dark:bg-gray-700'
              }`} 
            />
          ))}
        </div>
      )}
    </div>
  );
};