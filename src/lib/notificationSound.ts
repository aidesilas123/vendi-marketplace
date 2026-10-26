// src/lib/notificationSound.ts
//
// Custom notification sounds (Phase 3).
//
// Android plays a notification's sound from its CHANNEL, and channels persist
// once created — a per-message sound would lose to the channel's setting.
// So we pre-create one channel per tone (plus 'default' = system sound) and
// send-push picks the channel from the user's notification_preferences.sound.

import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';

export const CHANNEL_PREFIX = 'vendi_';

// ★ THE DEFAULT TONE — change this id anytime to change the default
// notification sound. Must be one of the ids in TONES below.
export const DEFAULT_TONE_ID = 'tone_penetrating';

export interface Tone {
  id: string; // stored in notification_preferences.sound; '' = system default
  name: string;
  /** res/raw filename (without extension) for the Android channel; null = system sound */
  raw: string | null;
  /** web preview file */
  preview: string | null;
}

export const TONES: Tone[] = [
  { id: 'default', name: 'Default', raw: null, preview: null },
  { id: 'tone_penetrating', name: 'Penetrating', raw: 'tone_penetrating', preview: '/sounds/tone_penetrating.ogg' },
  { id: 'tone_zero', name: 'Zero', raw: 'tone_zero', preview: '/sounds/tone_zero.ogg' },
  { id: 'tone_hard_wood', name: 'Hard Wood', raw: 'tone_hard_wood', preview: '/sounds/tone_hard_wood.ogg' },
  { id: 'tone_gentle', name: 'Gentle', raw: 'tone_gentle', preview: '/sounds/tone_gentle.ogg' },
  { id: 'tone_bubble_gum', name: 'Bubble Gum', raw: 'tone_bubble_gum', preview: '/sounds/tone_bubble_gum.ogg' },
];

export const toneIds = new Set(TONES.map((t) => t.id));

/** Channel id for a tone id (validated — falls back to the default tone). */
export function channelForTone(toneId: string | null | undefined): string {
  const id = toneId && toneIds.has(toneId) ? toneId : DEFAULT_TONE_ID;
  return `${CHANNEL_PREFIX}${id}`;
}

/**
 * Create every tone channel (idempotent). Call after login / on app start.
 * The channel's sound is fixed at creation, so one channel per tone lets the
 * user switch tones without a delete/recreate dance.
 */
export async function ensureToneChannels(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    for (const tone of TONES) {
      await PushNotifications.createChannel({
        id: `${CHANNEL_PREFIX}${tone.id}`,
        name: tone.id === 'default' ? 'Vendi notifications' : `Vendi notifications (${tone.name})`,
        description: 'Order, chat, wallet and marketplace updates',
        importance: 4, // high — heads-up + sound
        visibility: 1,
        ...(tone.raw ? { sound: tone.raw } : {}),
      });
    }
  } catch {
    // Channel creation must never break the app.
  }
}

/** Preview a tone in-app (web + native webview can both play the bundled ogg). */
export function previewTone(tone: Tone): void {
  if (!tone.preview) return;
  try {
    const audio = new Audio(tone.preview);
    void audio.play();
  } catch {}
}
