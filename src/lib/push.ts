// src/lib/push.ts
//
// Push notification registration for the native app (FCM via
// @capacitor/push-notifications). Web builds skip everything.
//
// Flow:
//   login  -> registerPushToken()  (permission -> FCM token -> user_push_tokens)
//   logout -> unregisterPushToken() (removes this device's token)
//   tap on a notification -> onAction(route) deep-links into the app.

import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import {
  PushNotifications,
  type Token,
  type ActionPerformed,
} from '@capacitor/push-notifications';
import { supabase } from '@/lib/supabase';
import { ensureToneChannels } from '@/lib/notificationSound';

const TOKEN_KEY = 'vendi_push_token';
let listenersAttached = false;

function attachListeners(onAction?: (route: string) => void) {
  if (listenersAttached) return;
  listenersAttached = true;

  // FCM token issued -> persist it for this user.
  PushNotifications.addListener('registration', async (token: Token) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !token.value) return;
      await Preferences.set({ key: TOKEN_KEY, value: token.value });
      await supabase.from('user_push_tokens').upsert(
        { user_id: user.id, token: token.value, platform: Capacitor.getPlatform() },
        { onConflict: 'user_id,token' }
      );
    } catch {
      // Push registration must never break the app.
    }
  });

  PushNotifications.addListener('registrationError', () => {
    // Permission denied or Play Services unavailable — silent.
  });

  // App is open when the push arrives: show the in-app banner (tap deep-links).
  // The bell/SWR also refreshes in the background.
  PushNotifications.addListener('pushNotificationReceived', (notification: any) => {
    try {
      const data = notification?.data ?? {};
      window.dispatchEvent(
        new CustomEvent('vendi-push-received', {
          detail: {
            title: notification?.title ?? '',
            body: notification?.body ?? '',
            route: (data as any)?.route ?? '',
          },
        })
      );
    } catch {
      // A banner must never break the app.
    }
  });

  // User tapped the notification -> deep link (payload: { data: { route } }).
  PushNotifications.addListener('pushNotificationActionPerformed', (action: ActionPerformed) => {
    const route = (action.notification?.data as any)?.route as string | undefined;
    if (route && onAction) onAction(route);
  });
}

/** Call after login (and on app start when a session exists). */
export async function registerPushToken(onAction?: (route: string) => void) {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { receive } = await PushNotifications.checkPermissions();
    if (receive !== 'granted') {
      const req = await PushNotifications.requestPermissions();
      if (req.receive !== 'granted') return;
    }
    attachListeners(onAction);
    await PushNotifications.register();
    // Pre-create one notification channel per tone so the user's chosen
    // sound just works (channel sound is fixed at creation).
    void ensureToneChannels();
  } catch {
    // Push unavailable — not fatal.
  }
}

/** Call on logout. Removes only this device's token. */
export async function unregisterPushToken() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { value } = await Preferences.get({ key: TOKEN_KEY });
    const { data: { user } } = await supabase.auth.getUser();
    if (user && value) {
      await supabase.from('user_push_tokens').delete().eq('user_id', user.id).eq('token', value);
    }
    await Preferences.remove({ key: TOKEN_KEY });
    await PushNotifications.unregister();
  } catch {
    // Best effort.
  }
}
