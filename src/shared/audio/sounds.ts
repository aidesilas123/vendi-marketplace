"use client";

// Web Audio API synthesizer for instant, zero-latency message sound effects.
// Uses local audio oscillators so it requires 0 external mp3 assets and works 100% offline.
export function playChatSound(type: 'sent' | 'received') {
  try {
    if (typeof window === 'undefined') return;
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;

    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;
    if (type === 'sent') {
      // Soft modern WhatsApp-style "pop" sound: 540Hz -> 760Hz
      osc.type = 'sine';
      osc.frequency.setValueAtTime(540, now);
      osc.frequency.exponentialRampToValueAtTime(760, now + 0.07);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
      osc.start(now);
      osc.stop(now + 0.07);
    } else {
      // Pleasant double-chime received note: 480Hz -> 880Hz
      osc.type = 'sine';
      osc.frequency.setValueAtTime(480, now);
      osc.frequency.setValueAtTime(880, now + 0.06);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      osc.start(now);
      osc.stop(now + 0.15);
    }

    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 250);
  } catch {
    // Audio autoplay restrictions or unsupported device — fail silently
  }
}
