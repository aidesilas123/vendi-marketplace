"use client";
import { useEffect, useRef, useState } from 'react';

export function useHideOnScroll(containerId: string, threshold = 20, lockDurationMs = 450) {
  const [visible, setVisible] = useState(true);
  const visibleRef = useRef(true);
  
  // The absolute lock timer
  const lockTime = useRef(0);
  const lastY = useRef(0);

  useEffect(() => {
    const el = document.getElementById(containerId);
    if (!el) return;

    lastY.current = el.scrollTop;

    const handleScroll = () => {
      const now = Date.now();
      const currentY = el.scrollTop;

      // 1. TIME LOCK: If we recently toggled, ignore ALL layout-shift scroll noise.
      if (now - lockTime.current < lockDurationMs) {
        lastY.current = currentY; // Silently track Y so it doesn't jump later
        return;
      }

      // 2. IOS SAFEGUARD: Ignore overscroll/bounce at the very top of the screen
      if (currentY <= 0) {
        if (!visibleRef.current) {
          setVisible(true);
          visibleRef.current = true;
        }
        lastY.current = currentY;
        return;
      }

      const delta = currentY - lastY.current;

      // 3. Evaluate intentional movement against the threshold
      if (Math.abs(delta) > threshold) {
        if (delta > 0 && currentY > 60 && visibleRef.current) {
          // Scrolling Down -> Hide
          setVisible(false);
          visibleRef.current = false;
          lockTime.current = now; // Engage Lock!
        } else if (delta < 0 && !visibleRef.current) {
          // Scrolling Up -> Show
          setVisible(true);
          visibleRef.current = true;
          lockTime.current = now; // Engage Lock!
        }
        lastY.current = currentY;
      }
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [containerId, threshold, lockDurationMs]);

  return visible;
}