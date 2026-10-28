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
export const DEFAULT_TONE_ID = 'banner_pop';

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
  { id: 'banner_pop', name: 'Banner Pop', raw: 'banner_pop', preview: '/sounds/banner_pop.ogg' },
  { id: 'notification_decorative-01', name: 'Decorative 01', raw: 'notification_decorative_01', preview: '/sounds/notification_decorative_01.ogg' },
  { id: 'notification_decorative-02', name: 'Decorative 02', raw: 'notification_decorative_02', preview: '/sounds/notification_decorative_02.ogg' },
  { id: 'notification_simple-01', name: 'Simple 01', raw: 'notification_simple_01', preview: '/sounds/notification_simple_01.ogg' },
  { id: 'notification_simple-02', name: 'Simple 02', raw: 'notification_simple_02', preview: '/sounds/notification_simple_02.ogg' },
  { id: 'alert_high-intensity', name: 'High Intensity', raw: 'alert_high_intensity', preview: '/sounds/alert_high_intensity.ogg' },
  { id: 'hero_decorative-celebration-02', name: 'Celebration', raw: 'hero_decorative_celebration_02', preview: '/sounds/hero_decorative_celebration_02.ogg' },
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
