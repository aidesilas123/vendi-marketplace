"use client";
// src/shared/audio/sounds.ts

// File-based in-chat message sounds (replaces the old Web Audio synth).
// sent     -> public/sounds/msg_sent_kpo.ogg
// received -> public/sounds/message_received.ogg
// These play through the WebView, so they live in public/sounds only —
// no res/raw copy needed (those are for notification channels).

const FILES: Record<'sent' | 'received', string> = {
  sent: '/sounds/msg_sent_kpo.ogg',
  received: '/sounds/message_received.ogg',
};

export function playChatSound(type: 'sent' | 'received') {
  try {
    const audio = new Audio(FILES[type]);
    void audio.play().catch(() => {});
  } catch {
    // Autoplay restrictions or unavailable audio device — fail silently
  }
}
