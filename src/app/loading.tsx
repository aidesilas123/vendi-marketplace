// src/app/loading.tsx
// No spinner between page navigations: the zoom transition IS the
// feedback, and a spinner flashing between pages reads as a second
// transition on top of it. With no loading UI, Next keeps showing the
// current page until the new one is ready, then it zooms in — no blank,
// no spinner, one motion.
export default function Loading() {
  return null;
}
