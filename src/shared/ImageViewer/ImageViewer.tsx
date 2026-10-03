import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { IonIcon, isPlatform } from '@ionic/react';
import { closeOutline } from 'ionicons/icons';

interface ImageViewerProps {
  images: string[];
  isOpen: boolean;
  onClose: () => void;
  /** Which image to show first (defaults to 0) */
  initialIndex?: number;
}

/* ───────────────────────── tuning ───────────────────────── */
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
const DOUBLE_TAP_MS = 280;
const TAP_MAX_MS = 300;
const AXIS_LOCK_PX = 8;
const DISMISS_DISTANCE = 120; // px
const DISMISS_VELOCITY = 0.6; // px/ms
const SWIPE_VELOCITY = 0.35; // px/ms
const SWIPE_FRACTION = 0.2; // of viewport width
const DURATION = 300; // ms
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

type Mode = 'idle' | 'undecided' | 'swipe' | 'dismiss' | 'pan' | 'pinch';
interface Pt {
  x: number;
  y: number;
}
interface GestureState {
  index: number;
  // zoom of the active image
  scale: number;
  x: number;
  y: number;
  // carousel drag offset / dismiss drag offset
  dragX: number;
  dragY: number;
  mode: Mode;
  pointers: Map<number, Pt>;
  start: { x: number; y: number; time: number };
  panStart: Pt;
  pinch: { dist: number; scale: number; ux: number; uy: number };
  vx: number;
  vy: number;
  last: { x: number; y: number; t: number };
  lastTap: { t: number; x: number; y: number };
  moved: boolean;
  closing: boolean;
}

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

/** Elastic resistance once `v` goes past `limit` */
const rubber = (v: number, limit: number) => {
  const a = Math.abs(v);
  return a <= limit ? v : Math.sign(v) * (limit + (a - limit) * 0.35);
};

