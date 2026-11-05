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
  // Retry the push on a slow/flaky network: a single failed invoke used to
  // lose the push silently (no retry, no record). Bounded (3 tries, 1s +
  // 3s backoff) so a dead network doesn't hang the sender; never throws,
  // so a notification can never break the feature that triggered it.
  const delays = [1000, 3000];
  const body = {
    user_id: input.userId,
    type: input.type,
    title: input.title,
    body: input.body ?? '',
    route: input.route ?? '',
    data: input.data ?? {},
    imageUrl: input.imageUrl ?? '',
  };
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const { error } = await supabase.functions.invoke('send-push', { body });
      if (!error) return;
    } catch {
      // Network / invoke failure — retry below unless out of attempts.
    }
    if (attempt === delays.length) return;
    await new Promise((r) => setTimeout(r, delays[attempt]));
  }
}
