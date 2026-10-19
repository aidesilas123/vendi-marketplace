// src/lib/notify.ts
//
// Central notification pipeline. Every two-user touchpoint (chat, questions,
// orders/escrow, wallet, reviews, disputes, verification) calls notify() —
// one call writes the in-app notification row AND fires the push via the
// send-push edge function. Never throws: a notification must not break
// the feature that triggered it.

import { supabase } from '@/lib/supabase';

export type NotifyType =
  | 'chat'
  | 'question'
  | 'order'
  | 'wallet'
  | 'review'
  | 'verification'
  | 'dispute'
  | 'announcement';

export interface NotifyInput {
  userId: string;
  type: NotifyType;
  title: string;
  body?: string;
  /** Deep link opened on tap, e.g. "/order?ref=abc", "/questions", "/chats". */
  route?: string;
  /** Extra context for the detail page (amount, itemTitle, reference...). Values are stringified. */
  data?: Record<string, string>;
  /** Public image URL shown as the big-picture in the push notification. */
  imageUrl?: string;
}

export async function notify(input: NotifyInput): Promise<void> {
  try {
    await supabase.functions.invoke('send-push', {
      body: {
        user_id: input.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? '',
        route: input.route ?? '',
        data: input.data ?? {},
        imageUrl: input.imageUrl ?? '',
      },
    });
  } catch {
    // Notifications are fire-and-forget.
  }
}