export const ImageViewer = ({ images, isOpen, onClose, initialIndex = 0 }: ImageViewerProps) => {
  // React state is only used for things that need a re-render (dots, which images are mounted).
  // Everything that changes on every pointer move is written straight to the DOM for 60fps.
  const [index, setIndex] = useState(initialIndex);

  const rootRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const chromeRef = useRef<HTMLDivElement>(null);
  const imgRefs = useRef<(HTMLImageElement | null)[]>([]);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const countRef = useRef(images.length);
  countRef.current = images.length;
  const closeTimer = useRef<number | undefined>(undefined);

  const g = useRef<GestureState>({
    index: 0,
    scale: 1,
    x: 0,
    y: 0,
    dragX: 0,
    dragY: 0,
    mode: 'idle',
    pointers: new Map(),
    start: { x: 0, y: 0, time: 0 },
    panStart: { x: 0, y: 0 },
    pinch: { dist: 1, scale: 1, ux: 0, uy: 0 },
    vx: 0,
    vy: 0,
    last: { x: 0, y: 0, t: 0 },
    lastTap: { t: 0, x: 0, y: 0 },
    moved: false,
    closing: false,
  });

  /* ───────────────────────── geometry ───────────────────────── */

  const size = () => ({
    w: rootRef.current?.clientWidth ?? 0,
    h: rootRef.current?.clientHeight ?? 0,
  });

  const center = () => {
    const r = rootRef.current?.getBoundingClientRect();
    return { cx: (r?.left ?? 0) + (r?.width ?? 0) / 2, cy: (r?.top ?? 0) + (r?.height ?? 0) / 2 };
  };

  /** Max pan distance (px) at a given scale, based on the *visible* (object-contain) image size */
  const bounds = (scale: number) => {
    const { w, h } = size();
    const img = imgRefs.current[g.current.index];
    let iw = w;
    let ih = h;
    if (img && img.naturalWidth && img.naturalHeight) {
      const fit = Math.min(w / img.naturalWidth, h / img.naturalHeight);
      iw = img.naturalWidth * fit;
      ih = img.naturalHeight * fit;
    }
    return { x: Math.max(0, (iw * scale - w) / 2), y: Math.max(0, (ih * scale - h) / 2) };
  };

  /* ───────────────────────── rendering ───────────────────────── */

  const render = (animated = false) => {
    const s = g.current;
    const { h } = size();
    const tf = animated ? `transform ${DURATION}ms ${EASE}` : 'none';

    const track = trackRef.current;
    if (track) {
      track.style.transition = tf;
      track.style.transform = `translate3d(calc(${-s.index * 100}% + ${s.dragX}px), 0, 0)`;
    }

    // progress of the swipe-to-dismiss (0 → 1)
    const p = Math.min(Math.abs(s.dragY) / ((h || 1) * 0.5), 1);

    const content = contentRef.current;
    if (content) {
      content.style.transition = animated ? `${tf}, opacity ${DURATION}ms linear` : 'none';
      content.style.transform = `translate3d(0, ${s.dragY}px, 0) scale(${1 - p * 0.15})`;
      content.style.opacity = s.closing ? '0' : '1';
    }

    const backdrop = backdropRef.current;
    if (backdrop) {
      backdrop.style.transition = animated ? `opacity ${DURATION}ms ${EASE}` : 'none';
      backdrop.style.opacity = String(1 - p);
    }

    const chrome = chromeRef.current;
    if (chrome) {
      chrome.style.transition = animated ? `opacity ${DURATION}ms ${EASE}` : 'none';
      chrome.style.opacity = String(1 - Math.min(p * 3, 1));
    }

    const img = imgRefs.current[s.index];
    if (img) {
      img.style.transition = tf;
      img.style.transform = `translate3d(${s.x}px, ${s.y}px, 0) scale(${s.scale})`;
    }
  };

  /** Return zoom to a valid resting state (clamp scale + pan) and clear drag offsets */
  const settleZoom = (animated = true) => {
    const s = g.current;
    const scale = clamp(s.scale, 1, MAX_SCALE);
    if (scale <= 1.01) {
      s.scale = 1;
      s.x = 0;
      s.y = 0;
    } else {
      const k = scale / s.scale;
      const b = bounds(scale);
      s.x = clamp(s.x * k, -b.x, b.x);
      s.y = clamp(s.y * k, -b.y, b.y);
      s.scale = scale;
    }
    s.dragX = 0;
    s.dragY = 0;
    render(animated);
  };

  const toggleZoom = (px: number, py: number) => {
    const s = g.current;
    if (s.scale > 1.01) {
      s.scale = 1;
      s.x = 0;
      s.y = 0;
    } else {
      const { cx, cy } = center();
      const target = DOUBLE_TAP_SCALE;
      const b = bounds(target);
      // keep the tapped point stationary while zooming in
      s.scale = target;
      s.x = clamp((px - cx) * (1 - target), -b.x, b.x);
      s.y = clamp((py - cy) * (1 - target), -b.y, b.y);
    }
    render(true);
  };

  const goTo = (next: number) => {
    const s = g.current;
    const prev = s.index;
    if (next !== prev) {
      // Reset the old image once it has slid out of view
      const old = imgRefs.current[prev];
      window.setTimeout(() => {
        if (old) {
          old.style.transition = 'none';
          old.style.transform = '';
        }
      }, DURATION + 20);
      s.index = next;
      s.scale = 1;
      s.x = 0;
      s.y = 0;
      setIndex(next);
    }
    s.dragX = 0;
    s.dragY = 0;
    render(true);
  };

  const commitSwipe = (vx: number) => {
    const s = g.current;
    const { w } = size();
    const last = countRef.current - 1;
    let next = s.index;
    if ((s.dragX < -w * SWIPE_FRACTION || vx < -SWIPE_VELOCITY) && s.index < last) next++;
    else if ((s.dragX > w * SWIPE_FRACTION || vx > SWIPE_VELOCITY) && s.index > 0) next--;

    if (next === s.index) settleZoom(true);
    else goTo(next);
  };

  /** Animate out, then tell the parent to close. Used by every close path. */
  const dismiss = (dir: 1 | -1 = 1) => {
    const s = g.current;
    if (s.closing) return;
    s.closing = true;
    s.mode = 'idle';
    s.pointers.clear();
    s.dragY = dir * size().h * 0.5;
    render(true);
    closeTimer.current = window.setTimeout(() => onCloseRef.current(), DURATION - 60);
  };

  /* ───────────────────────── lifecycle ───────────────────────── */

  // Reset everything each time the viewer opens (before paint → no flash)
  useLayoutEffect(() => {
    if (!isOpen) return;
    const start = clamp(initialIndex, 0, Math.max(images.length - 1, 0));
    const s = g.current;
    Object.assign(s, {
      index: start,
      scale: 1,
      x: 0,
      y: 0,
      dragX: 0,
      dragY: 0,
      mode: 'idle' as Mode,
      moved: false,
      closing: false,
    });
    s.pointers.clear();
    setIndex(start);
    render(false);
    return () => window.clearTimeout(closeTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialIndex]);

  // Hardware / browser back button closes ONLY the viewer
  useEffect(() => {
    if (!isOpen) return;

    // Native app (Capacitor / Cordova): hook into Ionic's back-button chain.
    // Priority 101 beats overlays (100), menus (99) and the router (0).
    if (isPlatform('hybrid')) {
      const onIonBack = (ev: Event) => {
        (ev as CustomEvent).detail.register(101, () => dismiss(1));
      };
      document.addEventListener('ionBackButton', onIonBack);
      return () => document.removeEventListener('ionBackButton', onIonBack);
    }

    // Mobile web / PWA: give the viewer its own history entry so "back" pops that entry
    const popped = { current: false };
    window.history.pushState({ ...window.history.state, __imageViewer: true }, '');
    const onPop = (e: PopStateEvent) => {
      if (e.state && e.state.__imageViewer) return;
      popped.current = true;
      dismiss(1);
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      // Closed via the X / swipe → remove the entry we added
      if (!popped.current && window.history.state && window.history.state.__imageViewer) {
        window.history.back();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Keyboard + wheel zoom (desktop) and keeping zoom valid on rotate/resize
  useEffect(() => {
    if (!isOpen) return;
    const el = rootRef.current;

    const onKey = (e: KeyboardEvent) => {
      const s = g.current;
      if (e.key === 'Escape') dismiss(1);
      else if (e.key === 'ArrowRight' && s.index < countRef.current - 1) goTo(s.index + 1);
      else if (e.key === 'ArrowLeft' && s.index > 0) goTo(s.index - 1);
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = g.current;
      const { cx, cy } = center();
      const next = clamp(s.scale * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)), 1, MAX_SCALE);
      const k = next / s.scale;
      s.x = e.clientX - cx - k * (e.clientX - cx - s.x);
      s.y = e.clientY - cy - k * (e.clientY - cy - s.y);
      s.scale = next;
      settleZoom(false);
    };

    const onResize = () => settleZoom(false);

    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    el?.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      el?.removeEventListener('wheel', onWheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  /* ───────────────────────── pointer gestures ───────────────────────── */

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = g.current;
    if (s.closing) return;
    if ((e.target as HTMLElement).closest('[data-no-gesture]')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (s.pointers.size === 1) {
      s.mode = 'undecided';
      s.start = { x: e.clientX, y: e.clientY, time: e.timeStamp };
      s.panStart = { x: s.x, y: s.y };
      s.last = { x: e.clientX, y: e.clientY, t: e.timeStamp };
      s.vx = 0;
      s.vy = 0;
      s.moved = false;
    } else if (s.pointers.size === 2) {
      const [a, b] = Array.from(s.pointers.values());
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const { cx, cy } = center();
      s.pinch = {
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        scale: s.scale,
        ux: (mid.x - cx - s.x) / s.scale,
        uy: (mid.y - cy - s.y) / s.scale,
      };
      s.mode = 'pinch';
      s.moved = true;
      if (s.dragX !== 0 || s.dragY !== 0) {
        s.dragX = 0;
        s.dragY = 0;
        render(false);
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = g.current;
    const p = s.pointers.get(e.pointerId);
    if (!p || s.closing) return;
    p.x = e.clientX;
    p.y = e.clientY;

    /* two fingers: pinch + two-finger pan */
    if (s.pointers.size >= 2) {
      if (s.mode !== 'pinch') return;
      const [a, b] = Array.from(s.pointers.values());
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const { cx, cy } = center();

      const raw = (s.pinch.scale * dist) / s.pinch.dist;
      const soft = raw < 1 ? 1 - (1 - raw) * 0.5 : raw > MAX_SCALE ? MAX_SCALE + (raw - MAX_SCALE) * 0.3 : raw;
      s.scale = Math.max(soft, 0.5);
      s.x = mid.x - cx - s.scale * s.pinch.ux;
      s.y = mid.y - cy - s.scale * s.pinch.uy;
      render(false);
      return;
    }

    /* one finger */
    const dt = Math.max(e.timeStamp - s.last.t, 1);
    s.vx = ((e.clientX - s.last.x) / dt) * 0.6 + s.vx * 0.4;
    s.vy = ((e.clientY - s.last.y) / dt) * 0.6 + s.vy * 0.4;
    s.last = { x: e.clientX, y: e.clientY, t: e.timeStamp };

    if (s.mode === 'idle') return;

    let dx = e.clientX - s.start.x;
    let dy = e.clientY - s.start.y;

    if (s.mode === 'undecided') {
      if (Math.hypot(dx, dy) < AXIS_LOCK_PX) return;
      s.moved = true;
      if (s.scale > 1.01) s.mode = 'pan';
      else s.mode = Math.abs(dx) > Math.abs(dy) ? 'swipe' : 'dismiss';
      // re-base so content doesn't jump by the lock distance
      s.start = { x: e.clientX, y: e.clientY, time: s.start.time };
      dx = 0;
      dy = 0;
    }

    const last = countRef.current - 1;

    if (s.mode === 'swipe') {
      const atEdge = (dx > 0 && s.index === 0) || (dx < 0 && s.index === last);
      s.dragX = atEdge ? dx * 0.3 : dx;
      render(false);
    } else if (s.mode === 'dismiss') {
      s.dragY = dy;
      render(false);
    } else if (s.mode === 'pan') {
      const b = bounds(s.scale);
      const rawX = s.panStart.x + dx;
      const rawY = s.panStart.y + dy;
      s.x = clamp(rawX, -b.x, b.x);
      // anything beyond the image edge slides the carousel (like the native photo app)
      let excess = rawX - s.x;
      if ((excess > 0 && s.index === 0) || (excess < 0 && s.index === last)) excess *= 0.3;
      s.dragX = excess;
      s.y = rubber(rawY, b.y);
      render(false);
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = g.current;
    if (!s.pointers.has(e.pointerId)) return;
    s.pointers.delete(e.pointerId);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }

    // One finger lifted during a pinch: settle zoom, let the other finger keep panning
    if (s.pointers.size > 0) {
      if (s.mode === 'pinch') {
        settleZoom(true);
        const [rest] = Array.from(s.pointers.values());
        s.start = { x: rest.x, y: rest.y, time: e.timeStamp };
        s.panStart = { x: s.x, y: s.y };
        s.last = { x: rest.x, y: rest.y, t: e.timeStamp };
        s.vx = 0;
        s.vy = 0;
        s.mode = s.scale > 1.01 ? 'undecided' : 'idle';
        s.moved = true;
      }
      return;
    }

    const mode = s.mode;
    s.mode = 'idle';
    const stale = e.timeStamp - s.last.t > 80;
    const vx = stale ? 0 : s.vx;
    const vy = stale ? 0 : s.vy;

    if (mode === 'undecided') {
      // a tap — check for double tap
      if (!s.moved && e.timeStamp - s.start.time < TAP_MAX_MS) {
        const t = s.lastTap;
        if (e.timeStamp - t.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 40) {
          s.lastTap = { t: 0, x: 0, y: 0 };
          toggleZoom(e.clientX, e.clientY);
        } else {
          s.lastTap = { t: e.timeStamp, x: e.clientX, y: e.clientY };
        }
      }
    } else if (mode === 'swipe') {
      commitSwipe(vx);
    } else if (mode === 'dismiss') {
      const flung = Math.abs(vy) > DISMISS_VELOCITY && Math.sign(vy) === Math.sign(s.dragY);
      if (Math.abs(s.dragY) > DISMISS_DISTANCE || flung) dismiss(s.dragY < 0 ? -1 : 1);
      else settleZoom(true);
    } else if (mode === 'pan') {
      if (s.dragX !== 0) commitSwipe(vx);
      else settleZoom(true);
    } else if (mode === 'pinch') {
      settleZoom(true);
    }
  };

  const onPointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = g.current;
    s.pointers.delete(e.pointerId);
    if (s.pointers.size === 0) {
      s.mode = 'idle';
      if (!s.closing) settleZoom(true);
    }
  };

  /* ───────────────────────── view ───────────────────────── */

  if (!isOpen) return null;

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
      className="fixed inset-0 z-[200] overflow-hidden select-none animate-in fade-in duration-200"
      style={{ touchAction: 'none', overscrollBehavior: 'contain', WebkitTouchCallout: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {/* Background (fades while dragging to dismiss) */}
      <div ref={backdropRef} className="absolute inset-0 bg-gray-50 dark:bg-[#0a1120]" />

      {/* Content (moves/scales while dragging to dismiss) */}
      <div ref={contentRef} className="absolute inset-0 will-change-transform">
        <div ref={trackRef} className="flex h-full w-full will-change-transform">
          {images.map((src, i) => (
            <div
              key={i}
              className="flex h-full w-full flex-none items-center justify-center overflow-hidden"
              aria-hidden={i !== index}
            >
              {/* Only mount the current image and its neighbours */}
              {Math.abs(i - index) <= 1 && (
                <img
                  ref={(el) => {
                    imgRefs.current[i] = el;
                  }}
                  src={src}
                  alt={`Fullscreen view ${i + 1} of ${images.length}`}
                  draggable={false}
                  className="pointer-events-none h-full w-full select-none object-contain will-change-transform"
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Close button + dots (fade while dragging) */}
      <div ref={chromeRef}>
        <div className="pointer-events-none absolute left-0 right-0 top-0 z-20 flex justify-end p-4 pt-safe">
          <button
            type="button"
            data-no-gesture
            aria-label="Close image viewer"
            onClick={() => dismiss(1)}
            className="pointer-events-auto border-none bg-transparent p-2 text-gray-900 outline-none dark:text-white"
          >
            <IonIcon icon={closeOutline} className="text-4xl drop-shadow-sm" />
          </button>
        </div>

        {images.length > 1 && (
          <div className="pointer-events-none absolute bottom-8 left-0 right-0 z-20 flex justify-center gap-2">
            {images.map((_, idx) => (
              <div
                key={idx}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  index === idx ? 'w-6 bg-orange-500' : 'w-2 bg-gray-300 dark:bg-gray-700'
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};