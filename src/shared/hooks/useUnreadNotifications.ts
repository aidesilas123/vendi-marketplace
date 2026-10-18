// src/shared/hooks/useUnreadNotifications.ts
//
// Shared unread-notification count. The Header bell badge and the
// /notifications page both read this key, so marking a notification
// read updates the badge instantly everywhere.

import useSWR from 'swr';
import { supabase } from '@/lib/supabase';

export const UNREAD_KEY = 'unread-notifications';

async function fetchUnreadCount(): Promise<number> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 0;
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('is_read', false);
  if (error) throw error;
  return count ?? 0;
}

export function useUnreadNotifications() {
  const { data, mutate } = useSWR(UNREAD_KEY, fetchUnreadCount, {
    revalidateOnFocus: true,
    dedupingInterval: 10000,
  });
  return { unread: data ?? 0, refreshUnread: mutate };
}
