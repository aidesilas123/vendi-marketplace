"use client";

// Web Audio API synthesizer for instant, zero-latency message sound effects.
// Optimized for phone speakers (Android & iOS) as well as headphones.
let sharedCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) return null;

  if (!sharedCtx || sharedCtx.state === 'closed') {
    sharedCtx = new AudioContextClass();
  }
  return sharedCtx;
}

// Unlock audio context on user gesture (required by Chrome/Android WebViews)
if (typeof window !== 'undefined') {
  const unlock = () => {
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
  };
  window.addEventListener('touchstart', unlock, { passive: true, once: false });
  window.addEventListener('pointerdown', unlock, { passive: true, once: false });
}

export function playChatSound(type: 'sent' | 'received') {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    // WhatsApp-style pop for BOTH sent and received — one recognizable sound.
    // Crisp, audible pop tone that cuts through phone bottom speakers:
    // Uses triangle wave for harmonic warmth, frequency sweeps 680Hz -> 940Hz
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(680, now);
    osc.frequency.exponentialRampToValueAtTime(940, now + 0.08);

    gain.gain.setValueAtTime(0.45, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    osc.start(now);
    osc.stop(now + 0.08);
  } catch {
    // Autoplay restrictions or unavailable audio device — fail silently
  }
}
